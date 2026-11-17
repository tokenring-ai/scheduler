import { schedulerRPCClient } from "@tokenring-ai/one-frontend/rpc.ts";
import { useEffect, useState } from "react";
import type { ScheduleTiming } from "../../schema.ts";

export type NextRunPreview =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; nextRunTime: number | null; error: string | null }
  | { state: "error"; error: string };

/**
 * Live "Next run" preview for a schedule being edited. The server computes it with the scheduler's
 * own getNextRunTime (moment-timezone stays out of the frontend bundle), as a new schedule would run.
 * Debounced; a stale response never overwrites a newer one.
 */
export function useNextRunPreview(timing: ScheduleTiming | null, delayMs = 300): NextRunPreview {
  const key = timing ? JSON.stringify(timing) : null;
  const [preview, setPreview] = useState<NextRunPreview>({ state: "idle" });

  useEffect(() => {
    if (!key) {
      setPreview({ state: "idle" });
      return;
    }
    let cancelled = false;
    setPreview(prev => (prev.state === "ready" ? prev : { state: "loading" }));
    const timer = setTimeout(() => {
      schedulerRPCClient
        .previewNextRun({ timing: JSON.parse(key) as ScheduleTiming })
        .then(result => {
          if (!cancelled) setPreview({ state: "ready", nextRunTime: result.nextRunTime, error: result.error });
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
