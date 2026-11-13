import type { PluginLayoutManifest } from "@tokenring-ai/one-frontend/plugins/layoutTypes.ts";
import { Timer } from "lucide-react";
import { SCHEDULER_APP_ID, SCHEDULER_RUNS_KIND, SCHEDULER_RUNS_VIEW_ID, SCHEDULER_TASKS_KIND, SCHEDULER_TASKS_VIEW_ID } from "./ids.ts";
import { SCHEDULER_PATH } from "./lib/paths.ts";

/**
 * Scheduler: the selected agent's scheduled tasks beside its run history, with
 * the agent's chat attached on the right. Routes: `/scheduler` (tasks) and
 * `/scheduler/runs`.
 */
export const SCHEDULER_APP = {
  id: SCHEDULER_APP_ID,
  path: SCHEDULER_PATH,
  shortLabel: "SC",
  iconClass: "text-indigo-500",
  gradient: "from-indigo-500 to-violet-600",
  label: "Scheduler",
  description: "Schedule recurring agent tasks and monitor runs",
  icon: Timer,
  group: "Operate",
  views: [SCHEDULER_TASKS_VIEW_ID, SCHEDULER_RUNS_VIEW_ID, "chat"],
  primaryKind: SCHEDULER_TASKS_KIND,
  placement: { agent: "right" },
  layout: {
    split: "row",
    sizes: [3, 2],
    children: [
      { presenter: "tabs", accepts: [SCHEDULER_TASKS_KIND], items: [SCHEDULER_TASKS_VIEW_ID], primary: true },
      { presenter: "tabs", accepts: [SCHEDULER_RUNS_KIND], items: [SCHEDULER_RUNS_VIEW_ID] },
    ],
  },
} satisfies PluginLayoutManifest["apps"][number];

export default {
  apps: [SCHEDULER_APP],
  kinds: [
    { id: SCHEDULER_TASKS_KIND, label: "Scheduled tasks", plural: "task lists" },
    { id: SCHEDULER_RUNS_KIND, label: "Run history", plural: "run histories" },
  ],
} satisfies PluginLayoutManifest;
