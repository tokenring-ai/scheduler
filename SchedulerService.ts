import {AgentManager} from "@tokenring-ai/agent";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import {AgentExecutionState} from "@tokenring-ai/agent/state/agentExecutionState";
import TokenRingApp from "@tokenring-ai/app";
import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import {z} from "zod";
import moment from "moment-timezone";

/**
 * Mapping of interval unit names to their equivalent in seconds.
 */
const INTERVALS: Record<string, number> = {
  second: 1, seconds: 1,
  minute: 60, minutes: 60,
  hour: 3600, hours: 3600,
  day: 86400, days: 86400,
};

/**
 * Zod schema for validating scheduled task configuration.
 *
 * @property {string} name - Unique name identifying the task.
 * @property {string} agentType - The type of agent to spawn for this task.
 * @property {string} [every] - Interval string for recurring tasks (e.g., "5 minutes").
 * @property {string} [spaced] - Interval string; schedules next run after current run completes.
 * @property {boolean} [once] - If true, run only once per day within the specified time window.
 * @property {string} [from] - Start of the time window in "HH:mm" format.
 * @property {string} [to] - End of the time window in "HH:mm" format.
 * @property {string} [on] - Space-separated weekday abbreviations (e.g., "mon tue wed thu fri").
 * @property {number} [dayOfMonth] - Specific day of the month (1-31) to run the task.
 * @property {string} [noLongerThan] - Maximum allowed runtime for the task (e.g., "30 minutes").
 * @property {boolean} [several] - If true, allows multiple concurrent instances of the task.
 * @property {string} [timezone] - IANA timezone string (e.g., "America/New_York"). Defaults to system timezone.
 * @property {string} message - The message/command to send to the spawned agent.
 */
export const ScheduleTaskSchema = z.object({
  name: z.string(),
  agentType: z.string(),
  every: z.string().optional(),
  spaced: z.string().optional(),
  once: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  on: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  noLongerThan: z.string().optional(),
  several: z.boolean().optional(),
  timezone: z.string().optional(),
  message: z.string(),
});

/**
 * Type definition for a scheduled task, inferred from the Zod schema.
 */
export type ScheduleTask = z.infer<typeof ScheduleTaskSchema>;

/**
 * Internal state tracking for each scheduled task.
 */
interface TaskState {
  /** Unix timestamp (seconds) of the next scheduled run. */
  nextRun?: number;
  /** Unix timestamp (seconds) of the last completed run. */
  lastRun?: number;
  /** Day of the month when the task last ran (used for `once` tasks). */
  lastDay?: number;
  /** Whether the task is currently executing. */
  isRunning: boolean;
  /** Unix timestamp (seconds) when the current run started. */
  startTime?: number;
  /** Unix timestamp (seconds) after which the task should be terminated. */
  maxRunTime?: number;
}

/**
 * Record of a task execution for history tracking.
 */
interface TaskRunHistory {
  /** Name of the task that was executed. */
  taskName: string;
  /** Unix timestamp (seconds) when execution started. */
  startTime: number;
  /** Unix timestamp (seconds) when execution ended. */
  endTime?: number;
  /** Error message if the task failed. */
  error?: string;
}

/**
 * A service that schedules and runs AI agents at specified intervals or times.
 *
 * Supports multiple scheduling modes:
 * - **every**: Run repeatedly at a fixed interval while within the time window.
 * - **spaced**: Run repeatedly, but the interval is measured from the end of the previous run.
 * - **once**: Run once per day within the specified time window.
 *
 * Tasks can be constrained by:
 * - Time windows (`from`/`to`)
 * - Specific weekdays (`on`)
 * - Specific day of the month (`dayOfMonth`)
 * - Timezone (`timezone`)
 *
 * @example
 * ```typescript
 * const tasks: ScheduleTask[] = [
 *   {
 *     name: "Morning Report",
 *     agentType: "reporter",
 *     message: "/report generate",
 *     once: true,
 *     from: "09:00",
 *     to: "09:30",
 *     on: "mon tue wed thu fri",
 *     timezone: "America/New_York"
 *   }
 * ];
 *
 * const scheduler = new SchedulerService(app, tasks);
 * ```
 */
export default class SchedulerService implements TokenRingService {
  /** Service name for identification. */
  name = "SchedulerService";

  /** Human-readable description of the service. */
  description = "Schedules AI agents to run at specified intervals";

  /** Reference to the main application instance. */
  private app: TokenRingApp;

  /** List of validated scheduled tasks. */
  private readonly tasks: ScheduleTask[];

