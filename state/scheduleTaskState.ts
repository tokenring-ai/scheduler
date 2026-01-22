import type {AgentStateSlice} from "@tokenring-ai/agent/types";
import {z} from "zod";

import {ScheduledTask, SchedulerAgentConfigSchema} from "../schema.ts";

interface TaskRunHistory {
  startTime: number;
  endTime: number;
  status: 'completed' | 'failed';
  message: string;
}

const serializationSchema = z.object({
  tasks: z.any()
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
      tasks: this.tasks,
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.tasks = data.tasks || [];
  }

  show(): string[] {
    return [`Tasks: ${this.tasks.size}`];
  }
}
