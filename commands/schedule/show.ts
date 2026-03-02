import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import indent from "@tokenring-ai/utility/string/indent";
import {ScheduleExecutionState} from "../../state/scheduleExecutionState.ts";
import {ScheduleTaskState} from "../../state/scheduleTaskState.ts";

async function execute(_remainder: string, agent: Agent): Promise<string> {
  const taskState = agent.getState(ScheduleTaskState);
  const executionState = agent.getState(ScheduleExecutionState);
  const lines = ["=== Scheduled Tasks ===\n"];
  for (const [taskName, task] of taskState.tasks.entries()) {
    const execEntry = executionState.tasks.get(taskName);
    lines.push(
      `**${taskName}**`,
      indent([`Message: ${task.message}`, `Status: ${execEntry?.status ?? "Not scheduled"}`, `Next Run: ${execEntry?.nextRunTime ? new Date(execEntry.nextRunTime).toLocaleString() : "Not scheduled"}`, `Last Run: ${task.lastRunTime ? new Date(task.lastRunTime).toLocaleString() : "Never"}`], 1),
      ""
    );
  }
  return lines.join("\n");
}

export default { name: "schedule show", description: "/schedule show - Show scheduled tasks", help: `# /schedule show

Display all current scheduled tasks with their next and last run times.

## Example

/schedule show`, execute } satisfies TokenRingAgentCommand;
