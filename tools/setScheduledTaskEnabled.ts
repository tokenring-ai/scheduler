import type Agent from "@tokenring-ai/agent/Agent";
import ChatService from "@tokenring-ai/chat/ChatService";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ToolCallError } from "@tokenring-ai/chat/util/tokenRingTool";
import { z } from "zod";
import SchedulerService from "../SchedulerService.ts";
import { ScheduleTaskState } from "../state/scheduleTaskState.ts";
import getSchedule from "./getSchedule.ts";

const name = "scheduler_set_enabled";
const displayName = "Scheduler/set_enabled";

/** Pausing or resuming a task changes whether it will fire. A running task is not interrupted. */
const SAFETY_LEVEL = 5;

const inputSchema = z.object({
  taskName: z.string().describe("Name of the scheduled task to pause or resume"),
  enabled: z.boolean().describe("True resumes the task. False pauses it so the scheduler skips it until it is resumed."),
});

async function execute({ taskName, enabled }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const scheduler = agent.requireService(SchedulerService);
  // setTaskEnabled throws before writing when the task does not exist.
  if (!agent.getState(ScheduleTaskState).tasks.has(taskName)) {
    scheduler.setTaskEnabled(taskName, enabled, agent);
  }

  const approved = await agent.requireService(ChatService).checkToolApproval(
    {
      toolName: name,
      message: `${enabled ? "Resume" : "Pause"} scheduled task "${taskName}"?`,
      detailedDescription: enabled
        ? `Resume "${taskName}" so the scheduler can fire it again.`
        : `Pause "${taskName}". It stays on the schedule but will not fire until resumed. A run already in progress will finish.`,
      safetyLevel: SAFETY_LEVEL,
      default: false,
    },
    agent,
  );
  if (!approved) throw new ToolCallError(name, "User did not approve pausing or resuming the scheduled task");

  scheduler.setTaskEnabled(taskName, enabled, agent);
  const schedule = getSchedule.execute({}, agent);
  const verb = enabled ? "resumed" : "paused";
  return {
    message: `**Scheduler** ${enabled ? "Resumed" : "Paused"} scheduled task ${taskName}`,
    result: `Scheduled task '${taskName}' ${verb} successfully.\n\n` + schedule.result,
  };
}

const description =
  "Pauses or resumes a scheduled task. A paused task stays on the schedule but does not fire; a task that is already running finishes its current run. Requires approval.";

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
