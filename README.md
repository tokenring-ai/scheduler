# @tokenring-ai/scheduler

Schedule AI agents to run at specified intervals with comprehensive timing control, runtime monitoring, and task state management.

## Overview

The Scheduler service runs within an AI agent to provide automated scheduling of other agents with flexible timing options, runtime monitoring, and task state management. It integrates seamlessly with the TokenRing ecosystem through automatic service attachment and provides real-time monitoring through chat commands.

## Installation

```bash
bun install @tokenring-ai/scheduler
```

## Usage

### Basic Integration

The scheduler is installed as a plugin in your TokenRing application:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import scheduler from "@tokenring-ai/scheduler";

const app = new TokenRingApp({
  // Your app configuration
});

app.install(scheduler);
```

### Automatic Agent Attachment

When an agent is created with scheduler configuration, the SchedulerService automatically attaches to it:

1. Validates configuration using Zod schemas
2. Initializes task and execution state on the agent
3. Optionally auto-starts the scheduler if configured
4. Provides real-time task monitoring through chat commands

## Plugin Configuration

The scheduler plugin is configured at the application level in `.tokenring/config.mjs`:

```javascript
export default {
  scheduler: {
    agentDefaults: {
      autoStart: true,
      tasks: {}
    }
  }
};
```

The `agentDefaults` are merged with per-agent configuration, allowing global defaults while supporting agent-specific overrides.

## Chat Commands

### /scheduler Command

The scheduler provides comprehensive chat commands for management and monitoring:

```
/scheduler [start|stop|show|add|remove|history]
```

**Subcommands:**

- `start` - Start the scheduler
- `stop` - Stop the scheduler
- `show` - Display current schedule and running status
- `history` - Display task execution history
- `add` - Add a new task (interactive)
- `remove <name>` - Remove a task by name

**Example Output:**

```
=== Scheduled Tasks ===

**Daily Report** (reportGenerator)
  Message: /chat Generate daily report
  Status: pending
  Next Run: Mon, Jan 15, 2024, 9:00:00 AM
  Last Run: Sun, Jan 14, 2024, 9:00:00 AM

**Health Check** (healthMonitor)
  Message: /chat Check system health
  Status: running
  Next Run: Mon, Jan 14, 2024, 2:30:00 PM
```

## Agent Configuration

The scheduler is configured per-agent through the agent's configuration. Configuration is validated using Zod schemas.

### Configuration Schema

```typescript
const SchedulerAgentConfigSchema = z.object({
  autoStart: z.boolean().default(false),
  tasks: z.record(z.string(), ScheduledTaskSchema).default({})
});
```

### Configuration Example

Add a `scheduler` section to your agent configuration in `.tokenring/config.mjs`:

```javascript
export default {
  scheduler: {
    agentDefaults: {
      autoStart: true,
      tasks: {
        "Daily Report": {
          agentType: "reportGenerator",
          message: "/chat Generate daily report",
          once: true,
          from: "09:00",
          on: "mon tue wed thu fri"
        },
        "Health Check": {
          agentType: "healthMonitor",
          message: "/chat Check system health",
          every: "30 minutes",
          noLongerThan: "5 minutes"
        },
        "Weekly Cleanup": {
          agentType: "cleanupAgent",
          message: "/chat Clean up old files",
          once: true,
          on: "sun",
          from: "02:00"
        }
      }
    }
  }
};
```

## Tools

The scheduler package provides three tools for programmatic task management:

### scheduler_add_task

Add a new scheduled task to run an agent at specified intervals.

**Input Schema:**

```typescript
{
  taskName: string,
  task: ScheduledTask
}
```

**Example:**

```typescript
await agent.executeTool('scheduler_add_task', {
  taskName: "Daily Backup",
  task: {
    agentType: "backupAgent",
    message: "/chat Run daily backup",
    once: true,
    from: "02:00"
  }
});
```

### scheduler_remove_task

Remove a scheduled task by name.

**Input Schema:**

```typescript
{
  taskName: string
}
```

**Example:**

```typescript
await agent.executeTool('scheduler_remove_task', {
  taskName: "Daily Backup"
});
```

### scheduler_get_schedule

Get the current schedule of all scheduled tasks with their status and next run times.

**Input Schema:**

```typescript
{}
```

**Example:**

```typescript
const schedule = await agent.executeTool('scheduler_get_schedule', {});
```

**Returns:**

```
Scheduled Tasks:

Daily Report (reportGenerator):
  Message: /chat Generate daily report
  Status: pending
  Next Run: Mon, Jan 15, 2024, 9:00:00 AM
  Last Run: Sun, Jan 14, 2024, 9:00:00 AM
