import { isValidRepeatInterval, parseTimeOfDayMinutes, REPEAT_PRESETS } from "./formatters.ts";

/** The scheduled-task shape the scheduler RPC accepts. */
export interface ScheduledTaskInput {
  message: string;
  lastRunTime: number;
  repeat?: string;
  once?: boolean;
  after?: string;
  before?: string;
  weekdays?: string;
  dayOfMonth?: number;
  timezone?: string;
  enabled?: boolean;
}

/** Raw values of the add/edit task form. */
export interface TaskFormValues {
  name: string;
  message: string;
  repeatPreset: string;
  customRepeat: string;
  after: string;
  before: string;
  weekdays: string[];
  dayOfMonth: string;
  timezone: string;
}

export type TaskFormResult = { ok: true; name: string; task: ScheduledTaskInput } | { ok: false; error: string };

const PRESET_VALUES = new Set<string>(REPEAT_PRESETS.map(p => p.value).filter(v => v !== "custom"));

/** Seed the form from an existing task (edit mode). */
export function taskToFormValues(name: string, task: ScheduledTaskInput, fallbackTimezone: string): TaskFormValues {
  // A task with neither `once` nor `repeat` runs daily; "Every day" is the closest preset.
  const repeat = task.once ? "" : (task.repeat ?? "1 day");
  const preset = PRESET_VALUES.has(repeat) ? repeat : "custom";
  return {
    name,
    message: task.message,
    repeatPreset: preset,
    customRepeat: preset === "custom" ? repeat : "",
    after: task.after ?? "",
    before: task.before ?? "",
    weekdays: (task.weekdays ?? "")
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean),
    dayOfMonth: task.dayOfMonth != null ? String(task.dayOfMonth) : "",
    timezone: task.timezone ?? fallbackTimezone,
  };
}

/**
 * Validate the form and build the task to send. Pure, so the live next-run
 * preview can reuse it without raising toasts. `lastRunTime` and `enabled`
 * come from the task being edited (or default for a new task).
 */
export function buildTaskFromForm(values: TaskFormValues, base: { lastRunTime?: number; enabled?: boolean } = {}): TaskFormResult {
  const name = values.name.trim();
  const message = values.message.trim();
  if (!name) return { ok: false, error: "Task name is required" };
  if (!message) return { ok: false, error: "Task message is required" };

  const repeat = values.repeatPreset === "custom" ? values.customRepeat.trim() || undefined : values.repeatPreset === "" ? undefined : values.repeatPreset;
  if (values.repeatPreset === "custom" && !repeat) return { ok: false, error: "Enter a custom interval (e.g. 2 hours)" };
  if (repeat && !isValidRepeatInterval(repeat)) return { ok: false, error: 'Interval must look like "2 hours", "30 minutes", or "1 day"' };

  const after = values.after.trim();
  const before = values.before.trim();
  const afterMins = after ? parseTimeOfDayMinutes(after) : null;
  const beforeMins = before ? parseTimeOfDayMinutes(before) : null;
  if (after && afterMins == null) return { ok: false, error: "Earliest time must be a valid time (HH:mm)" };
  if (before && beforeMins == null) return { ok: false, error: "Latest time must be a valid time (HH:mm)" };
  if (afterMins != null && beforeMins != null && afterMins >= beforeMins) return { ok: false, error: "Earliest time must be before latest time" };

  const day = values.dayOfMonth.trim() ? Number(values.dayOfMonth) : undefined;
  if (day != null && (!Number.isInteger(day) || day < 1 || day > 31)) return { ok: false, error: "Day of month must be a whole number between 1 and 31" };

  return {
    ok: true,
    name,
    task: {
      message,
      lastRunTime: base.lastRunTime ?? 0,
      ...(repeat ? { repeat } : { once: true }),
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      ...(values.weekdays.length > 0 ? { weekdays: values.weekdays.join(" ") } : {}),
      ...(day != null ? { dayOfMonth: day } : {}),
      ...(values.timezone ? { timezone: values.timezone } : {}),
      ...(base.enabled === false ? { enabled: false } : {}),
    },
  };
}
