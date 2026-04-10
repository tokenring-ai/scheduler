import {CommandFailedError} from "@tokenring-ai/agent/AgentError";
import type {AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand,} from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

const inputSchema = {
  args: {},
  positionals: [
    {
      name: "name",
      description: "Task name",
      required: true,
    },
  ],
} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule remove",
  description: "Remove a scheduled task",
  help: `Remove a scheduled task by name.

## Example

/schedule remove myTask`,
  inputSchema,
  execute: ({
              positionals,
              agent,
            }: AgentCommandInputType<typeof inputSchema>): string => {
    const name = positionals.name;
    if (!name) throw new CommandFailedError("Usage: /scheduler remove <name>");
    agent.requireServiceByType(SchedulerService).removeTask(name, agent);
    return `Task removed successfully`;
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
