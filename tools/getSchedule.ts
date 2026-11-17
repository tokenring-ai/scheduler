import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { z } from "zod";
import SchedulerService from "../SchedulerService.ts";
import { formatSchedules } from "./shared.ts";

const name = "scheduler_get_schedule";
const displayName = "Scheduler/get_schedule";

function execute(_args: z.output<typeof inputSchema>, agent: Agent): TokenRingToolResult {
  const scheduler = agent.requireService(SchedulerService);
  const count = scheduler.listSchedules().length;
  return {
    message: `**Scheduler** Listed ${count} schedule${count === 1 ? "" : "s"}`,
    result: formatSchedules(scheduler),
  };
}

const description = "Lists every schedule (something set to run later or repeatedly): what it does, its timing, status, next run and last run.";

const inputSchema = z.object({});

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
