import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ApprovalLevel } from "@tokenring-ai/chat/schema";
import { requireToolApproval } from "@tokenring-ai/chat/util/requireToolApproval";
import { z } from "zod";
import SchedulerService from "../SchedulerService.ts";
import { describeSchedule } from "./shared.ts";

const name = "scheduler_set_enabled";
const displayName = "Scheduler/set_enabled";

const inputSchema = z.object({
  name: z.string().describe("Name of the schedule to pause or resume"),
  enabled: z.boolean().describe("True resumes the schedule. False pauses it: it stays, but does not fire until resumed."),
});

async function execute({ name: scheduleName, enabled }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const scheduler = agent.requireService(SchedulerService);
  const existing = scheduler.getSchedule(scheduleName);
  if (!existing) throw new Error(`Schedule not found: ${scheduleName}`);
  if (enabled && existing.definition.action.kind === "tool") {
    throw new Error(
      `Schedule "${scheduleName}" runs a tool with fixed input, so agents cannot resume it (it could repeat a public action); pausing is allowed. Resume it, or change its time, in the Scheduler app`,
    );
  }

  await requireToolApproval(agent, {
    toolName: name,
    message: `${enabled ? "Resume" : "Pause"} the schedule "${scheduleName}"?`,
    detailedDescription: enabled
      ? `Resume "${scheduleName}" so it fires again, with nobody watching.`
      : `Pause "${scheduleName}". It stays but will not fire until resumed. A run already in progress finishes.`,
    // Resuming lets unattended runs happen again (shared change); pausing is easily undone.
    safetyLevel: enabled ? ApprovalLevel.SharedChange : ApprovalLevel.RecoverableChange,
    default: false,
  });

  const view = scheduler.setEnabled(scheduleName, enabled);
  return {
    message: `**Scheduler** ${enabled ? "Resumed" : "Paused"} schedule ${scheduleName}`,
    result: `Schedule "${scheduleName}" ${enabled ? "resumed" : "paused"}.\n\n${describeSchedule(view)}`,
  };
}

const description =
  "Pauses or resumes a schedule. A paused schedule stays but does not fire; a run already in progress finishes. Schedules that run a tool can be paused but not resumed from here, and a one-time schedule at an exact time that already ran cannot be resumed.";

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
