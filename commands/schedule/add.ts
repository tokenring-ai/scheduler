import Agent from "@tokenring-ai/agent/Agent";
import {CommandFailedError} from "@tokenring-ai/agent/AgentError";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";
import {ScheduledTaskSchema} from "../../schema.ts";
import z from "zod";

async function execute(remainder: string, agent: Agent): Promise<string> {
  const scheduler = agent.requireServiceByType(SchedulerService);
  const result = await agent.askQuestion({
    message: "Please provide details for the scheduled task:",
    question: {
      type: "form",
      sections: [{
        name: "Task Specification",
        fields: {
          name: { type: "text", label: "Task Name", required: true },
          message: { type: "text", label: "Instructions for the agent", required: true },
          repeat: { type: "treeSelect", label: "How often to run the task", minimumSelections: 1, maximumSelections: 1, tree: [
            { name: "Once", value: "once" },
            { name: "Every 5 minutes", value: "5 minute" },
            { name: "Every hour", value: "1 hour" },
            { name: "Every day", value: "1 day" },
          ]},
          after: { type: "text", label: "Earliest time of day to run the task at (hh::mm, 24 hour clock, optional)" },
          before: { type: "text", label: "Latest time of day to run the task at (hh::mm, 24 hour clock, optional)" },
        },
        type: "text"
      }]
    }
  });
  if (result === null) throw new CommandFailedError("Task creation cancelled");
  const taskSpec = result["Task Specification"];
  const task: z.input<typeof ScheduledTaskSchema> = {
    message: taskSpec.message,
    ...(taskSpec.repeat[0] === 'once' ? { once: true } : { repeat: taskSpec.repeat[0] }),
    after: taskSpec.after ?? undefined,
    before: taskSpec.before ?? undefined,
  };
  try {
    scheduler.addTask(taskSpec.name, ScheduledTaskSchema.parse(task), agent);
    return `Task '${taskSpec.name}' added successfully`;
  } catch (error) {
    throw new CommandFailedError(`Invalid task configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default { name: "schedule add", description: "/schedule add - Add a scheduled task", help: `# /schedule add

Interactively add a new scheduled task. Prompts for name, instructions, repeat interval, and optional time window.

## Example

/schedule add`, execute } satisfies TokenRingAgentCommand;
