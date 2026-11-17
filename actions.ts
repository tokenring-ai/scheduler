import { AgentJobService, AgentManager, JobCancelledError, type JobSession, type StepResult } from "@tokenring-ai/agent";
import type { InputMessage } from "@tokenring-ai/agent/AgentEvents";
import type { JobRecord } from "@tokenring-ai/agent/schema";
import type TokenRingApp from "@tokenring-ai/app";
import ChatService from "@tokenring-ai/chat/ChatService";
import { QueueService } from "@tokenring-ai/queue";
import { TaskService } from "@tokenring-ai/tasks";
import { SYSTEM } from "@tokenring-ai/tasks/model";
import formatError from "@tokenring-ai/utility/error/formatError";
import { WorkflowService } from "@tokenring-ai/workflow";
import type { ScheduleAction, ScheduleRunStatus } from "./schema.ts";

export type ActionOutcome = {
  status: Exclude<ScheduleRunStatus, "running">;
  message: string;
  /** The `agent` action's agent no longer exists: the schedule is paused rather than failing every time. */
  agentGone?: boolean;
};

export type ActionContext = {
  app: TokenRingApp;
  scheduleName: string;
  /** Aborted when the run is stopped (schedule removed, scheduler stopped, app stopping). */
  signal: AbortSignal;
  /** Links the run to the agent job it started or follows, as soon as its id is known. */
  linkJob: (jobId: string) => void;
};

const MAX_MESSAGE_LENGTH = 4000;

