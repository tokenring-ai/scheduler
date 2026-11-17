import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AgentJobService, AgentManager } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { ConfigurationError } from "@tokenring-ai/app/types";
import ChatService from "@tokenring-ai/chat/ChatService";
import { QueueService } from "@tokenring-ai/queue";
import { TaskService } from "@tokenring-ai/tasks";
import formatError from "@tokenring-ai/utility/error/formatError";
import { WorkflowService } from "@tokenring-ai/workflow";
import { type ActionOutcome, runScheduleAction } from "./actions.ts";
import {
  MISSED_RUN_MESSAGE,
  type ParsedSchedulerConfig,
  SCHEDULES_FILE_VERSION,
  type ScheduleDefinition,
  ScheduleDefinitionSchema,
  type ScheduleRun,
  type ScheduleRuntime,
  SchedulerConfigSchema,
  ScheduleStoreFileSchema,
  type ScheduleTiming,
  type ScheduleView,
} from "./schema.ts";
import { type LegacyScheduleData, LegacyScheduleState } from "./state/legacyScheduleState.ts";
import { getNextRunTime, parseAt, pastAtProblem, timingProblem } from "./utility/getNextRunTime.ts";

/** setTimeout's longest delay (2^31 - 1 ms, about 24.8 days); anything longer fires immediately. */
const MAX_TIMER_DELAY = 2 ** 31 - 1;
const MAX_NAME_LENGTH = 100;
/** Timers fire a little late; an `at` schedule is not "missed" for that. */
const TIMER_SLOP_MS = 5000;

type ActiveRun = { run: ScheduleRun; controller: AbortController };
type NextRun = { time: number | null; error: string | null };

const TIMING_KEYS = ["repeat", "once", "at", "after", "before", "weekdays", "dayOfMonth", "timezone"] as const satisfies (keyof ScheduleTiming)[];

/** Runs once and is then done: `once`, or an exact `at`. */
function isOneShot(timing: Pick<ScheduleTiming, "once" | "at">): boolean {
  return timing.once === true || timing.at !== undefined;
}

/**
 * One-shot schedules that must never be re-armed once they ran: an exact `at`, or a `tool` action
 * (which can post, email or otherwise act publicly under a standing permission grant).
 */
function isGuardedOneShot(definition: ScheduleDefinition): boolean {
  return isOneShot(definition) && (definition.at !== undefined || definition.action.kind === "tool");
}

function sameTiming(a: ScheduleTiming, b: ScheduleTiming): boolean {
  return TIMING_KEYS.every(key => a[key] === b[key]);
}

/**
 * Fires schedules: an app-level store of named schedules, each a timing plus an action (start an agent
 * job, prompt an existing agent, add a queue item, start a workflow, dispatch a task's agent).
 *
 * Schedules come from config (`scheduler.schedules`, edited there; paused and run from the app) and
 * from people and agents (tools, commands, RPC), which are saved with every schedule's run bookkeeping
 * and history in `schedules.json` in the workspace. They do not belong to any agent: deleting an agent
 * leaves them alone (a schedule that prompts a deleted agent is paused when it next fires).
 *
 * **Timing.** Repeats stay on a grid counted from their first run, days to months follow the calendar
 * in the schedule's timezone, a slot missed while the app was down fires once when it is back (inside
 * its window and days), and a schedule whose timing cannot be computed shows an error instead of
 * quietly never running. See {@link getNextRunTime}.
 *
 * **Runs.** A run's slot is recorded when it starts, so a restart never fires it twice; its status
 * comes from the agent job it started or followed (linked by `jobId`). A failed run is not retried
 * before the next slot. A run in flight when the app stops is recorded `interrupted`, and is not re-run.
 */
export default class SchedulerService implements TokenRingService {
  readonly name = "SchedulerService";
  description = "Fires schedules: agent jobs, chat prompts, queue items, workflows and task dispatches at set times";

  private config: ParsedSchedulerConfig = SchedulerConfigSchema.parse({});
  private readonly userSchedules = new Map<string, ScheduleDefinition>();
  private readonly runtime = new Map<string, ScheduleRuntime>();
  private readonly history = new Map<string, ScheduleRun[]>();
  /** Set by start/stop; null follows `autoStart`. */
  private runningOverride: boolean | null = null;

  private readonly active = new Map<string, ActiveRun>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly nextRuns = new Map<string, NextRun>();
  private readonly listeners = new Set<() => void>();
  private started = false;
  private stopping = false;

