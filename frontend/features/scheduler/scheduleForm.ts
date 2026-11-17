import { budgetProblem, parseApprovalLevel, parseBudget } from "@tokenring-ai/one-frontend/components/JobLimitsFields.tsx";
import type { ScheduleAction, ScheduleActionKind, ScheduleDefinition } from "../../../schema.ts";
import { isValidRepeatInterval, parseTimeOfDayMinutes, REPEAT_PRESETS } from "./formatters.ts";

/** Raw values of the add/edit schedule form. */
export interface ScheduleFormValues {
  name: string;
  actionKind: ScheduleActionKind;
  /** The prompt of a job, agent or queue action. */
  prompt: string;
  agentType: string;
  agentId: string;
  queue: string;
  itemName: string;
  workflow: string;
  /** Name of the chat tool a tool action runs. */
  tool: string;
  /** The tool's input as JSON text. */
  toolInput: string;
  board: string;
  taskId: string;
  assignmentId: string;
  /** Budget in USD for a job or workflow action; blank: the operator default. */
  maxCostUsd: string;
  /** Highest approval level a job or workflow action may approve unasked; blank: the operator default. */
  maxApprovalLevel: string;
  repeatPreset: string;
  customRepeat: string;
  /** For the "at" repeat preset: a `datetime-local` value in the browser's time zone, "2026-11-20T09:00". */
  at: string;
  after: string;
  before: string;
  weekdays: string[];
  dayOfMonth: string;
  timezone: string;
  /**
   * Loaded schedule has neither `once` nor `repeat` (once a day from the next start of day).
   * Cleared when Repeat changes, so an untouched edit does not persist `repeat`.
   */
  implicitDaily: boolean;
  /**
   * Loaded schedule has no timezone. The select may still show a guessed zone.
   * Cleared when Timezone changes, so opening the editor does not persist the guess.
   */
  omitTimezone: boolean;
}

export type ScheduleFormResult = { ok: true; name: string; schedule: ScheduleDefinition } | { ok: false; error: string };

export const ACTION_KINDS: { value: ScheduleActionKind; label: string; hint: string }[] = [
  { value: "job", label: "Start a new agent", hint: "A fresh agent of the chosen type runs the prompt, then is cleaned up" },
  { value: "agent", label: "Prompt an existing agent", hint: "The prompt queues behind whatever that agent is doing" },
  { value: "queue", label: "Add a queue item", hint: "An item is added to a work queue, which runs it" },
  { value: "workflow", label: "Run a workflow", hint: "A run of the workflow starts" },
  {
    value: "tool",
    label: "Run one tool",
    hint: "A fresh agent runs one chat tool with the fixed input below, with no model turn; approvals and permissions still apply",
  },
  { value: "task", label: "Dispatch a task's agent", hint: "The agent assigned on a task card is dispatched" },
];

const PRESET_VALUES = new Set<string>(REPEAT_PRESETS.map(p => p.value).filter(v => v !== "custom"));

