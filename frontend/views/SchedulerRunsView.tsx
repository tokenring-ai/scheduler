import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import ErrorState from "@tokenring-ai/one-frontend/components/ui/ErrorState.tsx";
import FilterTabs, { type FilterTabOption } from "@tokenring-ai/one-frontend/components/ui/FilterTabs.tsx";
import HistoryRunRow from "@tokenring-ai/one-frontend/components/ui/HistoryRunRow.tsx";
import LoadingState from "@tokenring-ai/one-frontend/components/ui/LoadingState.tsx";
import { toastManager } from "@tokenring-ai/one-frontend/components/ui/toast.tsx";
import ViewHeader from "@tokenring-ai/one-frontend/components/ui/ViewHeader.tsx";
import ViewShell from "@tokenring-ai/one-frontend/components/ui/ViewShell.tsx";
import { useAsyncActionGuard } from "@tokenring-ai/one-frontend/hooks/useAsyncActionGuard.ts";
import { useConfirmDialog } from "@tokenring-ai/one-frontend/hooks/useConfirmDialog.tsx";
import { useTick } from "@tokenring-ai/one-frontend/hooks/useTick.ts";
import { schedulerRPCClient, useSchedulerHistory } from "@tokenring-ai/one-frontend/rpc.ts";
import { Select } from "@tokenring-ai/one-frontend/ui";
import formatError from "@tokenring-ai/utility/error/formatError";
import { Eraser, History, RefreshCw, Search, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSchedulerAgentSession } from "../features/scheduler/useSchedulerAgentSession.ts";

type HistoryStatusFilter = "all" | "completed" | "failed";

