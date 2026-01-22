import Agent from "@tokenring-ai/agent/Agent";
import {ScheduleTaskState} from "../../state/scheduleTaskState.ts";

export default async function execute(remainder: string, agent: Agent) {
  const taskState = agent.getState(ScheduleTaskState);

  const lines: string[] = ["=== Task Execution History ===\n"];

  for (const [taskName, task] of taskState.tasks.entries()) {
    lines.push(`**${taskName}**`);
    const history = taskState.history.get(taskName);
    if (history && history.length > 0) {
      for (const run of history) {
        const startDate = new Date(run.startTime).toLocaleString();

        lines.push(`- [${startDate}] ${taskName} - ${run.status} (${Math.round(run.endTime - run.startTime)}s) ${run.message}`);
      }
    }
  }

  agent.infoMessage(lines.join("\n"));
}
