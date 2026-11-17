import { defineView } from "@tokenring-ai/one-frontend/layout/define.ts";
import type { PluginLayoutViews } from "@tokenring-ai/one-frontend/plugins/layoutTypes.ts";
import { History, Timer } from "lucide-react";
import { lazy } from "react";
import { SCHEDULER_RUNS_KIND, SCHEDULER_RUNS_VIEW_ID, SCHEDULER_TASKS_KIND, SCHEDULER_TASKS_VIEW_ID } from "./ids.ts";

const SchedulesPane = lazy(() => import("./panes/SchedulesPane.tsx"));
const SchedulerRunsView = lazy(() => import("./views/SchedulerRunsView.tsx"));

export default {
  views: [
    defineView({
      id: SCHEDULER_TASKS_VIEW_ID,
      kind: SCHEDULER_TASKS_KIND,
      title: "Schedules",
      description: "Schedules: what they run, and when they run next",
      icon: Timer,
      route: "",
      component: SchedulesPane,
    }),
    defineView({
      id: SCHEDULER_RUNS_VIEW_ID,
      kind: SCHEDULER_RUNS_KIND,
      title: "Runs",
      description: "History of schedule runs, filterable by schedule and status",
      icon: History,
      route: "runs",
      component: SchedulerRunsView,
    }),
  ],
} satisfies PluginLayoutViews;
