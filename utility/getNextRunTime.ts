import moment from "moment-timezone";
import type { ScheduleTiming } from "../schema.ts";
import { checkDayConditions, parseWeekdays } from "./checkDayConditions.ts";
import { parseRepeat, type RepeatInterval, repeatProblem } from "./parseInterval.ts";

/** How far ahead a matching day is searched: a full year, so day 29-31 and leap days are always found. */
export const MAX_DAYS_AHEAD = 366;

/** A schedule whose timing can never be computed: shown as an error, never silently dropped. */
export class ScheduleTimingError extends Error {
  override readonly name = "ScheduleTimingError";
}

/** What the scheduler remembers about a schedule's runs. */
export type RunBookkeeping = {
  /** The slot of the last run; 0 or absent when it never ran. */
  lastRunTime?: number | undefined;
  /** The first slot it ran for: repeats are counted from here, so they never drift. */
  anchorTime?: number | undefined;
};

/** "HH:mm" on a 24-hour clock; null for anything else ("9am", "25:00", "9:5"). */
export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/** True for a timezone moment-timezone knows (IANA names such as "Europe/Paris", or "UTC"). */
export function isValidTimezone(timezone: string): boolean {
  return moment.tz.zone(timezone) !== null;
}

/** The schedule's timezone, or the server's when it has none. */
export function resolveTimezone(timing: Pick<ScheduleTiming, "timezone">): string {
  return timing.timezone || moment.tz.guess();
}

/** An ISO-8601 date and time that names one instant: it ends in Z or a UTC offset. */
const AT_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i;

/** The instant `at` names (ms since the epoch); null when it is not an ISO-8601 time with Z or an offset. */
export function parseAt(value: string): number | null {
  const trimmed = value.trim();
  if (!AT_PATTERN.test(trimmed)) return null;
  // Date.parse rolls impossible dates over (2026-02-31 becomes March 3): refuse them instead.
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)!;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)) return null;
  const time = Date.parse(trimmed);
  return Number.isNaN(time) ? null : time;
}

/** Why a new schedule's `at` cannot be used because it has already passed; null when it is fine or absent. */
export function pastAtProblem(timing: Pick<ScheduleTiming, "at">, now = Date.now()): string | null {
  if (timing.at === undefined) return null;
  const at = parseAt(timing.at);
  return at !== null && at <= now ? `"at" (${timing.at}) is in the past; pick a time in the future` : null;
}

/** Why the timing could never run as written; null when it is fine. */
export function timingProblem(timing: ScheduleTiming): string | null {
  if (timing.at !== undefined) {
    if (parseAt(timing.at) === null) {
      return `"at" must be an ISO-8601 date and time with a Z or UTC offset, such as 2026-11-20T09:00:00-05:00, not "${timing.at}"`;
    }
    if (timing.repeat !== undefined) return `"at" runs once, so it cannot be combined with "repeat"`;
    if (timing.after !== undefined || timing.before !== undefined || timing.weekdays !== undefined || timing.dayOfMonth !== undefined) {
      return `"at" is an exact moment, so it cannot be combined with a time window, weekdays or a day of month`;
    }
  }
  const after = timing.after === undefined ? null : parseTimeOfDay(timing.after);
  const before = timing.before === undefined ? null : parseTimeOfDay(timing.before);
  if (timing.after !== undefined && !after) return `"after" must be a 24-hour time such as 09:30, not "${timing.after}"`;
  if (timing.before !== undefined && !before) return `"before" must be a 24-hour time such as 17:00, not "${timing.before}"`;
  if (after && before && after.hour * 60 + after.minute >= before.hour * 60 + before.minute) {
    return `"after" (${timing.after}) must be earlier than "before" (${timing.before}); windows that cross midnight are not supported`;
  }
  if (timing.repeat !== undefined) {
    const problem = repeatProblem(timing.repeat);
    if (problem) return problem;
  }
  if (timing.timezone !== undefined && !isValidTimezone(timing.timezone)) {
    return `"${timing.timezone}" is not a known timezone; use an IANA name such as "America/New_York" or "UTC"`;
  }
  if (timing.weekdays !== undefined && !parseWeekdays(timing.weekdays)) {
    return `"weekdays" must list days such as "mon tue wed", not "${timing.weekdays}"`;
  }
  if (timing.dayOfMonth !== undefined && (!Number.isInteger(timing.dayOfMonth) || timing.dayOfMonth < 1 || timing.dayOfMonth > 31)) {
    return `"dayOfMonth" must be a whole number from 1 to 31`;
  }
  return null;
}

