import Agent from "@tokenring-ai/agent/Agent";
import {CommandFailedError} from "@tokenring-ai/agent/AgentError";
import SchedulerService from "../../SchedulerService.ts";

export default async function execute(remainder: string, agent: Agent): Promise<string> {
  const scheduler = agent.requireServiceByType(SchedulerService);
  const name = remainder.trim();

  if (!name) {
    throw new CommandFailedError("Usage: /scheduler remove <name>");
  }

  scheduler.removeTask(name, agent);
  return `Task removed successfully`;
}
