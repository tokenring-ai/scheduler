import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Agent, AgentJobService, AgentManager } from "@tokenring-ai/agent";
import { AgentJobsConfigSchema } from "@tokenring-ai/agent/schema";
import { AgentEventState } from "@tokenring-ai/agent/state/agentEventState";
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent.test";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { QueueService } from "@tokenring-ai/queue";
import { TaskService } from "@tokenring-ai/tasks";
import { WorkflowService } from "@tokenring-ai/workflow";
import SchedulerService from "../SchedulerService.ts";
import { type ScheduleDefinition, SchedulerConfigSchema } from "../schema.ts";

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setup({
  storeFile = path.join(tempDir(), "schedules.json"),
  config = {},
}: {
  storeFile?: string;
  config?: Parameters<typeof SchedulerConfigSchema.parse>[0];
} = {}) {
  const app = createTestingApp() as TokenRingApp;
  const starter = createTestingAgent(app);
  const agentManager = app.requireService(AgentManager);
  agentManager.addAgentConfigs(starter.config);
  const jobs = app.addService(
    AgentJobService,
    new AgentJobService(app, { recordsFile: path.join(tempDir(), "agent-jobs.json"), config: AgentJobsConfigSchema.parse({}) }),
  );
  const scheduler = app.addService(SchedulerService, new SchedulerService(app, { storeFile }));
  scheduler.reconfigure(SchedulerConfigSchema.parse(config));
  scheduler.load();
  const controller = new AbortController();
  cleanups.push(async () => {
    controller.abort();
    jobs.stop();
    await jobs.flush();
    await scheduler.flush();
  });
  return { app, starter, agentManager, jobs, scheduler, storeFile, controller };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function queuedRequest(agent: Agent, message: string): string | undefined {
  return agent.getState(AgentEventState).inputQueue.find(item => item.request.input.message === message)?.request.requestId;
}

/** Plays the agent loop for the input with this message: output, then the response. */
async function respondTo(agent: Agent, message: string, text: string, status: "success" | "error" = "success"): Promise<void> {
  await waitFor(() => queuedRequest(agent, message) !== undefined);
  const requestId = queuedRequest(agent, message)!;
  agent.mutateState(AgentEventState, state => {
    state.currentlyExecutingInputItem = state.inputQueue.find(item => item.request.requestId === requestId) ?? null;
    state.emit({ type: "output.chat", message: text, timestamp: Date.now() });
    state.emit({ type: "agent.response", requestId, status, message: text, timestamp: Date.now() });
    state.emit({ type: "input.execution", requestId, status: "finished", timestamp: Date.now() });
  });
}

const jobSchedule = (prompt = "write the report", extra: Partial<ScheduleDefinition> = {}): ScheduleDefinition => ({
  repeat: "1 day",
  action: { kind: "job", agentType: "mock-agent", prompt },
  ...extra,
});

const lastRun = (scheduler: SchedulerService, name: string) => scheduler.getHistory(name)[name]!.at(-1)!;

describe("schedules live in the app, not in agents", () => {
  it("config schedules are listed once, however many agents exist, and are not copied into agents", () => {
    const { scheduler, agentManager } = setup({ config: { schedules: { nightly: jobSchedule() } } });
    const agent = agentManager.spawnAgent({ agentType: "mock-agent" });
    agentManager.spawnAgent({ agentType: "mock-agent" });
    expect(scheduler.listSchedules().map(view => [view.name, view.source])).toEqual([["nightly", "config"]]);
    expect(agent.generateCheckpoint().state.ScheduleTaskState).toEqual({ tasks: {}, history: {} });
    // Config schedules are edited in config.
    expect(() => scheduler.removeSchedule("nightly")).toThrow(/defined in config/);
    // …but can be paused from the app, without rewriting config.
    expect(scheduler.setEnabled("nightly", false).state).toBe("paused");
  });

  it("deleting an agent leaves its schedules; prompting a deleted agent fails the run and pauses the schedule", async () => {
    const { scheduler, agentManager, starter } = setup();
    scheduler.addSchedule("check", { repeat: "1 hour", action: { kind: "agent", agentId: starter.id, prompt: "check" } });
    agentManager.deleteAgent(starter.id, "closed");
    expect(scheduler.getSchedule("check")).toBeDefined();
    scheduler.runNow("check");
    await waitFor(() => lastRun(scheduler, "check").status !== "running");
    expect(lastRun(scheduler, "check")).toMatchObject({ status: "failed", message: expect.stringContaining("no longer exists") });
    expect(scheduler.getSchedule("check")).toMatchObject({ enabled: false, state: "paused" });
  });

  it("persists user schedules, bookkeeping and history in the workspace file", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    const first = setup({ storeFile });
    first.scheduler.addSchedule("report", jobSchedule());
    first.scheduler.setRunning(false);
    await first.scheduler.flush();
    const saved = JSON.parse(fs.readFileSync(storeFile, "utf8")) as { schedules: Record<string, unknown>; running: boolean };
    expect(Object.keys(saved.schedules)).toEqual(["report"]);

    const second = setup({ storeFile });
    expect(second.scheduler.getSchedule("report")?.definition.action).toEqual({ kind: "job", agentType: "mock-agent", prompt: "write the report" });
    expect(second.scheduler.isRunning()).toBe(false);
    expect(second.scheduler.getSchedule("report")?.state).toBe("stopped");
  });
});