  private readonly storeFile: string;
  private writeChain: Promise<void> = Promise.resolve();
  private writeQueued = false;
  private lastWriteFailed = false;
  private tmpCounter = 0;

  constructor(
    private readonly app: TokenRingApp,
    options: { storeFile?: string | undefined } = {},
  ) {
    this.storeFile = options.storeFile ?? app.getWorkspaceResolvedPath("schedules.json");
  }

  reconfigure(config: ParsedSchedulerConfig): void {
    this.config = config;
    this.rescheduleAll();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Arms every schedule; called by the app once services are installed. */
  start(signal: AbortSignal): void {
    this.started = true;
    this.stopping = false;
    signal.addEventListener(
      "abort",
      () => {
        this.started = false;
        this.disarmAll();
      },
      { once: true },
    );
    this.rescheduleAll();
  }

  /**
   * Runs in flight become `interrupted` and the store is written at once. Their jobs are ended by
   * the job engine's own stop (as interrupted); nothing is re-run on the next start.
   */
  stop(): void {
    this.stopping = true;
    this.started = false;
    this.disarmAll();
    const now = Date.now();
    for (const { run } of this.active.values()) {
      run.status = "interrupted";
      run.endTime = now;
      run.message = "The app stopped while it ran";
    }
    this.writeNow();
  }

  /** Reads old per-agent schedules out of a restored agent's state into the store. */
  attach(agent: Agent): void {
    agent.initializeState(LegacyScheduleState, { onRestore: data => this.migrateFromAgent(agent, data) });
  }

  private disarmAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  /** Whether schedules fire (`/schedule start` / `stop`; `autoStart` until either is used). */
  isRunning(): boolean {
    return this.runningOverride ?? this.config.autoStart;
  }

  /** Called on every change to a schedule, its runs, or the scheduler's state. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private names(): string[] {
    return [...new Set([...Object.keys(this.config.schedules), ...this.userSchedules.keys()])].sort((a, b) => a.localeCompare(b));
  }

  private definitionOf(name: string): { definition: ScheduleDefinition; source: "config" | "user" } | null {
    // Config wins over a user schedule of the same name (which stays saved, shadowed).
    const fromConfig = Object.hasOwn(this.config.schedules, name) ? this.config.schedules[name] : undefined;
    if (fromConfig) return { definition: fromConfig, source: "config" };
    const fromUser = this.userSchedules.get(name);
    return fromUser ? { definition: fromUser, source: "user" } : null;
  }

  private isEnabled(name: string, found: { definition: ScheduleDefinition; source: "config" | "user" }): boolean {
    if (found.source === "config") return this.runtime.get(name)?.enabled ?? found.definition.enabled ?? true;
    return found.definition.enabled ?? true;
  }

  listSchedules(): ScheduleView[] {
    return this.names().flatMap(name => {
      const view = this.getSchedule(name);
      return view ? [view] : [];
    });
  }

  getSchedule(name: string): ScheduleView | undefined {
    const found = this.definitionOf(name);
    if (!found) return undefined;
    const enabled = this.isEnabled(name, found);
    const next = this.nextRuns.get(name) ?? this.computeNext(name, found.definition);
    const active = this.active.get(name);
    const lastRunTime = this.runtime.get(name)?.lastRunTime ?? 0;
    const finished = lastRunTime > 0 && isGuardedOneShot(found.definition);
    const missed = finished && this.history.get(name)?.at(-1)?.message === MISSED_RUN_MESSAGE;
    const state = active
      ? "running"
      : finished
        ? missed
          ? "missed"
          : "done"
        : !enabled
          ? "paused"
          : next.error
            ? "error"
            : next.time === null
              ? "done"
              : !this.isRunning()
                ? "stopped"
                : "scheduled";
    return {
      name,
      source: found.source,
      definition: structuredClone(found.definition),
      enabled,
      state,
      lastRunTime,
      nextRunTime: enabled && !finished ? next.time : null,
      error: next.error,
      currentRun: active ? { ...active.run } : null,
    };
  }

  /** Runs per schedule, oldest first; one schedule's when `name` is given. */
  getHistory(name?: string): Record<string, ScheduleRun[]> {
    if (name !== undefined) return { [name]: (this.history.get(name) ?? []).map(run => ({ ...run })) };
    return Object.fromEntries([...this.history].map(([key, runs]) => [key, runs.map(run => ({ ...run }))]));
  }

  /** The next run of an unsaved timing, as a new schedule would get it; or why it cannot run. */
  previewNextRun(timing: ScheduleTiming): { nextRunTime: number | null; error: string | null } {
    try {
      const past = pastAtProblem(timing);
      if (past) return { nextRunTime: null, error: past };
      return { nextRunTime: getNextRunTime(timing), error: null };
    } catch (error) {
      return { nextRunTime: null, error: Error.isError(error) ? error.message : String(error) };
    }
  }

  // ─── Changes ───────────────────────────────────────────────────────────────

  /**
   * Adds a user schedule. Throws when the name is taken, or it could never run as written. With
   * `startsAt`, a repeating schedule counts its first interval from then (`/loop` waits one interval)
   * instead of firing at once.
   */
  addSchedule(name: string, definition: ScheduleDefinition, { startsAt }: { startsAt?: number | undefined } = {}): ScheduleView {
    name = this.assertName(name);
    if (this.definitionOf(name)) {
      // Adding over one would replace it and forget when it last ran (a daily one would fire again at once).
      throw new ConfigurationError(this.name, `A schedule named "${name}" already exists; update it, or pick another name`);
    }
    const parsed = this.assertValid(definition);
    this.userSchedules.set(name, parsed);
    this.runtime.set(name, startsAt && parsed.repeat ? { lastRunTime: startsAt, anchorTime: startsAt } : { lastRunTime: 0 });
    this.history.delete(name);
    this.changed(name);
    return this.getSchedule(name)!;
  }

  /**
   * Replaces a user schedule's definition. When it last ran is kept, so an edit does not make it fire
   * again at once; a changed timing starts a new repeat grid from the last run.
   */
  updateSchedule(name: string, definition: ScheduleDefinition): ScheduleView {
    const existing = this.requireUserSchedule(name, "edited");
    const parsed = this.assertValid(definition);
    const runtime = this.runtime.get(name) ?? { lastRunTime: 0 };
    if (!sameTiming(existing, parsed)) {
      // A one-time schedule that has run never runs again, so turning one that ran into one-time
      // would leave it with nothing to do: it runs once more, as a new one would.
      const lastRunTime = (isOneShot(parsed) && !isOneShot(existing)) || parsed.at !== existing.at ? 0 : runtime.lastRunTime;
      this.runtime.set(name, { lastRunTime, ...(lastRunTime ? { anchorTime: lastRunTime } : {}) });
    }
    this.userSchedules.set(name, parsed);
    this.changed(name);
    return this.getSchedule(name)!;
  }

  /** Removes a user schedule, its bookkeeping and history; a run in progress is stopped. */
  removeSchedule(name: string): void {
    this.requireUserSchedule(name, "removed");
    this.active.get(name)?.controller.abort(`Schedule "${name}" was removed`);
    this.userSchedules.delete(name);
    this.runtime.delete(name);
    this.history.delete(name);
    this.changed(name);
  }

  /**
   * Pauses (`false`) or resumes (`true`) a schedule; a run in progress finishes. Resuming an ordinary
   * one-time schedule that has run lets it run once more. An exact-time (`at`) or `tool` schedule that
   * already ran is never re-armed this way (it could repeat a public post or email): it throws, and the
   * way to run it again is to update it with a new future `at`, or create a new one.
   */
  setEnabled(name: string, enabled: boolean): ScheduleView {
    const found = this.requireSchedule(name);
    if (enabled && isGuardedOneShot(found.definition) && (this.runtime.get(name)?.lastRunTime ?? 0) > 0) {
      throw new ConfigurationError(
        this.name,
        `Schedule "${name}" already ran, so it cannot be resumed; create a new one, or change its time (update it with a new future "at")`,
      );
    }
    this.writeEnabled(name, found, enabled);
    if (enabled && isOneShot(found.definition)) {
      const runtime = this.runtime.get(name);
      if (runtime?.lastRunTime) this.runtime.set(name, { ...runtime, lastRunTime: 0 });
    }
    this.changed(name);
    return this.getSchedule(name)!;
  }

  private writeEnabled(name: string, found: { definition: ScheduleDefinition; source: "config" | "user" }, enabled: boolean): void {
    if (found.source === "config") {
      const runtime = this.runtime.get(name) ?? { lastRunTime: 0 };
      const next: ScheduleRuntime = { ...runtime };
      if (enabled === (found.definition.enabled ?? true)) delete next.enabled;
      else next.enabled = enabled;
      this.runtime.set(name, next);
    } else {
      const next: ScheduleDefinition = { ...found.definition };
      if (enabled) delete next.enabled;
      else next.enabled = false;
      this.userSchedules.set(name, next);
    }
  }

  /** Runs a schedule now, outside its timing (even when paused or the scheduler is stopped). */
  runNow(name: string): ScheduleRun {
    this.requireSchedule(name);
    if (this.active.has(name)) throw new ConfigurationError(this.name, `Schedule "${name}" is already running`);
    return this.fire(name, Date.now(), true)!;
  }

  /** Clears one schedule's run history, or every schedule's. Runs in progress are kept. */
  clearHistory(name?: string): void {
    const keep = (key: string) => {
      const active = this.active.get(key);
      if (active) this.history.set(key, [active.run]);
      else this.history.delete(key);
    };
    // Deleting from a Map while iterating it is safe.
    if (name === undefined) for (const key of this.history.keys()) keep(key);
    else keep(name);
    this.changed(name ?? null);
  }

  /** Starts (`true`) or stops (`false`) firing schedules; stopping stops the runs in progress. Saved across restarts. */
  setRunning(running: boolean): void {
    this.runningOverride = running;
    if (!running) {
      for (const { controller } of this.active.values()) controller.abort("The scheduler was stopped");
      this.disarmAll();
    }
    this.changed(null);
  }

  private requireSchedule(name: string): { definition: ScheduleDefinition; source: "config" | "user" } {
    const found = this.definitionOf(name);
    if (!found) throw new ConfigurationError(this.name, `Schedule not found: ${name}`);
    return found;
  }

  private requireUserSchedule(name: string, verb: string): ScheduleDefinition {
    const found = this.requireSchedule(name);
    if (found.source === "config") {
      throw new ConfigurationError(this.name, `Schedule "${name}" is defined in config (scheduler.schedules) and can only be ${verb} there`);
    }
    return found.definition;
  }

  private assertName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new ConfigurationError(this.name, "A schedule needs a name");
    if (trimmed.length > MAX_NAME_LENGTH) throw new ConfigurationError(this.name, `Schedule names are at most ${MAX_NAME_LENGTH} characters`);
    return trimmed;
  }

