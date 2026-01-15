import Agent from "@tokenring-ai/agent/Agent";
import SchedulerService from "../../SchedulerService.ts";
import {ScheduledTaskSchema} from "../../schema.ts";

export default async function execute(remainder: string, agent: Agent) {
  const scheduler = agent.requireServiceByType(SchedulerService);

  const name = await agent.askHuman({type: "askForText", message: "Task name:"});
  if (!name) return;

  const agentType = await agent.askHuman({type: "askForText", message: "Agent type:"});
  if (!agentType) return;

  const message = await agent.askHuman({type: "askForText", message: "Message/command:"});
  if (!message) return;

  const scheduleType = await agent.askHuman({type: "askForText", message: "Schedule type (every or once):"});
  if (!scheduleType) return;

  const task: any = {agentType, message};

  if (scheduleType.toLowerCase() === "every") {
    const interval = await agent.askHuman({type: "askForText", message: "Interval (e.g., '5 minutes', '1 hour'):"});
    if (interval) task.every = interval;
  } else if (scheduleType.toLowerCase() === "once") {
    task.once = true;
    const from = await agent.askHuman({type: "askForText", message: "Time (HH:MM, optional):"});
    if (from) task.from = from;
  } else {
    agent.errorLine("Schedule type must be 'every' or 'once'");
    return;
  }

  try {
    const validated = ScheduledTaskSchema.parse(task);
    scheduler.addTask(name, validated, agent);
    agent.infoLine(`Task '${name}' added successfully`);
  } catch (error) {
    agent.errorLine("Invalid task configuration:", error as Error);
  }
}
