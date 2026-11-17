import type moment from "moment-timezone";
import type { ScheduleTiming } from "../schema.ts";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The weekdays in a `weekdays` string ("mon tue", "Monday, Friday"), or null when a token is not a weekday. */
export function parseWeekdays(weekdays: string): Set<string> | null {
  const days = new Set<string>();
  for (const token of weekdays
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)) {
    const day = token.slice(0, 3);
    if (!(WEEKDAYS as readonly string[]).includes(day)) return null;
    days.add(day);
  }
  return days;
}

/** Whether the schedule may run on this day (its weekday and day of month). */
export function checkDayConditions(timing: Pick<ScheduleTiming, "weekdays" | "dayOfMonth">, day: moment.Moment): boolean {
  if (timing.dayOfMonth !== undefined && timing.dayOfMonth !== day.date()) return false;
  if (timing.weekdays) {
    const days = parseWeekdays(timing.weekdays);
    // An empty list ("" or only separators) does not limit the days.
    if (days && days.size > 0 && !days.has(WEEKDAYS[day.day()]!)) return false;
  }
  return true;
}
