import manifest from "./manifest.ts";
import SchedulerApp from "./SchedulerApp.tsx";
import type { PluginAppDefinition } from "@tokenring-ai/one-frontend/plugins/types.ts";

/**
 * The scheduler app contributed to the TokenRing One frontend by this
 * plugin. Discovered by `frontend/src/plugins/registry.ts`.
 */
export default {
  ...manifest,
  routePath: "/scheduler",
  component: SchedulerApp,
} satisfies PluginAppDefinition;
