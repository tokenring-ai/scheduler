import type Agent from "@tokenring-ai/agent/Agent";
import { AgentEventState } from "@tokenring-ai/agent/state/agentEventState";
import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { ConfigurationError } from "@tokenring-ai/app/types";
import deepClone from "@tokenring-ai/utility/object/deepClone";
import isEmpty from "@tokenring-ai/utility/object/isEmpty";
import { type ParsedSchedulerConfig, type ScheduledTask, SchedulerAgentConfigSchema, SchedulerConfigSchema } from "./schema.ts";
import { ScheduleExecutionState } from "./state/scheduleExecutionState.ts";
import { ScheduleTaskState } from "./state/scheduleTaskState.ts";
import { getNextRunTime } from "./utility/getNextRunTime.ts";

export default class SchedulerService implements TokenRingService {
  readonly name = "SchedulerService";
  description = "Schedules AI agents to run at specified intervals";

  private options = SchedulerConfigSchema.parse({});

  constructor(private app: TokenRingApp) {}

  reconfigure(newConfig: ParsedSchedulerConfig): void {
    this.options = newConfig;
  }

  attach(agent: Agent): void {
    const config = deepClone(this.options.agentDefaults, agent.getAgentConfigSlice("scheduler", SchedulerAgentConfigSchema));

    agent.initializeState(ScheduleTaskState, config);
    agent.initializeState(ScheduleExecutionState, config);

    if (config.autoStart && Object.keys(config.tasks).length > 0) {
      this.runScheduler(agent);
    }
  }

  runScheduler(agent: Agent): void {
    const execState = agent.getState(ScheduleExecutionState);
    if (execState.abortController) {
      agent.warningMessage("Scheduler is already running, not starting scheduler.");
      return;
    }

    const taskState = agent.getState(ScheduleTaskState);
    if (isEmpty(taskState.tasks)) {
      agent.warningMessage("No tasks found for scheduler, not starting scheduler.");
      return;
    }

    agent.infoMessage(`Starting scheduler with ${taskState.tasks.size} tasks`);

    const abortController = new AbortController();
    agent.mutateState(ScheduleExecutionState, state => {
      state.abortController = abortController;
    });
    const handleAbort = () => abortController.abort();

    agent.runBackgroundTask(async signal => {
      signal.addEventListener("abort", handleAbort);
      try {
        await this.watchTasks(agent, abortController.signal);
        agent.infoMessage("Scheduler complete");
      } catch (error: unknown) {
        agent.errorMessage("Error while running scheduler: ", error as Error);
      } finally {
        signal.removeEventListener("abort", handleAbort);
      }
      agent.mutateState(ScheduleExecutionState, state => {
        state.abortController = null;
        for (const [taskName, task] of state.tasks) {
          if (task.timer) {
            agent.debugMessage(`Cancelling timer for task ${taskName}`);
            clearTimeout(task.timer);
            state.tasks.delete(taskName);
          } else if (task.abortController) {
            agent.debugMessage(`Aborting running task ${taskName}`);
            task.abortController.abort();
            // The task will delete itself at abort
          } else {
            agent.debugMessage(`Task ${taskName} is not running and has no timer, deleting task`);
            state.tasks.delete(taskName);
          }
        }
      });
    });
  }

  stopScheduler(agent: Agent): void {
    const execState = agent.getState(ScheduleExecutionState);
    if (!execState.abortController) {
      agent.warningMessage("Scheduler is not running");
      return;
    }
    execState.abortController.abort();
  }

  addTask(name: string, task: ScheduledTask, agent: Agent): void {
    agent.mutateState(ScheduleTaskState, state => {
      state.tasks.set(name, task);
    });

    const executionState = agent.getState(ScheduleExecutionState);
    if (executionState.autoStart && executionState.abortController == null) {
      this.runScheduler(agent);
    }
  }

  removeTask(name: string, agent: Agent): void {
    const taskState = agent.getState(ScheduleTaskState);
    if (!taskState.tasks.has(name)) {
      throw new ConfigurationError(this.name, `Task not found: ${name}`);
    }

    agent.mutateState(ScheduleExecutionState, execState => {
      const execEntry = execState.tasks.get(name);
      if (execEntry) {
        if (execEntry.timer) {
          clearTimeout(execEntry.timer);
        }
        if (execEntry.abortController) {
          agent.debugMessage(`Aborting running task ${name} during removal`);
          execEntry.abortController.abort();
        }
        execState.tasks.delete(name);
      }
    });

    agent.mutateState(ScheduleTaskState, state => {
      state.tasks.delete(name);
    });
  }

  /**
   * Replace a task's definition in place. The run bookkeeping (`lastRunTime`)
   * is kept, so editing a schedule does not make it fire again immediately;
   * the scheduler reschedules the task from the new definition.
   */
  updateTask(name: string, task: ScheduledTask, agent: Agent): void {
    const existing = agent.getState(ScheduleTaskState).tasks.get(name);
    if (!existing) {
      throw new ConfigurationError(this.name, `Task not found: ${name}`);
    }
    agent.mutateState(ScheduleTaskState, state => {
      state.tasks.set(name, { ...task, lastRunTime: existing.lastRunTime });
    });
  }

