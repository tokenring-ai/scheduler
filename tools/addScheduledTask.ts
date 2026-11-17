import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ApprovalLevel } from "@tokenring-ai/chat/schema";
import { requireToolApproval } from "@tokenring-ai/chat/util/requireToolApproval";
import { z } from "zod";
import { describeAction } from "../actions.ts";
import SchedulerService from "../SchedulerService.ts";
import type { ScheduleAction, ScheduleDefinition } from "../schema.ts";
import { blankToUndefined, buildSchedulePrompt, describeSchedule } from "./shared.ts";

const name = "scheduler_add_task";
const displayName = "Scheduler/add_schedule";

/** The action the model asked for: a new agent of a type, or this chat. */
export function actionFor(runIn: "new agent" | "this chat", agentType: string | undefined, prompt: string, agent: Agent): ScheduleAction {
  if (runIn === "this chat") return { kind: "agent", agentId: agent.id, prompt };
  return { kind: "job", agentType: blankToUndefined(agentType) ?? agent.config.agentType, prompt };
}

async function execute(input: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const prompt = buildSchedulePrompt(input.prompt, input.context);
  const repeat = blankToUndefined(input.repeat);
  const definition: ScheduleDefinition = {
    action: actionFor(input.runIn, input.agentType, prompt, agent),
    ...(repeat ? { repeat } : { once: true }),
    ...(blankToUndefined(input.after) && { after: blankToUndefined(input.after)! }),
    ...(blankToUndefined(input.before) && { before: blankToUndefined(input.before)! }),
    ...(blankToUndefined(input.weekdays) && { weekdays: blankToUndefined(input.weekdays)! }),
    ...(input.dayOfMonth !== undefined && { dayOfMonth: input.dayOfMonth }),
    ...(blankToUndefined(input.timezone) && { timezone: blankToUndefined(input.timezone)! }),
  };
  const scheduler = agent.requireService(SchedulerService);
  // A schedule that could never run is refused before anyone is asked to approve it.
  const preview = scheduler.previewNextRun(definition);
  if (preview.error) throw new Error(preview.error);

  await requireToolApproval(agent, {
    toolName: name,
    message: `Schedule "${input.name}" to run ${repeat ? `every ${repeat}` : "once"}, with nobody watching?`,
    detailedDescription: `Adds the schedule "${input.name}". ${describeAction(definition.action)}${repeat ? `\n\nIt repeats every ${repeat}.` : ""}`,
    // A recurring unattended run is a shared change; a one-off run costs once.
    safetyLevel: repeat ? ApprovalLevel.SharedChange : ApprovalLevel.CostlyChange,
    default: false,
  });

  const view = scheduler.addSchedule(input.name, definition);
  return {
    message: `**Scheduler** Added schedule ${view.name}`,
    result: `Schedule "${view.name}" added.\n\n${describeSchedule(view)}`,
  };
}

const description =
  "Adds a schedule: run a prompt later, or repeatedly, with nobody watching. By default each run starts a fresh agent " +
  '(`runIn: "new agent"`, of `agentType`, or your own type) that does the work and is then cleaned up — use this for ' +
  'standalone work such as reports, checks and cleanups. Use `runIn: "this chat"` only when the prompt must run in this ' +
  "conversation with its context (e.g. checking back on something you are doing here); it queues behind whatever this chat is doing. " +
  "Omit `repeat` for a one-time run. Use a schedule only when timing matters: to run something now in the background use a queue item " +
  "(queue_addTaskToQueue), for tracked work on a board a board task (task_dispatch), for a saved multi-step script workflow_run. " +
  "A new-agent run is unattended: it can auto-approve no more than the app's cap for unattended agents, and the app-wide limits on how deep agents may start agents and how many one chain may start apply.";

const inputSchema = z.object({
  name: z.string().describe("A unique, short name for the schedule"),
  prompt: z
    .string()
    .describe(
      "The instructions the agent receives each time the schedule fires: several paragraphs, detailed enough for an agent with no other context to do the work.",
    ),
  context: z.string().exactOptional().describe("Background the agent may need (dependencies, links, prior results); appended to the prompt."),
  runIn: z
    .enum(["new agent", "this chat"])
    .default("new agent")
    .describe('"new agent" (default): a fresh agent runs each time. "this chat": the prompt is sent to this conversation.'),
  agentType: z.string().exactOptional().describe('For "new agent": the agent type to run (see the available agents). Defaults to your own type.'),
  repeat: z
    .string()
    .exactOptional()
    .describe(
      "How often to repeat, as '<number> <unit>' (e.g. '30 minutes', '1 hour', '1 day', '1 week', '1 month'); at least 1 minute. Omit for a one-time run.",
    ),
  after: z.string().exactOptional().describe("Earliest time of day to run, 'HH:mm' (24-hour)."),
  before: z.string().exactOptional().describe("Latest time of day to run, 'HH:mm' (24-hour)."),
  weekdays: z.string().exactOptional().describe("Only on these days, e.g. 'mon tue wed thu fri'."),
  dayOfMonth: z.number().int().min(1).max(31).exactOptional().describe("Only on this day of the month (1-31)."),
  timezone: z.string().exactOptional().describe("IANA timezone for the times and days (e.g. 'America/New_York', 'UTC'). Defaults to the server's."),
});

const requiredContextHandlers = ["available-agents"];

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
  requiredContextHandlers,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