function clip(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

function stopReason(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (typeof reason === "string" && reason) return reason;
  if (Error.isError(reason) && reason.message) return reason.message;
  return "The run was stopped";
}

/** A run's outcome from its job's final record: the job is the source of truth for status and output. */
export function outcomeOfJob(record: JobRecord): ActionOutcome {
  switch (record.status) {
    case "succeeded":
      return { status: "completed", message: clip(record.summary || "Done") };
    case "cancelled":
      return { status: "cancelled", message: clip(record.error || record.summary || "Cancelled") };
    case "interrupted":
      return { status: "interrupted", message: clip(record.error || "Interrupted by a restart") };
    default:
      return { status: "failed", message: clip(record.error || record.summary || "The job failed") };
  }
}

function requireOptional<T>(service: T | undefined, what: string): T {
  if (!service) throw new Error(`${what} is not available: its plugin is not installed`);
  return service;
}

/** Resolves with the job's final record; cancels the job when the run is stopped first. */
function waitForJob(jobs: AgentJobService, jobId: string, signal: AbortSignal): Promise<JobRecord> {
  return new Promise<JobRecord>((resolve, reject) => {
    const now = jobs.get(jobId);
    if (!now) {
      reject(new Error(`Job ${jobId} has no record`));
      return;
    }
    if (now.status !== "queued" && now.status !== "running") {
      resolve(now);
      return;
    }
    const onAbort = () => jobs.cancel(jobId, stopReason(signal));
    const unsubscribe = jobs.onJobFinished(record => {
      if (record.id !== jobId) return;
      unsubscribe();
      signal.removeEventListener("abort", onAbort);
      resolve(record);
    });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Recorded on every job a schedule starts, directly or through a queue, workflow or task dispatch. */
function scheduleOrigin(ctx: ActionContext): { kind: "schedule"; scheduleId: string } {
  return { kind: "schedule", scheduleId: ctx.scheduleName };
}

function inputFor(scheduleName: string, prompt: string): InputMessage {
  return { from: `Schedule ${scheduleName}`, message: prompt };
}

/**
 * Starts a fresh agent job of the action's agent type: owner "scheduler", origin the schedule. Returns the
 * session, or the outcome when the job could not start (or the run was stopped meanwhile).
 */
async function startScheduleJob(
  ctx: ActionContext,
  action: Extract<ScheduleAction, { kind: "job" | "tool" }>,
): Promise<{ jobs: AgentJobService; session: JobSession } | ActionOutcome> {
  const jobs = requireOptional(ctx.app.getService(AgentJobService), "Agent jobs");
  const pending = jobs.startJobWhenFree(
    {
      owner: "scheduler",
      label: `Schedule "${ctx.scheduleName}"`,
      ownerRef: { schedule: ctx.scheduleName },
      agentType: action.agentType,
      origin: scheduleOrigin(ctx),
      ...(action.maxCostUsd !== undefined && { limits: { maxCostUsd: action.maxCostUsd } }),
      ...(action.maxApprovalLevel !== undefined && { maxApprovalLevel: action.maxApprovalLevel }),
    },
    { signal: ctx.signal },
  );
  if (pending.id) ctx.linkJob(pending.id);
  try {
    return { jobs, session: await pending.session };
  } catch (error) {
    if (error instanceof JobCancelledError || ctx.signal.aborted) return { status: "cancelled", message: stopReason(ctx.signal) };
    return { status: "failed", message: clip(`Could not start the job: ${formatError(error, { includeStack: false })}`) };
  }
}

/** A fresh agent job of the action's agent type that is prompted with the action's prompt. */
async function runJob(ctx: ActionContext, action: Extract<ScheduleAction, { kind: "job" }>): Promise<ActionOutcome> {
  const started = await startScheduleJob(ctx, action);
  if (!("session" in started)) return started;
  const { session } = started;
  let result: StepResult;
  try {
    result = await session.run(inputFor(ctx.scheduleName, action.prompt));
  } catch (error) {
    return outcomeOfJob(await session.finish("failed", formatError(error, { includeStack: false })));
  }
  const status = result.status === "success" ? "succeeded" : result.status === "cancelled" ? "cancelled" : "failed";
  return outcomeOfJob(await session.finish(status, result.status === "success" ? result.output || result.message : result.message));
}

/** Why a refused run did nothing, in the words of the permission it lacked; null when nothing was refused. */
function refusalNote(record: JobRecord): string | null {
  const refusal = record.refusals[0];
  if (!refusal) return null;
  const permission = refusal.permissionId ? ` Allow \`${refusal.permissionId}\` (Agent jobs, or Configuration > Permissions) and run it again.` : "";
  return `Not run: "${refusal.message}" needs approval and nobody was there to give it.${permission}`;
}

/**
 * Runs one chat tool once with the action's fixed input, in a fresh job agent, with no model call. The tool
 * is called directly (so no LLM can change what it does) but it runs its own approval check, which is where
 * the permission grant, the job's approval ceiling and refusal recording apply.
 */
async function runTool(ctx: ActionContext, action: Extract<ScheduleAction, { kind: "tool" }>): Promise<ActionOutcome> {
  const chat = requireOptional(ctx.app.getService(ChatService), "Chat tools");
  const named = chat.getAvailableToolNames().includes(action.tool) ? chat.requireTool(action.tool) : undefined;
  const definition = named?.toolDefinition;
  if (!definition) return { status: "failed", message: `Tool "${action.tool}" does not exist (its plugin may not be installed), so nothing was run` };
  const parsed = definition.inputSchema.safeParse(action.input);
  if (!parsed.success)
    return { status: "failed", message: clip(`The input is not valid for tool "${action.tool}", so nothing was run: ${parsed.error.message}`) };

  const started = await startScheduleJob(ctx, action);
  if (!("session" in started)) return started;
  const { session } = started;
  try {
    if (ctx.signal.aborted) return outcomeOfJob(await session.finish("cancelled", stopReason(ctx.signal)));
    const result = await definition.execute(parsed.data, session.agent);
    return outcomeOfJob(await session.finish(result.failed ? "failed" : "succeeded", result.result || result.message));
  } catch (error) {
    const detail = formatError(error, { includeStack: false });
    return outcomeOfJob(await session.finish("failed", refusalNote(session.record) ?? detail));
  }
}

/** Prompts an existing agent; stopping the run cancels only its own input, never what the agent is doing. */
async function runInAgent(ctx: ActionContext, action: Extract<ScheduleAction, { kind: "agent" }>): Promise<ActionOutcome> {
  const agent = ctx.app.getService(AgentManager)?.getAgent(action.agentId);
  if (!agent || agent.agentShutdownSignal.aborted) {
    return { status: "failed", message: `Agent ${action.agentId} no longer exists; the schedule was paused`, agentGone: true };
  }
  const jobs = requireOptional(ctx.app.getService(AgentJobService), "Agent jobs");
  const result = await jobs.runInAgent(agent, inputFor(ctx.scheduleName, action.prompt), { signal: ctx.signal });
  if (result.status === "success") return { status: "completed", message: clip(result.output || result.message || "Done") };
  if (result.status === "cancelled") return { status: "cancelled", message: clip(result.message || "Cancelled") };
  return { status: "failed", message: clip(result.message) };
}

async function runQueue(ctx: ActionContext, action: Extract<ScheduleAction, { kind: "queue" }>): Promise<ActionOutcome> {
  const queues = requireOptional(ctx.app.getService(QueueService), "The work queue");
  const item = queues.enqueue(action.queue, { name: action.item.name, input: inputFor(ctx.scheduleName, action.item.prompt) }, { origin: scheduleOrigin(ctx) });
  return { status: "completed", message: `Queued "${action.item.name}" as item #${item.seq ?? "?"} of queue "${action.queue}"` };
}

async function runWorkflow(ctx: ActionContext, action: Extract<ScheduleAction, { kind: "workflow" }>): Promise<ActionOutcome> {
  const workflows = requireOptional(ctx.app.getService(WorkflowService), "Workflows");
  const jobs = requireOptional(ctx.app.getService(AgentJobService), "Agent jobs");
  const started = await workflows.spawnWorkflow(action.name, {
    origin: scheduleOrigin(ctx),
    ...(action.maxCostUsd !== undefined && { maxCostUsd: action.maxCostUsd }),
    ...(action.maxApprovalLevel !== undefined && { maxApprovalLevel: action.maxApprovalLevel }),
  });
  ctx.linkJob(started.jobId);
  return outcomeOfJob(await waitForJob(jobs, started.jobId, ctx.signal));
}

async function runTask(ctx: ActionContext, action: Extract<ScheduleAction, { kind: "task" }>): Promise<ActionOutcome> {
  const tasks = requireOptional(ctx.app.getService(TaskService), "Tasks");
  const started = await tasks.dispatcher.start(action.ref, action.assignmentId, SYSTEM, { origin: scheduleOrigin(ctx) });
  if (started.jobId) ctx.linkJob(started.jobId);
  const onAbort = () => tasks.dispatcher.cancel(action.ref, action.assignmentId, stopReason(ctx.signal));
  if (ctx.signal.aborted) onAbort();
  else ctx.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await started.done;
    if (result.jobId) ctx.linkJob(result.jobId);
    const message = clip(result.summary || result.report || result.state);
    if (result.state === "done" || result.state === "unreported") return { status: "completed", message };
    if (result.state === "cancelled") return { status: "cancelled", message };
    if (result.state === "interrupted") return { status: "interrupted", message };
    return { status: "failed", message };
  } finally {
    ctx.signal.removeEventListener("abort", onAbort);
  }
}

/** Carries out a schedule's action. Never throws: a failure is an outcome. */
export async function runScheduleAction(ctx: ActionContext, action: ScheduleAction): Promise<ActionOutcome> {
  try {
    switch (action.kind) {
      case "job":
        return await runJob(ctx, action);
      case "tool":
        return await runTool(ctx, action);
      case "agent":
        return await runInAgent(ctx, action);
      case "queue":
        return await runQueue(ctx, action);
      case "workflow":
        return await runWorkflow(ctx, action);
      case "task":
        return await runTask(ctx, action);
    }
  } catch (error) {
    if (ctx.signal.aborted) return { status: "cancelled", message: stopReason(ctx.signal) };
    return { status: "failed", message: clip(formatError(error, { includeStack: false })) };
  }
}

/** One line describing what the action does, for lists and approvals. */
export function describeAction(action: ScheduleAction): string {
  switch (action.kind) {
    case "job":
      return `Start a new ${action.agentType} agent with: ${action.prompt}`;
    case "agent":
      return `Prompt agent ${action.agentId} with: ${action.prompt}`;
    case "queue":
      return `Add "${action.item.name}" to queue "${action.queue}": ${action.item.prompt}`;
    case "workflow":
      return `Run workflow "${action.name}"`;
    case "tool":
      return `Run tool ${action.tool} in a new ${action.agentType} agent with: ${JSON.stringify(action.input)}`;
    case "task":
      return `Dispatch assignment ${action.assignmentId} on task ${action.ref.taskId} (board ${action.ref.board})`;
  }
}
