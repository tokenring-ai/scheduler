import type Agent from "@tokenring-ai/agent/Agent";
import ChatService from "@tokenring-ai/chat/ChatService";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ToolCallError } from "@tokenring-ai/chat/util/tokenRingTool";
import { stripUndefinedKeys } from "@tokenring-ai/utility/object/stripObject";
import intelligentTruncate from "@tokenring-ai/utility/string/intelligentTruncate";
import { z } from "zod";
import SchedulerService from "../SchedulerService.ts";
import type { ScheduledTask } from "../schema.ts";
import { ScheduleTaskState } from "../state/scheduleTaskState.ts";
import { buildTaskMessage } from "./addScheduledTask.ts";
import getSchedule from "./getSchedule.ts";

const name = "scheduler_update_task";
const displayName = "Scheduler/update_task";

/** Replacing a schedule changes when an agent acts. Last-run bookkeeping is kept by the service. */
const SAFETY_LEVEL = 6;

const inputSchema = z.object({
  taskName: z.string().describe("Name of the scheduled task to update"),
  task: z.object({
    description: z
      .string()
      .describe("The new task prompt. This replaces the task message entirely. It should be detailed enough for an AI agent to carry out the task."),
    context: z.string().exactOptional().describe("Additional context appended to the message. Omit it to store only the description."),
    repeat: z
      .string()
      .exactOptional()
      .describe(
        "How often to repeat the task, as '<number> <unit>' (e.g. '1 hour', '30 minutes', '3 days'). When set, the task stays recurring and `once` is ignored. Omit it for a one-shot, or for a daily task when `once` is false.",
      ),
    once: z
      .boolean()
      .exactOptional()
      .describe(
        "Run this task only once. Ignored when `repeat` is set. Omit it (and omit `repeat`) to run once. Set false with no `repeat` to run once a day.",
      ),
    after: z
      .string()
      .exactOptional()
      .describe("Time of day in 'HH:mm' format (24-hour clock) to run the task after. Omit to clear an existing time window start."),
    before: z
      .string()
      .exactOptional()
      .describe("Time of day in 'HH:mm' format (24-hour clock) to run the task before. Omit to clear an existing time window end."),
    timezone: z
      .string()
      .exactOptional()
      .describe("IANA timezone string (e.g. 'America/New_York', 'UTC'). Omit to clear an existing timezone and use the user's timezone."),
  }),
});

const blankToUndefined = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Full replacement of the message and schedule. Day constraints and pause state stay;
 * SchedulerService.updateTask keeps lastRunTime itself.
 */
function replacementTask(existing: ScheduledTask | undefined, task: z.output<typeof inputSchema>["task"]): ScheduledTask {
  const repeat = blankToUndefined(task.repeat);
  const once = repeat ? undefined : task.once === false ? undefined : true;
  return stripUndefinedKeys({
    message: buildTaskMessage(task.description, task.context),
    repeat,
    once,
    before: blankToUndefined(task.before),
    after: blankToUndefined(task.after),
    timezone: blankToUndefined(task.timezone),
    weekdays: existing?.weekdays,
    dayOfMonth: existing?.dayOfMonth,
    enabled: existing?.enabled,
    lastRunTime: existing?.lastRunTime ?? 0,
  });
}

async function execute({ taskName, task }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const scheduler = agent.requireService(SchedulerService);
  const existing = agent.getState(ScheduleTaskState).tasks.get(taskName);
  const next = replacementTask(existing, task);
  // updateTask throws before writing when the task does not exist.
  if (!existing) scheduler.updateTask(taskName, next, agent);

  const repeat = blankToUndefined(task.repeat);
  const scheduleLine = repeat ? `Repeat: ${repeat}` : task.once === false ? "Schedule: once a day" : "Schedule: once";
  const window = [blankToUndefined(task.after) ? `after ${task.after?.trim()}` : null, blankToUndefined(task.before) ? `before ${task.before?.trim()}` : null]
    .filter(part => part !== null)
    .join(", ");

  const approved = await agent.requireService(ChatService).checkToolApproval(
    {
      toolName: name,
      message: `Update scheduled task "${taskName}"?`,
      detailedDescription: [
        `Replace the message and schedule for "${taskName}". Its last run time is kept, so editing it does not make it fire again immediately.`,
        scheduleLine + (window ? ` (${window})` : "") + (blankToUndefined(task.timezone) ? ` [${task.timezone?.trim()}]` : ""),
        "",
        "Message:",
        intelligentTruncate(next.message, { maxLength: 2_000 }),
      ].join("\n"),
      safetyLevel: SAFETY_LEVEL,
      default: false,
    },
    agent,
  );
  if (!approved) throw new ToolCallError(name, "User did not approve updating the scheduled task");

  scheduler.updateTask(taskName, next, agent);
  const schedule = getSchedule.execute({}, agent);
  return {
    message: `**Scheduler** Updated scheduled task ${taskName}`,
    result: `Scheduled task '${taskName}' updated successfully.\n\n` + schedule.result,
  };
}

const description =
  "Replaces the message and schedule of an existing task (repeat interval or one-shot, time window, and timezone). Last run time is kept. Day-of-week, day-of-month, and pause state are left unchanged. Requires approval.";

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
