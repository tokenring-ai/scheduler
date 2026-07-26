import { AgentManager } from "@tokenring-ai/agent";
import type TokenRingApp from "@tokenring-ai/app";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import { stripUndefinedKeys } from "@tokenring-ai/utility/object/stripObject";
import SchedulerService from "../SchedulerService.ts";
import { ScheduleExecutionState } from "../state/scheduleExecutionState.ts";
import { ScheduleTaskState } from "../state/scheduleTaskState.ts";
import SchedulerRpcSchema from "./schema.ts";

export default createRPCEndpoint(SchedulerRpcSchema, {
  getTasks(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }

    const { tasks } = agent.getState(ScheduleTaskState);
    return { status: "success", tasks: tasks.toPlainObject(), count: tasks.size };
  },

  addTask(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    app.requireService(SchedulerService).addTask(args.name, args.task, agent);
    return { status: "success", success: true, message: `Task "${args.name}" added` };
  },

  removeTask(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    app.requireService(SchedulerService).removeTask(args.name, agent);
    return { status: "success", success: true, message: `Task "${args.name}" removed` };
  },

  getStatus(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    const execState = agent.getState(ScheduleExecutionState);
    const executions = Object.fromEntries(
      execState.tasks.mapEntries(([name, entry]) => [
        name,
        stripUndefinedKeys({
          nextRunTime: entry.nextRunTime,
          status: entry.status,
          startTime: entry.startTime,
        }),
      ]),
    );
    return {
      status: "success",
      running: execState.abortController !== null,
      autoStart: execState.autoStart,
      executions,
    };
  },

  startScheduler(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    app.requireService(SchedulerService).runScheduler(agent);
    return { status: "success", success: true, message: "Scheduler started" };
  },

  stopScheduler(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    app.requireService(SchedulerService).stopScheduler(agent);
    return { status: "success", success: true, message: "Scheduler stopped" };
  },

  getHistory(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    const { history } = agent.getState(ScheduleTaskState);
    if (args.taskName) {
      return { status: "success", history: { [args.taskName]: history.get(args.taskName) ?? [] } };
    }
    return { status: "success", history: history.toPlainObject() };
  },
});
