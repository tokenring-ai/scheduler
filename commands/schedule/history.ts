import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import SchedulerService from "../../SchedulerService.ts";

const inputSchema = {
  args: {},
  positionals: [{ name: "name", description: "Schedule name (all schedules when omitted)", required: false }],
} as const satisfies AgentCommandInputSchema;

export default {
  name: "schedule history",
  description: "Show schedule run history",
  help: `Display the runs of every schedule (or one), with status, duration and outcome.

## Example

/schedule history
/schedule history nightly-report`,
  inputSchema,
  execute: ({ args, agent }: AgentCommandInputType<typeof inputSchema>): string => {
    const history = agent.requireService(SchedulerService).getHistory(args.name || undefined);
    const lines = ["=== Schedule run history ===\n"];
    for (const [name, runs] of Object.entries(history)) {
      lines.push(`**${name}**`);
      if (runs.length === 0) lines.push("- No runs");
      for (const run of runs) {
        const duration = run.endTime ? ` (${Math.round((run.endTime - run.startTime) / 1000)}s)` : "";
        const job = run.jobId ? ` [job ${run.jobId}]` : "";
        lines.push(`- [${new Date(run.startTime).toLocaleString()}] ${run.status}${duration}${job} ${run.message.split("\n")[0] ?? ""}`);
      }
    }
    return lines.join("\n");
  },
} satisfies TokenRingAgentCommand<typeof inputSchema>;
