import { JobLink } from "@tokenring-ai/one-frontend/apps/agents/JobLink.tsx";
import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import ErrorState from "@tokenring-ai/one-frontend/components/ui/ErrorState.tsx";
import LoadingState from "@tokenring-ai/one-frontend/components/ui/LoadingState.tsx";
import StatusBadge, { type StatusBadgeDefinition } from "@tokenring-ai/one-frontend/components/ui/StatusBadge.tsx";
import SummaryStat from "@tokenring-ai/one-frontend/components/ui/SummaryStat.tsx";
import { toastManager } from "@tokenring-ai/one-frontend/components/ui/toast.tsx";
import ViewHeader from "@tokenring-ai/one-frontend/components/ui/ViewHeader.tsx";
import ViewShell from "@tokenring-ai/one-frontend/components/ui/ViewShell.tsx";
import { useConfirmDialog } from "@tokenring-ai/one-frontend/hooks/useConfirmDialog.tsx";
import { useKeyboardShortcuts } from "@tokenring-ai/one-frontend/hooks/useKeyboardShortcuts.ts";
import { useKeyedActions } from "@tokenring-ai/one-frontend/hooks/useKeyedActions.ts";
import { useTick } from "@tokenring-ai/one-frontend/hooks/useTick.ts";
import { usePaneLink, usePanel } from "@tokenring-ai/one-frontend/layout/hooks.ts";
import { cn } from "@tokenring-ai/one-frontend/lib/utils.ts";
import { schedulerRPCClient, useAgentList, useSchedules } from "@tokenring-ai/one-frontend/rpc.ts";
import formatError from "@tokenring-ai/utility/error/formatError";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePause,
  Clock,
  History,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ScheduleView } from "../../schema.ts";
import {
  actionPrompt,
  formatActionSummary,
  formatRelativeTime,
  formatScheduleSummary,
  formatScheduleTime,
  truncateMessage,
} from "../features/scheduler/formatters.ts";
import ScheduleForm from "../features/scheduler/ScheduleForm.tsx";
import { SCHEDULER_RUNS_VIEW_ID } from "../ids.ts";

