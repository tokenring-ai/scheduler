import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentJobService, AgentManager } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import { AgentJobsConfigSchema } from "@tokenring-ai/agent/schema";
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent.test";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import ChatService from "@tokenring-ai/chat/ChatService";
import PermissionService, { MemoryPermissionStore } from "@tokenring-ai/chat/PermissionService";
import { ChatAgentConfigSchema, type ParsedChatConfig } from "@tokenring-ai/chat/schema";
import { ToolCallError } from "@tokenring-ai/chat/util/tokenRingTool";
import { z } from "zod";
import SchedulerService from "../SchedulerService.ts";
import { type ScheduleDefinition, SchedulerConfigSchema } from "../schema.ts";
import setScheduledTaskEnabled from "../tools/setScheduledTaskEnabled.ts";
import updateScheduledTask from "../tools/updateScheduledTask.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-tool-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const HOUR = 3_600_000;
const posted: string[] = [];
let onPost: (() => void) | undefined;

/** A tool shaped like x_createPost: level 8, one permission id, throws when not approved. */
const stubPost = {
  name: "stub_post",
  displayName: "Stub/post",
  description: "Posts text",
  inputSchema: z.object({ text: z.string().min(1), account: z.string().min(1) }),
  async execute({ text, account }: { text: string; account: string }, agent: Agent) {
    const approved = await agent.requireService(ChatService).checkToolApproval(
      {
        toolName: "stub_post",
        message: `Post as ${account}?`,
        detailedDescription: text,
        safetyLevel: 8,
        default: false,
        permission: { id: `stub.${account}.post`, summary: `Post as ${account}` },
      },
      agent,
    );
    if (!approved) throw new ToolCallError("stub_post", "User did not approve posting");
    onPost?.();
    posted.push(`${account}: ${text}`);
    return { message: "**Stub** Posted", result: `Posted ${text}` };
  },
};

function setup(storeFile = path.join(tempDir(), "schedules.json"), config: Parameters<typeof SchedulerConfigSchema.parse>[0] = {}) {
  posted.length = 0;
  onPost = undefined;
  const app = createTestingApp() as TokenRingApp;
  const starter = createTestingAgent(app);
  const withChat = { ...starter.config, chat: ChatAgentConfigSchema.parse({ systemPrompt: "test" }) };
  app.requireService(AgentManager).addAgentConfigs(withChat);

  // Unattended jobs approve at most level 3, and nobody can be asked.
  const chat = app.addService(ChatService, new ChatService(app));
  chat.getChatConfig = () => ({ autoToolApprovalLevel: 3, toolApprovalMode: "ask" }) as ParsedChatConfig;
  chat.updateChatConfig = () => {};
  chat.addTool(stubPost);
  const permissions = app.addService(PermissionService, new PermissionService(app, new MemoryPermissionStore()));

  const jobs = app.addService(
    AgentJobService,
    new AgentJobService(app, { recordsFile: path.join(tempDir(), "agent-jobs.json"), config: AgentJobsConfigSchema.parse({}) }),
  );
  jobs.setChatIntegration(chat.jobIntegration());
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
  return { app, starter, chat, permissions, jobs, scheduler, controller, storeFile };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const postSchedule = (extra: Partial<ScheduleDefinition> = {}, input: Record<string, unknown> = { text: "Hello", account: "brand" }): ScheduleDefinition => ({
  at: new Date(Date.now() + HOUR).toISOString(),
  action: { kind: "tool", agentType: "mock-agent", tool: "stub_post", input },
  ...extra,
});

const lastRun = (scheduler: SchedulerService, name: string) => scheduler.getHistory(name)[name]!.at(-1)!;
const finished = (scheduler: SchedulerService, name: string) =>
  (scheduler.getHistory(name)[name] ?? []).at(-1)?.status !== "running" && (scheduler.getHistory(name)[name] ?? []).length > 0;

describe("scheduling at an exact time", () => {
  it("accepts a future time, shows it as the next run, and refuses a past one or a repeat", () => {
    const { scheduler } = setup();
    const when = new Date(Date.now() + HOUR).toISOString();
    scheduler.addSchedule("later", postSchedule({ at: when }));
    expect(scheduler.getSchedule("later")).toMatchObject({ state: "scheduled", nextRunTime: Date.parse(when) });

    expect(() => scheduler.addSchedule("old", postSchedule({ at: new Date(Date.now() - HOUR).toISOString() }))).toThrow(/in the past/);
    expect(() => scheduler.addSchedule("both", postSchedule({ repeat: "1 day" }))).toThrow(/cannot be combined with "repeat"/);
    expect(() => scheduler.addSchedule("naive", postSchedule({ at: "2099-01-01T09:00:00" }))).toThrow(/Z or UTC offset/);
    expect(scheduler.previewNextRun({ at: new Date(Date.now() - HOUR).toISOString() }).error).toContain("in the past");
    expect(scheduler.previewNextRun({ at: when })).toEqual({ nextRunTime: Date.parse(when), error: null });
  });

  it("fires from its timer at the time, once, and is then done", async () => {
    const { scheduler, controller } = setup();
    scheduler.start(controller.signal);
    scheduler.addSchedule("soon", postSchedule({ at: new Date(Date.now() + 60).toISOString() }));
    expect(scheduler.getHistory("soon").soon).toEqual([]);
    await waitFor(() => finished(scheduler, "soon"));
    expect(scheduler.getHistory("soon").soon).toHaveLength(1);
    expect(scheduler.getSchedule("soon")).toMatchObject({ nextRunTime: null, enabled: false });
  });

  it("a slot missed while the app was down fires once after the restart, and never again", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    const when = new Date(Date.now() + 80).toISOString();
    const first = setup(storeFile);
    first.scheduler.addSchedule("missed", postSchedule({ at: when })); // the app stops before it is started: nothing fires
    await first.scheduler.flush();
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(JSON.parse(fs.readFileSync(storeFile, "utf8")).history.missed ?? []).toEqual([]);

    const second = setup(storeFile);
    second.scheduler.start(second.controller.signal);
    await waitFor(() => finished(second.scheduler, "missed"));
    expect(second.scheduler.getHistory("missed").missed).toHaveLength(1);
    await second.scheduler.flush();

    // Back up again: it already ran, so it does not run a second time.
    const third = setup(storeFile);
    third.scheduler.start(third.controller.signal);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(third.scheduler.getHistory("missed").missed).toHaveLength(1);
    expect(third.scheduler.getSchedule("missed")?.state).not.toBe("scheduled");
  });
});

