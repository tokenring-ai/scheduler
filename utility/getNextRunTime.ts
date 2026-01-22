import moment from "moment-timezone";
import {ScheduledTask} from "../schema.ts";
import {checkDayConditions} from "./checkDayConditions.ts";
import {parseInterval} from "./parseInterval.ts";

export const MAX_DAYS_AHEAD = 30;

export function getNextRunTime(task: ScheduledTask): number | null {
  const tz = task.timezone || moment.tz.guess();
  const now = moment.tz(tz)

  let earliestRunTime: moment.Moment;

  if (task.repeat) {
    // For "every" tasks: earliestRunTime = lastRunTime + interval
    const interval = parseInterval(task.repeat);
    if (!interval) return null;

    earliestRunTime = moment.tz(task.lastRunTime ? task.lastRunTime + interval * 1000 : now, tz);
  } else {
    // If it has run before, we look at the next day. If not, we start from now.
    earliestRunTime = moment.tz(task.lastRunTime ? task.lastRunTime + 86400_000 : now, tz);
    if (task.lastRunTime) earliestRunTime.startOf('day');
  }

  // Walk through each day starting with the earliest run time
  for (let daysOffset = 0; daysOffset <= MAX_DAYS_AHEAD; daysOffset++) {
    const checkDay = earliestRunTime.clone();
    if (daysOffset > 0) checkDay.add(daysOffset, 'days').startOf('day');

    // Check if this day matches the day conditions
    if (!checkDayConditions(task, checkDay)) continue;

    if (task.after) {
      const [afterHour, afterMin] = task.after.split(':').map(Number);
      const afterTime = checkDay.clone().hour(afterHour).minute(afterMin).second(0);

      // If current checkDay is before the 'from' time, move it to 'from' time
      if (checkDay.isBefore(afterTime)) {
        checkDay.hour(afterHour).minute(afterMin).second(0);
      }
    }

    // Check if candidate time is after "to" window
    if (task.before) {
      const [beforeHour, beforeMin] = task.before.split(':').map(Number);
      const beforeTime = checkDay.clone().hour(beforeHour).minute(beforeMin).second(0);

      if (checkDay.isAfter(beforeTime)) {
        continue; // Try next day
      }
    }

    // Final check: if we calculated a time in the past (because of 'once' or 'every' logic), 
    // we need to ensure we aren't returning a timestamp that already happened.
    if (checkDay.isBefore(now)) {
      return now.valueOf();
    } else {
      return checkDay.valueOf();
    }
  }

  return null;
}