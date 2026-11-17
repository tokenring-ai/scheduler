import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

const inputSchema = {
  args: {},
  positionals: [
    {
      name: "name",
      description: "Schedule name",
      required: true,
    },
  ],
} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule remove",
  description: "Remove a schedule",
  help: `Remove a schedule by name, with its run history. A run in progress is stopped.

## Example

/schedule remove nightly-report`,
  inputSchema,
  execute: ({ args, agent }: AgentCommandInputType<typeof inputSchema>): string => {
    const name = args.name;
    if (!name) throw new CommandFailedError("Usage: /schedule remove <name>");
    agent.requireService(SchedulerService).removeSchedule(name);
    return `Schedule '${name}' removed`;
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
