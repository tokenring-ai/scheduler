import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import z from "zod";

export const ScheduledTaskSchema = z.object({
  repeat: z
    .string()
    .exactOptional()
    .meta({ description: "Cron-style repeat expression" } satisfies ConfigFieldMeta),
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
});

export type ScheduledTask = z.output<typeof ScheduledTaskSchema>;

export const SchedulerAgentConfigSchema = z
  .object({
    autoStart: z
      .boolean()
      .default(true)
      .meta({ description: "Start the scheduler automatically for new agents" } satisfies ConfigFieldMeta),
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
  .meta({ label: "Scheduler", description: "Time-based task scheduling for agents" } satisfies ConfigFieldMeta);