  /**
   * Refuses a schedule that could never run as written: bad timing (times, window, interval limits,
   * timezone, days), or an action whose agent type, agent, queue or plugin does not exist. Every way of
   * adding or editing one (tools, commands, RPC) passes through here.
   */
  private assertValid(definition: ScheduleDefinition): ScheduleDefinition {
    const result = ScheduleDefinitionSchema.safeParse(definition);
    if (!result.success) throw new ConfigurationError(this.name, `Invalid schedule: ${result.error.message}`);
    const parsed = result.data;
    const problem = timingProblem(parsed) ?? pastAtProblem(parsed);
    if (problem) throw new ConfigurationError(this.name, problem);
    try {
      getNextRunTime(parsed);
    } catch (error) {
      throw new ConfigurationError(this.name, formatError(error, { includeStack: false }));
    }
    const { action } = parsed;
    if ((action.kind === "job" || action.kind === "workflow" || action.kind === "tool") && action.maxApprovalLevel !== undefined) {
      try {
        this.app.getService(AgentJobService)?.assertApprovalLevel(action.maxApprovalLevel);
      } catch (error) {
        throw new ConfigurationError(this.name, formatError(error, { includeStack: false }));
      }
    }
    const agentManager = this.app.getService(AgentManager);
    if ((action.kind === "job" || action.kind === "tool") && agentManager && !agentManager.getAgentConfig(action.agentType)) {
      throw new ConfigurationError(this.name, `Agent type "${action.agentType}" does not exist`);
    }
    if (action.kind === "tool") this.assertToolAction(action);
    if (action.kind === "agent" && agentManager && !agentManager.getAgent(action.agentId)) {
      throw new ConfigurationError(this.name, `Agent ${action.agentId} does not exist`);
    }
    if (action.kind === "queue") {
      const queues = this.app.getService(QueueService);
      if (!queues) throw new ConfigurationError(this.name, "Queue actions need the queue plugin, which is not installed");
      if (!queues.getQueueConfig(action.queue)) throw new ConfigurationError(this.name, `Queue "${action.queue}" does not exist`);
    }
    if (action.kind === "workflow" && !this.app.getService(WorkflowService)) {
      throw new ConfigurationError(this.name, "Workflow actions need the workflow plugin, which is not installed");
    }
    if (action.kind === "task" && !this.app.getService(TaskService)) {
      throw new ConfigurationError(this.name, "Task actions need the tasks plugin, which is not installed");
    }
    return parsed;
  }