/** An ISO instant as the `datetime-local` value showing it in the browser's time zone. */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value (read in the browser's time zone) as an ISO instant; null when it is not a date. */
export function localInputToIso(value: string): string | null {
  const date = new Date(value);
  return value.trim() && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function emptyFormValues(timezone: string, agentType = ""): ScheduleFormValues {
  return {
    name: "",
    actionKind: "job",
    prompt: "",
    agentType,
    agentId: "",
    queue: "",
    itemName: "",
    workflow: "",
    tool: "",
    toolInput: "{}",
    board: "",
    taskId: "",
    assignmentId: "",
    maxCostUsd: "",
    maxApprovalLevel: "",
    repeatPreset: "1 day",
    customRepeat: "",
    at: "",
    after: "",
    before: "",
    weekdays: [],
    dayOfMonth: "",
    timezone,
    implicitDaily: false,
    omitTimezone: false,
  };
}

/** Seed the form from an existing schedule (edit mode). */
export function scheduleToFormValues(name: string, schedule: ScheduleDefinition, fallbackTimezone: string): ScheduleFormValues {
  // Neither `once` nor `repeat` runs at the next start of day. Show "Every day" without storing the
  // "1 day" interval, which repeats on a grid from its first run.
  const implicitDaily = !schedule.once && schedule.at == null && schedule.repeat == null;
  const repeat = schedule.once || schedule.at != null ? "" : (schedule.repeat ?? "1 day");
  const preset = schedule.at != null ? "at" : PRESET_VALUES.has(repeat) ? repeat : "custom";
  const { action } = schedule;
  return {
    ...emptyFormValues(schedule.timezone ?? fallbackTimezone),
    name,
    actionKind: action.kind,
    prompt: action.kind === "job" || action.kind === "agent" ? action.prompt : action.kind === "queue" ? action.item.prompt : "",
    agentType: action.kind === "job" || action.kind === "tool" ? action.agentType : "",
    agentId: action.kind === "agent" ? action.agentId : "",
    queue: action.kind === "queue" ? action.queue : "",
    itemName: action.kind === "queue" ? action.item.name : "",
    workflow: action.kind === "workflow" ? action.name : "",
    tool: action.kind === "tool" ? action.tool : "",
    toolInput: action.kind === "tool" ? JSON.stringify(action.input, null, 2) : "{}",
    board: action.kind === "task" ? action.ref.board : "",
    taskId: action.kind === "task" ? action.ref.taskId : "",
    assignmentId: action.kind === "task" ? action.assignmentId : "",
    maxCostUsd:
      (action.kind === "job" || action.kind === "workflow" || action.kind === "tool") && action.maxCostUsd !== undefined ? String(action.maxCostUsd) : "",
    maxApprovalLevel:
      (action.kind === "job" || action.kind === "workflow" || action.kind === "tool") && action.maxApprovalLevel !== undefined
        ? String(action.maxApprovalLevel)
        : "",
    repeatPreset: preset,
    customRepeat: preset === "custom" ? repeat : "",
    at: schedule.at != null ? isoToLocalInput(schedule.at) : "",
    after: schedule.after ?? "",
    before: schedule.before ?? "",
    weekdays: (schedule.weekdays ?? "")
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean),
    dayOfMonth: schedule.dayOfMonth != null ? String(schedule.dayOfMonth) : "",
    implicitDaily,
    omitTimezone: schedule.timezone == null,
  };
}

function buildAction(values: ScheduleFormValues): ScheduleAction | string {
  const prompt = values.prompt.trim();
  const budget = parseBudget(values.maxCostUsd);
  const level = parseApprovalLevel(values.maxApprovalLevel);
  const limits = { ...(budget !== undefined ? { maxCostUsd: budget } : {}), ...(level !== undefined ? { maxApprovalLevel: level } : {}) };
  if ((values.actionKind === "job" || values.actionKind === "workflow" || values.actionKind === "tool") && budgetProblem(values.maxCostUsd))
    return "Budget must be an amount above 0, or blank";
  switch (values.actionKind) {
    case "job":
      if (!values.agentType.trim()) return "Pick the agent type to start";
      if (!prompt) return "The prompt is required";
      return { kind: "job", agentType: values.agentType.trim(), prompt, ...limits };
    case "agent":
      if (!values.agentId.trim()) return "Pick the agent to prompt";
      if (!prompt) return "The prompt is required";
      return { kind: "agent", agentId: values.agentId.trim(), prompt };
    case "queue":
      if (!values.queue.trim()) return "Pick the queue";
      if (!values.itemName.trim()) return "The item needs a name";
      if (!prompt) return "The prompt is required";
      return { kind: "queue", queue: values.queue.trim(), item: { name: values.itemName.trim(), prompt } };
    case "workflow":
      if (!values.workflow.trim()) return "Pick the workflow";
      return { kind: "workflow", name: values.workflow.trim(), ...limits };
    case "tool": {
      if (!values.agentType.trim()) return "Pick the agent type to run the tool in";
      if (!values.tool.trim()) return "Enter the name of the tool to run";
      let input: unknown;
      try {
        input = JSON.parse(values.toolInput || "{}");
      } catch {
        return "The tool input must be valid JSON";
      }
      if (typeof input !== "object" || input === null || Array.isArray(input)) return "The tool input must be a JSON object";
      return { kind: "tool", agentType: values.agentType.trim(), tool: values.tool.trim(), input: input as Record<string, unknown>, ...limits };
    }
    case "task":
      if (!values.board.trim() || !values.taskId.trim() || !values.assignmentId.trim()) return "Enter the board, task and assignment ids";
      return { kind: "task", ref: { board: values.board.trim(), taskId: values.taskId.trim() }, assignmentId: values.assignmentId.trim() };
  }
}

/**
 * Validate the form and build the schedule to send. Pure, so the live next-run preview can reuse it
 * without raising toasts. `enabled` comes from the schedule being edited.
 */
export function buildScheduleFromForm(values: ScheduleFormValues, base: { enabled?: boolean | undefined } = {}): ScheduleFormResult {
  const name = values.name.trim();
  if (!name) return { ok: false, error: "Schedule name is required" };
  const action = buildAction(values);
  if (typeof action === "string") return { ok: false, error: action };

  if (values.repeatPreset === "at") {
    const at = localInputToIso(values.at);
    if (!at) return { ok: false, error: "Pick the date and time to run" };
    return { ok: true, name, schedule: { action, at, ...(base.enabled === false ? { enabled: false } : {}) } };
  }

  const implicitDaily = values.implicitDaily && values.repeatPreset === "1 day";
  const repeat = values.repeatPreset === "custom" ? values.customRepeat.trim() || undefined : values.repeatPreset === "" ? undefined : values.repeatPreset;
  if (values.repeatPreset === "custom" && !repeat) return { ok: false, error: "Enter a custom interval (e.g. 2 hours)" };
  if (repeat && !isValidRepeatInterval(repeat)) return { ok: false, error: 'Interval must look like "2 hours", "30 minutes", "1 day" or "1 month"' };

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
    schedule: {
      action,
      ...(implicitDaily ? {} : repeat ? { repeat } : { once: true }),
      ...(after ? { after: after.slice(0, 5) } : {}),
      ...(before ? { before: before.slice(0, 5) } : {}),
      ...(values.weekdays.length > 0 ? { weekdays: values.weekdays.join(" ") } : {}),
      ...(day != null ? { dayOfMonth: day } : {}),
      ...(values.timezone && !values.omitTimezone ? { timezone: values.timezone } : {}),
      ...(base.enabled === false ? { enabled: false } : {}),
    },
  };
}

/** The schedule's timing alone, for the next-run preview. */
export function timingOf(schedule: ScheduleDefinition): Omit<ScheduleDefinition, "action" | "enabled"> {
  const { action: _action, enabled: _enabled, ...timing } = schedule;
  return timing;
}
