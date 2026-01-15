import type {AgentStateSlice} from "@tokenring-ai/agent/types";

export interface ExecutionScheduleEntry {
  nextRunTime: number | null;
  status: 'pending' | 'running';
  abortController?: AbortController;
  timer?: NodeJS.Timeout;
  startTime?: number;
}

export class ScheduleExecutionState implements AgentStateSlice {
  name = "ScheduleExecutionState";
  tasks = new Map<string, ExecutionScheduleEntry>

  abortController: AbortController | null = null;

  constructor() {
  }

  serialize(): object {
    return {}
  }

  deserialize(data: any): void {
  }

  show(): string[] {
    return [
      `Running: ${this.abortController !== null}`
    ];
  }
}