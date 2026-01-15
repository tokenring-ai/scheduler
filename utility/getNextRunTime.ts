import moment from "moment-timezone";
import {ScheduledTask} from "../schema.ts";
import {checkDayConditions} from "./checkDayConditions.ts";
import {parseInterval} from "./parseInterval.ts";

export const MAX_DAYS_AHEAD = 30;

export function getNextRunTime(task: ScheduledTask): number | null {
  const tz = task.timezone || moment.tz.guess();
  const now = moment.tz(tz)

  let earliestRunTime: moment.Moment;

  if (task.every) {
    // For "every" tasks: earliestRunTime = lastRunTime + interval
    const interval = parseInterval(task.every);
    if (!interval) return null;

    earliestRunTime = moment.tz(task.lastRunTime ? task.lastRunTime + interval * 1000 : now, tz);
  } else if (task.once) {
    // If it has run before, we look at the next day. If not, we start from now.
    earliestRunTime = moment.tz(task.lastRunTime ? task.lastRunTime + 86400_000 : now, tz);
    if (task.lastRunTime) earliestRunTime.startOf('day');
  } else {
    return null;
  }

  // Walk through each day starting with the earliest run time
  for (let daysOffset = 0; daysOffset <= MAX_DAYS_AHEAD; daysOffset++) {
    const checkDay = earliestRunTime.clone();
    if (daysOffset > 0) checkDay.add(daysOffset, 'days').startOf('day');

    // Check if this day matches the day conditions
    if (!checkDayConditions(task, checkDay)) continue;

    if (task.from) {
      const [fromHour, fromMin] = task.from.split(':').map(Number);
      const fromTime = checkDay.clone().hour(fromHour).minute(fromMin).second(0);

      // If current checkDay is before the 'from' time, move it to 'from' time
      if (checkDay.isBefore(fromTime)) {
        checkDay.hour(fromHour).minute(fromMin).second(0);
      }
    }

    // Check if candidate time is after "to" window
    if (task.to) {
      const [toHour, toMin] = task.to.split(':').map(Number);
      const toTime = checkDay.clone().hour(toHour).minute(toMin).second(0);

      if (checkDay.isAfter(toTime)) {
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