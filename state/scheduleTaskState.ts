import type {AgentStateSlice} from "@tokenring-ai/agent/types";
import {z} from "zod";

import {ScheduledTask, SchedulerAgentConfigSchema} from "../schema.ts";

interface TaskRunHistory {
  startTime: number;
  endTime: number;
  status: 'completed' | 'failed';
  message: string;
}

export class ScheduleTaskState implements AgentStateSlice {
  name = "ScheduleTaskState";
  tasks: Map<string,ScheduledTask>;
  history = new Map<string, TaskRunHistory[]>();

  constructor(readonly initialConfig: z.output<typeof SchedulerAgentConfigSchema>) {
    this.tasks = new Map(Object.entries(initialConfig.tasks));
  }

  serialize(): object {
    return {
      tasks: this.tasks,
    };
  }

  deserialize(data: any): void {
    this.tasks = data.tasks || [];
  }

  show(): string[] {
    return [`Tasks: ${this.tasks.size}`];
  }
}

