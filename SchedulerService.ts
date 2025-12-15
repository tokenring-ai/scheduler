import {AgentManager} from "@tokenring-ai/agent";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import TokenRingApp from "@tokenring-ai/app";
import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import {z} from "zod";

const INTERVALS: Record<string, number> = {
  second: 1, seconds: 1,
  minute: 60, minutes: 60,
  hour: 3600, hours: 3600,
  day: 86400, days: 86400,
};

const WEEK_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
  message: z.string(),
});

export type ScheduleTask = z.infer<typeof ScheduleTaskSchema>;

interface TaskState {
  nextRun?: number;
  lastRun?: number;
  lastDay?: number;
  isRunning: boolean;
  startTime?: number;
  maxRunTime?: number;
}

interface TaskRunHistory {
  taskName: string;
  startTime: number;
  endTime?: number;
  error?: string;
}

export default class SchedulerService implements TokenRingService {
  name = "SchedulerService";
  description = "Schedules AI agents to run at specified intervals";
  
  private app: TokenRingApp;
  private tasks: ScheduleTask[];
  private taskStates: Map<number, TaskState> = new Map();
  private isRunning = false;
  private runHistory: TaskRunHistory[] = [];

  constructor(app: TokenRingApp, tasks: ScheduleTask[]) {
    this.app = app;
    this.tasks = tasks.map(t => ScheduleTaskSchema.parse(t));
    
    this.tasks.forEach((_, i) => {
      this.taskStates.set(i, { isRunning: false });
    });
  }

  async run(signal: AbortSignal): Promise<void> {
    this.isRunning = true;
    this.app.serviceOutput(`[SchedulerService] Starting with ${this.tasks.length} scheduled tasks`);

    //TODO: this is whacky, should just be a normal promise based timer loop
    this.app.scheduleEvery(10000, () => this.runTasks());

    return waitForAbort(signal, async (ev) => {
      this.isRunning = false;
      this.app.serviceOutput(`[SchedulerService] Stopped`);
    });
  }

  private async runTasks(): Promise<void> {
    if (!this.isRunning) return;
    
    const now = Date.now() / 1000;

    for (let i = 0; i < this.tasks.length; i++) {
      const task = this.tasks[i];
      const state = this.taskStates.get(i)!;

      if (state.isRunning && !task.several) {
        if (state.maxRunTime && now > state.maxRunTime) {
          const runtime = now - (state.startTime || 0);
          this.app.serviceError(`[SchedulerService] Task ${task.name} exceeded max runtime`);
        }
        continue;
      }

      if (!state.nextRun) {
        this.retimeTask(i);
      }

      if (state.nextRun && state.nextRun <= now) {
        state.lastRun = now;
        delete state.nextRun;
        this.app.trackPromise(this.runTask(i));
      }
    }
  }

  private retimeTask(taskIndex: number): void {
    const task = this.tasks[taskIndex];
    const state = this.taskStates.get(taskIndex)!;
    const now = new Date();

    if (task.dayOfMonth !== undefined && task.dayOfMonth !== now.getDate()) return;
    
    if (task.on) {
      const weekDay = WEEK_DAYS[now.getDay()];
      if (!task.on.toLowerCase().includes(weekDay)) return;
    }

    if (task.from) {
      const [fromHour, fromMin] = task.from.split(':').map(Number);
      if (now.getHours() < fromHour || (now.getHours() === fromHour && now.getMinutes() < fromMin)) return;
    }

    if (task.to) {
      const [toHour, toMin] = task.to.split(':').map(Number);
      if (now.getHours() > toHour || (now.getHours() === toHour && now.getMinutes() > toMin)) return;
    }

    if (task.every) {
      const interval = this.parseInterval(task.every);
      if (interval) {
        state.nextRun = state.lastRun ? state.lastRun + interval : Date.now() / 1000;
        this.app.serviceOutput(`[SchedulerService] Scheduled ${task.name} at ${new Date(state.nextRun * 1000).toLocaleString()}`);
      }
      return;
    }

    if (task.spaced) {
      const interval = this.parseInterval(task.spaced);
      if (interval) {
        state.nextRun = Date.now() / 1000 + interval;
        this.app.serviceOutput(`[SchedulerService] Scheduled ${task.name} at ${new Date(state.nextRun * 1000).toLocaleString()}`);
      }
      return;
    }

    if (task.once) {
      const today = now.getDate();
      if (state.lastDay !== today) {
        state.nextRun = Date.now() / 1000;
        state.lastDay = today;
        this.app.serviceOutput(`[SchedulerService] Scheduled ${task.name} to run once`);
      }
    }
  }

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
      const agent = await agentManager.spawnAgent({ agentType: task.agentType, headless: true });
      
      const initialState = await agent.waitForState(AgentEventState, (state) => state.idle);
      const eventCursor = initialState.getEventCursorFromCurrentPosition();
      const requestId = agent.handleInput({ message: task.message });

      const unsubscribe = agent.subscribeState(AgentEventState, (state) => {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          if (event.type === "output.system") {
            this.app.serviceOutput(`[SchedulerService:${task.name}] ${event.message}`);
          } else if (event.type === "input.handled" && event.requestId === requestId) {
            unsubscribe();

            agent.config.idleTimeout = 3600_000; // Leave agent alive for 1 hour
            //this.app.trackPromise(agentManager.deleteAgent(agent));
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

  getStatus() {
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

  private parseInterval(interval: string): number | null {
    const match = interval.match(/^\s*(\d+)\s+(\w+)\s*$/);
    if (!match) return null;
    
    const [, num, unit] = match;
    const multiplier = INTERVALS[unit.toLowerCase()];
    return multiplier ? parseInt(num) * multiplier : null;
  }
}
