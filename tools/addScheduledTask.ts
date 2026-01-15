import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import SchedulerService from "../SchedulerService.ts";
import {ScheduledTaskSchema} from "../schema.ts";

const name = "scheduler_add_task";

async function execute(
  {taskName, task}: z.output<typeof inputSchema>,
  agent: Agent
): Promise<string> {
  const scheduler = agent.requireServiceByType(SchedulerService);
  
  scheduler.addTask(taskName, task, agent);
  
  return `Scheduled task '${taskName}' added successfully`;
}

const description = "Add a new scheduled task to run an agent at specified intervals";

const inputSchema = z.object({
  taskName: z.string().describe("Unique name for the scheduled task"),
  task: ScheduledTaskSchema.describe("Task configuration including agent type, schedule, and message")
});

const requiredContextHandlers = ["available-agents"];

export default {
  name, description, inputSchema, execute, requiredContextHandlers
} satisfies TokenRingToolDefinition<typeof inputSchema>;
