import Agent from "@tokenring-ai/agent/Agent";
import {ScheduleExecutionState} from "../../state/scheduleExecutionState.ts";
import {ScheduleTaskState} from "../../state/scheduleTaskState.ts";

export default async function execute(remainder: string, agent: Agent) {
  const taskState = agent.getState(ScheduleTaskState);
  const executionState = agent.getState(ScheduleExecutionState);

  agent.infoLine("=== Scheduled Tasks ===\n");

  for (const [taskName,task] of taskState.tasks.entries()) {
    const execEntry = executionState.tasks.get(taskName);
    agent.infoLine(`**${taskName}** (${task.agentType})`);
    agent.infoLine(`  Message: ${task.message}`);
    agent.infoLine(`  Status: ${execEntry?.status ?? "Not scheduled"}`);
    const nextDate = execEntry?.nextRunTime ? new Date(execEntry.nextRunTime).toLocaleString() : "Not scheduled";
    agent.infoLine(`  Next Run: ${nextDate}`);
    const lastDate = task.lastRunTime ? new Date(task.lastRunTime).toLocaleString() : "Never";
    agent.infoLine(`  Last Run: ${lastDate}`);
    agent.infoLine("");
  }
}
