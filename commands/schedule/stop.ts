import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule stop",
  description: "Stop the scheduler",
  help: `Stop firing schedules (for the whole app) and stop the runs in progress. Stays stopped across restarts,
until /schedule start.

## Example

/schedule stop`,
  inputSchema,
  execute: ({ agent }: AgentCommandInputType<typeof inputSchema>): string => {
    agent.requireService(SchedulerService).setRunning(false);
    return "Scheduler stopped";
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
