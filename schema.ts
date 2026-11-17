import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import z from "zod";

/** When a schedule fires. Shared by config, the store, tools and the RPC. */
export const ScheduleTimingSchema = z.object({
  repeat: z
    .string()
    .exactOptional()
    .meta({
      description:
        'Repeat interval as "<number> <unit>" (e.g. "30 minutes", "1 day", "1 month"), at least 1 minute. Days, weeks and months follow the calendar in the schedule\'s timezone. If omitted the schedule runs once a day, unless "once" is set',
    } satisfies ConfigFieldMeta),
  once: z
    .boolean()
    .exactOptional()
    .meta({ description: "Run only once; the schedule is disabled after it runs" } satisfies ConfigFieldMeta),
  at: z
    .string()
    .exactOptional()
    .meta({
      description:
        'An exact moment to run, as an ISO-8601 instant with a Z or UTC offset (e.g. "2026-11-20T09:00:00-05:00"). The schedule runs once at or after it (once, if the app was down then) and is then done. It cannot be combined with repeat, a time window, weekdays or a day of month',
    } satisfies ConfigFieldMeta),
  after: z
    .string()
    .exactOptional()
    .meta({ description: "Only run at or after this time of day (HH:mm, 24-hour)" } satisfies ConfigFieldMeta),
  before: z
    .string()
    .exactOptional()
    .meta({ description: "Only run at or before this time of day (HH:mm, 24-hour)" } satisfies ConfigFieldMeta),
  weekdays: z
    .string()
    .exactOptional()
    .meta({ description: 'Weekdays it may run on, e.g. "mon tue wed thu fri"' } satisfies ConfigFieldMeta),
  dayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .exactOptional()
    .meta({ description: "Day of month it may run on (months without that day are skipped)" } satisfies ConfigFieldMeta),
  timezone: z
    .string()
    .exactOptional()
    .meta({ description: "IANA timezone the schedule is evaluated in; defaults to the server's" } satisfies ConfigFieldMeta),
});

export type ScheduleTiming = z.output<typeof ScheduleTimingSchema>;

/** Limits for the agent job a schedule starts. */
const JobLimitFields = {
  maxCostUsd: z
    .number()
    .positive()
    .exactOptional()
    .meta({
      description: "Stop the run and mark it failed when it has spent more than this (USD). Unset: agent.jobs.defaultMaxCostUsd, else no limit",
    } satisfies ConfigFieldMeta),
  maxApprovalLevel: z
    .number()
    .int()
    .min(0)
    .max(10)
    .exactOptional()
    .meta({
      description:
        "Highest tool approval level the run may approve without asking anyone (see Tool approval levels). Unset: agent.jobs.maxAutoApprovalLevel. Cannot exceed the operator's agent.jobs.approvalCeiling; actions above it are refused",
    } satisfies ConfigFieldMeta),
};

/** What a schedule does when it fires. */
export const ScheduleActionSchema = z.discriminatedUnion("kind", [
  /** Start an agent job: a fresh agent of `agentType` gets the prompt, and is deleted when it is done. */
  z.object({ kind: z.literal("job"), agentType: z.string().min(1), prompt: z.string().min(1), ...JobLimitFields }),
  /** Prompt an existing agent (a chat): the prompt queues behind whatever it is doing. `/loop` uses this. */
  z.object({ kind: z.literal("agent"), agentId: z.string().min(1), prompt: z.string().min(1) }),
  /** Add an item to a work queue. */
  z.object({
    kind: z.literal("queue"),
    queue: z.string().min(1),
    item: z.object({ name: z.string().min(1), prompt: z.string().min(1) }),
  }),
  /** Start a workflow run. */
  z.object({ kind: z.literal("workflow"), name: z.string().min(1), ...JobLimitFields }),
  /**
   * Run one chat tool with fixed input, in a fresh agent of `agentType`, with no LLM turn. The run goes
   * through the tool's normal approval, so a tool that needs a permission grant is refused without one.
   * Not available to agents (the scheduler tools never create it): config, RPC and plugin code only.
   */
  z.object({
    kind: z.literal("tool"),
    agentType: z.string().min(1),
    tool: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    ...JobLimitFields,
  }),
  /** Dispatch the agent assigned to a task on a board. */
  z.object({
    kind: z.literal("task"),
    ref: z.object({ board: z.string().min(1), taskId: z.string().min(1) }),
    assignmentId: z.string().min(1),
  }),
]);

export type ScheduleAction = z.output<typeof ScheduleActionSchema>;
export type ScheduleActionKind = ScheduleAction["kind"];

