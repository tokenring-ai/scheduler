import {AgentManager} from "@tokenring-ai/agent";
import type TokenRingApp from "@tokenring-ai/app";
import {createRPCEndpoint} from "@tokenring-ai/rpc/createRPCEndpoint";
import SchedulerService from "../SchedulerService.ts";
import {ScheduleExecutionState} from "../state/scheduleExecutionState.ts";
import {ScheduleTaskState} from "../state/scheduleTaskState.ts";
import SchedulerRpcSchema from "./schema.ts";

export default createRPCEndpoint(SchedulerRpcSchema, {
  getTasks(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) throw new Error("Agent not found");
    const tasks = Object.fromEntries(
      agent.getState(ScheduleTaskState).tasks.entries(),
    );
    return {tasks, count: Object.keys(tasks).length};
  },

  addTask(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) throw new Error("Agent not found");
    app.requireService(SchedulerService).addTask(args.name, args.task, agent);
    return {success: true, message: `Task "${args.name}" added`};
  },

  removeTask(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) throw new Error("Agent not found");
    app.requireService(SchedulerService).removeTask(args.name, agent);
    return {success: true, message: `Task "${args.name}" removed`};
  },

  getStatus(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) throw new Error("Agent not found");
    const execState = agent.getState(ScheduleExecutionState);
    const executions = Object.fromEntries(
      [...execState.tasks.entries()].map(([name, entry]) => [
        name,
        {
          nextRunTime: entry.nextRunTime,
          status: entry.status,
          startTime: entry.startTime,
        },
      ]),
    );
    return {
      running: execState.abortController !== null,
      autoStart: execState.autoStart,
      executions,
    };
  },

  startScheduler(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) throw new Error("Agent not found");
    app.requireService(SchedulerService).runScheduler(agent);
    return {success: true, message: "Scheduler started"};
  },

  stopScheduler(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) throw new Error("Agent not found");
    app.requireService(SchedulerService).stopScheduler(agent);
    return {success: true, message: "Scheduler stopped"};
  },

  getHistory(args, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(args.agentId);
    if (!agent) throw new Error("Agent not found");
    const {history} = agent.getState(ScheduleTaskState);
    if (args.taskName) {
      return {history: {[args.taskName]: history.get(args.taskName) ?? []}};
    }
    return {history: Object.fromEntries(history.entries())};
  },
});
