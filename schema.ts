import z from "zod";

export const ScheduledTaskSchema = z.object({
  agentType: z.string(),
  every: z.string().optional(),
  once: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  on: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  lastRunTime: z.number().default(0),
  noLongerThan: z.string().optional(),
  several: z.boolean().optional(),
  timezone: z.string().optional(),
  message: z.string(),
});

export type ScheduledTask = z.output<typeof ScheduledTaskSchema>

export const SchedulerAgentConfigSchema = z.object({
  autoStart: z.boolean().default(false),
  tasks: z.record(z.string(), ScheduledTaskSchema).default({})
}).prefault({});

export const SchedulerConfigSchema = z.object({
  agentDefaults: SchedulerAgentConfigSchema
});

export type SchedulerAgentConfig = {
  scheduler: z.input<typeof SchedulerAgentConfigSchema>
};