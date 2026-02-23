import Agent from "@tokenring-ai/agent/Agent";
import SchedulerService from "../../SchedulerService.ts";

export default async function execute(remainder: string, agent: Agent): Promise<string> {
  agent.requireServiceByType(SchedulerService).stopScheduler(agent);
  return "Scheduler stopped";
}
