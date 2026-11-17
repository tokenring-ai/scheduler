import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ApprovalLevel } from "@tokenring-ai/chat/schema";
import { requireToolApproval } from "@tokenring-ai/chat/util/requireToolApproval";
import intelligentTruncate from "@tokenring-ai/utility/string/intelligentTruncate";
import { z } from "zod";
import { describeAction } from "../actions.ts";
import SchedulerService from "../SchedulerService.ts";
import type { ScheduleAction, ScheduleDefinition } from "../schema.ts";
import { blankToUndefined, buildSchedulePrompt, describeSchedule, describeTiming } from "./shared.ts";

const name = "scheduler_update_task";
const displayName = "Scheduler/update_schedule";

const inputSchema = z.object({
  name: z.string().describe("Name of the schedule to update"),
  prompt: z
    .string()
    .exactOptional()
    .describe("The new instructions; replaces the old prompt entirely. Omit to keep the prompt (required for schedules that run a workflow or a task)."),
  context: z.string().exactOptional().describe("Additional context appended to the new prompt."),
  repeat: z
    .string()
    .exactOptional()
    .describe(
      "How often to repeat, as '<number> <unit>' (e.g. '1 hour', '1 day'); at least 1 minute. Omit for a one-time run (or a daily one with once: false).",
    ),
  once: z.boolean().exactOptional().describe("Ignored when `repeat` is set. Omit (with no `repeat`) to run once; false with no `repeat` runs once a day."),
  after: z.string().exactOptional().describe("Earliest time of day, 'HH:mm' (24-hour). Omit to clear it."),
  before: z.string().exactOptional().describe("Latest time of day, 'HH:mm' (24-hour). Omit to clear it."),
  timezone: z.string().exactOptional().describe("IANA timezone (e.g. 'America/New_York', 'UTC'). Omit to clear it and use the server's."),
});

function withPrompt(action: ScheduleAction, prompt: string | undefined): ScheduleAction {
  if (prompt === undefined) return action;
  switch (action.kind) {
    case "job":
    case "agent":
      return { ...action, prompt };
    case "queue":
      return { ...action, item: { ...action.item, prompt } };
    default:
      throw new Error(`This schedule runs a ${action.kind}, which has no prompt to change; edit it in the Scheduler app`);
  }
}

/** A full replacement of the prompt and timing; the action's kind, weekdays, day of month and pause stay. */
function replacement(existing: ScheduleDefinition, input: z.output<typeof inputSchema>): ScheduleDefinition {
  const repeat = blankToUndefined(input.repeat);
  const prompt = input.prompt === undefined ? undefined : buildSchedulePrompt(input.prompt, input.context);
  return {
    action: withPrompt(existing.action, prompt),
    ...(repeat ? { repeat } : input.once === false ? {} : { once: true }),
    ...(blankToUndefined(input.after) && { after: blankToUndefined(input.after)! }),
    ...(blankToUndefined(input.before) && { before: blankToUndefined(input.before)! }),
    ...(blankToUndefined(input.timezone) && { timezone: blankToUndefined(input.timezone)! }),
    ...(existing.weekdays !== undefined && { weekdays: existing.weekdays }),
    ...(existing.dayOfMonth !== undefined && { dayOfMonth: existing.dayOfMonth }),
    ...(existing.enabled !== undefined && { enabled: existing.enabled }),
  };
}

async function execute(input: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const scheduler = agent.requireService(SchedulerService);
  const existing = scheduler.getSchedule(input.name);
  if (!existing) throw new Error(`Schedule not found: ${input.name}`);
  if (existing.source === "config") throw new Error(`Schedule "${input.name}" is defined in config and can only be edited there`);
  // A scheduled tool run has its input fixed by whoever scheduled it, and an exact time has no repeat or window to edit.
  if (existing.definition.action.kind === "tool" || existing.definition.at !== undefined) {
    throw new Error(
      `Schedule "${input.name}" is a fixed-time or tool schedule; agents cannot edit it. Remove it and schedule again, or edit it in the Scheduler app`,
    );
  }
  const next = replacement(existing.definition, input);
  const preview = scheduler.previewNextRun(next);
  if (preview.error) throw new Error(preview.error);

  await requireToolApproval(agent, {
    toolName: name,
    message: `Update the schedule "${input.name}"?`,
    detailedDescription: [
      `Replace the prompt and timing of "${input.name}". When it last ran is kept, so the edit does not make it fire again at once.`,
      `Timing: ${describeTiming({ definition: next })}`,
      "",
      intelligentTruncate(describeAction(next.action), { maxLength: 2_000 }),
    ].join("\n"),
    // Changes a recurring run that acts with nobody watching.
    safetyLevel: ApprovalLevel.SharedChange,
    default: false,
  });

  const view = scheduler.updateSchedule(input.name, next);
  return {
    message: `**Scheduler** Updated schedule ${input.name}`,
    result: `Schedule "${input.name}" updated.\n\n${describeSchedule(view)}`,
  };
}

const description =
  "Replaces the prompt and timing of a schedule (repeat or one-time, time window, timezone). What it runs (a new agent or a chat), its days, " +
  "last run time and pause state are kept. Requires approval.";

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
