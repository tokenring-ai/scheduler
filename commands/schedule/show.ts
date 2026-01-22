import Agent from "@tokenring-ai/agent/Agent";
import indent from "@tokenring-ai/utility/string/indent";
import {ScheduleExecutionState} from "../../state/scheduleExecutionState.ts";
import {ScheduleTaskState} from "../../state/scheduleTaskState.ts";

export default async function execute(remainder: string, agent: Agent) {
  const taskState = agent.getState(ScheduleTaskState);
  const executionState = agent.getState(ScheduleExecutionState);

  const lines: string[] = ["=== Scheduled Tasks ===\n"];

  for (const [taskName,task] of taskState.tasks.entries()) {
    const execEntry = executionState.tasks.get(taskName);
    const nextDate = execEntry?.nextRunTime ? new Date(execEntry.nextRunTime).toLocaleString() : "Not scheduled";
    const lastDate = task.lastRunTime ? new Date(task.lastRunTime).toLocaleString() : "Never";

    lines.push(
      `**${taskName}**`,
      indent([
        `Message: ${task.message}`,
        `Status: ${execEntry?.status ?? "Not scheduled"}`,
        `Next Run: ${nextDate}`,
        `Last Run: ${lastDate}`
      ], 1),
      ""
    );
  }

  agent.infoMessage(lines.join("\n"));
}
