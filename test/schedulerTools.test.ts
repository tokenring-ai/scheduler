import { describe, expect, it, mock } from "bun:test";
import type Agent from "@tokenring-ai/agent/Agent";
import type TokenRingApp from "@tokenring-ai/app";
import ChatService, { type CheckToolApprovalOptions } from "@tokenring-ai/chat/ChatService";
import SchedulerService from "../SchedulerService.ts";
import type { ScheduledTask } from "../schema.ts";
import { ScheduleExecutionState } from "../state/scheduleExecutionState.ts";
import { ScheduleTaskState } from "../state/scheduleTaskState.ts";
import setScheduledTaskEnabled from "../tools/setScheduledTaskEnabled.ts";
import updateScheduledTask from "../tools/updateScheduledTask.ts";
import tools from "../tools.ts";

function createAgent(tasks: Record<string, ScheduledTask>, approve = true) {
  const config = { autoStart: false, maxHistoryPerTask: 50, tasks };
  const states = new Map<unknown, unknown>([
    [ScheduleTaskState, new ScheduleTaskState(config)],
    [ScheduleExecutionState, new ScheduleExecutionState(config)],
  ]);
  const service = new SchedulerService({} as TokenRingApp);
  const checkToolApproval = mock(async (_request: CheckToolApprovalOptions, _agent: Agent) => approve);
  const agent = {
    getState: (cls: unknown) => states.get(cls),
    mutateState: (cls: unknown, fn: (state: unknown) => unknown) => fn(states.get(cls)),
    infoMessage: mock(),
    debugMessage: mock(),
    warningMessage: mock(),
    errorMessage: mock(),
    requireService: (cls: unknown) => {
      if (cls === SchedulerService) return service;
      if (cls === ChatService) return { checkToolApproval };
      throw new Error("service not stubbed");
    },
  } as unknown as Agent;
  return { agent, checkToolApproval };
}

const original: ScheduledTask = {
  message: "old",
  repeat: "1 hour",
  before: "17:00",
  weekdays: "mon",
  dayOfMonth: 3,
  lastRunTime: 1234,
  enabled: false,
};

describe("scheduler edit tools", () => {
  it("exports update and pause next to the existing scheduler tools", () => {
    expect(tools.map(tool => tool.name)).toEqual([
      "scheduler_add_task",
      "scheduler_remove_task",
      "scheduler_get_schedule",
      "scheduler_update_task",
      "scheduler_set_enabled",
    ]);
  });

  it("replaces the schedule after approval and keeps lastRunTime, day constraints, and pause", async () => {
    const { agent, checkToolApproval } = createAgent({ report: original });

    const result = await updateScheduledTask.execute(
      {
        taskName: "report",
        task: { description: "new", context: "ctx", repeat: "2 hours", after: "09:00", timezone: "UTC", once: true },
      },
      agent,
    );

    expect(checkToolApproval).toHaveBeenCalledTimes(1);
    expect(checkToolApproval.mock.calls[0]![0]).toMatchObject({ toolName: "scheduler_update_task", safetyLevel: 6, default: false });
    expect(checkToolApproval.mock.calls[0]![1]).toBe(agent);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")).toEqual({
      message: "new\n\nADDITIONAL CONTEXT:\nctx",
      repeat: "2 hours",
      after: "09:00",
      timezone: "UTC",
      weekdays: "mon",
      dayOfMonth: 3,
      lastRunTime: 1234,
      enabled: false,
    });
    expect(result.result).toContain("new");
    expect(result.result).toContain("Paused");
  });

  it("runs once when repeat is omitted, or daily when once is false", async () => {
    const { agent } = createAgent({ report: { message: "old", repeat: "1 hour", lastRunTime: 50 } });

    await updateScheduledTask.execute({ taskName: "report", task: { description: "once" } }, agent);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")).toEqual({ message: "once", once: true, lastRunTime: 50 });

    await updateScheduledTask.execute({ taskName: "report", task: { description: "daily", once: false } }, agent);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")).toEqual({ message: "daily", lastRunTime: 50 });
  });

  it("does not update when approval is declined", async () => {
    const { agent, checkToolApproval } = createAgent({ report: original }, false);

    await expect(updateScheduledTask.execute({ taskName: "report", task: { description: "new", repeat: "2 hours" } }, agent)).rejects.toThrow(
      /did not approve/,
    );
    expect(checkToolApproval).toHaveBeenCalledTimes(1);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")).toEqual(original);
  });

  it("throws for an unknown task before asking", async () => {
    const { agent, checkToolApproval } = createAgent({});

    await expect(updateScheduledTask.execute({ taskName: "missing", task: { description: "x" } }, agent)).rejects.toThrow(/Task not found/);
    expect(checkToolApproval).not.toHaveBeenCalled();
  });

  it("pauses and resumes a task after approval", async () => {
    const { agent, checkToolApproval } = createAgent({ report: { message: "m", repeat: "1 hour", lastRunTime: 0 } });

    const paused = await setScheduledTaskEnabled.execute({ taskName: "report", enabled: false }, agent);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")?.enabled).toBe(false);
    expect(paused.result).toContain("paused");
    expect(paused.result).toContain("Paused");
    expect(checkToolApproval.mock.calls[0]![0]).toMatchObject({ toolName: "scheduler_set_enabled", safetyLevel: 5, default: false });

    await setScheduledTaskEnabled.execute({ taskName: "report", enabled: true }, agent);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")).not.toHaveProperty("enabled");
  });

  it("does not pause when approval is declined", async () => {
    const { agent } = createAgent({ report: { message: "m", repeat: "1 hour", lastRunTime: 0 } }, false);

    await expect(setScheduledTaskEnabled.execute({ taskName: "report", enabled: false }, agent)).rejects.toThrow(/did not approve/);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")).not.toHaveProperty("enabled");
  });

  it("throws for an unknown task before asking to pause it", async () => {
    const { agent, checkToolApproval } = createAgent({});

    await expect(setScheduledTaskEnabled.execute({ taskName: "missing", enabled: false }, agent)).rejects.toThrow(/Task not found/);
    expect(checkToolApproval).not.toHaveBeenCalled();
  });
});
