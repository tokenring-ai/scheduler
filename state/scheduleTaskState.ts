import type {AgentStateSlice} from "@tokenring-ai/agent/types";
import {z} from "zod";

import {ScheduledTask, ScheduledTaskSchema, SchedulerAgentConfigSchema} from "../schema.ts";

interface TaskRunHistory {
  startTime: number;
  endTime: number;
  status: 'completed' | 'failed';
  message: string;
}

const serializationSchema = z.object({
  tasks: z.record(z.string(), ScheduledTaskSchema)
});

export class ScheduleTaskState implements AgentStateSlice<typeof serializationSchema> {
  name = "ScheduleTaskState";
  serializationSchema = serializationSchema;
  tasks: Map<string,ScheduledTask>;
  history = new Map<string, TaskRunHistory[]>();

  constructor(readonly initialConfig: z.output<typeof SchedulerAgentConfigSchema>) {
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

  show(): string[] {
    return [`Tasks: ${this.tasks.size}`];
  }
}
