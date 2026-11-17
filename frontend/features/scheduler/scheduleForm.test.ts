import { describe, expect, it } from "bun:test";
import { buildScheduleFromForm, emptyFormValues, type ScheduleFormValues, scheduleToFormValues } from "./scheduleForm.ts";

const base: ScheduleFormValues = { ...emptyFormValues("UTC", "code"), name: "Brief", prompt: "Do it" };

describe("buildScheduleFromForm", () => {
  it("builds a recurring job schedule", () => {
    expect(buildScheduleFromForm(base)).toEqual({
      ok: true,
      name: "Brief",
      schedule: { action: { kind: "job", agentType: "code", prompt: "Do it" }, repeat: "1 day", timezone: "UTC" },
    });
  });

  it("carries a budget and approval level on job and workflow actions only", () => {
    const limits = { maxCostUsd: "1.5", maxApprovalLevel: "6" };
    expect(buildScheduleFromForm({ ...base, ...limits })).toMatchObject({
      ok: true,
      schedule: { action: { kind: "job", agentType: "code", prompt: "Do it", maxCostUsd: 1.5, maxApprovalLevel: 6 } },
    });
    expect(buildScheduleFromForm({ ...base, ...limits, actionKind: "workflow", workflow: "deploy" })).toMatchObject({
      ok: true,
      schedule: { action: { kind: "workflow", name: "deploy", maxCostUsd: 1.5, maxApprovalLevel: 6 } },
    });
    // Blank means the operator default: nothing is sent.
    expect(buildScheduleFromForm({ ...base, maxCostUsd: "", maxApprovalLevel: "" })).toMatchObject({
      schedule: { action: { kind: "job", agentType: "code", prompt: "Do it" } },
    });
    expect(buildScheduleFromForm({ ...base, maxCostUsd: "0" })).toEqual({ ok: false, error: "Budget must be an amount above 0, or blank" });
    // Other kinds have no limits to carry.
    expect(buildScheduleFromForm({ ...base, ...limits, actionKind: "agent", agentId: "a1" })).toMatchObject({
      schedule: { action: { kind: "agent", agentId: "a1", prompt: "Do it" } },
    });
    // Editing shows them again.
    const built = buildScheduleFromForm({ ...base, ...limits });
    if (!built.ok) throw new Error("expected ok");
    expect(scheduleToFormValues("Brief", built.schedule, "UTC")).toMatchObject(limits);
  });

  it("builds each action kind", () => {
    const build = (values: Partial<ScheduleFormValues>) => {
      const result = buildScheduleFromForm({ ...base, ...values });
      return result.ok ? result.schedule.action : result.error;
    };
    expect(build({ actionKind: "agent", agentId: "a1" })).toEqual({ kind: "agent", agentId: "a1", prompt: "Do it" });
    expect(build({ actionKind: "agent" })).toBe("Pick the agent to prompt");
    expect(build({ actionKind: "queue", queue: "docs", itemName: "Refresh" })).toEqual({
      kind: "queue",
      queue: "docs",
      item: { name: "Refresh", prompt: "Do it" },
    });
    expect(build({ actionKind: "workflow", workflow: "deploy", prompt: "" })).toEqual({ kind: "workflow", name: "deploy" });
    expect(build({ actionKind: "task", board: "eng", taskId: "ENG-1", assignmentId: "a1" })).toEqual({
      kind: "task",
      ref: { board: "eng", taskId: "ENG-1" },
      assignmentId: "a1",
    });
    expect(build({ actionKind: "task", board: "eng" })).toBe("Enter the board, task and assignment ids");
  });

  it("marks one-time schedules and keeps the pause of an edited one", () => {
    const result = buildScheduleFromForm({ ...base, repeatPreset: "", weekdays: ["mon", "fri"] }, { enabled: false });
    expect(result).toMatchObject({ ok: true, schedule: { once: true, weekdays: "mon fri", timezone: "UTC", enabled: false } });
  });

  it("rejects invalid input", () => {
    expect(buildScheduleFromForm({ ...base, name: " " })).toMatchObject({ ok: false });
    expect(buildScheduleFromForm({ ...base, repeatPreset: "custom", customRepeat: "often" })).toMatchObject({ ok: false });
    expect(buildScheduleFromForm({ ...base, repeatPreset: "custom", customRepeat: "10 seconds" })).toMatchObject({ ok: false });
    expect(buildScheduleFromForm({ ...base, after: "17:00", before: "09:00" })).toEqual({ ok: false, error: "Earliest time must be before latest time" });
    expect(buildScheduleFromForm({ ...base, dayOfMonth: "32" })).toMatchObject({ ok: false });
  });
});

