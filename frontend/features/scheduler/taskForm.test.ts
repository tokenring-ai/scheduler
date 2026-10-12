import { describe, expect, it } from "bun:test";
import { buildTaskFromForm, type TaskFormValues, taskToFormValues } from "./taskForm.ts";

const base: TaskFormValues = {
  name: "Brief",
  message: "Do it",
  repeatPreset: "1 day",
  customRepeat: "",
  after: "",
  before: "",
  weekdays: [],
  dayOfMonth: "",
  timezone: "UTC",
};

describe("buildTaskFromForm", () => {
  it("builds a recurring task", () => {
    expect(buildTaskFromForm(base)).toEqual({ ok: true, name: "Brief", task: { message: "Do it", lastRunTime: 0, repeat: "1 day", timezone: "UTC" } });
  });

  it("marks one-time tasks and keeps edit bookkeeping", () => {
    const result = buildTaskFromForm({ ...base, repeatPreset: "", weekdays: ["mon", "fri"] }, { lastRunTime: 9, enabled: false });
    expect(result).toEqual({
      ok: true,
      name: "Brief",
      task: { message: "Do it", lastRunTime: 9, once: true, weekdays: "mon fri", timezone: "UTC", enabled: false },
    });
  });

  it("rejects invalid input", () => {
    expect(buildTaskFromForm({ ...base, name: " " })).toMatchObject({ ok: false });
    expect(buildTaskFromForm({ ...base, repeatPreset: "custom", customRepeat: "often" })).toMatchObject({ ok: false });
    expect(buildTaskFromForm({ ...base, after: "17:00", before: "09:00" })).toEqual({ ok: false, error: "Earliest time must be before latest time" });
    expect(buildTaskFromForm({ ...base, dayOfMonth: "32" })).toMatchObject({ ok: false });
  });
});

describe("taskToFormValues", () => {
  it("round-trips presets, custom intervals and once tasks", () => {
    expect(taskToFormValues("a", { message: "m", lastRunTime: 0, repeat: "1 hour" }, "UTC").repeatPreset).toBe("1 hour");
    const custom = taskToFormValues("a", { message: "m", lastRunTime: 0, repeat: "3 hours", weekdays: "Mon tue" }, "UTC");
    expect(custom).toMatchObject({ repeatPreset: "custom", customRepeat: "3 hours", weekdays: ["mon", "tue"] });
    expect(taskToFormValues("a", { message: "m", lastRunTime: 0, once: true, dayOfMonth: 3, timezone: "Asia/Tokyo" }, "UTC")).toMatchObject({
      repeatPreset: "",
      dayOfMonth: "3",
      timezone: "Asia/Tokyo",
    });
  });
});