/**
 * The first repeat slot after `lastRunTime`, counted from `anchor` (anchor + n × interval). Days, weeks
 * and months are added on the calendar in `tz`, so they keep their wall-clock time across DST, and a
 * month from the 31st is the last day of a shorter month, then the 31st again.
 */
function nextSlotAfter(anchor: number, lastRunTime: number, interval: RepeatInterval, tz: string): number {
  if (lastRunTime < anchor) return anchor;
  if (!interval.calendar) {
    const step = interval.approxMs;
    return anchor + (Math.floor((lastRunTime - anchor) / step) + 1) * step;
  }
  const start = moment.tz(anchor, tz);
  const slot = (n: number) =>
    start
      .clone()
      .add(n * interval.amount, interval.unit)
      .valueOf();
  let n = Math.max(1, Math.floor(moment.tz(lastRunTime, tz).diff(start, interval.unit, true) / interval.amount));
  while (n > 1 && slot(n - 1) > lastRunTime) n--;
  while (slot(n) <= lastRunTime) n++;
  return slot(n);
}

/** The first time at or after `start` that the schedule's days and time window allow; null when none within a year. */
function firstAllowedAtOrAfter(start: number, timing: ScheduleTiming, tz: string): number | null {
  const after = timing.after ? parseTimeOfDay(timing.after) : null;
  const before = timing.before ? parseTimeOfDay(timing.before) : null;
  const first = moment.tz(start, tz);
  for (let offset = 0; offset <= MAX_DAYS_AHEAD; offset++) {
    let candidate = offset === 0 ? first.clone() : first.clone().startOf("day").add(offset, "days");
    if (!checkDayConditions(timing, candidate)) continue;
    if (after) {
      const opens = candidate.clone().set({ hour: after.hour, minute: after.minute, second: 0, millisecond: 0 });
      if (candidate.isBefore(opens)) candidate = opens;
    }
    if (before) {
      const closes = candidate.clone().set({ hour: before.hour, minute: before.minute, second: 0, millisecond: 0 });
      if (candidate.isAfter(closes)) continue;
    }
    return candidate.valueOf();
  }
  return null;
}

/**
 * When the schedule should fire next. Null only when it is finished: a `once` schedule that ran.
 * (Pausing is the caller's business.) An `at` schedule is one-time too: it runs at that instant, or
 * as soon as the app is up when it was down then (once), and is done after it ran.
 *
 * - With `repeat`: the next slot on its grid (anchor + n × interval) after the last run.
 * - Without `repeat` or `once`: once a day, from the start of the day after the last run.
 * - A slot that has passed (the app was down or asleep) fires now — once, not once per missed slot —
 *   when the days and window allow it, and otherwise when the window next opens.
 *
 * @throws ScheduleTimingError when the timing is invalid or never matches within a year.
 */
export function getNextRunTime(timing: ScheduleTiming, runs: RunBookkeeping = {}, now = Date.now()): number | null {
  const problem = timingProblem(timing);
  if (problem) throw new ScheduleTimingError(problem);
  const lastRunTime = runs.lastRunTime ?? 0;
  if ((timing.once || timing.at !== undefined) && lastRunTime) return null;
  if (timing.at !== undefined) return Math.max(parseAt(timing.at)!, now);

  const tz = resolveTimezone(timing);
  let earliest = now;
  if (lastRunTime && !timing.once) {
    if (timing.repeat) {
      earliest = nextSlotAfter(runs.anchorTime ?? lastRunTime, lastRunTime, parseRepeat(timing.repeat)!, tz);
    } else {
      earliest = moment.tz(lastRunTime, tz).add(1, "day").startOf("day").valueOf();
    }
  }

  const next = firstAllowedAtOrAfter(Math.max(earliest, now), timing, tz);
  if (next === null) {
    throw new ScheduleTimingError("It never matches within the next year; check its weekdays, day of month and time window");
  }
  return next;
}