  /** A `tool` action must name an installed chat tool and an input that tool accepts: it runs unattended, so it is checked now. */
  private assertToolAction(action: Extract<ScheduleDefinition["action"], { kind: "tool" }>): void {
    const chat = this.app.getService(ChatService);
    if (!chat) throw new ConfigurationError(this.name, "Tool actions need the chat plugin, which is not installed");
    const definition = chat.getAvailableToolNames().includes(action.tool) ? chat.requireTool(action.tool).toolDefinition : undefined;
    if (!definition) throw new ConfigurationError(this.name, `Tool "${action.tool}" does not exist`);
    const parsed = definition.inputSchema.safeParse(action.input);
    if (!parsed.success) throw new ConfigurationError(this.name, `The input is not valid for tool "${action.tool}": ${parsed.error.message}`);
  }

  // ─── Timers and runs ───────────────────────────────────────────────────────

  private computeNext(name: string, definition: ScheduleDefinition): NextRun {
    try {
      return { time: getNextRunTime(definition, this.runtime.get(name) ?? {}), error: null };
    } catch (error) {
      return { time: null, error: Error.isError(error) ? error.message : String(error) };
    }
  }

  private rescheduleAll(): void {
    const names = new Set(this.names());
    for (const name of [...this.timers.keys(), ...this.nextRuns.keys()]) {
      if (!names.has(name)) this.reschedule(name);
    }
    for (const name of names) this.reschedule(name);
  }

