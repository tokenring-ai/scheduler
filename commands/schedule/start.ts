import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

export default {
  name: "schedule start",
  description: "/schedule start - Start the scheduler",
  help: `# /schedule start

Start the scheduler service.

## Example

/schedule start`,
  execute: async (_remainder: string, agent: Agent): Promise<string> => {
    agent.requireServiceByType(SchedulerService).runScheduler(agent);
    return "Scheduler started";
  },
} satisfies TokenRingAgentCommand;
