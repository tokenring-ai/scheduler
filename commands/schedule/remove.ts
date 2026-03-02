import Agent from "@tokenring-ai/agent/Agent";
import {CommandFailedError} from "@tokenring-ai/agent/AgentError";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

export default {
  name: "schedule remove",
  description: "/schedule remove - Remove a scheduled task",
  help: `# /schedule remove <name>

Remove a scheduled task by name.

## Example

/schedule remove myTask`,
  execute: async (remainder: string, agent: Agent): Promise<string> => {
    const name = remainder.trim();
    if (!name) throw new CommandFailedError("Usage: /scheduler remove <name>");
    agent.requireServiceByType(SchedulerService).removeTask(name, agent);
    return `Task removed successfully`;
  },
} satisfies TokenRingAgentCommand;
