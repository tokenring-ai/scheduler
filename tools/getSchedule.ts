import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import {ScheduleExecutionState} from "../state/scheduleExecutionState.ts";
import {ScheduleTaskState} from "../state/scheduleTaskState.ts";

const name = "scheduler_get_schedule";

async function execute(
  {}: z.output<typeof inputSchema>,
  agent: Agent
): Promise<string> {
  const taskState = agent.getState(ScheduleTaskState);
  const executionState = agent.getState(ScheduleExecutionState);

  if (taskState.tasks.size === 0) {
    return "No scheduled tasks";
  }

  const taskList = [`The current date and time is ${new Date().toLocaleString()}, and the following tasks are scheduled`];
  for (const [taskName, task] of taskState.tasks.entries()) {
    const execEntry = executionState.tasks.get(taskName);
    const nextRun = execEntry?.nextRunTime ? new Date(execEntry.nextRunTime).toLocaleString() : "";
    const lastRun = task.lastRunTime ? new Date(task.lastRunTime).toLocaleString() : "Never";
    const status = execEntry?.status ?? "Not scheduled";
    
    taskList.push(`${taskName} : 
  Message: ${task.message}
  Status: ${status}
  Next Run: ${nextRun}
  Last Run: ${lastRun}`);
  }

  return `Scheduled Tasks:\n\n${taskList.join('\n\n')}`;
}

const description = "Get the current schedule of all scheduled tasks with their status and next run times";

const inputSchema = z.object({});

export default {
  name, description, inputSchema, execute
} satisfies TokenRingToolDefinition<typeof inputSchema>;