describe("validation and errors", () => {
  it("refuses an invalid timezone, a too-short interval, an unknown agent type, and duplicates", () => {
    const { scheduler } = setup();
    expect(() => scheduler.addSchedule("tz", jobSchedule("x", { timezone: "Mars/Olympus" }))).toThrow(/not a known timezone/);
    expect(() => scheduler.addSchedule("fast", jobSchedule("x", { repeat: "10 seconds" }))).toThrow(/at most once a minute/);
    expect(() => scheduler.addSchedule("who", { once: true, action: { kind: "job", agentType: "nobody", prompt: "x" } })).toThrow(/does not exist/);
    expect(() => scheduler.addSchedule("wf", { once: true, action: { kind: "workflow", name: "deploy" } })).toThrow(/workflow plugin/);
    scheduler.addSchedule("daily", jobSchedule());
    expect(() => scheduler.addSchedule("daily", jobSchedule())).toThrow(/already exists/);
    expect(scheduler.listSchedules()).toHaveLength(1);
  });

  it("a config schedule that cannot be computed shows an error instead of silently never running", () => {
    const { scheduler } = setup({ config: { schedules: { broken: jobSchedule("x", { timezone: "Nowhere/Land" }) } } });
    expect(scheduler.getSchedule("broken")).toMatchObject({ state: "error", nextRunTime: null, error: expect.stringContaining("not a known timezone") });
  });

  it("previews the next run of an unsaved timing, or why it cannot run", () => {
    const { scheduler } = setup();
    expect(scheduler.previewNextRun({ repeat: "1 hour" }).nextRunTime).toBeNumber();
    expect(scheduler.previewNextRun({ repeat: "5 seconds" }).error).toContain("at most once a minute");
  });
});