  /** Map of task index to its current state. */
  private taskStates: Map<number, TaskState> = new Map();

  /** Flag indicating whether the service is actively running. */
  private isRunning = false;

  /** History of task executions. */
  private runHistory: TaskRunHistory[] = [];

  /**
   * Creates a new SchedulerService instance.
   *
   * @param app - The TokenRing application instance.
   * @param tasks - Array of task configurations to schedule.
   * @throws {z.ZodError} If any task configuration fails validation.
   */
  constructor(app: TokenRingApp, tasks: ScheduleTask[]) {
    this.app = app;
    this.tasks = tasks.map(t => ScheduleTaskSchema.parse(t));

    this.tasks.forEach((_, i) => {
      this.taskStates.set(i, {isRunning: false});
    });
  }

  /**
   * Starts the scheduler service.
   *
   * Initializes all task schedules and begins the polling loop that checks
   * for tasks ready to run every 10 seconds.
   *
   * @param signal - AbortSignal to stop the service gracefully.
   * @returns Promise that resolves when the service is stopped.
   */
  async run(signal: AbortSignal): Promise<void> {
    this.isRunning = true;
    this.app.serviceOutput(`[SchedulerService] Starting with ${this.tasks.length} scheduled tasks`);

    // Initialize nextRun for all tasks
    for (let i = 0; i < this.tasks.length; i++) {
      this.retimeTask(i);
    }

    //TODO: this is whacky, should just be a normal promise based timer loop
    this.app.scheduleEvery(10000, () => this.runTasks());

    return waitForAbort(signal, async () => {
      this.isRunning = false;
      this.app.serviceOutput(`[SchedulerService] Stopped`);
    });
  }

  /**
   * Main task polling loop. Checks all tasks and runs those that are due.
   *
   * Called periodically by the scheduler. For each task:
   * 1. Skips if already running (unless `several` is true).
   * 2. Calculates next run time if not set.
   * 3. Executes the task if its scheduled time has passed and conditions are met.
   *
   * @private
   */
  private async runTasks(): Promise<void> {
    if (!this.isRunning) return;

    const now = Date.now() / 1000;

    for (let i = 0; i < this.tasks.length; i++) {
      const task = this.tasks[i];
      const state = this.taskStates.get(i)!;

      if (state.isRunning && !task.several) {
        //TODO: this should kill the task or something?
        if (state.maxRunTime && now - (state.startTime || 0) > state.maxRunTime) {
          this.app.serviceError(`[SchedulerService] Task ${task.name} exceeded max runtime`);
        }
        continue;
      }

      if (!state.nextRun) {
        this.retimeTask(i);
      }

      if (state.nextRun && state.nextRun <= now) {
        const currentMoment = this.getMomentInTaskTimezone(task);
        if (this.checkTaskConditions(task, currentMoment)) {
          state.lastRun = now;
          delete state.nextRun;
          this.app.trackPromise(() => this.runTask(i));
        } else {
          delete state.nextRun;
          this.retimeTask(i);
        }
      }
    }
  }

  /**
   * Calculates and sets the next run time for a task.
   *
   * Handles three scheduling modes:
   * - **every**: Schedules the next run at a fixed interval from the last run.
   * - **spaced**: Schedules the next run at a fixed interval (called after task completes).
   * - **once**: Schedules a single run at the `from` time, once per day.
   *
   * @param taskIndex - Index of the task in the tasks array.
   * @private
   */
  private retimeTask(taskIndex: number): void {
    const task = this.tasks[taskIndex];
    const state = this.taskStates.get(taskIndex)!;
    const now = this.getMomentInTaskTimezone(task);

    if (task.every) {
      this.retimeEveryTask(task, state, now);
      return;
    }

    if (task.spaced) {
      this.retimeSpacedTask(task, state);
      return;
    }

    if (task.once) {
      this.retimeOnceTask(task, state, now);
    }
  }

  /**
   * Calculates next run time for tasks with `every` interval.
   *
   * Only schedules if currently within the task's time window.
   *
   * @param task - The task configuration.
   * @param state - The task's current state.
   * @param now - Current moment in the task's timezone.
   * @private
   */
  private retimeEveryTask(task: ScheduleTask, state: TaskState, now: moment.Moment): void {
    const inTimeWindow = this.checkTimeWindowConditions(task, now);
    if (inTimeWindow) {
      const interval = this.parseInterval(task.every!);
      if (interval) {
        const currentTimeSeconds = Date.now() / 1000;
        state.nextRun = state.lastRun ? state.lastRun + interval : currentTimeSeconds + interval;
        if (state.nextRun < currentTimeSeconds) {
          state.nextRun = currentTimeSeconds + interval;
        }
        this.logScheduledTask(task, state.nextRun);
      }
    }
  }

