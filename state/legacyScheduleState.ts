import { AgentStateSlice } from "@tokenring-ai/agent/types";
import { z } from "zod";

/** A task as older versions kept it in each agent's state: a prompt for that agent. */
export const LegacyScheduledTaskSchema = z.object({
  repeat: z.string().optional(),
  once: z.boolean().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  weekdays: z.string().optional(),
  dayOfMonth: z.number().optional(),
  lastRunTime: z.number().default(0),
  timezone: z.string().optional(),
  message: z.string(),
  enabled: z.boolean().optional(),
});

export type LegacyScheduledTask = z.output<typeof LegacyScheduledTaskSchema>;

export const LegacyRunSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  status: z.enum(["completed", "failed"]),
  message: z.string(),
});

export type LegacyRun = z.output<typeof LegacyRunSchema>;

const serializationSchema = z.object({
  tasks: z.record(z.string(), z.unknown()).default({}),
  history: z.record(z.string(), z.unknown()).default({}),
});

export type LegacyScheduleData = { tasks: Record<string, LegacyScheduledTask>; history: Record<string, LegacyRun[]> };

/**
 * Reads the `ScheduleTaskState` slice older versions saved in agent checkpoints, and hands its tasks to
 * the scheduler's app-level store once. It always saves empty, so a migrated checkpoint is not
 * migrated again.
 */
export class LegacyScheduleState extends AgentStateSlice<typeof serializationSchema> {
  constructor(private readonly props: { onRestore: (data: LegacyScheduleData) => void }) {
    super("ScheduleTaskState", serializationSchema);
  }

  serialize(): z.output<typeof serializationSchema> {
    return { tasks: {}, history: {} };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    const tasks: Record<string, LegacyScheduledTask> = {};
    for (const [name, raw] of Object.entries(data.tasks)) {
      const parsed = LegacyScheduledTaskSchema.safeParse(raw);
      if (parsed.success) tasks[name] = parsed.data;
    }
    if (Object.keys(tasks).length === 0) return;
    const history: Record<string, LegacyRun[]> = {};
    for (const [name, raw] of Object.entries(data.history)) {
      const parsed = z.array(LegacyRunSchema).safeParse(raw);
      if (parsed.success) history[name] = parsed.data;
    }
    this.props.onRestore({ tasks, history });
  }

  show(): string {
    return "Schedules live in the app-level scheduler";
  }
}
