import { AgentStateSlice } from "@tokenring-ai/agent/types";
import EnhancedMap from "@tokenring-ai/utility/map/enhancedMap";
import { z } from "zod";

import { type ScheduledTask, ScheduledTaskSchema, type SchedulerAgentConfigSchema } from "../schema.ts";

export const TaskRunHistorySchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  status: z.enum(["completed", "failed"]),
  message: z.string(),
});

export type TaskRunHistory = z.output<typeof TaskRunHistorySchema>;

const serializationSchema = z.object({
  tasks: z.record(z.string(), ScheduledTaskSchema),
  // Older checkpoints predate persisted history.
  history: z.record(z.string(), z.array(TaskRunHistorySchema)).default({}),
});

export class ScheduleTaskState extends AgentStateSlice<typeof serializationSchema> {
  tasks: EnhancedMap<string, ScheduledTask>;
  history = new EnhancedMap<string, TaskRunHistory[]>();
  readonly maxHistoryPerTask: number;

  constructor(readonly initialConfig: z.output<typeof SchedulerAgentConfigSchema>) {
    super("ScheduleTaskState", serializationSchema);
    this.tasks = EnhancedMap.fromPlainObject(this.initialConfig.tasks);
    this.maxHistoryPerTask = Math.max(1, initialConfig.maxHistoryPerTask);
  }

  /** Append a run to a task's history, dropping the oldest entries beyond the cap. */
  recordRun(name: string, entry: TaskRunHistory): void {
    const entries = [...(this.history.get(name) ?? []), entry];
    this.history.set(name, entries.length > this.maxHistoryPerTask ? entries.slice(entries.length - this.maxHistoryPerTask) : entries);
  }

  serialize(): z.output<typeof serializationSchema> {
    return {
      tasks: this.tasks.toPlainObject(),
      history: this.history.toPlainObject(),
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.tasks = EnhancedMap.fromPlainObject(data.tasks);
    this.history = new EnhancedMap<string, TaskRunHistory[]>();
    for (const [name, entries] of Object.entries(data.history)) {
      this.history.set(name, entries.slice(Math.max(0, entries.length - this.maxHistoryPerTask)));
    }
  }

  show(): string {
    return `Tasks: ${this.tasks.size}`;
  }
}
