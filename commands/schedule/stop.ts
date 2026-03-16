import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

export default {
  name: "schedule stop",
  description: "Stop the scheduler",
  help: `# /schedule stop

Stop the scheduler service.

## Example

/schedule stop`,
  execute: async (_remainder: string, agent: Agent): Promise<string> => {
    agent.requireServiceByType(SchedulerService).stopScheduler(agent);
    return "Scheduler stopped";
  },
} satisfies TokenRingAgentCommand;
