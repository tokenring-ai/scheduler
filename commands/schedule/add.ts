import Agent from "@tokenring-ai/agent/Agent";
import SchedulerService from "../../SchedulerService.ts";
import {ScheduledTaskSchema} from "../../schema.ts";

export default async function execute(remainder: string, agent: Agent) {
  const scheduler = agent.requireServiceByType(SchedulerService);

  const name = await agent.askForText({message: "Task name:", label: "Name"});
  if (!name) return;

  const agentType = await agent.askForText({message: "Agent type:", label: "Agent Type"});
  if (!agentType) return;

  const message = await agent.askForText({message: "Message/command:", label: "Message"});
  if (!message) return;

  const scheduleType = await agent.askForText({message: "Schedule type (every or once):", label: "Schedule Type"});
  if (!scheduleType) return;

  const task: any = {agentType, message};

  if (scheduleType.toLowerCase() === "every") {
    const interval = await agent.askForText({message: "Interval (e.g., '5 minutes', '1 hour'):", label: "Interval"});
    if (interval) task.every = interval;
  } else if (scheduleType.toLowerCase() === "once") {
    task.once = true;
    const from = await agent.askForText({message: "Time (HH:MM, optional):", label: "Time"});
    if (from) task.from = from;
  } else {
    agent.errorMessage("Schedule type must be 'every' or 'once'");
    return;
  }

  try {
    const validated = ScheduledTaskSchema.parse(task);
    scheduler.addTask(name, validated, agent);
    agent.infoMessage(`Task '${name}' added successfully`);
  } catch (error) {
    agent.errorMessage("Invalid task configuration:", error as Error);
  }
}
