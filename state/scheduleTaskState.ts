import { AgentStateSlice } from "@tokenring-ai/agent/types";
import EnhancedMap from "@tokenring-ai/utility/map/enhancedMap";
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
  tasks: EnhancedMap<string, ScheduledTask>;
  history = new EnhancedMap<string, TaskRunHistory[]>();

  constructor(readonly initialConfig: z.output<typeof SchedulerAgentConfigSchema>) {
    super("ScheduleTaskState", serializationSchema);
    this.tasks = EnhancedMap.fromPlainObject(this.initialConfig.tasks);
  }

  serialize(): z.output<typeof serializationSchema> {
    return {
      tasks: this.tasks.toPlainObject(),
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.tasks = EnhancedMap.fromPlainObject(data.tasks);
  }

  show(): string {
    return `Tasks: ${this.tasks.size}`;
  }
}
