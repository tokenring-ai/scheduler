import { schedulerRPCClient } from "@tokenring-ai/one-frontend/rpc.ts";
import { useEffect, useState } from "react";
import type { ScheduledTaskInput } from "../features/scheduler/taskForm.ts";

export type NextRunPreview = { state: "idle" } | { state: "loading" } | { state: "ready"; nextRunTime: number | null } | { state: "error"; error: string };

/**
 * Live "Next run" preview for a task being edited. The server computes it
 * with the scheduler's own getNextRunTime (moment-timezone stays out of the
 * frontend bundle). Debounced; a stale response never overwrites a newer one.
 */
export function useNextRunPreview(task: ScheduledTaskInput | null, delayMs = 300): NextRunPreview {
  const key = task ? JSON.stringify(task) : null;
  const [preview, setPreview] = useState<NextRunPreview>({ state: "idle" });

  useEffect(() => {
    if (!key) {
      setPreview({ state: "idle" });
      return;
    }
    let cancelled = false;
    setPreview(prev => (prev.state === "ready" ? prev : { state: "loading" }));
    const timer = setTimeout(() => {
      // Preview the schedule as if the task were enabled; the form says when it is paused.
      const { enabled: _enabled, ...rest } = JSON.parse(key) as ScheduledTaskInput;
      schedulerRPCClient
        .previewNextRun({ task: rest })
        .then(result => {
          if (!cancelled) setPreview({ state: "ready", nextRunTime: result.nextRunTime });
        })
        .catch((err: unknown) => {
          if (!cancelled) setPreview({ state: "error", error: err instanceof Error ? err.message : String(err) });
        });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, delayMs]);

  return preview;
}
