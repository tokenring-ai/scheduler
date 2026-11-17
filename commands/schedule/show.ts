import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";
import { formatSchedules } from "../../tools/shared.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule show",
  description: "Show schedules",
  help: `Display every schedule: what it runs, its timing, status, next and last run.

## Example

/schedule show`,
  inputSchema,
  execute: ({ agent }: AgentCommandInputType<typeof inputSchema>): string => `=== Schedules ===\n\n${formatSchedules(agent.requireService(SchedulerService))}`,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
