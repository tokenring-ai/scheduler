import type {AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule start",
  description: "Start the scheduler",
  help: `Start the scheduler service.

## Example

/schedule start`,
  inputSchema,
  execute: async ({agent}: AgentCommandInputType<typeof inputSchema>): Promise<string> => {
    agent.requireServiceByType(SchedulerService).runScheduler(agent);
    return "Scheduler started";
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
