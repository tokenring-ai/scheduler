import { defineView } from "@tokenring-ai/one-frontend/layout/define.ts";
import type { PluginLayoutViews } from "@tokenring-ai/one-frontend/plugins/layoutTypes.ts";
import { History, Timer } from "lucide-react";
import { lazy } from "react";
import { SCHEDULER_RUNS_KIND, SCHEDULER_RUNS_VIEW_ID, SCHEDULER_TASKS_KIND, SCHEDULER_TASKS_VIEW_ID } from "./ids.ts";

const SchedulerTasksPane = lazy(() => import("./panes/SchedulerTasksPane.tsx"));
const SchedulerRunsView = lazy(() => import("./views/SchedulerRunsView.tsx"));

export default {
  views: [
    defineView({
      id: SCHEDULER_TASKS_VIEW_ID,
      kind: SCHEDULER_TASKS_KIND,
      title: "Tasks",
      description: "Scheduled tasks and their next runs",
      icon: Timer,
      route: "",
      component: SchedulerTasksPane,
    }),
    defineView({
      id: SCHEDULER_RUNS_VIEW_ID,
      kind: SCHEDULER_RUNS_KIND,
      title: "Runs",
      description: "History of task runs, filterable by task and status",
      icon: History,
      route: "runs",
      component: SchedulerRunsView,
    }),
  ],
} satisfies PluginLayoutViews;