const SCHEDULER_STATUS_BADGES: Record<"started" | "stopped" | "unknown", StatusBadgeDefinition> = {
  started: {
    label: "Scheduler started",
    dotColor: "bg-emerald-500",
    pulse: true,
    colorClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  stopped: {
    label: "Scheduler stopped",
    icon: <Pause className="w-3 h-3" />,
    colorClass: "bg-tertiary text-muted border-primary",
  },
  unknown: {
    label: "Scheduler status unknown",
    icon: <AlertCircle className="w-3 h-3" />,
    colorClass: "bg-tertiary text-muted border-primary",
  },
};

const STATE_BADGES: Record<ScheduleView["state"], StatusBadgeDefinition> = {
  running: { label: "Running", icon: <Activity className="w-3 h-3 animate-pulse" />, colorClass: "text-amber-600 dark:text-amber-400" },
  scheduled: { label: "Scheduled", icon: <Clock className="w-3 h-3" />, colorClass: "text-indigo-600 dark:text-indigo-400" },
  stopped: { label: "Waiting for the scheduler", icon: <Pause className="w-3 h-3" />, colorClass: "text-muted" },
  paused: { label: "Paused", icon: <CirclePause className="w-3 h-3" />, colorClass: "text-muted" },
  done: { label: "Done", icon: <CheckCircle2 className="w-3 h-3" />, colorClass: "text-muted" },
  missed: { label: "Missed, not run", icon: <AlertCircle className="w-3 h-3" />, colorClass: "text-amber-600 dark:text-amber-400" },
  error: { label: "Error", icon: <AlertCircle className="w-3 h-3" />, colorClass: "text-red-600 dark:text-red-400" },
};

const iconButton = "p-1.5 text-muted hover:text-primary transition-colors rounded-md focus-ring cursor-pointer disabled:opacity-50 shrink-0";
const smallButton =
  "inline-flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-primary border border-primary rounded-md focus-ring cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Every schedule in the app: what it runs, its timing, next and last runs, with start/stop of the
 * scheduler and the add/edit form. Sits beside the Runs view in the Scheduler app.
 */
export default function SchedulesPane() {
  const panel = usePanel();
  const paneLink = usePaneLink();
  const schedulesQuery = useSchedules();
  const agents = useAgentList();
  const [showAddForm, setShowAddForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const { openConfirm, Dialog: ConfirmDialog } = useConfirmDialog();
  // Per schedule and action: a Pause on one must not swallow a Run now clicked on another.
  const { busy, execute } = useKeyedActions();

  const agentName = useMemo(() => {
    const names = new Map((agents.data ?? []).map(agent => [agent.id, agent.displayName]));
    return (agentId: string) => names.get(agentId);
  }, [agents.data]);

  const schedules = useMemo(
    () =>
      [...(schedulesQuery.data?.schedules ?? [])].sort((a, b) => {
        // Running first, then soonest next run
        if (a.state === "running" && b.state !== "running") return -1;
        if (b.state === "running" && a.state !== "running") return 1;
        return (a.nextRunTime ?? Number.POSITIVE_INFINITY) - (b.nextRunTime ?? Number.POSITIVE_INFINITY);
      }),
    [schedulesQuery.data],
  );

  const statusKnown = schedulesQuery.data != null;
  const schedulerRunning = schedulesQuery.data?.running ?? false;
  const runningCount = schedules.filter(s => s.state === "running").length;
  const editingEntry = editing ? schedules.find(s => s.name === editing) : undefined;

  // Refresh relative-time labels while there is upcoming or active work
  useTick(15_000, runningCount > 0 || schedules.some(s => s.nextRunTime != null));

  // Cmd/Ctrl+N opens the add form while this panel is in focus.
  useKeyboardShortcuts([
    {
      key: "n",
      handler: () => {
        setEditing(null);
        setShowAddForm(true);
      },
      enabled: panel.isActive && !showAddForm,
    },
  ]);

  const refresh = async () => {
    await schedulesQuery.mutate();
  };

  const act = (key: string, call: () => Promise<{ message: string }>, after?: () => void) =>
    execute(key, async () => {
      try {
        const result = await call();
        toastManager.success(result.message, { duration: 2500 });
        after?.();
        await refresh();
      } catch (err) {
        toastManager.error(formatError(err), { duration: 5000 });
      }
    });

  const handleStartStop = async () => {
    if (!statusKnown) return;
    if (schedulerRunning && runningCount > 0) {
      const confirmed = await openConfirm({
        title: "Stop scheduler",
        message:
          runningCount === 1
            ? "1 schedule is running right now. Stopping the scheduler stops its run. Stop anyway?"
            : `${runningCount} schedules are running right now. Stopping the scheduler stops their runs. Stop anyway?`,
        confirmText: "Stop and cancel runs",
        cancelText: "Cancel",
        variant: "danger",
      });
      if (!confirmed) return;
    }
    await act(schedulerRunning ? "stop" : "start", () => schedulerRPCClient.setSchedulerRunning({ running: !schedulerRunning }));
  };

  const handleRemove = async (name: string) => {
    const confirmed = await openConfirm({
      title: "Remove schedule",
      message: `Remove "${name}" and its run history? If it is running now, the run is stopped. This cannot be undone.`,
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    await act(
      `remove:${name}`,
      () => schedulerRPCClient.removeSchedule({ name }),
      () => {
        if (expanded === name) setExpanded(null);
        if (editing === name) setEditing(null);
      },
    );
  };

  let body: React.ReactNode;
  if (schedulesQuery.isLoading && !schedulesQuery.data) {
    body = <LoadingState size="md" className="py-12" />;
  } else if (schedulesQuery.error && !schedulesQuery.data) {
    body = <ErrorState title="Unable to load schedules" error={schedulesQuery.error} onRetry={() => void refresh()} variant="page" />;
  } else {
    body = (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryStat
            label="Schedules"
            value={String(schedules.length)}
            icon={<Timer className="w-4 h-4" />}
            accentClass="text-indigo-500"
            iconPosition="right"
          />
          <SummaryStat
            label="Scheduler"
            value={!statusKnown ? "Unknown" : schedulerRunning ? "Started" : "Stopped"}
            sub={schedulerRunning ? "Schedules fire on time" : "Nothing fires until started"}
            icon={schedulerRunning ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            accentClass={schedulerRunning ? "text-emerald-500" : "text-muted"}
            iconPosition="right"
          />
          <SummaryStat
            label="Running now"
            value={String(runningCount)}
            icon={<Activity className="w-4 h-4" />}
            accentClass="text-amber-500"
            iconPosition="right"
          />
        </div>

        <div className="bg-secondary border border-primary rounded-xl p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
          <StatusBadge status={!statusKnown ? "unknown" : schedulerRunning ? "started" : "stopped"} statuses={SCHEDULER_STATUS_BADGES} gap="md" />
          <button
            type="button"
            disabled={!statusKnown || busy.has("start") || busy.has("stop")}
            onClick={() => void handleStartStop()}
            title={schedulerRunning ? "Stop firing schedules (for the whole app)" : "Start firing schedules"}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg focus-ring cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
              schedulerRunning ? "bg-tertiary border border-primary text-primary hover:bg-hover" : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm",
            )}
          >
            {busy.has("start") || busy.has("stop") ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : schedulerRunning ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {schedulerRunning ? "Stop" : "Start"}
          </button>
        </div>

        {showAddForm ? (
          <ScheduleForm
            existingNames={schedules.map(s => s.name)}
            onCancel={() => setShowAddForm(false)}
            onSaved={() => {
              setShowAddForm(false);
              void refresh();
            }}
          />
        ) : null}

        {editingEntry ? (
          <ScheduleForm
            key={`edit:${editingEntry.name}`}
            existingNames={schedules.map(s => s.name)}
            editing={{ name: editingEntry.name, schedule: editingEntry.definition }}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void refresh();
            }}
          />
        ) : null}

        {schedules.length === 0 && !showAddForm ? (
          <EmptyState
            variant="card"
            icon={Clock}
            title="No schedules"
            hint="Start an agent, prompt a chat, add a queue item, run a workflow or dispatch a task at set times — daily briefs, health checks, cleanups."
            ctaLabel="Add your first schedule"
            ctaVariant="indigo"
            onCta={() => setShowAddForm(true)}
          />
        ) : null}

        {schedules.length > 0 ? (
          <div className="bg-secondary border border-primary rounded-xl shadow-sm overflow-hidden divide-y divide-primary">
            {schedules.map(entry => {
              const isExpanded = expanded === entry.name;
              const prompt = actionPrompt(entry.definition.action);
              const fromConfig = entry.source === "config";
              return (
                <div key={entry.name} className="px-4 py-3 hover:bg-hover/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : entry.name)}
                      className="mt-0.5 p-0.5 text-muted hover:text-primary rounded focus-ring cursor-pointer shrink-0"
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-sm font-medium text-primary truncate">{entry.name}</span>
                        <StatusBadge status={entry.state} statuses={STATE_BADGES} variant="inline" />
                        {fromConfig ? <span className="text-[10px] uppercase tracking-wide text-muted border border-primary rounded px-1">config</span> : null}
                      </div>
                      <p className="text-xs text-primary/80 mb-0.5">{formatActionSummary(entry.definition.action, agentName)}</p>
                      {prompt ? (
                        <p className="text-xs text-muted mb-1.5" title={prompt}>
                          {isExpanded ? prompt : truncateMessage(prompt)}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted/90 mb-2">{formatScheduleSummary(entry.definition)}</p>
                      {entry.error ? <p className="text-xs text-red-600 dark:text-red-400 mb-2">{entry.error}</p> : null}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {entry.currentRun ? (
                          <span className="text-muted">
                            Started:{" "}
                            <span className="text-primary font-medium">
                              {formatScheduleTime(entry.currentRun.startTime)} ({formatRelativeTime(entry.currentRun.startTime)})
                            </span>
                            {entry.currentRun.jobId ? <JobLink jobId={entry.currentRun.jobId} className="ml-1" /> : null}
                          </span>
                        ) : (
                          <span className="text-muted">
                            Next:{" "}
                            <span className="text-primary font-medium" title={formatScheduleTime(entry.nextRunTime)}>
                              {entry.state === "paused"
                                ? "Paused"
                                : entry.state === "missed"
                                  ? "Missed, not run (the app was not running then)"
                                  : entry.state === "done" && entry.definition.at !== undefined
                                    ? "Done"
                                    : entry.nextRunTime
                                      ? `${formatScheduleTime(entry.nextRunTime)} (${formatRelativeTime(entry.nextRunTime)})`
                                      : "—"}
                            </span>
                          </span>
                        )}
                        <span className="text-muted">
                          Last:{" "}
                          <span className="text-primary font-medium" title={formatScheduleTime(entry.lastRunTime)}>
                            {entry.lastRunTime ? `${formatScheduleTime(entry.lastRunTime)} (${formatRelativeTime(entry.lastRunTime)})` : "Never"}
                          </span>
                        </span>
                      </div>
                      {isExpanded ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void act(`run:${entry.name}`, () => schedulerRPCClient.runSchedule({ name: entry.name }))}
                            disabled={entry.state === "running" || busy.has(`run:${entry.name}`)}
                            title={entry.state === "running" ? "Already running" : "Run it now, outside its timing"}
                            className={smallButton}
                          >
                            {busy.has(`run:${entry.name}`) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            Run now
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddForm(false);
                              paneLink(SCHEDULER_RUNS_VIEW_ID);
                            }}
                            className={smallButton}
                          >
                            <History className="w-3 h-3" />
                            View run history
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {entry.state === "done" || entry.state === "missed" ? null : (
                      <button
                        type="button"
                        onClick={() =>
                          void act(`toggle:${entry.name}`, () => schedulerRPCClient.setScheduleEnabled({ name: entry.name, enabled: !entry.enabled }))
                        }
                        disabled={busy.has(`toggle:${entry.name}`)}
                        className={iconButton}
                        aria-label={entry.enabled ? `Pause schedule ${entry.name}` : `Resume schedule ${entry.name}`}
                        title={entry.enabled ? "Pause (it stays, but does not fire until resumed)" : "Resume"}
                      >
                        {busy.has(`toggle:${entry.name}`) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : entry.enabled ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setEditing(entry.name);
                      }}
                      disabled={fromConfig}
                      className={iconButton}
                      aria-label={`Edit schedule ${entry.name}`}
                      title={fromConfig ? "Defined in config: edit it there" : "Edit schedule"}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove(entry.name)}
                      disabled={fromConfig || busy.has(`remove:${entry.name}`)}
                      className={cn(iconButton, "hover:text-red-500")}
                      aria-label={`Remove schedule ${entry.name}`}
                      title={fromConfig ? "Defined in config: remove it there" : "Remove schedule"}
                    >
                      {busy.has(`remove:${entry.name}`) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <ViewShell
      header={
        <ViewHeader
          title="Schedules"
          icon={<Timer className="w-4 h-4" />}
          iconGradient="from-indigo-500 to-violet-600"
          actions={[
            {
              key: "refresh",
              icon: <RefreshCw className={cn("w-4 h-4", schedulesQuery.isValidating && "animate-spin")} aria-label="Refresh" />,
              label: "Refresh",
              title: "Refresh",
              onClick: () => void refresh(),
            },
          ]}
        >
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowAddForm(v => !v);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg focus-ring cursor-pointer shadow-sm shrink-0"
            title="Add schedule (Cmd/Ctrl+N)"
          >
            <Plus className="w-3.5 h-3.5" />
            Add schedule
          </button>
        </ViewHeader>
      }
    >
      <div className="p-3 space-y-4">{body}</div>
      <ConfirmDialog />
    </ViewShell>
  );
}
