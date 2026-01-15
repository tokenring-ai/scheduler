import moment from "moment-timezone";
import {ScheduledTask} from "../schema.ts";

export function checkDayConditions(task: ScheduledTask, now: moment.Moment): boolean {
  if (task.dayOfMonth !== undefined && task.dayOfMonth !== now.date()) return false;
  if (task.on) {
    const weekDay = now.format('ddd').toLowerCase();
    if (!task.on.toLowerCase().includes(weekDay)) return false;
  }
  return true;
}