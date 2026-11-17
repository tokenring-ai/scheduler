import { JobLink } from "@tokenring-ai/one-frontend/apps/agents/JobLink.tsx";
import { JobRefusalBadge } from "@tokenring-ai/one-frontend/apps/agents/JobRefusals.tsx";
import type { RollupDays } from "@tokenring-ai/one-frontend/apps/agents/JobRollup.tsx";
import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import ErrorState from "@tokenring-ai/one-frontend/components/ui/ErrorState.tsx";
import FilterTabs, { type FilterTabOption } from "@tokenring-ai/one-frontend/components/ui/FilterTabs.tsx";
import HistoryRunRow, { type HistoryRunStatus } from "@tokenring-ai/one-frontend/components/ui/HistoryRunRow.tsx";
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
import { Eraser, History, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MISSED_RUN_MESSAGE, type ScheduleRunStatus } from "../../schema.ts";
import ScheduleRollup from "./ScheduleRollup.tsx";

type HistoryStatusFilter = "all" | "completed" | "failed" | "other";

const STATUS_FILTERS: FilterTabOption<HistoryStatusFilter>[] = [
  { id: "all", label: "All statuses" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "other", label: "Cancelled / interrupted" },
];

const ROW_STATUS: Record<ScheduleRunStatus, { status: HistoryRunStatus; label?: string }> = {
  completed: { status: "completed" },
  failed: { status: "failed" },
  cancelled: { status: "cancelled" },
  interrupted: { status: "custom", label: "Interrupted" },
  running: { status: "custom", label: "Running" },
};

function matchesFilter(status: ScheduleRunStatus, filter: HistoryStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "other") return status === "cancelled" || status === "interrupted";
  return status === filter;
}

/** Run history of every schedule, filterable by schedule and status. The Schedules view's "View run history" lands here. */
export default function SchedulerRunsView() {
  const [scheduleFilter, setScheduleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>("all");
  const [rollupDays, setRollupDays] = useState<RollupDays>(7);

  const historyQuery = useSchedulerHistory();
  const { openConfirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const { activeKey: busyAction, execute: executeBusy } = useAsyncActionGuard();

  /** Clears the schedule picked in the filter, or every schedule's history when none is picked. */
  const handleClearHistory = async () => {
    const name = scheduleFilter || undefined;
    const confirmed = await openConfirm({
      title: "Clear run history",
      message: name ? `Clear the run history of "${name}"? This cannot be undone.` : "Clear the run history of every schedule? This cannot be undone.",
      confirmText: "Clear history",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    await executeBusy("clear", async () => {
      try {
        const result = await schedulerRPCClient.clearHistory(name ? { name } : {});
        toastManager.success(result.message, { duration: 2500 });
        if (name) setScheduleFilter("");
        await historyQuery.mutate();
      } catch (err) {
        toastManager.error(formatError(err), { duration: 5000 });
      }
    });
  };

  const runs = useMemo(() => {
    const history = historyQuery.data?.history ?? {};
    return Object.entries(history)
      .flatMap(([name, entries]) => entries.map(run => ({ name, ...run })))
      .sort((a, b) => b.startTime - a.startTime);
  }, [historyQuery.data]);

  const filtered = useMemo(
    () => runs.filter(run => (!scheduleFilter || run.name === scheduleFilter) && matchesFilter(run.status, statusFilter)),
    [runs, scheduleFilter, statusFilter],
  );

  const names = useMemo(() => [...new Set(runs.map(r => r.name))].sort((a, b) => a.localeCompare(b)), [runs]);

  // Refresh relative-time labels while there is history to show
  useTick(15_000, runs.length > 0);

  let body: React.ReactNode;
  if (historyQuery.isLoading && !historyQuery.data) {
    body = <LoadingState size="md" className="py-12" />;
  } else if (historyQuery.error && !historyQuery.data) {
    body = <ErrorState title="Unable to load history" error={historyQuery.error} onRetry={() => void historyQuery.mutate()} variant="page" />;
  } else if (runs.length === 0) {
    body = <EmptyState variant="card" icon={History} title="No runs yet" hint="Each run of a schedule appears here, linked to the agent job it started." />;
  } else {
    body = (
      <div className="space-y-3">
        <FilterTabs tabs={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} tabClassName="flex-none px-3" />
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <Select label="Schedule" value={scheduleFilter} onChange={setScheduleFilter} className="flex-1" aria-label="Filter history by schedule">
            <option value="">All schedules</option>
            {names.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          {scheduleFilter || statusFilter !== "all" ? (
            <button
              type="button"
              onClick={() => {
                setScheduleFilter("");
                setStatusFilter("all");
              }}
              className="px-3 py-2 text-xs text-muted hover:text-primary border border-primary rounded-lg focus-ring cursor-pointer sm:mb-0"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {filtered.length === 0 ? (
          <EmptyState variant="card" icon={Search} title="No matching runs" hint="Try a different schedule or status filter." />
        ) : (
          <div className="bg-secondary border border-primary rounded-xl shadow-sm overflow-hidden divide-y divide-primary">
            {filtered.map(run => {
              const row = run.message === MISSED_RUN_MESSAGE ? { status: "custom" as const, label: "Missed, not run" } : ROW_STATUS[run.status];
              const details = run.manual ? "Run now" : null;
              return (
                <HistoryRunRow
                  key={run.id}
                  id={run.id}
                  entityName={run.name}
                  onEntityClick={() => setScheduleFilter(run.name)}
                  status={row.status}
                  statusLabel={row.label}
                  startTime={run.startTime}
                  endTime={run.endTime ?? undefined}
                  message={run.message}
                  timestampOptions={{ weekday: true }}
                >
                  {details || run.jobId ? (
                    <p className="text-[11px] text-muted mt-1 flex items-center gap-2">
                      {details}
                      {run.jobId ? <JobLink jobId={run.jobId} /> : null}
                      {run.jobId ? <JobRefusalBadge jobId={run.jobId} /> : null}
                    </p>
                  ) : null}
                </HistoryRunRow>
              );
            })}
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
          icon={<History className="w-4 h-4" />}
          iconGradient="from-indigo-500 to-violet-600"
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
              label: scheduleFilter ? `Clear history of ${scheduleFilter}` : "Clear history",
              title: scheduleFilter ? `Clear the run history of "${scheduleFilter}"` : "Clear run history",
              onClick: () => void handleClearHistory(),
              disabled: runs.length === 0 || busyAction === "clear",
            },
          ]}
        />
      }
    >
      <div className="p-3 space-y-4">
        <ScheduleRollup days={rollupDays} onDaysChange={setRollupDays} onSelectSchedule={setScheduleFilter} />
        {body}
      </div>
      <ConfirmDialog />
    </ViewShell>
  );
}
