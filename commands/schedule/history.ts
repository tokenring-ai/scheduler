import Agent from "@tokenring-ai/agent/Agent";
import {ScheduleTaskState} from "../../state/scheduleTaskState.ts";

export default async function execute(remainder: string, agent: Agent) {
  const taskState = agent.getState(ScheduleTaskState);

  agent.infoLine("=== Task Execution History ===\n");

  for (const [taskName, task] of taskState.tasks.entries()) {
    agent.infoLine(`**${taskName}** (${task.agentType})`);
    const history = taskState.history.get(taskName);
    if (history && history.length > 0) {
      for (const run of history) {
        const startDate = new Date(run.startTime).toLocaleString();

        agent.infoLine(`- [${startDate}] ${taskName} - ${run.status} (${Math.round(run.endTime - run.startTime)}s) ${run.message}`);
      }
    }
  }
}
