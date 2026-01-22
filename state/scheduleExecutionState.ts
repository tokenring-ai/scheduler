import type {AgentStateSlice} from "@tokenring-ai/agent/types";
import {z} from "zod";
import type {SchedulerAgentConfigSchema} from "../schema.ts";

export interface ExecutionScheduleEntry {
  nextRunTime: number | null;
  status: 'pending' | 'running';
  abortController?: AbortController;
  timer?: NodeJS.Timeout;
  startTime?: number;
}

const serializationSchema = z.object({
  autoStart: z.boolean()
});

export class ScheduleExecutionState implements AgentStateSlice<typeof serializationSchema> {
  name = "ScheduleExecutionState";
  tasks = new Map<string, ExecutionScheduleEntry>
  autoStart: boolean;
  abortController: AbortController | null = null;
  serializationSchema = serializationSchema;

  constructor(readonly initialConfig: z.output<typeof SchedulerAgentConfigSchema>) {
    this.autoStart = initialConfig.autoStart;
  }

  serialize() {
    return { autoStart: this.autoStart };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.autoStart = data.autoStart;
  }

  show(): string[] {
    return [
      `Running: ${this.abortController !== null}`
    ];
  }
}