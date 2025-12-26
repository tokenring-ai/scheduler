import {AgentCommandService} from "@tokenring-ai/agent";
import {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import chatCommands from "./chatCommands.ts";
import {SchedulerConfigSchema} from "./index.ts";
import packageJSON from './package.json' with {type: 'json'};
import SchedulerService from "./SchedulerService.ts";

const packageConfigSchema = z.object({
  scheduler: SchedulerConfigSchema.optional()
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    // const config = app.getConfigSlice('scheduler', SchedulerConfigSchema);
    if (config.scheduler?.tasks) {
      app.waitForService(AgentCommandService, agentCommandService =>
        agentCommandService.addAgentCommands(chatCommands)
      );
      app.addServices(new SchedulerService(app, config.scheduler.tasks));
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