describe("scheduleToFormValues", () => {
  it("round-trips presets, custom intervals, actions and one-time schedules", () => {
    const action = { kind: "job" as const, agentType: "code", prompt: "m" };
    expect(scheduleToFormValues("a", { action, repeat: "1 hour" }, "UTC").repeatPreset).toBe("1 hour");
    expect(scheduleToFormValues("a", { action, repeat: "3 hours", weekdays: "Mon tue" }, "UTC")).toMatchObject({
      repeatPreset: "custom",
      customRepeat: "3 hours",
      weekdays: ["mon", "tue"],
    });
    expect(scheduleToFormValues("a", { action, once: true, dayOfMonth: 3, timezone: "Asia/Tokyo" }, "UTC")).toMatchObject({
      repeatPreset: "",
      dayOfMonth: "3",
      timezone: "Asia/Tokyo",
      implicitDaily: false,
      omitTimezone: false,
    });
    const queue = { action: { kind: "queue" as const, queue: "docs", item: { name: "n", prompt: "p" } }, repeat: "1 week" };
    const values = scheduleToFormValues("q", queue, "UTC");
    expect(values).toMatchObject({ actionKind: "queue", queue: "docs", itemName: "n", prompt: "p", omitTimezone: true });
    expect(buildScheduleFromForm(values)).toEqual({ ok: true, name: "q", schedule: queue });
  });

  it("does not write repeat for an untouched implicit daily schedule, or a guessed timezone", () => {
    const schedule = { action: { kind: "agent" as const, agentId: "a1", prompt: "Digest" }, after: "09:00", weekdays: "mon fri" };
    const values = scheduleToFormValues("Digest", schedule, "America/Chicago");
    expect(values).toMatchObject({ repeatPreset: "1 day", implicitDaily: true, omitTimezone: true, timezone: "America/Chicago" });
    expect(buildScheduleFromForm(values)).toEqual({ ok: true, name: "Digest", schedule });
    expect(buildScheduleFromForm({ ...values, implicitDaily: false, omitTimezone: false })).toMatchObject({
      ok: true,
      schedule: { repeat: "1 day", timezone: "America/Chicago" },
    });
  });
});

describe("an exact time (at) and the tool action", () => {
  it("builds an at schedule from a local date and time, with no repeat, window or timezone", () => {
    const local = "2099-01-02T09:30";
    const built = buildScheduleFromForm({ ...base, repeatPreset: "at", at: local, after: "09:00", weekdays: ["mon"], timezone: "Asia/Tokyo" });
    expect(built).toEqual({
      ok: true,
      name: "Brief",
      schedule: { action: { kind: "job", agentType: "code", prompt: "Do it" }, at: new Date(local).toISOString() },
    });
    expect(buildScheduleFromForm({ ...base, repeatPreset: "at", at: "" })).toEqual({ ok: false, error: "Pick the date and time to run" });
  });

  it("shows an at schedule as the at preset with its local time, and round-trips it", () => {
    const at = new Date("2099-01-02T09:30").toISOString();
    const values = scheduleToFormValues("Brief", { at, action: { kind: "job", agentType: "code", prompt: "Do it" } }, "UTC");
    expect(values).toMatchObject({ repeatPreset: "at", at: "2099-01-02T09:30", implicitDaily: false });
    expect(buildScheduleFromForm(values)).toMatchObject({ ok: true, schedule: { at } });
  });

  it("builds and round-trips a tool action, and refuses input that is not a JSON object", () => {
    const values = { ...base, actionKind: "tool" as const, tool: "x_createPost", toolInput: '{"text":"hi","account":"brand"}' };
    const built = buildScheduleFromForm(values);
    expect(built).toMatchObject({
      ok: true,
      schedule: { action: { kind: "tool", agentType: "code", tool: "x_createPost", input: { text: "hi", account: "brand" } } },
    });
    if (!built.ok) throw new Error("expected ok");
    expect(scheduleToFormValues("Brief", built.schedule, "UTC")).toMatchObject({ actionKind: "tool", tool: "x_createPost", agentType: "code" });
    expect(buildScheduleFromForm({ ...values, toolInput: "{" })).toEqual({ ok: false, error: "The tool input must be valid JSON" });
    expect(buildScheduleFromForm({ ...values, toolInput: "[1]" })).toEqual({ ok: false, error: "The tool input must be a JSON object" });
    expect(buildScheduleFromForm({ ...values, tool: "" })).toEqual({ ok: false, error: "Enter the name of the tool to run" });
  });
});
