import AgentSessionList from "@tokenring-ai/one-frontend/components/AgentSessionList.tsx";
import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import ErrorState from "@tokenring-ai/one-frontend/components/ui/ErrorState.tsx";
import LoadingState from "@tokenring-ai/one-frontend/components/ui/LoadingState.tsx";
import SectionLabel from "@tokenring-ai/one-frontend/components/ui/SectionLabel.tsx";
import StatusBadge, { type StatusBadgeDefinition } from "@tokenring-ai/one-frontend/components/ui/StatusBadge.tsx";
import SummaryStat from "@tokenring-ai/one-frontend/components/ui/SummaryStat.tsx";
import { toastManager } from "@tokenring-ai/one-frontend/components/ui/toast.tsx";
import ViewHeader from "@tokenring-ai/one-frontend/components/ui/ViewHeader.tsx";
import ViewShell from "@tokenring-ai/one-frontend/components/ui/ViewShell.tsx";
import { useDashboardApi } from "@tokenring-ai/one-frontend/dock/DashboardApiContext.tsx";
import { openInMainArea } from "@tokenring-ai/one-frontend/dock/layout/mainArea.ts";
import { usePanel } from "@tokenring-ai/one-frontend/dock/PanelContext.tsx";
import { useAgentChatPanel } from "@tokenring-ai/one-frontend/dock/useAgentChatPanel.ts";
import { useOpenAgentChat } from "@tokenring-ai/one-frontend/dock/useOpenAgentChat.ts";
import type { UseAppAgentSessionResult } from "@tokenring-ai/one-frontend/hooks/useAppAgentSession.tsx";
import { useAsyncActionGuard } from "@tokenring-ai/one-frontend/hooks/useAsyncActionGuard.ts";
import { useConfirmDialog } from "@tokenring-ai/one-frontend/hooks/useConfirmDialog.tsx";
import { useKeyboardShortcuts } from "@tokenring-ai/one-frontend/hooks/useKeyboardShortcuts.ts";
import { useTick } from "@tokenring-ai/one-frontend/hooks/useTick.ts";
import { cn } from "@tokenring-ai/one-frontend/lib/utils.ts";
import { schedulerRPCClient, useSchedulerStatus, useSchedulerTasks } from "@tokenring-ai/one-frontend/rpc.ts";
import formatError from "@tokenring-ai/utility/error/formatError";
import {
  Activity,
  AlertCircle,
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
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AddTaskForm from "../features/scheduler/AddTaskForm.tsx";
import { formatRelativeTime, formatScheduleSummary, formatScheduleTime, truncateMessage } from "../features/scheduler/formatters.ts";
import { useSchedulerAgentSession } from "../features/scheduler/useSchedulerAgentSession.ts";
import { SCHEDULER_DASHBOARD_ID, SCHEDULER_RUNS_VIEW_ID } from "../manifest.ts";

type TaskRunStatus = "pending" | "running" | "idle" | "paused";

const SCHEDULER_STATUS_BADGES: Record<"enabled" | "disabled" | "unknown", StatusBadgeDefinition> = {
  enabled: {
    label: "Scheduler enabled",
    dotColor: "bg-emerald-500",
    pulse: true,
    colorClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  disabled: {
    label: "Scheduler disabled",
    icon: <Pause className="w-3 h-3" />,
    colorClass: "bg-tertiary text-muted border-primary",
  },
  unknown: {
    label: "Scheduler status unknown",
    icon: <AlertCircle className="w-3 h-3" />,
    colorClass: "bg-tertiary text-muted border-primary",
  },
};

const TASK_STATUS_BADGES: Record<TaskRunStatus, StatusBadgeDefinition> = {
  running: {
    label: "Running",
    icon: <Activity className="w-3 h-3 animate-pulse" />,
    colorClass: "text-amber-600 dark:text-amber-400",
  },
  pending: {
    label: "Pending",
    icon: <Clock className="w-3 h-3" />,
    colorClass: "text-indigo-600 dark:text-indigo-400",
  },
  idle: {
    label: "Not scheduled",
    icon: <Pause className="w-3 h-3" />,
    colorClass: "text-muted",
  },
  paused: {
    label: "Paused",
    icon: <CirclePause className="w-3 h-3" />,
    colorClass: "text-muted",
  },
};

/** The agent sessions this view can attach to; keeps the chat panel docked beside the tasks. */
function SchedulerAgentSessions({ session }: { session: UseAppAgentSessionResult }) {
  const { agents, agentId, isLoading, selectAgent, createAgent, terminateAgent, TerminateDialog } = session;
  return (
    <>
      <AgentSessionList
        agents={agents}
        selectedAgentId={agentId}
        isLoading={isLoading}
        storageKey="scheduler"
        label="Scheduler agents"
        onSelect={selectAgent}
        onCreate={() => void createAgent()}
        onTerminate={id => void terminateAgent(id)}
      />
      <TerminateDialog />
    </>
  );
}

/**
 * Scheduled tasks for the selected agent: next runs, scheduler start/stop and
 * the add-task form. Docked beside the Runs view on the Scheduler dashboard;
 * standalone elsewhere.
 */
export default function SchedulerTasksView() {
  const panel = usePanel();
  const dashboard = useDashboardApi();
  const openAgentChat = useOpenAgentChat();
  const session = useSchedulerAgentSession();
  useAgentChatPanel({ agentId: session.agentId });

  const { agentId: selectedAgentId, agent: selectedAgent, agents, isLoading: agentsLoading, isCreating } = session;
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const { openConfirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const { activeKey: busyAction, execute: executeBusy } = useAsyncActionGuard();

  const tasksQuery = useSchedulerTasks(selectedAgentId ?? undefined);
  const statusQuery = useSchedulerStatus(selectedAgentId ?? undefined);

  // Drop agent-scoped UI state when the selected agent changes
  useEffect(() => {
    setShowAddForm(false);
    setExpandedTask(null);
    setEditingTask(null);
  }, [selectedAgentId]);

  const taskEntries = useMemo(() => {
    const tasks = tasksQuery.data?.tasks ?? {};
    const executions = statusQuery.data?.executions ?? {};
    return Object.entries(tasks)
      .map(([name, task]) => {
        const exec = executions[name];
        // A paused task can still be finishing a run it started before the pause.
        const status: TaskRunStatus = exec?.status === "running" ? "running" : task.enabled === false ? "paused" : (exec?.status ?? "idle");
        return {
          name,
          task,
          status,
          nextRunTime: exec?.nextRunTime ?? null,
          startTime: exec?.startTime,
        };
      })
      .sort((a, b) => {
        // Running first, then soonest next run
        if (a.status === "running" && b.status !== "running") return -1;
        if (b.status === "running" && a.status !== "running") return 1;
        const an = a.nextRunTime ?? Number.POSITIVE_INFINITY;
        const bn = b.nextRunTime ?? Number.POSITIVE_INFINITY;
        return an - bn;
      });
  }, [tasksQuery.data, statusQuery.data]);

  const editingEntry = editingTask ? taskEntries.find(t => t.name === editingTask) : undefined;
  const taskCount = taskEntries.length;
  const runningTaskCount = taskEntries.filter(t => t.status === "running").length;
  const schedulerRunning = statusQuery.data?.running ?? false;
  // Without status data (load failed or still loading) we cannot claim the scheduler is disabled.
  const statusKnown = statusQuery.data != null;
  const autoStart = statusQuery.data?.autoStart ?? false;

  // Refresh relative-time labels while there is upcoming or active work
  useTick(15_000, runningTaskCount > 0 || taskEntries.some(t => t.nextRunTime != null));

  // Cmd/Ctrl+N opens the add-task form while this panel is in focus.
  useKeyboardShortcuts([
    {
      key: "n",
      handler: () => {
        setEditingTask(null);
        setShowAddForm(true);
      },
      enabled: panel.dashboardId === SCHEDULER_DASHBOARD_ID && panel.isActive && !showAddForm && Boolean(selectedAgentId),
    },
  ]);

  const refreshAll = async () => {
    await Promise.all([tasksQuery.mutate(), statusQuery.mutate()]);
  };

  const handleStartStop = async () => {
    if (!selectedAgentId || !statusKnown) return;
    const action = schedulerRunning ? "stop" : "start";
    if (schedulerRunning && runningTaskCount > 0) {
      const confirmed = await openConfirm({
        title: "Disable scheduler",
        message:
          runningTaskCount === 1
            ? "1 task is running right now. Disabling the scheduler aborts it. Disable anyway?"
            : `${runningTaskCount} tasks are running right now. Disabling the scheduler aborts them. Disable anyway?`,
        confirmText: "Disable and abort",
        cancelText: "Cancel",
        variant: "danger",
      });
      if (!confirmed) return;
    }
    await executeBusy(action, async () => {
      try {
        const result = schedulerRunning
          ? await schedulerRPCClient.stopScheduler({ agentId: selectedAgentId })
          : await schedulerRPCClient.startScheduler({ agentId: selectedAgentId });
        if (result.status === "agentNotFound") {
          toastManager.error("Agent no longer exists", { duration: 4000 });
          return;
        }
        toastManager.success(result.message, { duration: 2500 });
        await Promise.all([statusQuery.mutate(), tasksQuery.mutate()]);
      } catch (err) {
        toastManager.error(formatError(err), { duration: 5000 });
      }
    });
  };

  const handleRemove = async (agentId: string, name: string) => {
    const confirmed = await openConfirm({
      title: "Remove scheduled task",
      message: `Remove "${name}" from this agent's schedule? This cannot be undone.`,
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    await executeBusy(`remove:${name}`, async () => {
      try {
        const result = await schedulerRPCClient.removeTask({ agentId, name });
        if (result.status === "agentNotFound") {
          toastManager.error("Agent no longer exists", { duration: 4000 });
          return;
        }
        toastManager.success(result.message, { duration: 2500 });
        if (expandedTask === name) setExpandedTask(null);
        if (editingTask === name) setEditingTask(null);
        await refreshAll();
      } catch (err) {
        toastManager.error(formatError(err), { duration: 5000 });
      }
    });
  };

  const handleToggleEnabled = async (agentId: string, name: string, enabled: boolean) => {
    await executeBusy(`toggle:${name}`, async () => {
      try {
        const result = await schedulerRPCClient.setTaskEnabled({ agentId, name, enabled });
        if (result.status === "agentNotFound") {
          toastManager.error("Agent no longer exists", { duration: 4000 });
          return;
        }
        toastManager.success(result.message, { duration: 2500 });
        await refreshAll();
      } catch (err) {
        toastManager.error(formatError(err), { duration: 5000 });
      }
    });
  };

  const startEditing = (name: string) => {
    setShowAddForm(false);
    setEditingTask(name);
  };

  const handleRunNow = async (agentId: string, name: string) => {
    await executeBusy(`run:${name}`, async () => {
      try {
        const result = await schedulerRPCClient.runTask({ agentId, name });
        if (result.status === "agentNotFound") {
          toastManager.error("Agent no longer exists", { duration: 4000 });
          return;
        }
        toastManager.success(result.message, { duration: 2500 });
        await refreshAll();
      } catch (err) {
        toastManager.error(formatError(err), { duration: 5000 });
      }
    });
  };

  const openRunHistory = () => {
    setShowAddForm(false);
    openInMainArea(dashboard, SCHEDULER_RUNS_VIEW_ID, {}, { sidebarViews: [] });
  };

  const isLoadingAgentData = Boolean(selectedAgentId) && (tasksQuery.isLoading || statusQuery.isLoading) && !tasksQuery.data;

  let body: React.ReactNode;
  if (agentsLoading && agents.length === 0) {
    body = <LoadingState size="md" className="py-12" />;
  } else if (agents.length === 0) {
    body = (
      <EmptyState
        variant="card"
        icon={Timer}
        title="No agents available"
        hint="Scheduled tasks run on a specific agent. Create an agent first, then add recurring prompts."
        ctaLabel="Create agent"
        ctaIcon={User}
        ctaVariant="indigo"
        ctaLoading={isCreating}
        onCta={() => void session.createAgent()}
      />
    );
  } else {
    body = (
      <>
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryStat
            label="Tasks"
            value={String(taskCount)}
            sub={selectedAgent ? selectedAgent.displayName : "Select an agent"}
            icon={<Timer className="w-4 h-4" />}
            accentClass="text-indigo-500"
            iconPosition="right"
          />
          <SummaryStat
            label="Scheduler"
            value={!statusKnown ? "Unknown" : schedulerRunning ? "Enabled" : "Disabled"}
            sub={!statusKnown ? "Status unavailable" : autoStart ? "Starts when tasks are added" : "Starts only when enabled"}
            icon={schedulerRunning ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            accentClass={schedulerRunning ? "text-emerald-500" : "text-muted"}
            iconPosition="right"
          />
          <SummaryStat
            label="Running now"
            value={String(runningTaskCount)}
            sub={runningTaskCount === 1 ? "1 task executing" : `${runningTaskCount} tasks executing`}
            icon={<Activity className="w-4 h-4" />}
            accentClass="text-amber-500"
            iconPosition="right"
          />
        </div>

        {/* Scheduler controls */}
        <div className="bg-secondary border border-primary rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0">
              <SectionLabel>Agent</SectionLabel>
              <p className="text-xs text-primary truncate" title={selectedAgent ? `${selectedAgent.displayName} — ${selectedAgent.agentType}` : undefined}>
                {selectedAgent ? `${selectedAgent.displayName} — ${selectedAgent.agentType}` : "Select an agent below"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={!statusKnown ? "unknown" : schedulerRunning ? "enabled" : "disabled"} statuses={SCHEDULER_STATUS_BADGES} gap="md" />
              <button
                type="button"
                disabled={!selectedAgentId || !statusKnown || busyAction === "start" || busyAction === "stop" || (!schedulerRunning && taskCount === 0)}
                onClick={() => void handleStartStop()}
                title={
                  !schedulerRunning && taskCount === 0
                    ? "Add a task before enabling the scheduler"
                    : schedulerRunning
                      ? "Disable scheduler (pause all tasks)"
                      : "Enable scheduler so pending tasks can fire"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg focus-ring cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
                  schedulerRunning
                    ? "bg-tertiary border border-primary text-primary hover:bg-hover"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm",
                )}
              >
                {busyAction === "start" || busyAction === "stop" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : schedulerRunning ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                {schedulerRunning ? "Disable" : "Enable"}
              </button>
              {selectedAgentId ? (
                <button
                  type="button"
                  onClick={() => openAgentChat(selectedAgentId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-primary border border-primary rounded-lg focus-ring cursor-pointer"
                >
                  Open chat
                </button>
              ) : null}
            </div>
          </div>

          {statusQuery.error && !statusQuery.data ? (
            <ErrorState title="Unable to load scheduler status" error={statusQuery.error} onRetry={() => void statusQuery.mutate()} variant="inline" />
          ) : null}

          {statusKnown && !schedulerRunning && taskCount > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {autoStart
                ? "Scheduler is disabled. Tasks will not fire until you enable it; adding a task also starts it."
                : "Scheduler is disabled. Tasks will not fire until you enable it."}
            </p>
          ) : null}
        </div>

        {isLoadingAgentData ? (
          <LoadingState size="md" className="py-12" />
        ) : tasksQuery.error && !tasksQuery.data ? (
          <ErrorState title="Unable to load schedule" error={tasksQuery.error} onRetry={() => void refreshAll()} variant="page" />
        ) : (
          <>
            {showAddForm && selectedAgentId ? (
              <AddTaskForm
                agentId={selectedAgentId}
                existingNames={taskEntries.map(t => t.name)}
                onCancel={() => setShowAddForm(false)}
                onCreated={() => {
                  setShowAddForm(false);
                  void refreshAll();
                }}
              />
            ) : null}

            {editingEntry && selectedAgentId ? (
              <AddTaskForm
                key={`edit:${editingEntry.name}`}
                agentId={selectedAgentId}
                existingNames={taskEntries.map(t => t.name)}
                editing={{ name: editingEntry.name, task: editingEntry.task }}
                onCancel={() => setEditingTask(null)}
                onCreated={() => {
                  setEditingTask(null);
                  void refreshAll();
                }}
              />
            ) : null}

            {taskEntries.length === 0 && !showAddForm ? (
              <EmptyState
                variant="card"
                icon={Clock}
                title="No scheduled tasks"
                hint="Add a recurring prompt—health checks, daily briefs, cleanup, monitoring—to this agent."
                ctaLabel="Add your first task"
                ctaVariant="indigo"
                onCta={() => setShowAddForm(true)}
              />
            ) : null}

            {taskEntries.length > 0 ? (
              <div className="bg-secondary border border-primary rounded-xl shadow-sm overflow-hidden divide-y divide-primary">
                {taskEntries.map(entry => {
                  const isExpanded = expandedTask === entry.name;
                  return (
                    <div key={entry.name} className="px-4 py-3 hover:bg-hover/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedTask(isExpanded ? null : entry.name)}
                          className="mt-0.5 p-0.5 text-muted hover:text-primary rounded focus-ring cursor-pointer shrink-0"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-sm font-medium text-primary truncate">{entry.name}</span>
                            <StatusBadge status={entry.status} statuses={TASK_STATUS_BADGES} variant="inline" />
                          </div>
                          <p className="text-xs text-muted mb-1.5" title={entry.task.message}>
                            {isExpanded ? entry.task.message : truncateMessage(entry.task.message)}
                          </p>
                          <p className="text-xs text-muted/90 mb-2">{formatScheduleSummary(entry.task)}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            {entry.status === "running" ? (
                              <span className="text-muted">
                                Started:{" "}
                                <span className="text-primary font-medium" title={formatScheduleTime(entry.startTime)}>
                                  {entry.startTime ? `${formatScheduleTime(entry.startTime)} (${formatRelativeTime(entry.startTime)})` : "just now"}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted">
                                Next:{" "}
                                <span className="text-primary font-medium" title={formatScheduleTime(entry.nextRunTime)}>
                                  {entry.status === "paused"
                                    ? "Paused"
                                    : entry.nextRunTime
                                      ? `${formatScheduleTime(entry.nextRunTime)} (${formatRelativeTime(entry.nextRunTime)})`
                                      : "—"}
                                </span>
                              </span>
                            )}
                            <span className="text-muted">
                              Last:{" "}
                              <span className="text-primary font-medium" title={formatScheduleTime(entry.task.lastRunTime)}>
                                {entry.task.lastRunTime
                                  ? `${formatScheduleTime(entry.task.lastRunTime)} (${formatRelativeTime(entry.task.lastRunTime)})`
                                  : "Never"}
                              </span>
                            </span>
                          </div>
                          {isExpanded ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!selectedAgentId) return;
                                  void handleRunNow(selectedAgentId, entry.name);
                                }}
                                disabled={!selectedAgentId || entry.status === "running" || busyAction === `run:${entry.name}`}
                                title={entry.status === "running" ? "Task is already running" : "Run this task now, outside its schedule"}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-primary border border-primary rounded-md focus-ring cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {busyAction === `run:${entry.name}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                Run now
                              </button>
                              <button
                                type="button"
                                onClick={openRunHistory}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-primary border border-primary rounded-md focus-ring cursor-pointer"
                              >
                                <History className="w-3 h-3" />
                                View run history
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedAgentId) return;
                            void handleToggleEnabled(selectedAgentId, entry.name, entry.task.enabled === false);
                          }}
                          disabled={!selectedAgentId || busyAction === `toggle:${entry.name}`}
                          className="p-1.5 text-muted hover:text-primary transition-colors rounded-md focus-ring cursor-pointer disabled:opacity-50 shrink-0"
                          aria-label={entry.task.enabled === false ? `Resume task ${entry.name}` : `Pause task ${entry.name}`}
                          title={entry.task.enabled === false ? "Resume task" : "Pause task (the scheduler skips it until resumed)"}
                        >
                          {busyAction === `toggle:${entry.name}` ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : entry.task.enabled === false ? (
                            <Play className="w-3.5 h-3.5" />
                          ) : (
                            <Pause className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditing(entry.name)}
                          disabled={!selectedAgentId}
                          className="p-1.5 text-muted hover:text-primary transition-colors rounded-md focus-ring cursor-pointer disabled:opacity-50 shrink-0"
                          aria-label={`Edit task ${entry.name}`}
                          title="Edit task"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedAgentId) return;
                            void handleRemove(selectedAgentId, entry.name);
                          }}
                          disabled={!selectedAgentId || busyAction === `remove:${entry.name}`}
                          className="p-1.5 text-muted hover:text-red-500 transition-colors rounded-md focus-ring cursor-pointer disabled:opacity-50 shrink-0"
                          aria-label={`Remove task ${entry.name}`}
                          title="Remove task"
                        >
                          {busyAction === `remove:${entry.name}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <ViewShell
      header={
        <ViewHeader
          title="Tasks"
          subtitle={selectedAgent ? selectedAgent.displayName : undefined}
          icon={<Timer className="w-4 h-4" />}
          iconGradient="from-indigo-500 to-violet-600"
          actions={[
            {
              key: "refresh",
              icon: <RefreshCw className={cn("w-4 h-4", (tasksQuery.isValidating || statusQuery.isValidating) && "animate-spin")} aria-label="Refresh" />,
              label: "Refresh",
              title: "Refresh",
              onClick: () => void refreshAll(),
            },
          ]}
        >
          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setShowAddForm(v => !v);
            }}
            disabled={agents.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg focus-ring cursor-pointer shadow-sm shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Add task (Cmd/Ctrl+N)"
          >
            <Plus className="w-3.5 h-3.5" />
            Add task
          </button>
        </ViewHeader>
      }
    >
      <div className="p-3 space-y-4">
        {body}
        {agents.length > 0 && (
          <section className="border-t border-primary pt-1 -mx-3 -mb-3" aria-label="Scheduler agents">
            <SchedulerAgentSessions session={session} />
          </section>
        )}
      </div>
      <ConfirmDialog />
    </ViewShell>
  );
}
