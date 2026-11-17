import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule start",
  description: "Start the scheduler",
  help: `Start firing schedules (for the whole app). Stays started across restarts.

## Example

/schedule start`,
  inputSchema,
  execute: ({ agent }: AgentCommandInputType<typeof inputSchema>): string => {
    agent.requireService(SchedulerService).setRunning(true);
    return "Scheduler started";
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