  /**
   * Calculates next run time for tasks with `spaced` interval.
   *
   * Always schedules the next run from the current time.
   *
   * @param task - The task configuration.
   * @param state - The task's current state.
   * @private
   */
  private retimeSpacedTask(task: ScheduleTask, state: TaskState): void {
    const interval = this.parseInterval(task.spaced!);
    if (interval) {
      state.nextRun = (Date.now() / 1000) + interval;
      this.logScheduledTask(task, state.nextRun);
    }
  }

  /**
   * Calculates next run time for `once` per day tasks.
   *
   * If the scheduled time has passed but we're still in the window, runs immediately.
   * Otherwise, schedules for the `from` time.
   *
   * @param task - The task configuration.
   * @param state - The task's current state.
   * @param now - Current moment in the task's timezone.
   * @private
   */
  private retimeOnceTask(task: ScheduleTask, state: TaskState, now: moment.Moment): void {
    const today = now.date();

    if (state.lastDay === today) {
      // Already ran or scheduled for today
      return;
    }

    // Check day-of-week and day-of-month conditions before scheduling
    if (!this.checkDayConditions(task, now)) {
      return;
    }

    const [fromHour, fromMin] = (task.from || "00:00").split(':').map(Number);
    const runTime = now.clone().hour(fromHour).minute(fromMin).second(0).millisecond(0);

    if (runTime.isBefore(now)) {
      // Scheduled time has passed for today
      if (this.checkTimeWindowConditions(task, now)) {
        // Still within the time window, run immediately
        state.lastDay = today;
        state.nextRun = Date.now() / 1000;
        this.logScheduledTask(task, state.nextRun);
      }
      // If outside window, don't schedule (will retry tomorrow)
    } else {
      // Schedule for the future `from` time
      state.lastDay = today;
      state.nextRun = runTime.unix();
      this.logScheduledTask(task, state.nextRun);
    }
  }

  /**
   * Checks if all conditions for running a task are satisfied.
   *
   * Validates:
   * - Day of month (if specified)
   * - Day of week (if specified)
   * - Time window (from/to)
   *
   * @param task - The task configuration.
   * @param now - Current moment in the task's timezone.
   * @returns True if all conditions are met, false otherwise.
   * @private
   */
  private checkTaskConditions(task: ScheduleTask, now: moment.Moment): boolean {
    if (!this.checkDayConditions(task, now)) {
      return false;
    }

    return this.checkTimeWindowConditions(task, now);
  }

