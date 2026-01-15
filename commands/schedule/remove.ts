import Agent from "@tokenring-ai/agent/Agent";
import SchedulerService from "../../SchedulerService.ts";

export default async function execute(remainder: string, agent: Agent) {
  const scheduler = agent.requireServiceByType(SchedulerService);
  const name = remainder.trim();

  if (!name) {
    agent.errorLine("Usage: /scheduler remove <name>");
    return;
  }

  scheduler.removeTask(name, agent);

  agent.infoLine(`Task removed successfully`);
}
