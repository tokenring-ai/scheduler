import { describe, expect, it, mock } from "bun:test";
import type Agent from "@tokenring-ai/agent/Agent";
import { AgentEventState } from "@tokenring-ai/agent/state/agentEventState";
import type TokenRingApp from "@tokenring-ai/app";
import SchedulerService from "../SchedulerService.ts";
import type { ScheduledTask } from "../schema.ts";
import { ScheduleExecutionState } from "../state/scheduleExecutionState.ts";
import { ScheduleTaskState } from "../state/scheduleTaskState.ts";
import addScheduledTask, { buildTaskMessage } from "../tools/addScheduledTask.ts";
import { getNextRunTime } from "../utility/getNextRunTime.ts";

function createFakeAgent(tasks: Record<string, ScheduledTask>) {
  const config = { autoStart: false, maxHistoryPerTask: 50, tasks };
  const states = new Map<unknown, unknown>([
    [ScheduleTaskState, new ScheduleTaskState(config)],
    [ScheduleExecutionState, new ScheduleExecutionState(config)],
    [AgentEventState, { getEventCursorFromCurrentPosition: () => ({}) }],
  ]);
  const handleInput = mock(() => "request-1");
  const agent = {
    getState: (cls: unknown) => states.get(cls),
    mutateState: (cls: unknown, fn: (state: unknown) => unknown) => fn(states.get(cls)),
    handleInput,
    // The agent replies to the scheduled request straight away.
    async *subscribeStateAsync() {
      yield {
        yieldEventsByCursor: () => [{ type: "agent.response", requestId: "request-1", status: "success", message: "done" }],
      };
    },
    infoMessage: mock(),
    debugMessage: mock(),
    warningMessage: mock(),
    errorMessage: mock(),
  };
  return { agent: agent as unknown as Agent, handleInput };
}

describe("SchedulerService once semantics and run-now", () => {
  it("runs a once task on demand and never reschedules it afterwards", async () => {
    const { agent, handleInput } = createFakeAgent({ report: { message: "send report", once: true, lastRunTime: 0 } });
    const service = new SchedulerService({} as TokenRingApp);

    service.runTaskNow("report", agent);
    await Bun.sleep(0);

    expect(handleInput).toHaveBeenCalledWith({ from: "Scheduled task report", message: "send report" });
    const task = agent.getState(ScheduleTaskState).tasks.get("report")!;
    expect(task.lastRunTime).toBeGreaterThan(0);
    expect(agent.getState(ScheduleExecutionState).tasks.has("report")).toBe(false);
    expect(agent.getState(ScheduleTaskState).history.get("report")?.[0]?.status).toBe("completed");
    // What watchTasks consults after the run: a once task has no next run.
    expect(getNextRunTime(task)).toBeNull();
  });

  it("refuses to run a task that is already running or does not exist", () => {
    const { agent } = createFakeAgent({ report: { message: "send report", lastRunTime: 0 } });
    agent.getState(ScheduleExecutionState).tasks.set("report", { nextRunTime: null, status: "running" });
    const service = new SchedulerService({} as TokenRingApp);

    expect(() => service.runTaskNow("report", agent)).toThrow(/already running/);
    expect(() => service.runTaskNow("missing", agent)).toThrow(/Task not found/);
  });
});

describe("scheduler_add_task tool", () => {
  it("marks tasks without a repeat as once and omits empty context", () => {
    const addTask = mock();
    const agent = {
      requireService: () => ({ addTask }),
      getState: () => ({ tasks: new Map(), history: new Map() }),
    } as unknown as Agent;
    // getSchedule reads state that this fake does not model; only addTask's arguments matter here.
    try {
      addScheduledTask.execute({ taskName: "t", task: { description: "Do the thing" } }, agent);
    } catch {}

    expect(addTask).toHaveBeenCalledWith("t", { once: true, lastRunTime: 0, message: "Do the thing" }, agent);
  });

  it("keeps repeat tasks recurring", () => {
    const addTask = mock();
    const agent = { requireService: () => ({ addTask }), getState: () => ({ tasks: new Map(), history: new Map() }) } as unknown as Agent;
    try {
      addScheduledTask.execute({ taskName: "t", task: { description: "Poll", repeat: "1 hour", context: "ctx" } }, agent);
    } catch {}

    expect(addTask).toHaveBeenCalledWith("t", { repeat: "1 hour", lastRunTime: 0, message: "Poll\n\nADDITIONAL CONTEXT:\nctx" }, agent);
  });

  it("never renders an undefined context", () => {
    expect(buildTaskMessage("Do it", undefined)).toBe("Do it");
    expect(buildTaskMessage("Do it", "  ")).toBe("Do it");
  });
});
