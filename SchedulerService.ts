import {AgentManager} from "@tokenring-ai/agent";
import Agent from "@tokenring-ai/agent/Agent";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import {AgentExecutionState} from "@tokenring-ai/agent/state/agentExecutionState";
import TokenRingApp from "@tokenring-ai/app";
import {TokenRingService} from "@tokenring-ai/app/types";
import deepMerge from "@tokenring-ai/utility/object/deepMerge";
import {z} from "zod";
import {ScheduledTask, SchedulerAgentConfigSchema, SchedulerConfigSchema} from "./schema.ts";
import {ScheduleExecutionState} from "./state/scheduleExecutionState.ts";
import {ScheduleTaskState} from "./state/scheduleTaskState.ts";
import {getNextRunTime} from "./utility/getNextRunTime.ts";

export default class SchedulerService implements TokenRingService {
  name = "SchedulerService";
  description = "Schedules AI agents to run at specified intervals";

  constructor(private app: TokenRingApp, private options: z.output<typeof SchedulerConfigSchema>) {}

  attach(agent: Agent): void {
    const config = deepMerge(this.options, agent.getAgentConfigSlice('scheduler', SchedulerAgentConfigSchema));

    agent.initializeState(ScheduleTaskState, config);
    agent.initializeState(ScheduleExecutionState, {});

    if (config.autoStart) {
      this.runScheduler(agent);
    }
  }

  runScheduler(agent: Agent): void {
    const execState = agent.getState(ScheduleExecutionState);
    if (execState.abortController) {
      agent.infoMessage("Scheduler is already running");
      return;
    }

    const taskState = agent.getState(ScheduleTaskState);
    agent.infoMessage(`Starting scheduler with ${taskState.tasks.size} tasks`);

    const abortController = new AbortController();
    agent.mutateState(ScheduleExecutionState, (state) => {
      state.abortController = abortController;
    });

    this.app.trackPromise(async () => {
      try {
        await this.watchTasks(agent, abortController.signal);
        agent.infoMessage("Scheduler complete");
      } catch (error) {
        agent.errorMessage("Error while running scheduler: ", error as Error);
      }
      agent.mutateState(ScheduleExecutionState, (state) => {
        state.abortController = null;
        for (const [taskName, task] of state.tasks.entries()) {
          if (task.timer) {
            agent.infoMessage(`Cancelling timer for task ${taskName}`);
            clearTimeout(task.timer);
            state.tasks.delete(taskName);
          } else if (task.abortController) {
            agent.infoMessage(`Aborting running task ${taskName}`);
            task.abortController.abort();
            // The task will delete itself at abort
          } else {
            agent.infoMessage(`Task ${taskName} is not running and has no timer, deleting task`);
            state.tasks.delete(taskName);
          }
        }
      });
    });
  }

  stopScheduler(agent: Agent): void {
    const execState = agent.getState(ScheduleExecutionState);
    if (!execState.abortController) {
      agent.infoMessage("Scheduler is not running");
      return;
    }
    execState.abortController.abort();
  }

  addTask(name: string, task: ScheduledTask, agent: Agent): void {
    agent.mutateState(ScheduleTaskState, (state) => {
      state.tasks.set(name, task);
    });
  }

  removeTask(name: string, agent: Agent): void {
    agent.mutateState(ScheduleExecutionState, (execState) => {
      agent.mutateState(ScheduleTaskState, (taskState) => {
        const task = taskState.tasks.get(name);
        if (!task) {
          throw new Error(`Task not found: ${name}`);
        }
        const execEntry = execState.tasks.get(name);
        if (execEntry) {
          if (execEntry.timer) {
            clearTimeout(execEntry.timer);
            execState.tasks.delete(name);
          }
        }
        taskState.tasks.delete(name);
      });
    });

  }

  async watchTasks(agent: Agent, signal: AbortSignal) {
    for await (const taskState of agent.subscribeStateAsync(ScheduleTaskState, signal)) {
      const now = Date.now();

      agent.mutateState(ScheduleExecutionState, executionState => {
        for (const [taskName, task] of taskState.tasks.entries()) {
          const executionEntry = executionState.tasks.get(taskName);
          if (executionEntry) {
            // Task is already in execution state, check if it needs to be rescheduled
            if (executionEntry.status !== 'pending') continue;

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
      });
    }
  }

  async runTask(name: string, task: ScheduledTask, schedulerAgent: Agent): Promise<void> {
    const agentManager = schedulerAgent.requireServiceByType(AgentManager);
    const abortController = new AbortController();
    const signal = abortController.signal;

    const execEntry = schedulerAgent.mutateState(ScheduleExecutionState, state => {
      const execEntry = state.tasks.get(name);
      if (execEntry) {
        execEntry.status = 'running';
        execEntry.startTime = Date.now();
        delete execEntry.timer;
        execEntry.abortController = abortController;
      }

      return execEntry;
    });

    if (!execEntry) {
      schedulerAgent.infoMessage(`Task ${name} started running, but no entry was found in execution state - task may have been deleted and not cleaned up properly`);
      return;
    }

    schedulerAgent.infoMessage(`Running task: ${name}`);

    let taskAgent: Agent | null = null;

    try {
      taskAgent = await agentManager.spawnAgent({agentType: task.agentType, headless: true});

      if (signal.aborted) {
        taskAgent.shutdown("Scheduler was stopped");
        this.handleTaskFinished(name, "failed", "Task was aborted before starting", schedulerAgent);
        return;
      }

      await taskAgent.waitForState(AgentExecutionState, (state) => state.idle);

      if (signal.aborted) {
        taskAgent.shutdown("Scheduler was stopped");
        this.handleTaskFinished(name, "failed", "Task was aborted after starting", schedulerAgent);
        return;
      }

      const eventCursor = taskAgent.getState(AgentEventState).getEventCursorFromCurrentPosition();
      const requestId = taskAgent.handleInput({message: task.message});

      for await (const state of taskAgent.subscribeStateAsync(AgentEventState, signal)) {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'input.handled':
              if (event.requestId === requestId) {
                this.handleTaskFinished(name, event.status === 'success' ? 'completed' : 'failed', event.message, schedulerAgent);
                taskAgent!.config.idleTimeout = 3600_000;
                return;
              }
          }
        }
      }
      if (signal.aborted) {
        this.handleTaskFinished(name, "failed", "Task was aborted", schedulerAgent);
      } else {
        this.handleTaskFinished(name, "failed", "Task exited without any reason given", schedulerAgent);
      }
    } catch (error) {
      this.handleTaskFinished(name, "failed", `Task failed with error: ${error}`, schedulerAgent);
    }
  }

  private handleTaskFinished(name: string, status: "completed" | "failed", message: string, schedulerAgent: Agent): void {
    const now = Date.now();
    const executionEntry = schedulerAgent.mutateState(ScheduleExecutionState, (state) => {
      const executionEntry = state.tasks.get(name);
      state.tasks.delete(name);
      return executionEntry;
    });

    schedulerAgent.mutateState(ScheduleTaskState, (state) => {
      const task = state.tasks.get(name);
      if (task) task.lastRunTime = Date.now();
      if (!state.history.has(name)) state.history.set(name, []);

      const historyEntries = state.history.get(name)!;
      historyEntries.push({
        startTime: executionEntry?.startTime ?? 0,
        endTime: now,
        status,
        message
      });
    })
  }
}