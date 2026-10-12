import { type UseAppAgentSessionResult, useAppAgentSession } from "@tokenring-ai/one-frontend/hooks/useAppAgentSession.tsx";
import { useAgentTypes } from "@tokenring-ai/one-frontend/rpc.ts";
import { useMemo } from "react";

/** Persisted selection key shared by every Scheduler surface. */
export const SCHEDULER_STORAGE_KEY = "scheduler";

/**
 * The agent whose schedule the Scheduler views operate on.
 *
 * Both views call this hook with the same storage key, so they stay in step:
 * selecting an agent in Tasks selects it in Runs and vice versa. Agent types
 * are ordered so a new agent defaults to an interactive coding agent, like the
 * old dashboard's create-agent preference.
 */
export function useSchedulerAgentSession(): UseAppAgentSessionResult {
  const agentTypes = useAgentTypes();
  const orderedTypes = useMemo(() => {
    const types = agentTypes.data ?? [];
    if (types.length === 0) return ["code"];
    const preferred = types.find(t => t.type === "code") ?? types.find(t => t.category?.toLowerCase().includes("interactive")) ?? types[0]!;
    return [preferred.type, ...types.map(t => t.type).filter(type => type !== preferred.type)];
  }, [agentTypes.data]);

  return useAppAgentSession({
    appName: "Scheduler",
    storageKey: SCHEDULER_STORAGE_KEY,
    agentTypes: orderedTypes,
  });
}
