import { describe, expect, it } from "bun:test";
import moment from "moment-timezone";
import { getNextRunTime } from "../../../utility/getNextRunTime.ts";
import { buildTaskFromForm, type ScheduledTaskInput, type TaskFormValues, taskToFormValues } from "./taskForm.ts";

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
  implicitDaily: false,
  omitTimezone: false,
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
      implicitDaily: false,
      omitTimezone: false,
    });
  });
});

describe("edit round-trips", () => {
  it("does not write repeat for an untouched default daily task, and the preview stays the next start of day", () => {
    const timezone = "UTC";
    const lastRunTime = moment.tz(timezone).startOf("day").add(12, "hours").valueOf();
    const task: ScheduledTaskInput = { message: "Digest", lastRunTime, timezone, after: "09:00", weekdays: "mon fri" };
    const values = taskToFormValues("Digest", task, "America/Chicago");
    expect(values).toMatchObject({ repeatPreset: "1 day", timezone, implicitDaily: true, omitTimezone: false, weekdays: ["mon", "fri"] });

    const built = buildTaskFromForm(values, { lastRunTime });
    expect(built).toEqual({
      ok: true,
      name: "Digest",
      task: { message: "Digest", lastRunTime, timezone, after: "09:00", weekdays: "mon fri" },
    });

    const open = { message: "Digest", lastRunTime, timezone };
    const openValues = taskToFormValues("Digest", open, timezone);
    const preview = buildTaskFromForm(openValues, { lastRunTime });
    expect(preview).toEqual({ ok: true, name: "Digest", task: open });
    if (!preview.ok) return;
    const nextStartOfDay = moment.tz(lastRunTime + 86_400_000, timezone).startOf("day").valueOf();
    expect(getNextRunTime(preview.task)).toBe(nextStartOfDay);
    expect(getNextRunTime(preview.task)).toBe(getNextRunTime(open));
    expect(getNextRunTime({ ...open, repeat: "1 day" })).not.toBe(nextStartOfDay);

    expect(buildTaskFromForm({ ...openValues, implicitDaily: false }, { lastRunTime })).toMatchObject({
      ok: true,
      task: { repeat: "1 day", timezone },
    });
    const explicit = taskToFormValues("Digest", { ...open, repeat: "1 day" }, timezone);
    expect(explicit.implicitDaily).toBe(false);
    expect(buildTaskFromForm(explicit, { lastRunTime })).toMatchObject({ ok: true, task: { repeat: "1 day" } });
  });

  it("omits a missing timezone on preview and save unless the user picks one", () => {
    const task: ScheduledTaskInput = { message: "Digest", lastRunTime: 4, repeat: "6 hours" };
    const values = taskToFormValues("Digest", task, "Pacific/Auckland");
    expect(values.timezone).toBe("Pacific/Auckland");
    expect(values.omitTimezone).toBe(true);

    const built = buildTaskFromForm(values, { lastRunTime: task.lastRunTime });
    expect(built).toEqual({
      ok: true,
      name: "Digest",
      task: { message: "Digest", lastRunTime: 4, repeat: "6 hours" },
    });
    if (!built.ok) return;
    expect(getNextRunTime(built.task)).toBe(getNextRunTime(task));

    expect(buildTaskFromForm({ ...values, omitTimezone: false }, { lastRunTime: 4 })).toEqual({
      ok: true,
      name: "Digest",
      task: { message: "Digest", lastRunTime: 4, repeat: "6 hours", timezone: "Pacific/Auckland" },
    });
    expect(buildTaskFromForm({ ...values, timezone: "UTC", omitTimezone: false }, { lastRunTime: 4 })).toMatchObject({
      ok: true,
      task: { timezone: "UTC" },
    });

    const stored = taskToFormValues("Digest", { ...task, timezone: "UTC" }, "Pacific/Auckland");
    expect(stored.omitTimezone).toBe(false);
    expect(buildTaskFromForm(stored, { lastRunTime: 4 })).toMatchObject({ ok: true, task: { timezone: "UTC" } });
  });
});
