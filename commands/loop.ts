import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../SchedulerService.ts";
import { parseLoopCommand } from "../utility/parseLoopCommand.ts";

const inputSchema = {
  args: {},
  remainder: {
    name: "definition",
    description: "Interval and prompt, e.g. 5m check the build",
    required: true,
  },
} as const satisfies AgentCommandInputSchema;

function createLoopName(): string {
  return `loop-${Math.random().toString(36).slice(2, 10)}`;
}

export default {
  name: "loop",
  description: "Schedule a prompt to run repeatedly in this chat",
  help: `Schedule a prompt to run repeatedly in the current chat. Each run queues behind whatever the chat is doing;
stopping a run cancels only that prompt. Manage it with /schedule show and /schedule remove.

## Usage

/loop [interval] <prompt>
/loop <prompt> every <interval>

If no interval is provided, the prompt runs every 10 minutes. The first run is one interval from now.

## Example

/loop 5m check if the deployment finished
/loop check the build every 2 hours`,
  inputSchema,
  execute: ({ remainder, agent }: AgentCommandInputType<typeof inputSchema>): string => {
    const parsed = parseLoopCommand(remainder);
    if (!parsed) {
      throw new CommandFailedError("Usage: /loop [interval] <prompt> or /loop <prompt> every <interval>");
    }

    const scheduler = agent.requireService(SchedulerService);
    const name = createLoopName();
    scheduler.addSchedule(name, { repeat: parsed.repeat, action: { kind: "agent", agentId: agent.id, prompt: parsed.prompt } }, { startsAt: Date.now() });

    const lines = [`Scheduled loop '${name}' to run every ${parsed.displayInterval} in this chat.`, `Prompt: ${parsed.prompt}`];
    if (parsed.note) lines.push(parsed.note);
    if (!scheduler.isRunning()) lines.push("The scheduler is stopped; it runs once you /schedule start.");
    return lines.join("\n");
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
