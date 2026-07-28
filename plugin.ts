import { AgentCommandService } from "@tokenring-ai/agent";
import type { TokenRingPlugin } from "@tokenring-ai/app";
import { ChatService } from "@tokenring-ai/chat";
import { RpcService } from "@tokenring-ai/rpc";
import { z } from "zod";
import agentCommands from "./commands.ts";
import packageJSON from "./package.json" with { type: "json" };
import schedulerRPC from "./rpc/scheduler.ts";
import SchedulerService from "./SchedulerService.ts";
import { SchedulerConfigSchema } from "./schema.ts";
import tools from "./tools.ts";

const packageConfigSchema = z.object({
  scheduler: SchedulerConfigSchema.prefault({}),
});

export default {
  name: packageJSON.name,
  displayName: "Agent Scheduler",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app) {
    app.waitForService(ChatService, chatService => chatService.addTools(...tools));
    app.waitForService(AgentCommandService, agentCommandService => agentCommandService.addAgentCommands([...agentCommands]));
    app.waitForService(RpcService, rpcService => {
      rpcService.registerEndpoint(schedulerRPC);
    });
    app.addServices(new SchedulerService(app));
  },
  reconfigure(app, config) {
    app.requireService(SchedulerService).reconfigure(config.scheduler);
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
