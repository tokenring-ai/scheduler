import { AgentStateSlice } from "@tokenring-ai/agent/types";
import { z } from "zod";

import { type ScheduledTask, ScheduledTaskSchema, type SchedulerAgentConfigSchema } from "../schema.ts";

interface TaskRunHistory {
  startTime: number;
  endTime: number;
  status: "completed" | "failed";
  message: string;
}

const serializationSchema = z.object({
  tasks: z.record(z.string(), ScheduledTaskSchema),
});

export class ScheduleTaskState extends AgentStateSlice<typeof serializationSchema> {
  tasks: Map<string, ScheduledTask>;
  history = new Map<string, TaskRunHistory[]>();

  constructor(readonly initialConfig: z.output<typeof SchedulerAgentConfigSchema>) {
    super("ScheduleTaskState", serializationSchema);
    this.tasks = new Map(Object.entries(initialConfig.tasks));
  }

  serialize(): z.output<typeof serializationSchema> {
    return {
      tasks: Object.fromEntries(this.tasks.entries()),
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.tasks = new Map(Object.entries(data.tasks));
  }

  show(): string {
    return `Tasks: ${this.tasks.size}`;
  }
}
