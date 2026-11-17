export type RepeatUnit = "second" | "minute" | "hour" | "day" | "week" | "month";

export type RepeatInterval = {
  amount: number;
  unit: RepeatUnit;
  /** Calendar units (day, week, month) follow the wall clock in the schedule's timezone; the others are fixed lengths. */
  calendar: boolean;
  /** Approximate length in milliseconds (a month counts as 31 days), for limits. */
  approxMs: number;
};

const UNITS: Record<string, RepeatUnit> = {
  second: "second",
  seconds: "second",
  minute: "minute",
  minutes: "minute",
  hour: "hour",
  hours: "hour",
  day: "day",
  days: "day",
  week: "week",
  weeks: "week",
  month: "month",
  months: "month",
};

const UNIT_MS: Record<RepeatUnit, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 31 * 86_400_000,
};

/** The shortest repeat: a schedule may not fire more often than this. */
export const MIN_REPEAT_MS = 60_000;
/** The longest repeat, a year ("12 months", "365 days"): anything longer is almost certainly a mistake. */
export const MAX_REPEAT_MS = 12 * 31 * 86_400_000;

/** "<number> <unit>" (e.g. "30 minutes", "1 month"); null for anything else, a zero, or a number too large to be exact. */
export function parseRepeat(interval: string): RepeatInterval | null {
  const match = /^\s*(\d{1,9})\s+([a-z]+)\s*$/i.exec(interval);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = UNITS[match[2]!.toLowerCase()];
  if (!unit || !Number.isSafeInteger(amount) || amount < 1) return null;
  return { amount, unit, calendar: unit === "day" || unit === "week" || unit === "month", approxMs: amount * UNIT_MS[unit] };
}

/** Why a repeat interval is refused; null when it is fine. */
export function repeatProblem(interval: string): string | null {
  const parsed = parseRepeat(interval);
  if (!parsed) return `"${interval}" is not an interval such as "30 minutes", "1 day" or "1 month"`;
  if (parsed.approxMs < MIN_REPEAT_MS) return `"${interval}" is too short: a schedule repeats at most once a minute`;
  if (parsed.approxMs > MAX_REPEAT_MS) return `"${interval}" is too long: a schedule repeats at least once a year`;
  return null;
}

/** The interval in whole seconds (a month counts as 31 days); null when it does not parse. */
export function parseInterval(interval: string): number | null {
  const parsed = parseRepeat(interval);
  return parsed ? parsed.approxMs / 1000 : null;
}
