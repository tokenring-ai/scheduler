import Agent from "@tokenring-ai/agent/Agent";
import SchedulerService from "../../SchedulerService.ts";

export default async function execute(remainder: string, agent: Agent): Promise<string> {
  agent.requireServiceByType(SchedulerService).runScheduler(agent);
  return "Scheduler started";
}
