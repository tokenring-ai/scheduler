import {AgentCommandService} from "@tokenring-ai/agent";
import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import chatCommands from "./chatCommands.ts";
import {SchedulerConfigSchema} from "./index.ts";
import SchedulerService from "./SchedulerService.ts";
import packageJSON from './package.json' with {type: 'json'};


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
