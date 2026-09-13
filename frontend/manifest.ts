import { Timer } from "lucide-react";
import type { PluginAppManifest } from "@tokenring-ai/one-frontend/plugins/types.ts";

/**
 * Metadata for the scheduler app shipped by this plugin. The frontend merges
 * this into its app registry and derives the SPA server routes from it.
 */
export default {
  id: "scheduler",
  path: "/scheduler",
  label: "Scheduler",
  shortLabel: "SC",
  description: "Schedule recurring agent tasks and monitor runs",
  group: "Operate",
  icon: Timer,
  iconClass: "text-indigo-500",
  gradient: "from-indigo-500 to-violet-600",
} satisfies PluginAppManifest;
