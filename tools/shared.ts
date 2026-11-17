import { describeAction } from "../actions.ts";
import type SchedulerService from "../SchedulerService.ts";
import type { ScheduleRun, ScheduleView } from "../schema.ts";

/** The prompt a schedule sends: the instructions, plus any extra context. */
export function buildSchedulePrompt(prompt: string, context: string | undefined): string {
  const trimmedContext = context?.trim();
  return trimmedContext ? `${prompt}\n\nADDITIONAL CONTEXT:\n${trimmedContext}` : prompt;
}

export const blankToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

function time(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : "";
}

/** How a schedule's timing reads: "every 1 hour, 09:00–17:00, mon tue [UTC]". */
export function describeTiming(view: Pick<ScheduleView, "definition">): string {
  const { definition: d } = view;
  const parts = [d.at ? `once, at ${d.at}` : d.once ? "once" : d.repeat ? `every ${d.repeat}` : "once a day"];
  if (d.after || d.before) parts.push(`${d.after ?? "…"}–${d.before ?? "…"}`);
  if (d.weekdays) parts.push(d.weekdays);
  if (d.dayOfMonth !== undefined) parts.push(`day ${d.dayOfMonth} of the month`);
  if (d.timezone) parts.push(`[${d.timezone}]`);
  return parts.join(", ");
}

const STATE_LABELS: Record<ScheduleView["state"], string> = {
  scheduled: "Scheduled",
  running: "Running",
  paused: "Paused",
  done: "Done (one-time, ran)",
  missed: "Missed (the app was not running at its time; not run)",
  error: "Error",
  stopped: "Scheduler stopped",
};

export function describeSchedule(view: ScheduleView, lastRun?: ScheduleRun): string {
  const lines = [
    `${view.name}${view.source === "config" ? " (from config)" : ""}:`,
    `  Action: ${describeAction(view.definition.action)}`,
    `  Timing: ${describeTiming(view)}`,
    `  Status: ${STATE_LABELS[view.state]}${view.error ? ` — ${view.error}` : ""}`,
    `  Next run: ${time(view.nextRunTime) || "—"}`,
    `  Last run: ${time(view.lastRunTime) || "Never"}${lastRun && lastRun.status !== "running" ? ` (${lastRun.status}: ${lastRun.message.split("\n")[0]})` : ""}`,
  ];
  return lines.join("\n");
}

/** Every schedule, as the get-schedule tool and `/schedule show` list them. */
export function formatSchedules(scheduler: SchedulerService): string {
  const views = scheduler.listSchedules();
  if (views.length === 0) return "No schedules.";
  const history = scheduler.getHistory();
  const header = `The current date and time is ${new Date().toLocaleString()}. The scheduler is ${scheduler.isRunning() ? "running" : "stopped"}.`;
  return [header, ...views.map(view => describeSchedule(view, history[view.name]?.at(-1)))].join("\n\n");
}
