import z from "zod";

export const ScheduledTaskSchema = z.object({
  repeat: z.string().exactOptional(),
  after: z.string().exactOptional(),
  before: z.string().exactOptional(),
  weekdays: z.string().exactOptional(),
  dayOfMonth: z.number().min(1).max(31).exactOptional(),
  lastRunTime: z.number().default(0),
  timezone: z.string().exactOptional(),
  message: z.string(),
});

export type ScheduledTask = z.output<typeof ScheduledTaskSchema>;

export const SchedulerAgentConfigSchema = z
  .object({
    autoStart: z.boolean().default(true),
    tasks: z.record(z.string(), ScheduledTaskSchema).default({}),
  })
  .prefault({});

export const SchedulerConfigSchema = z.object({
  agentDefaults: SchedulerAgentConfigSchema,
});
