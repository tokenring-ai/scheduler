import type { ViewManifest } from "@tokenring-ai/one-frontend/dock/types.ts";
import type { PluginFrontendManifest } from "@tokenring-ai/one-frontend/plugins/types.ts";
import { History, Timer } from "lucide-react";
import { SCHEDULER_PATH } from "./lib/paths.ts";

/** The Scheduler dashboard id; views use it to tell they are docked on their own dashboard. */
export const SCHEDULER_DASHBOARD_ID = "scheduler";

/** Scheduled tasks for the selected agent, with next runs and scheduler controls. */
export const SCHEDULER_TASKS_VIEW_ID = "scheduler-tasks";
export const schedulerTasksViewManifest = {
  id: SCHEDULER_TASKS_VIEW_ID,
  title: "Tasks",
  description: "Scheduled tasks and their next runs",
  icon: Timer,
  availableOn: ["home", "any"],
  defaultSize: { width: 520, height: 480 },
  minimumSize: { width: 340, height: 240 },
  tags: ["ops"],
} satisfies ViewManifest;

/** Run history for the selected agent, filterable by task and status. */
export const SCHEDULER_RUNS_VIEW_ID = "scheduler-runs";
export const schedulerRunsViewManifest = {
  id: SCHEDULER_RUNS_VIEW_ID,
  title: "Runs",
  description: "History of task runs, filterable by task and status",
  icon: History,
  availableOn: ["any"],
  defaultSize: { width: 560, height: 480 },
  minimumSize: { width: 340, height: 240 },
  tags: ["ops"],
} satisfies ViewManifest;

/**
 * Metadata for the scheduler dashboard shipped by this plugin. The frontend
 * merges this into its registry and derives the SPA server routes from it.
 */
export default {
  id: SCHEDULER_DASHBOARD_ID,
  path: SCHEDULER_PATH,
  label: "Scheduler",
  shortLabel: "SC",
  description: "Schedule recurring agent tasks and monitor runs",
  group: "Operate",
  icon: Timer,
  iconClass: "text-indigo-500",
  gradient: "from-indigo-500 to-violet-600",
  views: [schedulerTasksViewManifest, schedulerRunsViewManifest],
} satisfies PluginFrontendManifest;
