import Agent from "@tokenring-ai/agent/Agent";
import SchedulerService from "../../SchedulerService.ts";
import {ScheduledTaskSchema} from "../../schema.ts";
import z from "zod";

export default async function execute(remainder: string, agent: Agent) {
  const scheduler = agent.requireServiceByType(SchedulerService);

  const result = await agent.askQuestion({
    message: "Please provide details for the scheduled task:",
    question: {
      type: "form",
      sections: [
        {
          name: "Task Specification",
          fields: {
            name: {
              type: "text",
              label: "Task Name",
              required: true,
            },
            message: {
              type: "text",
              label: "Instructions for the agent",
              required: true,
            },
            repeat: {
              type: "treeSelect",
              label: "How often to run the task",
              minimumSelections: 1,
              maximumSelections: 1,
              tree: [
                { name: "Once", value: "once" },
                { name: "Every 5 minutes", value: "5 minute" },
                { name: "Every hour", value: "1 hour" },
                { name: "Every day", value: "1 day" },
              ],
            },
            after: {
              type: "text",
              label: "Earliest time of day to run the task at (hh::mm, 24 hour clock, optional)",
            },
            before: {
              type: "text",
              label: "Latest time of day to run the task at (hh::mm, 24 hour clock, optional)",
            }
          },
          type: "text"
        },
      ]
    }
  });

  if (result === null) {
    agent.errorMessage("Task creation cancelled");
    return;
  }

  const taskSpec = result["Task Specification"];


  const task: z.input<typeof ScheduledTaskSchema> = {
    message: taskSpec.message,
    ...(taskSpec.repeat[0] === 'once'
      ? { once: true}
      : { repeat: taskSpec.repeat[0] }
    ),
    after: taskSpec.after ?? undefined,
    before: taskSpec.before ?? undefined,
  };

  try {
    const validated = ScheduledTaskSchema.parse(task);
    scheduler.addTask(taskSpec.name, validated, agent);
    agent.infoMessage(`Task '${name}' added successfully`);
  } catch (error) {
    agent.errorMessage("Invalid task configuration:", error as Error);
  }
}
