import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ApprovalLevel } from "@tokenring-ai/chat/schema";
import { requireToolApproval } from "@tokenring-ai/chat/util/requireToolApproval";
import { z } from "zod";
import { describeAction } from "../actions.ts";
import SchedulerService from "../SchedulerService.ts";

const name = "scheduler_remove_task";
const displayName = "Scheduler/remove_schedule";

async function execute({ name: scheduleName }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const scheduler = agent.requireService(SchedulerService);
  const view = scheduler.getSchedule(scheduleName);
  if (!view) throw new Error(`Schedule not found: ${scheduleName}`);
  if (view.source === "config") throw new Error(`Schedule "${scheduleName}" is defined in config and can only be removed there`);
  await requireToolApproval(agent, {
    toolName: name,
    message: `Remove the schedule "${scheduleName}"?`,
    detailedDescription: `Deletes the schedule "${scheduleName}" (${describeAction(view.definition.action)}) and its run history. It will not run again; a run in progress is stopped.`,
    safetyLevel: ApprovalLevel.OwnDataLoss,
    default: true,
  });
  scheduler.removeSchedule(scheduleName);
  return {
    message: `**Scheduler** Removed schedule ${scheduleName}`,
    result: `Schedule "${scheduleName}" removed`,
  };
}

const description = "Removes a schedule by name, with its run history. To stop it for a while instead, pause it with scheduler_set_enabled.";

const inputSchema = z.object({
  name: z.string().describe("Name of the schedule to remove"),
});

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
