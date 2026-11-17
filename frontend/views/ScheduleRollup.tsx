import { type RollupDays, RollupWindowSelect } from "@tokenring-ai/one-frontend/apps/agents/JobRollup.tsx";
import RollupList from "@tokenring-ai/one-frontend/apps/agents/RollupList.tsx";
import { useJobRollup } from "@tokenring-ai/one-frontend/rpc.ts";

/** Per-schedule runs, outcomes and spend for a window, with a total row. Picking a schedule filters the runs below. */
export default function ScheduleRollup({
  days,
  onDaysChange,
  onSelectSchedule,
}: {
  days: RollupDays;
  onDaysChange: (days: RollupDays) => void;
  onSelectSchedule: (name: string) => void;
}) {
  const query = useJobRollup({ days, groupBy: "schedule" });
  const data = query.data;
  return (
    <section aria-label="Schedule spend and outcomes" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-primary">Spend and outcomes</h2>
        <RollupWindowSelect days={days} onChange={onDaysChange} />
      </div>
      {!data ? (
        <p className="text-xs text-muted">{query.error ? "Could not load the summary." : "Loading summary…"}</p>
      ) : data.rows.length === 0 ? (
        <p className="text-xs text-muted">No schedule has run an agent job in this window.</p>
      ) : (
        <>
          <RollupList rows={data.rows} totals={data.totals} label="Schedules" owner="scheduler" itemAttribute="data-schedule" onSelect={onSelectSchedule} />
          {data.truncated && <p className="text-xs text-muted">Only the newest 1000 jobs are kept, so older runs in this window are not counted.</p>}
        </>
      )}
    </section>
  );
}
