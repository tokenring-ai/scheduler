import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import SchedulerService from "../SchedulerService.ts";

const name = "scheduler_remove_task";

async function execute(
  {taskName}: z.output<typeof inputSchema>,
  agent: Agent
): Promise<string> {
  const scheduler = agent.requireServiceByType(SchedulerService);
  
  scheduler.removeTask(taskName, agent);
  
  return `Scheduled task '${taskName}' removed successfully`;
}

const description = "Remove a scheduled task by name";

const inputSchema = z.object({
  taskName: z.string().describe("Name of the scheduled task to remove")
});

export default {
  name, description, inputSchema, execute
} satisfies TokenRingToolDefinition<typeof inputSchema>;
