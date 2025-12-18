import {z} from "zod";
import {ScheduleTaskSchema} from "./SchedulerService.ts";

export const SchedulerConfigSchema = z.object({
  tasks: z.array(ScheduleTaskSchema)
}).optional();


export {default as SchedulerService} from "./SchedulerService.ts";
export type {ScheduleTask} from "./SchedulerService.ts";
