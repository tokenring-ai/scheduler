import {CommandFailedError} from "@tokenring-ai/agent/AgentError";
import type {AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import SchedulerService from "../SchedulerService.ts";
import {ScheduleExecutionState} from "../state/scheduleExecutionState.ts";
import {parseLoopCommand} from "../utility/parseLoopCommand.ts";

const inputSchema = {
  args: {},
  remainder: {
    name: "definition",
    description: "Interval and prompt, e.g. 5m check the build",
    required: true,
  },
} as const satisfies AgentCommandInputSchema;

function createLoopTaskName(): string {
  return `loop-${Math.random().toString(36).slice(2, 10)}`;
}

export default {
  name: "loop",
  description: "Schedule a prompt to run repeatedly",
  help: `Schedule a prompt to run repeatedly in the current session.

## Usage

/loop [interval] <prompt>
/loop <prompt> every <interval>

If no interval is provided, the prompt runs every 10 minutes.

## Example

/loop 5m check if the deployment finished
/loop check the build every 2 hours`,
  inputSchema,
  execute: ({
              remainder,
              agent,
            }: AgentCommandInputType<typeof inputSchema>): string => {
    const parsed = parseLoopCommand(remainder);
    if (!parsed) {
      throw new CommandFailedError(
        "Usage: /loop [interval] <prompt> or /loop <prompt> every <interval>",
      );
    }

    const scheduler = agent.requireServiceByType(SchedulerService);
    const taskName = createLoopTaskName();

    scheduler.addTask(
      taskName,
      {
        message: parsed.prompt,
        repeat: parsed.repeat,
        lastRunTime: Date.now(),
      },
      agent,
    );

    const executionState = agent.getState(ScheduleExecutionState);
    if (!executionState.abortController) {
      scheduler.runScheduler(agent);
    }

    const lines = [
      `Scheduled loop '${taskName}' to run every ${parsed.displayInterval}.`,
      `Prompt: ${parsed.prompt}`,
    ];

    if (parsed.note) {
      lines.push(parsed.note);
    }

    return lines.join("\n");
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