/** A store file written by hand: an `at` schedule that never ran, with its time in the past. */
function writeStore(storeFile: string, at: string, extra: Partial<ScheduleDefinition> = {}): void {
  fs.writeFileSync(storeFile, JSON.stringify({ version: 1, schedules: { late: postSchedule({ at, ...extra }) }, runtime: {}, history: {} }));
}

describe("a finished exact-time or tool schedule cannot be resumed", () => {
  it("resuming one that ran throws, does not reset it, and never fires it again (repeat-fire regression)", async () => {
    const { scheduler, permissions, controller } = setup();
    await permissions.grant({ id: "stub.brand.post" });
    scheduler.start(controller.signal);
    scheduler.addSchedule("post", postSchedule());
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));
    expect(posted).toEqual(["brand: Hello"]);
    const lastRunTime = scheduler.getSchedule("post")!.lastRunTime;
    expect(lastRunTime).toBeGreaterThan(0);
    expect(scheduler.getSchedule("post")).toMatchObject({ state: "done", enabled: false, nextRunTime: null });

    expect(() => scheduler.setEnabled("post", true)).toThrow(/already ran/);
    expect(scheduler.getSchedule("post")).toMatchObject({ lastRunTime, enabled: false, state: "done", nextRunTime: null });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(posted).toEqual(["brand: Hello"]);
    expect(scheduler.getHistory("post").post).toHaveLength(1);
    // Pausing is still fine.
    expect(scheduler.setEnabled("post", false).enabled).toBe(false);
  });

  it("a never-run paused one can be resumed, and updating it with a new future time re-arms it", async () => {
    const { scheduler, permissions, controller } = setup();
    await permissions.grant({ id: "stub.brand.post" });
    scheduler.start(controller.signal);
    scheduler.addSchedule("post", postSchedule({ enabled: false }));
    expect(scheduler.setEnabled("post", true).state).toBe("scheduled");
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));
    const when = new Date(Date.now() + 2 * HOUR).toISOString();
    scheduler.updateSchedule("post", postSchedule({ at: when }));
    expect(scheduler.getSchedule("post")).toMatchObject({ lastRunTime: 0, enabled: true, state: "scheduled", nextRunTime: Date.parse(when) });
  });

  it("an ordinary once job schedule that ran can still be resumed to run again", () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    const job: ScheduleDefinition = { once: true, enabled: false, action: { kind: "job", agentType: "mock-agent", prompt: "x" } };
    fs.writeFileSync(storeFile, JSON.stringify({ version: 1, schedules: { job }, runtime: { job: { lastRunTime: 1000 } }, history: {} }));
    const { scheduler } = setup(storeFile);
    expect(scheduler.setEnabled("job", true)).toMatchObject({ lastRunTime: 0, enabled: true, state: "scheduled" });
  });
});

