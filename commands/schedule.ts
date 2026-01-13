import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import SchedulerService from "../SchedulerService.ts";

const description = "/schedule - Display current schedule and run history." as const;

export function execute(remainder: string, agent: Agent): void {
  const scheduler = agent.app.getService(SchedulerService);
  
  if (!scheduler) {
    agent.infoLine("Scheduler service is not running.");
    return;
  }

  const status = scheduler.getStatus();
  
  agent.infoLine("=== Scheduled Tasks ===\n");
  
  for (const task of status.tasks) {
    agent.infoLine(`**${task.name}** (${task.agentType})`);
    agent.infoLine(`  Message: ${task.message}`);
    agent.infoLine(`  Status: ${task.isRunning ? "Running" : "Idle"}`);
    const nextDate = task.nextRun ? new Date(task.nextRun * 1000).toLocaleString() : "Task not scheduled to run today";
    agent.infoLine(`  Next Run: ${nextDate}`);

    const lastDate = task.lastRun ? new Date(task.lastRun * 1000).toLocaleString() : "Task has not run since application was started";
    agent.infoLine(`  Last Run: ${lastDate}`);
    
    agent.infoLine("");
  }

  const history = status.history.slice(-50);
  if (history.length > 0) {
    agent.infoLine(`\n=== Last ${history.length} Runs ===\n`);
    
    for (const run of history) {
      const startDate = new Date(run.startTime * 1000).toLocaleString();
      const duration = run.endTime ? `${Math.round(run.endTime - run.startTime)}s` : "running";
      const status = run.error ? "failed" : "completed";
      
      agent.infoLine(`[${startDate}] ${run.taskName} - ${status} (${duration})`);
      if (run.error) {
        agent.infoLine(`  Error: ${run.error}`);
      }
    }
  }
}

const help: string = `# /schedule

## Description
Display current schedule, next run times, and execution history.

## Usage
/schedule

## Output
- Current scheduled tasks with next/last run times
- Last 50 agent execution runs with status and duration`;

export default {
  description,
  execute,
  help,
} satisfies TokenRingAgentCommand;
