import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import createSubcommandRouter from "@tokenring-ai/agent/util/subcommandRouter";
import add from "./schedule/add.ts";
import history from "./schedule/history.ts";
import remove from "./schedule/remove.ts";
import show from "./schedule/show.ts";
import start from "./schedule/start.ts";
import stop from "./schedule/stop.ts";

const description = "/scheduler [start|stop|show|add|remove|history] - Manage the scheduler." as const;

const execute = createSubcommandRouter({
  start,
  stop,
  show,
  add,
  remove,
  history
});
const help: string = `# /scheduler

## Description
Manage the scheduler service.

## Usage
/schedule start         - Start the scheduler
/schedule stop          - Stop the scheduler
/schedule show          - Display current schedule and running status
/schedule history       - Display task execution history
/schedule add           - Add a new task (interactive)
/schedule remove <name> - Remove a task by name or index

## Output
- Current scheduled tasks with next/last run times
- Last 50 agent execution runs with status and duration`;

export default {
  description,
  execute,
  help,
} satisfies TokenRingAgentCommand;