  /**
   * Checks if the day-based conditions for a task are satisfied.
   *
   * Validates:
   * - Day of month (if specified)
   * - Day of week (if specified)
   *
   * @param task - The task configuration.
   * @param now - Current moment in the task's timezone.
   * @returns True if day conditions are met, false otherwise.
   * @private
   */
  private checkDayConditions(task: ScheduleTask, now: moment.Moment): boolean {
    if (task.dayOfMonth !== undefined && task.dayOfMonth !== now.date()) {
      return false;
    }

    if (task.on) {
      const weekDay = now.format('ddd').toLowerCase();
      if (!task.on.toLowerCase().includes(weekDay)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Checks if the current time is within the task's time window.
   *
   * Compares current time against `from` and `to` boundaries.
   *
   * @param task - The task configuration.
   * @param now - Current moment in the task's timezone.
   * @returns True if within the time window (or no window specified), false otherwise.
   * @private
   */
  private checkTimeWindowConditions(task: ScheduleTask, now: moment.Moment): boolean {
    if (task.from) {
      const [h, m] = task.from.split(':').map(Number);
      const fromTime = now.clone().hour(h).minute(m).second(0);
      if (now.isBefore(fromTime)) {
        return false;
      }
    }

    if (task.to) {
      const [h, m] = task.to.split(':').map(Number);
      const toTime = now.clone().hour(h).minute(m).second(59);
      if (now.isAfter(toTime)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Executes a scheduled task by spawning an agent and sending it a message.
   *
   * Handles:
   * - Agent spawning and lifecycle
   * - Runtime tracking and limits
   * - Error capture and history recording
   * - Re-scheduling for `spaced` tasks
   *
   * @param taskIndex - Index of the task to run.
   * @private
   */
  private async runTask(taskIndex: number): Promise<void> {
    const task = this.tasks[taskIndex];
    const state = this.taskStates.get(taskIndex)!;
    const agentManager = this.app.requireService(AgentManager);

    state.isRunning = true;
    state.startTime = Date.now() / 1000;

    const historyEntry: TaskRunHistory = {
      taskName: task.name,
      startTime: state.startTime,
    };
    this.runHistory.push(historyEntry);

    if (task.noLongerThan) {
      const maxRunSeconds = this.parseInterval(task.noLongerThan);
      if (maxRunSeconds) {
        state.maxRunTime = state.startTime + maxRunSeconds;
      }
    }

    this.app.serviceOutput(`[SchedulerService] Running task: ${task.name}`);

    try {
      const agent = await agentManager.spawnAgent({agentType: task.agentType, headless: true});

      await agent.waitForState(AgentExecutionState, (state) => state.idle);
      const eventCursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();
      const requestId = agent.handleInput({message: task.message});

      const unsubscribe = agent.subscribeState(AgentEventState, (state) => {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'output.info':
            case 'output.warning':
            case 'output.error':
              this.app.serviceError(`[SchedulerService:${task.name}] ${event.message}`);
              break;
            case 'input.handled':
              if (event.requestId === requestId) {
                unsubscribe();

                agent.config.idleTimeout = 3600_000; // Leave agent alive for 1 hour
                //this.app.trackPromise(agentManager.deleteAgent(agent));
              }
              return;
          }
        }
      });
    } catch (error) {
      this.app.serviceError(`[SchedulerService] Error running task ${task.name}:`, error);
      historyEntry.error = String(error);
    } finally {
      historyEntry.endTime = Date.now() / 1000;
      state.isRunning = false;
      delete state.startTime;
      delete state.maxRunTime;

      if (task.spaced) {
        this.retimeTask(taskIndex);
      }
    }
  }

  /**
   * Returns the current status of all scheduled tasks and execution history.
   *
   * @returns Object containing task states and run history.
   *
   * @example
   * ```typescript
   * const status = scheduler.getStatus();
   * console.log(status.tasks); // Array of task statuses
   * console.log(status.history); // Array of past executions
   * ```
   */
  getStatus(): { tasks: Array<{ name: string; agentType: string; message: string; isRunning: boolean; nextRun?: number; lastRun?: number }>; history: TaskRunHistory[] } {
    return {
      tasks: this.tasks.map((task, i) => {
        const state = this.taskStates.get(i)!;
        return {
          name: task.name,
          agentType: task.agentType,
          message: task.message,
          isRunning: state.isRunning,
          nextRun: state.nextRun,
          lastRun: state.lastRun,
        };
      }),
      history: this.runHistory,
    };
  }

  /**
   * Parses an interval string into seconds.
   *
   * @param interval - Interval string in the format "N unit" (e.g., "5 minutes", "1 hour").
   * @returns Number of seconds, or null if the format is invalid.
   *
   * @example
   * ```typescript
   * parseInterval("5 minutes"); // 300
   * parseInterval("2 hours");   // 7200
   * parseInterval("invalid");   // null
   * ```
   * @private
   */
  private parseInterval(interval: string): number | null {
    const match = interval.match(/^\s*(\d+)\s+(\w+)\s*$/);
    if (!match) return null;

    const [, num, unit] = match;
    const multiplier = INTERVALS[unit.toLowerCase()];
    return multiplier ? parseInt(num) * multiplier : null;
  }

  /**
   * Gets the current moment in the task's configured timezone.
   *
   * Falls back to the system's local timezone if no timezone is specified.
   *
   * @param task - The task configuration.
   * @returns Moment instance in the appropriate timezone.
   * @private
   */
  private getMomentInTaskTimezone(task: ScheduleTask): moment.Moment {
    return task.timezone ? moment().tz(task.timezone) : moment();
  }

  /**
   * Logs a message indicating when a task is scheduled to run.
   *
   * @param task - The task configuration.
   * @param nextRunUnix - Unix timestamp (seconds) of the next run.
   * @private
   */
  private logScheduledTask(task: ScheduleTask, nextRunUnix: number): void {
    const tz = task.timezone || moment.tz.guess();
    const formattedTime = moment.unix(nextRunUnix).tz(tz).format('YYYY-MM-DD HH:mm:ss z');
    this.app.serviceOutput(`[SchedulerService] Scheduled ${task.name} at ${formattedTime}`);
  }
}