  /** Recomputes a schedule's next run and (re)arms its timer when it should fire. */
  private reschedule(name: string): void {
    const timer = this.timers.get(name);
    if (timer) clearTimeout(timer);
    this.timers.delete(name);
    const found = this.definitionOf(name);
    if (!found) {
      this.nextRuns.delete(name);
      return;
    }
    if (this.started && this.isRunning() && this.isEnabled(name, found) && !this.active.has(name) && this.markMissedIfLate(name, found)) return;
    const next = this.computeNext(name, found.definition);
    this.nextRuns.set(name, next);
    if (!this.started || !this.isRunning() || !this.isEnabled(name, found) || this.active.has(name) || next.time === null) return;
    this.arm(name, next.time);
  }

  /** setTimeout fires at once for delays over ~24.8 days; longer waits are taken in steps. */
  private arm(name: string, runAt: number): void {
    const timer = setTimeout(
      () => {
        this.timers.delete(name);
        if (Date.now() < runAt) this.arm(name, runAt);
        else {
          const found = this.definitionOf(name);
          if (found && this.markMissedIfLate(name, found)) return;
          this.fire(name, runAt, false);
        }
      },
      Math.min(Math.max(0, runAt - Date.now()), MAX_TIMER_DELAY),
    );
    timer.unref();
    this.timers.set(name, timer);
  }

  /**
   * An `at` schedule that has not run and whose time is more than the grace (`missedGraceMinutes` plus
   * timer slop) in the past is not run: a run is recorded as cancelled ("Missed") and the schedule is
   * done. Returns whether it did so.
   */
  private markMissedIfLate(name: string, found: { definition: ScheduleDefinition; source: "config" | "user" }): boolean {
    const { at } = found.definition;
    if (at === undefined || (this.runtime.get(name)?.lastRunTime ?? 0) > 0) return false;
    const slot = parseAt(at);
    if (slot === null) return false;
    const now = Date.now();
    if (now - slot <= this.config.missedGraceMinutes * 60_000 + TIMER_SLOP_MS) return false;
    const runtime = this.runtime.get(name) ?? { lastRunTime: 0 };
    this.runtime.set(name, { ...runtime, lastRunTime: slot, anchorTime: runtime.anchorTime ?? slot });
    this.recordRun(name, {
      id: randomUUID(),
      scheduledFor: slot,
      startTime: now,
      endTime: now,
      status: "cancelled",
      message: MISSED_RUN_MESSAGE,
      actionKind: found.definition.action.kind,
      jobId: null,
      manual: false,
    });
    this.writeEnabled(name, found, false);
    const timer = this.timers.get(name);
    if (timer) clearTimeout(timer);
    this.timers.delete(name);
    this.nextRuns.set(name, { time: null, error: null });
    this.app.serviceOutput(this, `Schedule "${name}" was not run. ${MISSED_RUN_MESSAGE}`);
    this.schedulePersist();
    this.notify();
    return true;
  }