describe("missed exact-time schedules", () => {
  it("does not run one whose time passed beyond the grace while the app was down; records it as missed", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    const at = new Date(Date.now() - 2 * HOUR).toISOString();
    writeStore(storeFile, at);
    const { scheduler, permissions, controller } = setup(storeFile);
    await permissions.grant({ id: "stub.brand.post" });
    scheduler.start(controller.signal);
    expect(posted).toEqual([]);
    const runs = scheduler.getHistory("late").late!;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "cancelled",
      message: "Missed: the app was not running at the scheduled time",
      scheduledFor: Date.parse(at),
      jobId: null,
    });
    expect(scheduler.getSchedule("late")).toMatchObject({ state: "missed", enabled: false, nextRunTime: null });
    expect(() => scheduler.setEnabled("late", true)).toThrow(/already ran/);
    await scheduler.flush();
    expect(JSON.parse(fs.readFileSync(storeFile, "utf8")).history.late[0].status).toBe("cancelled");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(posted).toEqual([]);
  });

  it("runs one that is late but inside the grace", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    writeStore(storeFile, new Date(Date.now() - 10 * 60_000).toISOString());
    const { scheduler, permissions, controller } = setup(storeFile);
    await permissions.grant({ id: "stub.brand.post" });
    scheduler.start(controller.signal);
    await waitFor(() => finished(scheduler, "late"));
    expect(posted).toEqual(["brand: Hello"]);
    expect(lastRun(scheduler, "late").status).toBe("completed");
  });

  it("honours missedGraceMinutes: 0 allows no lateness beyond the timer slop", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    writeStore(storeFile, new Date(Date.now() - 60_000).toISOString());
    const { scheduler, controller } = setup(storeFile, { missedGraceMinutes: 0 });
    scheduler.start(controller.signal);
    expect(lastRun(scheduler, "late").message).toContain("Missed");
    expect(posted).toEqual([]);
  });

  it("a paused one resumed after its time passed is missed, not run", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    writeStore(storeFile, new Date(Date.now() - 2 * HOUR).toISOString(), { enabled: false });
    const { scheduler, controller } = setup(storeFile);
    scheduler.start(controller.signal);
    expect(scheduler.getHistory("late").late).toEqual([]);
    expect(scheduler.setEnabled("late", true).state).toBe("missed");
    expect(posted).toEqual([]);
  });
});

describe("the crash window", () => {
  it("a tool action starts only after its slot is on disk", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    const { scheduler, permissions } = setup(storeFile);
    await permissions.grant({ id: "stub.brand.post" });
    scheduler.addSchedule("post", postSchedule());
    let onDisk: { lastRunTime?: number } | undefined;
    onPost = () => {
      onDisk = JSON.parse(fs.readFileSync(storeFile, "utf8")).runtime.post;
    };
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));
    expect(posted).toEqual(["brand: Hello"]);
    expect(onDisk?.lastRunTime).toBeGreaterThan(0);
  });
});

