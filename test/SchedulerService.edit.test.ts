import { describe, expect, it, mock } from "bun:test";
import type Agent from "@tokenring-ai/agent/Agent";
import { AgentEventState } from "@tokenring-ai/agent/state/agentEventState";
import type TokenRingApp from "@tokenring-ai/app";
import SchedulerService from "../SchedulerService.ts";
import type { ScheduledTask } from "../schema.ts";
import { ScheduleExecutionState } from "../state/scheduleExecutionState.ts";
import { ScheduleTaskState } from "../state/scheduleTaskState.ts";
import { getNextRunTime } from "../utility/getNextRunTime.ts";

function createFakeAgent(tasks: Record<string, ScheduledTask>, maxHistoryPerTask = 50) {
  const config = { autoStart: false, maxHistoryPerTask, tasks };
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

const service = new SchedulerService({} as TokenRingApp);

describe("SchedulerService.updateTask", () => {
  it("replaces the definition but keeps lastRunTime", () => {
    const { agent } = createFakeAgent({ report: { message: "old", repeat: "1 hour", lastRunTime: 1234 } });
    service.updateTask("report", { message: "new", repeat: "2 hours", lastRunTime: 0 }, agent);
    expect(agent.getState(ScheduleTaskState).tasks.get("report")).toEqual({ message: "new", repeat: "2 hours", lastRunTime: 1234 });
  });

  it("throws for an unknown task", () => {
    const { agent } = createFakeAgent({});
    expect(() => service.updateTask("missing", { message: "x", lastRunTime: 0 }, agent)).toThrow(/Task not found/);
  });

  it("delivers the edited message when a timer scheduled from the old definition fires", async () => {
    const original: ScheduledTask = { message: "old", repeat: "1 hour", lastRunTime: 0 };
    const { agent, handleInput } = createFakeAgent({ report: original });
    agent.getState(ScheduleExecutionState).tasks.set("report", { nextRunTime: Date.now(), status: "pending" });
    service.updateTask("report", { message: "new", repeat: "1 hour", lastRunTime: 0 }, agent);

    await service.runTask("report", original, agent);
    expect(handleInput).toHaveBeenCalledWith({ from: "Scheduled task report", message: "new" });
  });
});

describe("SchedulerService.setTaskEnabled", () => {
  it("pauses and resumes a task, and a paused task has no next run", () => {
    const { agent } = createFakeAgent({ report: { message: "m", repeat: "1 hour", lastRunTime: 0 } });

    service.setTaskEnabled("report", false, agent);
    const paused = agent.getState(ScheduleTaskState).tasks.get("report")!;
    expect(paused.enabled).toBe(false);
    expect(getNextRunTime(paused)).toBeNull();

    service.setTaskEnabled("report", true, agent);
    const resumed = agent.getState(ScheduleTaskState).tasks.get("report")!;
    expect(resumed).not.toHaveProperty("enabled");
    expect(getNextRunTime(resumed)).not.toBeNull();
  });

  it("throws for an unknown task", () => {
    const { agent } = createFakeAgent({});
    expect(() => service.setTaskEnabled("missing", false, agent)).toThrow(/Task not found/);
  });
});

describe("run history", () => {
  it("caps entries per task, keeping the newest", async () => {
    const { agent } = createFakeAgent({ report: { message: "m", repeat: "1 hour", lastRunTime: 0 } }, 2);
    for (let i = 0; i < 3; i++) {
      service.runTaskNow("report", agent);
      await Bun.sleep(0);
    }
    const state = agent.getState(ScheduleTaskState);
    expect(state.history.get("report")).toHaveLength(2);

    state.recordRun("report", { startTime: 1, endTime: 2, status: "failed", message: "latest" });
    expect(state.history.get("report")).toHaveLength(2);
    expect(state.history.get("report")!.at(-1)!.message).toBe("latest");
  });

  it("persists history through serialize/deserialize and accepts older checkpoints without it", () => {
    const config = { autoStart: false, maxHistoryPerTask: 2, tasks: {} };
    const source = new ScheduleTaskState(config);
    source.tasks.set("a", { message: "m", lastRunTime: 5 });
    for (const message of ["one", "two"]) source.recordRun("a", { startTime: 1, endTime: 2, status: "completed", message });

    const restored = new ScheduleTaskState(config);
    restored.deserialize(restored.serializationSchema.parse(JSON.parse(JSON.stringify(source.serialize()))));
    expect(restored.history.get("a")!.map(r => r.message)).toEqual(["one", "two"]);
    expect(restored.tasks.get("a")!.lastRunTime).toBe(5);

    const legacy = new ScheduleTaskState(config);
    legacy.deserialize(legacy.serializationSchema.parse({ tasks: {} }));
    expect(legacy.history.size).toBe(0);
  });

  it("trims oversized persisted history to the cap on load", () => {
    const state = new ScheduleTaskState({ autoStart: false, maxHistoryPerTask: 1, tasks: {} });
    const run = (message: string) => ({ startTime: 1, endTime: 2, status: "completed" as const, message });
    state.deserialize({ tasks: {}, history: { a: [run("old"), run("new")] } });
    expect(state.history.get("a")!.map(r => r.message)).toEqual(["new"]);
  });

  it("clears one task's history or all of it", () => {
    const { agent } = createFakeAgent({});
    const state = agent.getState(ScheduleTaskState);
    const run = { startTime: 1, endTime: 2, status: "completed" as const, message: "x" };
    state.recordRun("a", run);
    state.recordRun("b", run);

    service.clearHistory(agent, "a");
    expect(state.history.has("a")).toBe(false);
    expect(state.history.has("b")).toBe(true);

    service.clearHistory(agent);
    expect(state.history.size).toBe(0);
  });
});