describe("runs", () => {
  it("a job action runs as an agent job owned by the scheduler, with the schedule as its origin", async () => {
    const { scheduler, jobs, agentManager } = setup();
    scheduler.addSchedule("report", jobSchedule());
    const run = scheduler.runNow("report");
    await waitFor(() => lastRun(scheduler, "report").jobId !== null);
    const jobId = lastRun(scheduler, "report").jobId!;
    expect(jobs.get(jobId)).toMatchObject({ owner: "scheduler", ownerRef: { schedule: "report" }, origin: { kind: "schedule", scheduleId: "report" } });

    await waitFor(() => jobs.get(jobId)?.agentId != null);
    await respondTo(agentManager.getAgent(jobs.get(jobId)!.agentId!)!, "write the report", "Report written");
    await waitFor(() => lastRun(scheduler, "report").status !== "running");
    expect(lastRun(scheduler, "report")).toMatchObject({ id: run.id, status: "completed", message: "Report written", jobId });
    expect(jobs.get(jobId)?.status).toBe("succeeded");
  });

  it("passes a schedule's budget and approval allowance to its job, and a run over budget ends failed", async () => {
    const { scheduler, jobs, agentManager } = setup({});
    jobs.reconfigure(AgentJobsConfigSchema.parse({ approvalCeiling: 7 }));
    jobs.setUsageReader(() => ({ costUsd: 5, tokens: 10 }));
    scheduler.addSchedule(
      "pricey",
      jobSchedule("spend", { action: { kind: "job", agentType: "mock-agent", prompt: "spend", maxCostUsd: 1.5, maxApprovalLevel: 6 } }),
    );
    scheduler.runNow("pricey");
    await waitFor(() => jobs.list().at(0)?.agentId != null);
    expect(jobs.list()[0]).toMatchObject({ maxCostUsd: 1.5, approvalLevel: 6 });
    await respondTo(agentManager.getAgent(jobs.list()[0]!.agentId!)!, "spend", "done");
    await waitFor(() => lastRun(scheduler, "pricey").status !== "running");
    expect(lastRun(scheduler, "pricey")).toMatchObject({ status: "failed", message: expect.stringContaining("over budget") });
  });

  it("refuses to save a schedule whose approval level is above the operator's ceiling", () => {
    const { scheduler, jobs } = setup();
    expect(jobs.getJobPolicy().approvalCeiling).toBe(5);
    expect(() =>
      scheduler.addSchedule("high", jobSchedule("x", { action: { kind: "job", agentType: "mock-agent", prompt: "x", maxApprovalLevel: 7 } })),
    ).toThrow(/ceiling of 5/);
    expect(() =>
      scheduler.addSchedule("ok", jobSchedule("x", { action: { kind: "job", agentType: "mock-agent", prompt: "x", maxApprovalLevel: 5 } })),
    ).not.toThrow();
    expect(() => scheduler.addSchedule("wf-high", { repeat: "1 day", action: { kind: "workflow", name: "w", maxApprovalLevel: 6 } })).toThrow(/ceiling of 5/);
  });

  it("a failed job is recorded failed, and the slot is not retried", async () => {
    const { scheduler, jobs, agentManager } = setup();
    scheduler.addSchedule("report", jobSchedule());
    scheduler.runNow("report");
    await waitFor(() => jobs.list().at(0)?.agentId != null);
    await respondTo(agentManager.getAgent(jobs.list()[0]!.agentId!)!, "write the report", "No access", "error");
    await waitFor(() => lastRun(scheduler, "report").status !== "running");
    expect(lastRun(scheduler, "report")).toMatchObject({ status: "failed", message: "No access" });
    // The next run is a day after the run's slot.
    const view = scheduler.getSchedule("report")!;
    expect(view.nextRunTime! - view.lastRunTime).toBeGreaterThan(23 * 3_600_000);
  });

  it("an agent action prompts the chat; stopping the run cancels only its own request", async () => {
    const { scheduler, starter } = setup();
    const own = starter.handleInput({ from: "person", message: "person's work" });
    await waitFor(() => queuedRequest(starter, "person's work") !== undefined);
    starter.mutateState(AgentEventState, state => {
      state.currentlyExecutingInputItem = state.inputQueue.find(item => item.request.requestId === own) ?? null;
    });
    const personsItem = starter.getState(AgentEventState).currentlyExecutingInputItem!;

    scheduler.addSchedule("tick", { repeat: "5 minutes", action: { kind: "agent", agentId: starter.id, prompt: "tick" } });
    scheduler.runNow("tick");
    await waitFor(() => queuedRequest(starter, "tick") !== undefined);
    scheduler.setRunning(false);
    await waitFor(() => lastRun(scheduler, "tick").status !== "running");

    expect(lastRun(scheduler, "tick")).toMatchObject({ status: "cancelled", jobId: null });
    expect(personsItem.abortController.signal.aborted).toBe(false);
    expect(queuedRequest(starter, "tick")).toBeUndefined();
    expect(queuedRequest(starter, "person's work")).toBe(own);
  });

  it("a queue action adds an item to the queue, with the schedule as its origin", async () => {
    const { app, scheduler } = setup();
    const enqueued: unknown[] = [];
    app.addService(QueueService, {
      name: "QueueService",
      description: "fake",
      getQueueConfig: (name: string) => (name === "docs" ? { agentType: "mock-agent" } : undefined),
      enqueue: (queue: string, item: unknown, options: unknown) => {
        enqueued.push({ queue, item, options });
        return { seq: 7 };
      },
    } as unknown as QueueService);
    expect(() => scheduler.addSchedule("bad", { once: true, action: { kind: "queue", queue: "nope", item: { name: "x", prompt: "y" } } })).toThrow(
      /does not exist/,
    );
    scheduler.addSchedule("weekly docs", { repeat: "1 week", action: { kind: "queue", queue: "docs", item: { name: "Refresh docs", prompt: "refresh" } } });
    scheduler.runNow("weekly docs");
    await waitFor(() => lastRun(scheduler, "weekly docs").status !== "running");
    expect(lastRun(scheduler, "weekly docs")).toMatchObject({ status: "completed", message: expect.stringContaining("#7") });
    expect(enqueued).toEqual([
      {
        queue: "docs",
        item: { name: "Refresh docs", input: { from: "Schedule weekly docs", message: "refresh" } },
        options: { origin: { kind: "schedule", scheduleId: "weekly docs" } },
      },
    ]);
  });

  it("a workflow action starts the workflow and takes the run's status from its job", async () => {
    const { app, scheduler, jobs } = setup();
    let jobSession: ReturnType<AgentJobService["startJob"]> | null = null;
    app.addService(WorkflowService, {
      name: "WorkflowService",
      description: "fake",
      spawnWorkflow: async (_name: string, options: { origin?: { kind: "schedule"; scheduleId: string } }) => {
        jobSession = jobs.startJob({
          owner: "workflow",
          label: "deploy run",
          agentType: "mock-agent",
          origin: options.origin ?? { kind: "person", label: "?" },
        });
        return { runId: "run-1", jobId: jobSession.id, agent: jobSession.agent };
      },
    } as unknown as WorkflowService);
    scheduler.addSchedule("deploy", { once: true, action: { kind: "workflow", name: "deploy" } });
    scheduler.runNow("deploy");
    await waitFor(() => jobSession !== null && lastRun(scheduler, "deploy").jobId === jobSession.id);
    expect(jobSession!.record.origin).toEqual({ kind: "schedule", scheduleId: "deploy" });
    await jobSession!.finish("failed", "step 2 failed");
    await waitFor(() => lastRun(scheduler, "deploy").status !== "running");
    expect(lastRun(scheduler, "deploy")).toMatchObject({ status: "failed", message: "step 2 failed" });
    // A one-time schedule is disabled once it ran.
    expect(scheduler.getSchedule("deploy")).toMatchObject({ enabled: false, state: "paused" });
  });

  it("a task action dispatches the assignment with the schedule as its origin and maps its outcome", async () => {
    const { app, scheduler } = setup();
    const started: unknown[] = [];
    app.addService(TaskService, {
      name: "TaskService",
      description: "fake",
      dispatcher: {
        start: async (ref: unknown, assignmentId: string, _actor: unknown, options: unknown) => {
          started.push({ ref, assignmentId, options });
          return { dispatchId: "d1", agentId: null, jobId: "job-1", done: Promise.resolve({ state: "done", summary: "Reviewed", report: "", jobId: "job-1" }) };
        },
        cancel: () => true,
      },
    } as unknown as TaskService);
    scheduler.addSchedule("review", { repeat: "1 day", action: { kind: "task", ref: { board: "eng", taskId: "ENG-1" }, assignmentId: "a1" } });
    scheduler.runNow("review");
    await waitFor(() => lastRun(scheduler, "review").status !== "running");
    expect(lastRun(scheduler, "review")).toMatchObject({ status: "completed", message: "Reviewed", jobId: "job-1" });
    expect(started).toEqual([{ ref: { board: "eng", taskId: "ENG-1" }, assignmentId: "a1", options: { origin: { kind: "schedule", scheduleId: "review" } } }]);
  });

  it("a timer run records its scheduled slot as the last run time", async () => {
    const { scheduler, controller, jobs, agentManager } = setup();
    scheduler.start(controller.signal);
    scheduler.addSchedule("now", jobSchedule("go"));
    await waitFor(() => (scheduler.getHistory("now").now ?? []).length > 0);
    const run = lastRun(scheduler, "now");
    expect(run.manual).toBe(false);
    expect(scheduler.getSchedule("now")!.lastRunTime).toBe(run.scheduledFor);
    await waitFor(() => jobs.list().at(0)?.agentId != null);
    await respondTo(agentManager.getAgent(jobs.list()[0]!.agentId!)!, "go", "ok");
    await waitFor(() => lastRun(scheduler, "now").status === "completed");
    // Next is a day after the slot, not after the run finished.
    expect(scheduler.getSchedule("now")!.nextRunTime).toBe(run.scheduledFor + 86_400_000);
  });
});

