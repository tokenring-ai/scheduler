import Agent from "@tokenring-ai/agent/Agent";
import SchedulerService from "../../SchedulerService.ts";

export default async function execute(remainder: string, agent: Agent) {
  agent.requireServiceByType(SchedulerService).runScheduler(agent);
}
