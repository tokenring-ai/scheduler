import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { z } from "zod";
import SchedulerService from "../SchedulerService.ts";

const name = "scheduler_remove_task";
const displayName = "Scheduler/removeTask";

function execute({ taskName }: z.output<typeof inputSchema>, agent: Agent): TokenRingToolResult {
  const scheduler = agent.requireServiceByType(SchedulerService);

  scheduler.removeTask(taskName, agent);

  return {
    message: `**Scheduler** Removed scheduled task ${taskName}`,
    result: `Scheduled task '${taskName}' removed successfully`,
  };
}

const description = "Remove a scheduled task by name";

const inputSchema = z.object({
  taskName: z.string().describe("Name of the scheduled task to remove"),
});

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