  /** Starts a run for `slot`: recorded (and the slot taken) before the action starts. */
  private fire(name: string, slot: number, manual: boolean): ScheduleRun | null {
    const found = this.definitionOf(name);
    if (!found || this.active.has(name)) return null;
    const { action } = found.definition;
    const run: ScheduleRun = {
      id: randomUUID(),
      scheduledFor: slot,
      startTime: Date.now(),
      endTime: null,
      status: "running",
      message: "",
      actionKind: action.kind,
      jobId: null,
      manual,
    };
    const controller = new AbortController();
    this.active.set(name, { run, controller });
    const runtime = this.runtime.get(name) ?? { lastRunTime: 0 };
    this.runtime.set(name, { ...runtime, lastRunTime: slot, anchorTime: runtime.anchorTime ?? slot });
    this.recordRun(name, run);
    this.changed(name);

    const start = () =>
      void runScheduleAction(
        {
          app: this.app,
          scheduleName: name,
          signal: controller.signal,
          linkJob: jobId => {
            if (run.jobId === jobId) return;
            run.jobId = jobId;
            this.changed(null);
          },
        },
        action,
      ).then(outcome => this.finishRun(name, run, outcome));
    if (action.kind === "tool") {
      // A tool action can post or send something public: the slot must be on disk before it starts, so a
      // hard kill cannot make it fire again after a restart.
      void this.flush().then(() => {
        if (this.stopping) return;
        if (this.lastWriteFailed) {
          this.finishRun(name, run, { status: "failed", message: "Not run: the schedule store could not be saved, so the run could not be recorded first" });
          return;
        }
        start();
      });
    } else {
      start();
    }
    return { ...run };
  }

  private finishRun(name: string, run: ScheduleRun, outcome: ActionOutcome): void {
    if (this.active.get(name)?.run === run) this.active.delete(name);
    // stop() already recorded it as interrupted.
    if (this.stopping) return;
    run.status = outcome.status;
    run.message = outcome.message;
    run.endTime = Date.now();
    const found = this.definitionOf(name);
    if (found && (isOneShot(found.definition) || outcome.agentGone)) this.writeEnabled(name, found, false);
    if (outcome.status === "failed") this.app.serviceError(this, `Schedule "${name}" failed: ${outcome.message}`);
    this.changed(name);
  }

  private recordRun(name: string, run: ScheduleRun): void {
    const runs = [...(this.history.get(name) ?? []), run];
    const max = this.config.maxHistoryPerSchedule;
    this.history.set(name, runs.length > max ? runs.slice(runs.length - max) : runs);
  }