  /** Pause (`false`) or resume (`true`) a task without removing it. A running task finishes its current run. */
  setTaskEnabled(name: string, enabled: boolean, agent: Agent): void {
    const existing = agent.getState(ScheduleTaskState).tasks.get(name);
    if (!existing) {
      throw new ConfigurationError(this.name, `Task not found: ${name}`);
    }
    agent.mutateState(ScheduleTaskState, state => {
      const next: ScheduledTask = { ...existing };
      if (enabled) delete next.enabled;
      else next.enabled = false;
      state.tasks.set(name, next);
    });
  }

  /** Clear the run history of one task, or of every task when `name` is omitted. */
  clearHistory(agent: Agent, name?: string): void {
    agent.mutateState(ScheduleTaskState, state => {
      if (name === undefined) state.history.clear();
      else state.history.delete(name);
    });
  }

  async watchTasks(agent: Agent, signal: AbortSignal) {
    for await (const taskState of agent.subscribeStateAsync(ScheduleTaskState, signal)) {
      const now = Date.now();

      agent.mutateState(ScheduleExecutionState, executionState => {
        for (const [taskName, task] of taskState.tasks) {
          const executionEntry = executionState.tasks.get(taskName);
          if (executionEntry) {
            // Task is already in execution state, check if it needs to be rescheduled
            if (executionEntry.status !== "pending") continue;

            const nextRunTime = getNextRunTime(task);
            if (executionEntry.nextRunTime !== nextRunTime) {
              if (executionEntry.timer) clearTimeout(executionEntry.timer);
              executionEntry.nextRunTime = nextRunTime;

              executionEntry.timer = nextRunTime ? setTimeout(() => this.runTask(taskName, task, agent), nextRunTime - now) : undefined;
            }
          } else {
            // Task is not in execution state, schedule it
            const nextRunTime = getNextRunTime(task);
            if (nextRunTime) {
              executionState.tasks.set(taskName, {
                nextRunTime,
                status: "pending",
                timer: nextRunTime ? setTimeout(() => this.runTask(taskName, task, agent), nextRunTime - now) : undefined,
              });
            }
          }
        }

        for (const execName of executionState.tasks.keysArray()) {
          if (taskState.tasks.has(execName)) continue;
          const entry = executionState.tasks.get(execName);
          if (entry?.timer) clearTimeout(entry.timer);
          if (entry?.abortController) entry.abortController.abort();
          executionState.tasks.delete(execName);
        }
      });
    }
  }

  /**
   * Run a task immediately, outside its schedule. Any pending timer for the
   * task is cancelled; when the run finishes the scheduler (if running)
   * reschedules it from the new lastRunTime, and a `once` task is not
   * scheduled again.
   */
  runTaskNow(name: string, agent: Agent): void {
    const task = agent.getState(ScheduleTaskState).tasks.get(name);
    if (!task) {
      throw new ConfigurationError(this.name, `Task not found: ${name}`);
    }

    if (agent.getState(ScheduleExecutionState).tasks.get(name)?.status === "running") {
      throw new ConfigurationError(this.name, `Task is already running: ${name}`);
    }

    agent.mutateState(ScheduleExecutionState, execState => {
      const execEntry = execState.tasks.get(name);
      if (execEntry?.timer) clearTimeout(execEntry.timer);
      execState.tasks.set(name, { nextRunTime: Date.now(), status: "pending" });
    });

    void this.runTask(name, task, agent);
  }

  async runTask(name: string, task: ScheduledTask, agent: Agent): Promise<void> {
    // A timer captures the definition it was scheduled from; an edit that kept
    // the same next run time must still deliver the edited message.
    const currentTask = agent.getState(ScheduleTaskState).tasks.get(name) ?? task;
    const abortController = new AbortController();
    const signal = abortController.signal;

    const execEntry = agent.mutateState(ScheduleExecutionState, state => {
      const execEntry = state.tasks.get(name);
      if (execEntry) {
        execEntry.status = "running";
        execEntry.startTime = Date.now();
        delete execEntry.timer;
        execEntry.abortController = abortController;
      }

      return execEntry;
    });

    if (!execEntry) {
      agent.infoMessage(`Task ${name} started running, but no entry was found in execution state - task may have been deleted and not cleaned up properly`);
      return;
    }

    agent.infoMessage(`Running task: ${name}`);

    try {
      const eventCursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();

      const requestId = agent.handleInput({
        from: `Scheduled task ${name}`,
        message: currentTask.message,
      });

      for await (const state of agent.subscribeStateAsync(AgentEventState, signal)) {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case "agent.response":
              if (event.requestId === requestId) {
                this.handleTaskFinished(name, event.status === "success" ? "completed" : "failed", event.message, agent);
                return;
              }
          }
        }
      }
      if (signal.aborted) {
        this.handleTaskFinished(name, "failed", "Task was aborted", agent);
      } else {
        this.handleTaskFinished(name, "failed", "Task exited without any reason given", agent);
      }
    } catch (error: unknown) {
      this.handleTaskFinished(name, "failed", `Task failed with error: ${error as Error}`, agent);
    }
  }

  private handleTaskFinished(name: string, status: "completed" | "failed", message: string, schedulerAgent: Agent): void {
    const now = Date.now();
    const executionEntry = schedulerAgent.mutateState(ScheduleExecutionState, state => {
      return state.tasks.deleteAndReturnItem(name);
    });

    schedulerAgent.mutateState(ScheduleTaskState, state => {
      const task = state.tasks.get(name);
      if (task) state.tasks.set(name, { ...task, lastRunTime: now });
      state.recordRun(name, {
        startTime: executionEntry?.startTime ?? 0,
        endTime: now,
        status,
        message,
      });
    });
  }
}