describe("the tool action", () => {
  it("with a grant, runs the tool once in a scheduler job with the fixed input and no model turn", async () => {
    const { scheduler, permissions, jobs } = setup();
    await permissions.grant({ id: "stub.brand.post", summary: "Post as brand" });
    scheduler.addSchedule("post", postSchedule());
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));

    expect(posted).toEqual(["brand: Hello"]);
    const run = lastRun(scheduler, "post");
    expect(run).toMatchObject({ status: "completed", actionKind: "tool", message: "Posted Hello" });
    const job = jobs.get(run.jobId!)!;
    expect(job).toMatchObject({
      owner: "scheduler",
      ownerRef: { schedule: "post" },
      origin: { kind: "schedule", scheduleId: "post" },
      status: "succeeded",
      refusalCount: 0,
    });
  });

  it("without a grant, is refused: nothing is posted and the refusal names the permission to allow", async () => {
    const { scheduler, jobs } = setup();
    scheduler.addSchedule("post", postSchedule());
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));

    expect(posted).toEqual([]);
    const run = lastRun(scheduler, "post");
    expect(run.status).toBe("failed");
    expect(run.message).toContain("needs approval and nobody was there to give it");
    expect(run.message).toContain("stub.brand.post");
    const job = jobs.get(run.jobId!)!;
    expect(job.refusalCount).toBe(1);
    expect(job.refusals[0]).toMatchObject({ tool: "stub_post", level: 8, permissionId: "stub.brand.post", permissionSummary: "Post as brand" });
  });

  it("a grant for another account does not cover it", async () => {
    const { scheduler, permissions } = setup();
    await permissions.grant({ id: "stub.other.post" });
    scheduler.addSchedule("post", postSchedule());
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));
    expect(posted).toEqual([]);
    expect(lastRun(scheduler, "post").status).toBe("failed");
  });

  it("a grant made after a refusal lets the next run through", async () => {
    const { scheduler, permissions } = setup();
    scheduler.addSchedule("post", postSchedule());
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));
    expect(posted).toEqual([]);
    await permissions.grant({ id: "stub.brand.post" });
    scheduler.runNow("post");
    await waitFor(() => scheduler.getHistory("post").post!.length === 2 && lastRun(scheduler, "post").status !== "running");
    expect(posted).toEqual(["brand: Hello"]);
  });

  it("fails clearly, starting no job, when the tool is missing at run time", async () => {
    const { scheduler, chat, jobs } = setup();
    scheduler.addSchedule("post", postSchedule());
    chat.unregisterTool("stub_post");
    scheduler.runNow("post");
    await waitFor(() => finished(scheduler, "post"));
    expect(lastRun(scheduler, "post")).toMatchObject({ status: "failed", jobId: null, message: expect.stringContaining('Tool "stub_post" does not exist') });
    expect(jobs.list()).toEqual([]);
  });

  it("fails clearly, starting no job, when the stored input no longer fits the tool", async () => {
    const storeFile = path.join(tempDir(), "schedules.json");
    // Written by hand (the store is not validated against tools when loaded).
    fs.writeFileSync(storeFile, JSON.stringify({ version: 1, schedules: { bad: postSchedule({}, { text: "", account: "brand" }) }, runtime: {}, history: {} }));
    const { scheduler, jobs } = setup(storeFile);
    scheduler.runNow("bad");
    await waitFor(() => finished(scheduler, "bad"));
    expect(lastRun(scheduler, "bad")).toMatchObject({ status: "failed", jobId: null, message: expect.stringContaining("not valid for tool") });
    expect(posted).toEqual([]);
    expect(jobs.list()).toEqual([]);
  });

  it("is checked when it is added: unknown tool, bad input, unknown agent type, approval level above the ceiling", () => {
    const { scheduler } = setup();
    expect(() => scheduler.addSchedule("a", postSchedule({ action: { kind: "tool", agentType: "mock-agent", tool: "nope", input: {} } }))).toThrow(
      /Tool "nope" does not exist/,
    );
    expect(() => scheduler.addSchedule("b", postSchedule({}, { text: "", account: "brand" }))).toThrow(/not valid for tool "stub_post"/);
    expect(() =>
      scheduler.addSchedule("c", postSchedule({ action: { kind: "tool", agentType: "ghost", tool: "stub_post", input: { text: "x", account: "y" } } })),
    ).toThrow(/Agent type "ghost" does not exist/);
    expect(() =>
      scheduler.addSchedule(
        "d",
        postSchedule({ action: { kind: "tool", agentType: "mock-agent", tool: "stub_post", input: { text: "x", account: "y" }, maxApprovalLevel: 9 } }),
      ),
    ).toThrow(/above this installation's ceiling/);
  });
});

describe("agents cannot create or edit tool schedules", () => {
  it("scheduler_set_enabled refuses to resume a tool schedule", async () => {
    const { scheduler, starter, app } = setup();
    scheduler.addSchedule("post", postSchedule({ enabled: false }));
    const agent = { requireService: (cls: unknown) => app.requireService(cls as never), config: starter.config, id: starter.id } as unknown as Agent;
    await expect(setScheduledTaskEnabled.execute({ name: "post", enabled: true }, agent)).rejects.toThrow(/cannot resume it/);
    expect(scheduler.getSchedule("post")!.enabled).toBe(false);
  });

  it("the generic update tool refuses a tool schedule and a fixed-time schedule", async () => {
    const { scheduler, starter, app } = setup();
    scheduler.addSchedule("post", postSchedule());
    const agent = { requireService: (cls: unknown) => app.requireService(cls as never), config: starter.config, id: starter.id } as unknown as Agent;
    await expect(updateScheduledTask.execute(updateScheduledTask.inputSchema.parse({ name: "post", prompt: "x" }), agent)).rejects.toThrow(/cannot edit it/);
    await expect(updateScheduledTask.execute(updateScheduledTask.inputSchema.parse({ name: "post", repeat: "1 day" }), agent)).rejects.toThrow(
      /cannot edit it/,
    );
  });

  it("neither generic tool has an input that could carry a tool action", async () => {
    const addTask = (await import("../tools/addScheduledTask.ts")).default;
    for (const tool of [addTask, updateScheduledTask]) {
      const shape = Object.keys(tool.inputSchema.shape);
      expect(shape).not.toContain("tool");
      expect(shape).not.toContain("input");
      expect(shape).not.toContain("at");
    }
  });
});