describe("restarts", () => {
  it("a run in flight when the app stopped (or crashed) is interrupted, never re-run", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    const first = setup({ storeFile });
    first.scheduler.addSchedule("report", jobSchedule());
    first.scheduler.runNow("report");
    await first.scheduler.flush();
    // A crash: the file says "running".
    const saved = JSON.parse(fs.readFileSync(storeFile, "utf8")) as { history: Record<string, { status: string }[]> };
    expect(saved.history.report![0]!.status).toBe("running");

    const second = setup({ storeFile });
    expect(lastRun(second.scheduler, "report")).toMatchObject({ status: "interrupted", message: "Interrupted by a restart" });
    // Its slot was taken when it started: it is not due again until tomorrow.
    expect(second.scheduler.getSchedule("report")!.nextRunTime! - Date.now()).toBeGreaterThan(23 * 3_600_000);

    // A clean stop records it at once.
    first.scheduler.stop();
    const stopped = JSON.parse(fs.readFileSync(storeFile, "utf8")) as { history: Record<string, { status: string }[]> };
    expect(stopped.history.report![0]!.status).toBe("interrupted");
  });
});

describe("migration from agent state", () => {
  it("moves a restored agent's tasks into the store as prompts for that agent, once", async () => {
    const { scheduler, agentManager, starter } = setup();
    const checkpoint = starter.generateCheckpoint();
    const ranAt = Date.now() - 3_600_000;
    checkpoint.state.ScheduleTaskState = {
      tasks: { standup: { message: "post the standup", repeat: "1 day", lastRunTime: ranAt, after: "09:00" } },
      history: { standup: [{ startTime: ranAt, endTime: ranAt + 1000, status: "completed", message: "posted" }] },
    };
    agentManager.deleteAgent(starter.id, "restart");
    const restored = agentManager.spawnAgentFromCheckpoint(checkpoint);

    const view = scheduler.getSchedule("standup")!;
    expect(view.definition).toEqual({ repeat: "1 day", after: "09:00", action: { kind: "agent", agentId: restored.id, prompt: "post the standup" } });
    expect(view.lastRunTime).toBe(ranAt);
    expect(lastRun(scheduler, "standup")).toMatchObject({ status: "completed", message: "posted", actionKind: "agent" });
    // The restored agent saves the slice empty, so it is not migrated again.
    expect(restored.generateCheckpoint().state.ScheduleTaskState).toEqual({ tasks: {}, history: {} });

    // The same task copied into another agent (old config defaults) is not added twice.
    const other = { ...checkpoint, agentId: "other-agent-id" };
    agentManager.spawnAgentFromCheckpoint(other);
    expect(scheduler.listSchedules().map(entry => entry.name)).toEqual(["standup"]);
  });
});
