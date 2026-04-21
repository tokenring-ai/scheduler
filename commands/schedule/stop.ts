import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule stop",
  description: "Stop the scheduler",
  help: `Stop the scheduler service.

## Example

/schedule stop`,
  inputSchema,
  execute: ({ agent }: AgentCommandInputType<typeof inputSchema>): string => {
    agent.requireServiceByType(SchedulerService).stopScheduler(agent);
    return "Scheduler stopped";
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
