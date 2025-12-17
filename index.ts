import {AgentCommandService} from "@tokenring-ai/agent";
import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import chatCommands from "./chatCommands.ts";
import SchedulerService, {ScheduleTaskSchema} from "./SchedulerService.ts";
import packageJSON from './package.json' with {type: 'json'};

export const SchedulerConfigSchema = z.object({
  tasks: z.array(ScheduleTaskSchema)
}).optional();

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const config = app.getConfigSlice('scheduler', SchedulerConfigSchema);
    if (config?.tasks) {
      app.waitForService(AgentCommandService, agentCommandService =>
        agentCommandService.addAgentCommands(chatCommands)
      );
      app.addServices(new SchedulerService(app, config.tasks));
    }
  }
} satisfies TokenRingPlugin;

export {default as SchedulerService} from "./SchedulerService.ts";
export type {ScheduleTask} from "./SchedulerService.ts";
