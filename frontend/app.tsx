import type { PluginFrontendContribution } from "@tokenring-ai/one-frontend/plugins/types.ts";
import { lazy } from "react";
import { SCHEDULER_PATH } from "./lib/paths.ts";
import manifest, { schedulerRunsViewManifest, schedulerTasksViewManifest } from "./manifest.ts";

/**
 * The Scheduler dashboard: the agent's scheduled tasks beside its run history.
 * Discovered by `frontend/src/plugins/registry.ts`.
 */
export default {
  ...manifest,
  views: [
    { ...schedulerTasksViewManifest, component: lazy(() => import("./views/SchedulerTasksView.tsx")) },
    { ...schedulerRunsViewManifest, component: lazy(() => import("./views/SchedulerRunsView.tsx")) },
  ],
  dashboards: [
    {
      ...manifest,
      routePath: SCHEDULER_PATH,
      defaultLayout: {
        kind: "row",
        sizes: [3, 2],
        children: [
          { kind: "panel", view: schedulerTasksViewManifest.id },
          { kind: "panel", view: schedulerRunsViewManifest.id },
        ],
      },
      documentTitle: () => "Scheduler",
    },
  ],
} satisfies PluginFrontendContribution;
