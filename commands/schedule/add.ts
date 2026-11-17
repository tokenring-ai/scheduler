import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";
import type { ScheduleDefinition } from "../../schema.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule add",
  description: "Add a schedule",
  help: `Interactively add a schedule. Prompts for a name, the instructions, where they run (a new agent of this
chat's type each time, or this chat), how often, and an optional time window.

## Example

/schedule add`,
  inputSchema,
  execute: async ({ agent }: AgentCommandInputType<typeof inputSchema>): Promise<string> => {
    const scheduler = agent.requireService(SchedulerService);
    const result = await agent.askQuestion({
      message: "Please provide details for the schedule:",
      question: {
        type: "form",
        sections: [
          {
            name: "Schedule",
            fields: {
              name: { type: "text", label: "Schedule name", required: true },
              message: { type: "text", label: "Instructions for the agent", required: true },
              runIn: {
                type: "treeSelect",
                label: "Where it runs",
                minimumSelections: 1,
                maximumSelections: 1,
                tree: [
                  { name: `A new ${agent.config.agentType} agent each time`, value: "job" },
                  { name: "This chat", value: "agent" },
                ],
              },
              repeat: {
                type: "treeSelect",
                label: "How often",
                minimumSelections: 1,
                maximumSelections: 1,
                tree: [
                  { name: "Once", value: "once" },
                  { name: "Every 5 minutes", value: "5 minutes" },
                  { name: "Every hour", value: "1 hour" },
                  { name: "Every day", value: "1 day" },
                  { name: "Every week", value: "1 week" },
                  { name: "Every month", value: "1 month" },
                ],
              },
              after: { type: "text", label: "Earliest time of day (HH:mm, 24-hour clock, optional)" },
              before: { type: "text", label: "Latest time of day (HH:mm, 24-hour clock, optional)" },
            },
            type: "text",
          },
        ],
      },
    });
    if (result === null) throw new CommandFailedError("Cancelled");
    const spec = result.Schedule;
    if (!spec) throw new CommandFailedError("The schedule's details are missing");

    const prompt = spec.message;
    const definition: ScheduleDefinition = {
      action: spec.runIn[0] === "agent" ? { kind: "agent", agentId: agent.id, prompt } : { kind: "job", agentType: agent.config.agentType, prompt },
      ...(spec.repeat[0] === "once" || !spec.repeat[0] ? { once: true } : { repeat: spec.repeat[0] }),
      ...(spec.after && { after: spec.after }),
      ...(spec.before && { before: spec.before }),
    };
    try {
      scheduler.addSchedule(spec.name, definition);
    } catch (err: unknown) {
      throw new CommandFailedError(`Invalid schedule: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    return `Schedule '${spec.name}' added`;
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