const STATUS_FILTERS: FilterTabOption<HistoryStatusFilter>[] = [
  { id: "all", label: "All statuses" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

/**
 * Run history for the selected agent, filterable by task and status. The
 * agent is the one selected by the Scheduler views (shared selection): the
 * Tasks panel's "View run history" action lands here.
 */
export default function SchedulerRunsView() {
  const session = useSchedulerAgentSession();
  const { agentId: selectedAgentId, agent: selectedAgent, agents, isLoading: agentsLoading } = session;

  const [historyTaskFilter, setHistoryTaskFilter] = useState<string>("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatusFilter>("all");

  // Drop agent-scoped filters when the selected agent changes
  useEffect(() => {
    setHistoryTaskFilter("");
    setHistoryStatusFilter("all");
  }, [selectedAgentId]);

  const historyQuery = useSchedulerHistory(selectedAgentId ?? undefined);
  const { openConfirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const { activeKey: busyAction, execute: executeBusy } = useAsyncActionGuard();

  /** Clears the task picked in the task filter, or every task's history when none is picked. */
  const handleClearHistory = async () => {
    if (!selectedAgentId) return;
    const taskName = historyTaskFilter || undefined;
    const confirmed = await openConfirm({
      title: "Clear run history",
      message: taskName
        ? `Clear the run history of "${taskName}"? This cannot be undone.`
        : "Clear the run history of every task on this agent? This cannot be undone.",
      confirmText: "Clear history",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    await executeBusy("clear", async () => {
      try {
        const result = await schedulerRPCClient.clearHistory(taskName ? { agentId: selectedAgentId, taskName } : { agentId: selectedAgentId });
        if (result.status === "agentNotFound") {
          toastManager.error("Agent no longer exists", { duration: 4000 });
          return;
        }
        toastManager.success(result.message, { duration: 2500 });
        if (taskName) setHistoryTaskFilter("");
        await historyQuery.mutate();
      } catch (err) {
        toastManager.error(formatError(err), { duration: 5000 });
      }
    });
  };

  const historyEntries = useMemo(() => {
    const history = historyQuery.data?.history ?? {};
    return Object.entries(history)
      .flatMap(([taskName, runs]) =>
        runs.map(run => ({
          taskName,
          ...run,
        })),
      )
      .sort((a, b) => b.startTime - a.startTime);
  }, [historyQuery.data]);

  const filteredHistory = useMemo(() => {
    return historyEntries.filter(run => {
      if (historyTaskFilter && run.taskName !== historyTaskFilter) return false;
      if (historyStatusFilter !== "all" && run.status !== historyStatusFilter) return false;
      return true;
    });
  }, [historyEntries, historyTaskFilter, historyStatusFilter]);

  const historyTaskNames = useMemo(() => {
    const names = new Set(historyEntries.map(r => r.taskName));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [historyEntries]);

  // Refresh relative-time labels while there is history to show
  useTick(15_000, historyEntries.length > 0);

  let body: React.ReactNode;
  if (agentsLoading && agents.length === 0) {
    body = <LoadingState size="md" className="py-12" />;
  } else if (!selectedAgentId) {
    body = <EmptyState variant="card" icon={User} title="No agent selected" hint="Select an agent to see its run history, or pick one in the Tasks view." />;
  } else if (historyQuery.isLoading && !historyQuery.data) {
    body = <LoadingState size="md" className="py-12" />;
  } else if (historyQuery.error && !historyQuery.data) {
    body = <ErrorState title="Unable to load history" error={historyQuery.error} onRetry={() => void historyQuery.mutate()} variant="page" />;
  } else if (historyEntries.length === 0) {
    body = (
      <EmptyState
        variant="card"
        icon={History}
        title="No runs yet"
        hint="Completed and failed runs appear here. The most recent runs of each task are saved with the agent."
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        <FilterTabs tabs={STATUS_FILTERS} value={historyStatusFilter} onChange={setHistoryStatusFilter} tabClassName="flex-none px-3" />
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <Select label="Task" value={historyTaskFilter} onChange={setHistoryTaskFilter} className="flex-1" aria-label="Filter history by task">
            <option value="">All tasks</option>
            {historyTaskNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          {historyTaskFilter || historyStatusFilter !== "all" ? (
            <button
              type="button"
              onClick={() => {
                setHistoryTaskFilter("");
                setHistoryStatusFilter("all");
              }}
              className="px-3 py-2 text-xs text-muted hover:text-primary border border-primary rounded-lg focus-ring cursor-pointer sm:mb-0"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {filteredHistory.length === 0 ? (
          <EmptyState variant="card" icon={Search} title="No matching runs" hint="Try a different task or status filter." />
        ) : (
          <div className="bg-secondary border border-primary rounded-xl shadow-sm overflow-hidden divide-y divide-primary">
            {filteredHistory.map((run, idx) => (
              <HistoryRunRow
                key={`${run.taskName}-${run.startTime}-${idx}`}
                id={`${run.taskName}-${run.startTime}-${idx}`}
                entityName={run.taskName}
                onEntityClick={() => setHistoryTaskFilter(run.taskName)}
                status={run.status === "completed" ? "completed" : "failed"}
                startTime={run.startTime}
                endTime={run.endTime}
                message={run.message}
                timestampOptions={{ weekday: true }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <ViewShell
      header={
        <ViewHeader
          title="Runs"
          subtitle={selectedAgent ? selectedAgent.displayName : undefined}
          icon={<History className="w-4 h-4" />}
          iconGradient="from-indigo-500 to-violet-600"
          middle={
            agents.length > 1 ? (
              <select
                value={selectedAgentId ?? ""}
                onChange={e => session.selectAgent(e.target.value)}
                className="max-w-48 bg-input border border-primary rounded-lg px-2 py-1 text-xs text-primary focus-accent"
                aria-label="Agent"
              >
                {agents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            ) : undefined
          }
          actions={[
            {
              key: "refresh",
              icon: <RefreshCw className={`w-4 h-4 ${historyQuery.isValidating ? "animate-spin" : ""}`} />,
              label: "Refresh",
              title: "Refresh",
              onClick: () => void historyQuery.mutate(),
            },
            {
              key: "clear",
              icon: <Eraser className="w-4 h-4" />,
              label: historyTaskFilter ? `Clear history of ${historyTaskFilter}` : "Clear history",
              title: historyTaskFilter ? `Clear the run history of "${historyTaskFilter}"` : "Clear run history",
              onClick: () => void handleClearHistory(),
              disabled: !selectedAgentId || historyEntries.length === 0 || busyAction === "clear",
            },
          ]}
        />
      }
    >
      <div className="p-3">{body}</div>
      <ConfirmDialog />
    </ViewShell>
  );
}
