import z from "zod";

export const ScheduledTaskSchema = z.object({
  repeat: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  weekdays: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  lastRunTime: z.number().default(0),
  timezone: z.string().optional(),
  message: z.string(),
});

export type ScheduledTask = z.output<typeof ScheduledTaskSchema>

export const SchedulerAgentConfigSchema = z.object({
  autoStart: z.boolean().default(true),
  tasks: z.record(z.string(), ScheduledTaskSchema).default({})
}).prefault({});

export const SchedulerConfigSchema = z.object({
  agentDefaults: SchedulerAgentConfigSchema
});

export type SchedulerAgentConfig = {
  scheduler: z.input<typeof SchedulerAgentConfigSchema>
};