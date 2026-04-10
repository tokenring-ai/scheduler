import type {AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand,} from "@tokenring-ai/agent/types";
import {ScheduleTaskState} from "../../state/scheduleTaskState.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule history",
  description: "Show task execution history",
  help: `Display the execution history for all scheduled tasks, including status and duration.

## Example

/schedule history`,
  inputSchema,
  execute: ({
              agent,
            }: AgentCommandInputType<typeof inputSchema>): string => {
    const taskState = agent.getState(ScheduleTaskState);
    const lines = ["=== Task Execution History ===\n"];
    for (const [taskName] of taskState.tasks.entries()) {
      lines.push(`**${taskName}**`);
      const history = taskState.history.get(taskName);
      if (history?.length) {
        for (const run of history) {
          lines.push(
            `- [${new Date(run.startTime).toLocaleString()}] ${taskName} - ${run.status} (${Math.round(run.endTime - run.startTime)}s) ${run.message}`,
          );
        }
      }
    }
    return lines.join("\n");
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
