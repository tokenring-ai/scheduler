import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import SchedulerService from "../SchedulerService.ts";
import {ScheduledTaskSchema} from "../schema.ts";
import {ScheduleExecutionState} from "../state/scheduleExecutionState.ts";
import getSchedule from "./getSchedule.ts";

const name = "add_scheduled_task";
const displayName = "Scheduler/addScheduledTask";

async function execute(
  {taskName, task}: z.output<typeof inputSchema>,
  agent: Agent
): Promise<string> {
  const scheduler = agent.requireServiceByType(SchedulerService);

  scheduler.addTask(taskName, {
    before: task.before,
    after: task.after,
    repeat: task.repeat,
    timezone: task.timezone,
    lastRunTime: Date.now(),
    message: `${task.description}\n\nADDITIONAL CONTEXT:${task.context}`
  }, agent);

  return `Scheduled task '${taskName}' added successfully.\n\n` + await getSchedule.execute({}, agent);
}

const description = "This tools adds a scheduled task to the scheduler. It allows you to define a task with a unique name, specify the agent to run, and set the schedule for when the task should be executed.";

const inputSchema = z.object({
  taskName: z.string().describe("Unique name for the scheduled task"),
  task: z.object({
    description: z.string().describe("A long, several paragraph description of the exact task to execute. This should provide enough detail for an AI agent to understand the purpose and requirements of the task."),
    context: z.string().optional().describe("Additional context or information that may be relevant to the task execution. This should include background information, dependencies, or any other details that could help the agent perform the task more effectively."),
    repeat: z.string().optional().describe("An optional string describing how often to repeat the task, which should be omitted if the task should only run once. The format of the string is an interval schedule in the format '<number> <unit>' (e.g., '1 hour', '30 minutes', '30 minute', '3 days')"),
    after: z.string().optional().describe(
      "Time of day in 'HH:mm' format (24-hour clock) to run the task after. The task will be scheduled to run after this time."),
    before: z.string().optional().describe(
      "Time of day in 'HH:mm' format (24-hour clock) to run the task before. The task will be scheduled to run before this time."),
    timezone: z.string().optional().describe(
      "IANA timezone string for the time. (e.g., 'America/New_York', 'UTC'). Defaults to the users timezone."
    ),
  })
});


const requiredContextHandlers = ["available-agents"];

export default {
  name, displayName, description, inputSchema, execute, requiredContextHandlers
} satisfies TokenRingToolDefinition<typeof inputSchema>;