```

## Services

### SchedulerService

The SchedulerService runs within an agent and provides automated scheduling for spawning other agents.

**Constructor:**

```typescript
constructor(app: TokenRingApp, options: z.output<typeof SchedulerConfigSchema>)
```

**Methods:**

#### attach(agent: Agent): void

Attaches the scheduler to an agent, initializing task and execution state.

#### runScheduler(agent: Agent): void

Starts the scheduler loop for the given agent.

#### stopScheduler(agent: Agent): void

Stops the scheduler loop for the given agent.

#### addTask(name: string, task: ScheduledTask, agent: Agent): void

Adds a new scheduled task to the agent.

#### removeTask(name: string, agent: Agent): void

Removes a scheduled task from the agent.

#### watchTasks(agent: Agent, signal: AbortSignal): Promise<void>

Watches task state and schedules executions.

#### runTask(name: string, task: ScheduledTask, agent: Agent): Promise<void>

Executes a scheduled task by spawning the configured agent.

### State Interfaces

#### ExecutionScheduleEntry

```typescript
interface ExecutionScheduleEntry {
  nextRunTime: number | null;
  status: 'pending' | 'running';
  abortController?: AbortController;
  timer?: NodeJS.Timeout;
  startTime?: number;
}
```

#### TaskRunHistory

```typescript
interface TaskRunHistory {
  startTime: number;
  endTime: number;
  status: 'completed' | 'failed';
  message: string;
}
```

## ScheduleTask Schema

The ScheduleTask schema defines the structure for scheduled tasks:

```typescript
const ScheduledTaskSchema = z.object({
  agentType: z.string(),
  every: z.string().optional(),
  once: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  on: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  lastRunTime: z.number().default(0),
  noLongerThan: z.string().optional(),
  several: z.boolean().optional(),
  timezone: z.string().optional(),
  message: z.string(),
});
```

### ScheduleTask Properties

| Property       | Type      | Required | Description                                                         |
|----------------|-----------|----------|---------------------------------------------------------------------|
| `agentType`    | `string`  | Yes      | Agent type to spawn (must be available in AgentManager)             |
| `message`      | `string`  | Yes      | Message to send to the spawned agent                                |
| `every`        | `string`  | No       | Run at fixed intervals (e.g., "30 seconds", "5 minutes", "2 hours") |
| `once`         | `boolean` | No       | Run once per day                                                    |
| `from`         | `string`  | No       | Start time in HH:MM format (e.g., "09:00")                          |
| `to`           | `string`  | No       | End time in HH:MM format (e.g., "17:00")                            |
| `on`           | `string`  | No       | Days of week (e.g., "mon tue wed", "sat sun")                       |
| `dayOfMonth`   | `number`  | No       | Specific day of month (1-31)                                        |
| `lastRunTime`  | `number`  | No       | Timestamp of last execution (default: 0)                            |
| `noLongerThan` | `string`  | No       | Maximum runtime duration (e.g., "10 minutes")                       |
| `several`      | `boolean` | No       | Allow multiple simultaneous runs (default: false)                   |
| `timezone`     | `string`  | No       | Timezone for scheduling (default: system timezone)                  |

## Schedule Configuration

### Time Intervals

Supported time units:

- `second`, `seconds`
- `minute`, `minutes`
- `hour`, `hours`
- `day`, `days`

Format: `"<number> <unit>"` (e.g., "5 minutes", "2 hours")

### Days of Week

Use three-letter abbreviations: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`

Multiple days: `"mon tue wed thu fri"` or `"sat sun"`

## Examples

### Run Every Hour During Business Hours

```javascript
{
  agentType: "syncAgent",
  message: "/chat Sync data",
  every: "1 hour",
  from: "09:00",
  to: "17:00",
  on: "mon tue wed thu fri"
}
```

### Run Once Daily at Specific Time

```javascript
{
  agentType: "briefingAgent",
  message: "/chat Generate morning briefing",
  once: true,
  from: "08:00"
}
```

### Run Every 30 Minutes with Timeout

```javascript
{
  agentType: "monitorAgent",
  message: "/chat Quick system check",
  every: "30 minutes",
  noLongerThan: "5 minutes"
}
```

### Run on Specific Day of Month

```javascript
{
  agentType: "reportAgent",
  message: "/chat Generate monthly report",
  once: true,
  dayOfMonth: 1,
  from: "00:00"
}
```

### Allow Multiple Concurrent Runs

```javascript
{
  agentType: "processingAgent",
  message: "/chat Process queue",
  every: "5 minutes",
  several: true
}
```

## State Management

The scheduler maintains task state within the agent using two state slices:

### ScheduleTaskState

Tracks configured tasks and their execution history:
- `tasks`: Map of task name to ScheduledTask configuration
- `history`: Map of task name to array of TaskRunHistory entries

### ScheduleExecutionState

Tracks runtime execution state:
- `tasks`: Map of task name to ExecutionScheduleEntry
- `abortController`: Controls the scheduler loop

**State Persistence**: Task state is stored in the agent's state and persists across agent restarts if the agent's state is persisted.

## Error Handling

- **Runtime Timeout**: Tasks exceeding `noLongerThan` are logged but not terminated
- **Agent Errors**: Execution errors are captured in run history with error message
- **Configuration Validation**: Invalid configurations prevent agent attachment
- **Graceful Shutdown**: Scheduler stops scheduling new tasks and aborts running tasks

## Monitoring and Logging

- **Agent Output**: Real-time logging of task scheduling and execution through agent info/error lines
- **Run History**: All executions tracked with timing and status information
- **Status Monitoring**: Real-time task status through `/scheduler show` command
- **Performance Tracking**: Runtime duration and timeout monitoring

## Integration Features

- **Automatic Attachment**: Plugin automatically attaches to agents with scheduler configuration
- **Agent Spawning**: Seamless integration with AgentManager for spawning scheduled agents
- **Event Streaming**: Real-time event monitoring during agent execution
- **Headless Operation**: All scheduled agents run in headless mode by default
- **State-Based**: Leverages agent state system for task and execution tracking

## Testing

Run tests with:

```bash
bun test
```

Run tests in watch mode:

```bash
bun test:watch
```

Run tests with coverage:

```bash
bun test:coverage
```

## License

MIT License - see [LICENSE](./LICENSE) file for details.