  /** After any change: reschedule (one schedule, or all when null), save, notify. */
  private changed(name: string | null): void {
    if (name === null) this.rescheduleAll();
    else this.reschedule(name);
    this.schedulePersist();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.app.serviceError(this, "A schedule listener failed:", error);
      }
    }
  }

  // ─── Migration from per-agent state ────────────────────────────────────────

  /**
   * Older versions kept schedules in each agent's state, as prompts for that agent. A restored agent's
   * tasks move to the store as `agent` schedules on that agent, keeping their bookkeeping and history.
   * A task already in the store under its name with the same prompt (config tasks were copied into
   * every agent) is skipped.
   */
  migrateFromAgent(agent: Agent, data: LegacyScheduleData): void {
    const moved: string[] = [];
    for (const [taskName, task] of Object.entries(data.tasks)) {
      const prompt = task.message;
      const existing = this.definitionOf(taskName);
      if (existing) {
        const { action } = existing.definition;
        const existingPrompt = action.kind === "job" || action.kind === "agent" ? action.prompt : action.kind === "queue" ? action.item.prompt : null;
        if (existingPrompt === prompt) continue;
      }
      const name = existing ? `${taskName} (${agent.id})` : taskName;
      if (this.definitionOf(name) || !prompt.trim()) continue;
      const definition: ScheduleDefinition = {
        ...(task.repeat !== undefined && { repeat: task.repeat }),
        ...(task.once !== undefined && { once: task.once }),
        ...(task.after !== undefined && { after: task.after }),
        ...(task.before !== undefined && { before: task.before }),
        ...(task.weekdays !== undefined && { weekdays: task.weekdays }),
        ...(task.dayOfMonth !== undefined && { dayOfMonth: task.dayOfMonth }),
        ...(task.timezone !== undefined && { timezone: task.timezone }),
        ...(task.enabled === false && { enabled: false }),
        action: { kind: "agent", agentId: agent.id, prompt },
      };
      // Not validated: one that can no longer run shows its error instead of disappearing.
      this.userSchedules.set(name, definition);
      this.runtime.set(name, { lastRunTime: task.lastRunTime, ...(task.lastRunTime ? { anchorTime: task.lastRunTime } : {}) });
      const runs = (data.history[taskName] ?? []).map(
        (entry): ScheduleRun => ({
          id: randomUUID(),
          scheduledFor: entry.startTime,
          startTime: entry.startTime,
          endTime: entry.endTime,
          status: entry.status,
          message: entry.message,
          actionKind: "agent",
          jobId: null,
          manual: false,
        }),
      );
      this.history.set(name, runs.slice(-this.config.maxHistoryPerSchedule));
      moved.push(name);
    }
    if (moved.length === 0) return;
    for (const name of moved) this.reschedule(name);
    this.changed(null);
    agent.infoMessage(`Moved ${moved.length} scheduled task(s) from this agent to the app's scheduler: ${moved.join(", ")}`);
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  /** Loads the store (called once at install). Runs in flight when the app stopped or crashed become `interrupted`. */
  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storeFile, "utf8");
    } catch {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.app.serviceError(this, `Could not read ${this.storeFile}:`, error);
      return;
    }
    const result = ScheduleStoreFileSchema.safeParse(parsed);
    if (!result.success) {
      this.app.serviceError(this, `Could not read ${this.storeFile}:`, result.error);
      return;
    }
    const data = result.data;
    if (data.running !== undefined) this.runningOverride = data.running;
    for (const [name, definition] of Object.entries(data.schedules)) this.userSchedules.set(name, definition);
    for (const [name, runtime] of Object.entries(data.runtime)) this.runtime.set(name, runtime);
    let interrupted = 0;
    for (const [name, runs] of Object.entries(data.history)) {
      for (const run of runs) {
        if (run.status !== "running") continue;
        run.status = "interrupted";
        run.endTime ??= Date.now();
        run.message = run.message || "Interrupted by a restart";
        interrupted++;
      }
      this.history.set(name, runs);
    }
    this.rescheduleAll();
    if (interrupted > 0) this.schedulePersist();
  }

  private serialize(): string {
    return `${JSON.stringify(
      {
        version: SCHEDULES_FILE_VERSION,
        ...(this.runningOverride !== null && { running: this.runningOverride }),
        schedules: Object.fromEntries(this.userSchedules),
        runtime: Object.fromEntries(this.runtime),
        history: Object.fromEntries(this.history),
      },
      null,
      2,
    )}\n`;
  }

  /** Coalesced, ordered, atomic (temp file + rename) writes. */
  private schedulePersist(): void {
    if (this.writeQueued || this.stopping) return;
    this.writeQueued = true;
    this.writeChain = this.writeChain
      .then(async () => {
        this.writeQueued = false;
        const content = this.serialize();
        await fs.promises.mkdir(path.dirname(this.storeFile), { recursive: true });
        const tmpFile = `${this.storeFile}.${process.pid}.${++this.tmpCounter}.tmp`;
        await fs.promises.writeFile(tmpFile, content);
        await fs.promises.rename(tmpFile, this.storeFile);
        this.lastWriteFailed = false;
      })
      .catch((error: unknown) => {
        this.writeQueued = false;
        this.lastWriteFailed = true;
        this.app.serviceError(this, `Could not save schedules to ${this.storeFile}:`, error);
      });
  }

  /** Resolves once every change so far is on disk. */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  private writeNow(): void {
    try {
      fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
      const tmpFile = `${this.storeFile}.${process.pid}.${++this.tmpCounter}.tmp`;
      fs.writeFileSync(tmpFile, this.serialize());
      fs.renameSync(tmpFile, this.storeFile);
    } catch (error) {
      this.app.serviceError(this, `Could not save schedules to ${this.storeFile}:`, error);
    }
  }
}
