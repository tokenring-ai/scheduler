import { AgentStateSlice } from "@tokenring-ai/agent/types";
import EnhancedMap from "@tokenring-ai/utility/map/enhancedMap";
import { z } from "zod";
import type { SchedulerAgentConfigSchema } from "../schema.ts";

export interface ExecutionScheduleEntry {
  nextRunTime: number | null;
  status: "pending" | "running";
  abortController?: AbortController;
  timer?: NodeJS.Timeout | undefined;
  startTime?: number;
}

const serializationSchema = z.object({
  autoStart: z.boolean(),
});

export class ScheduleExecutionState extends AgentStateSlice<typeof serializationSchema> {
  tasks = new EnhancedMap<string, ExecutionScheduleEntry>();
  autoStart: boolean;
  abortController: AbortController | null = null;

  constructor(readonly initialConfig: z.output<typeof SchedulerAgentConfigSchema>) {
    super("ScheduleExecutionState", serializationSchema);
    this.autoStart = initialConfig.autoStart;
  }

  serialize() {
    return { autoStart: this.autoStart };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.autoStart = data.autoStart;
  }

  show(): string {
    return `Running: ${this.abortController !== null}`;
  }
}
