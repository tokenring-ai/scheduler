import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import z from "zod";

export const ScheduledTaskSchema = z.object({
  repeat: z
    .string()
    .exactOptional()
    .meta({
      description: 'Repeat interval as "<number> <unit>" (e.g. "30 minutes", "1 day"). If omitted the task runs once a day, unless "once" is set',
    } satisfies ConfigFieldMeta),
  once: z
    .boolean()
    .exactOptional()
    .meta({ description: "Run this task only once; it is not rescheduled after it runs" } satisfies ConfigFieldMeta),
  after: z
    .string()
    .exactOptional()
    .meta({ description: "Only run this task after this time" } satisfies ConfigFieldMeta),
  before: z
    .string()
    .exactOptional()
    .meta({ description: "Only run this task before this time" } satisfies ConfigFieldMeta),
  weekdays: z
    .string()
    .exactOptional()
    .meta({ description: "Weekdays this task is allowed to run" } satisfies ConfigFieldMeta),
  dayOfMonth: z
    .number()
    .min(1)
    .max(31)
    .exactOptional()
    .meta({ description: "Day of month this task is allowed to run" } satisfies ConfigFieldMeta),
  lastRunTime: z
    .number()
    .default(0)
    .meta({ hidden: true } satisfies ConfigFieldMeta), // runtime-tracked
  timezone: z
    .string()
    .exactOptional()
    .meta({ description: "Timezone used to evaluate the schedule" } satisfies ConfigFieldMeta),
  message: z.string().meta({ uiType: "multilineText", description: "Message/prompt delivered to the agent when this task fires" } satisfies ConfigFieldMeta),
  enabled: z
    .boolean()
    .exactOptional()
    .meta({ description: "Set to false to pause this task; the scheduler skips it until it is resumed. Omitted means enabled" } satisfies ConfigFieldMeta),
});

export type ScheduledTask = z.output<typeof ScheduledTaskSchema>;

export const SchedulerAgentConfigSchema = z
  .object({
    autoStart: z
      .boolean()
      .default(true)
      .meta({ description: "Start the scheduler automatically for new agents" } satisfies ConfigFieldMeta),
    maxHistoryPerTask: z
      .number()
      .int()
      .min(1)
      .default(50)
      .meta({ description: "Run history entries kept per task; older runs are dropped" } satisfies ConfigFieldMeta),
    tasks: z
      .record(z.string(), ScheduledTaskSchema)
      .default({})
      .meta({ label: "Scheduled Tasks", description: "Scheduled tasks, keyed by name" } satisfies ConfigFieldMeta),
  })
  .prefault({});

export const SchedulerConfigSchema = z
  .object({
    agentDefaults: SchedulerAgentConfigSchema.meta({ label: "Agent Defaults" } satisfies ConfigFieldMeta),
  })
  .prefault({})
  .meta({ label: "Scheduler", description: "Time-based task scheduling for agents" } satisfies ConfigFieldMeta);

export type SchedulerConfig = z.input<typeof SchedulerConfigSchema>;
export type ParsedSchedulerConfig = z.output<typeof SchedulerConfigSchema>;