export const ScheduleDefinitionSchema = ScheduleTimingSchema.extend({
  action: ScheduleActionSchema,
  enabled: z
    .boolean()
    .exactOptional()
    .meta({ description: "Set to false to pause the schedule. Omitted means enabled" } satisfies ConfigFieldMeta),
});

export type ScheduleDefinition = z.output<typeof ScheduleDefinitionSchema>;

export const SchedulerConfigSchema = z
  .object({
    autoStart: z
      .boolean()
      .default(true)
      .meta({ description: "Start firing schedules when the app starts. When false, they wait for /schedule start" } satisfies ConfigFieldMeta),
    maxHistoryPerSchedule: z
      .number()
      .int()
      .min(1)
      .default(50)
      .meta({ description: "Runs kept per schedule; older runs are dropped" } satisfies ConfigFieldMeta),
    missedGraceMinutes: z
      .number()
      .min(0)
      .default(30)
      .meta({
        description:
          'How late an exact-time ("at") schedule may still run, in minutes after its time (plus a few seconds of timer slop). When the app was not running at that time and starts later than this, the schedule does not run: the run is recorded as missed and the schedule is done. 0 allows no lateness beyond the slop',
      } satisfies ConfigFieldMeta),
    schedules: z
      .record(z.string(), ScheduleDefinitionSchema)
      .default({})
      .meta({
        label: "Schedules",
        description: "Schedules defined in config, keyed by name. They can be paused and run from the app, but are edited here",
      } satisfies ConfigFieldMeta),
  })
  .prefault({})
  .meta({ label: "Scheduler", description: "Time-based triggers for agent jobs, chats, queues, workflows and tasks" } satisfies ConfigFieldMeta);

export type SchedulerConfig = z.input<typeof SchedulerConfigSchema>;
export type ParsedSchedulerConfig = z.output<typeof SchedulerConfigSchema>;

export const ScheduleRunStatusSchema = z.enum(["running", "completed", "failed", "cancelled", "interrupted"]);
export type ScheduleRunStatus = z.output<typeof ScheduleRunStatusSchema>;

/** One firing of a schedule. */
export const ScheduleRunSchema = z.object({
  id: z.string(),
  /** The slot it ran for (for a catch-up after downtime, when it fired). */
  scheduledFor: z.number(),
  startTime: z.number(),
  endTime: z.number().nullable(),
  status: ScheduleRunStatusSchema,
  message: z.string(),
  actionKind: z.enum(["job", "agent", "queue", "workflow", "task", "tool"]),
  /** The agent job the run started or followed, when there is one; its record has the status, cost and output. */
  jobId: z.string().nullable(),
  manual: z.boolean().default(false),
});

export type ScheduleRun = z.output<typeof ScheduleRunSchema>;

/** Run bookkeeping of one schedule (config or user-added), kept in the store file. */
export const ScheduleRuntimeSchema = z.object({
  /** The slot of the last run (not when it finished), so repeats stay on their grid. 0: never ran. */
  lastRunTime: z.number().default(0),
  /** Grid origin for repeats: the first slot it ran for. */
  anchorTime: z.number().exactOptional(),
  /** A pause set from the app on a config schedule (config is not rewritten). */
  enabled: z.boolean().exactOptional(),
});

export type ScheduleRuntime = z.output<typeof ScheduleRuntimeSchema>;

export const SCHEDULES_FILE_VERSION = 1;

/** `schedules.json` in the workspace. */
export const ScheduleStoreFileSchema = z.object({
  version: z.number().default(SCHEDULES_FILE_VERSION),
  /** False while the scheduler was stopped with /schedule stop (survives restarts). */
  running: z.boolean().exactOptional(),
  schedules: z.record(z.string(), ScheduleDefinitionSchema).default({}),
  runtime: z.record(z.string(), ScheduleRuntimeSchema).default({}),
  history: z.record(z.string(), z.array(ScheduleRunSchema)).default({}),
});

export type ScheduleStoreFile = z.output<typeof ScheduleStoreFileSchema>;

export type ScheduleState = "scheduled" | "running" | "paused" | "done" | "missed" | "error" | "stopped";

/** The message of the run recorded when an exact-time schedule was not run because the app was down at its time. */
export const MISSED_RUN_MESSAGE = "Missed: the app was not running at the scheduled time";

/** A schedule as the tools, commands and RPC show it. */
export type ScheduleView = {
  name: string;
  source: "config" | "user";
  definition: ScheduleDefinition;
  enabled: boolean;
  state: ScheduleState;
  lastRunTime: number;
  nextRunTime: number | null;
  /** Why it cannot be scheduled (state "error"). */
  error: string | null;
  /** The run in progress. */
  currentRun: ScheduleRun | null;
};
