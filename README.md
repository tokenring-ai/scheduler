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

### /schedule Command

The scheduler provides comprehensive chat commands for management and monitoring.

```
/schedule [start|stop|show|add|remove|history]
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

**Daily Report**
  Message: /chat Generate daily report
  Status: pending
  Next Run: Mon, Jan 15, 2024, 9:00:00 AM
  Last Run: Sun, Jan 14, 2024, 9:00:00 AM

**Health Check**
  Message: /chat Check system health
  Status: running
  Next Run: Mon, Jan 14, 2024, 2:30:00 PM
```

## Agent Configuration

The scheduler is configured per-agent through the agent's configuration. Configuration is validated using Zod schemas.

### Configuration Schema

```typescript
const SchedulerAgentConfigSchema = z.object({
  autoStart: z.boolean().default(true),
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
          message: "/chat Generate daily report",
          repeat: "1 day",
          after: "09:00",
          before: "17:00",
          weekdays: "mon tue wed thu fri"
        },
        "Health Check": {
          message: "/chat Check system health",
          repeat: "30 minutes",
          after: "00:00",
          before: "23:59"
        },
        "Weekly Cleanup": {
          message: "/chat Clean up old files",
          repeat: "1 week",
          weekdays: "sun"
        }
      }
    }
  }
};
```

## Tools

The scheduler package provides three tools for programmatic task management:

### add_scheduled_task

Add a new scheduled task to run an agent at specified intervals.

**Input Schema:**

```typescript
{
  taskName: string,
  task: {
    description: string,
    context?: string,
    repeat?: string,
    after?: string,
    before?: string,
    timezone?: string
  }
}
```

**Example:**

```typescript
await agent.executeTool('add_scheduled_task', {
  taskName: "Daily Backup",
  task: {
    description: "Run a full backup of all critical data. This includes user documents, database exports, and configuration files. Ensure the backup completes within 30 minutes.",
    context: "Backup should run after regular business hours to minimize system impact. Include checksum verification for data integrity.",
    repeat: "1 day",
    after: "02:00",
    before: "03:00",
    timezone: "America/New_York"
  }
});
```

### remove_scheduled_task

Remove a scheduled task by name.

**Input Schema:**

```typescript
{
  taskName: string
}
```

**Example:**

```typescript
await agent.executeTool('remove_scheduled_task', {
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

Daily Report:
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
  repeat: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  weekdays: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  lastRunTime: z.number().default(0),
  timezone: z.string().optional(),
  message: z.string(),
});
```

### ScheduleTask Properties

| Property       | Type      | Required | Description                                                         |
|----------------|-----------|----------|---------------------------------------------------------------------|
| `message`      | `string`  | Yes      | Message to send to the spawned agent                                |
| `repeat`       | `string`  | No       | Run at fixed intervals (e.g., "30 seconds", "5 minutes", "2 hours") |
| `after`        | `string`  | No       | Start time in HH:MM format (e.g., "09:00")                          |
| `before`       | `string`  | No       | End time in HH:MM format (e.g., "17:00")                            |
| `weekdays`     | `string`  | No       | Days of week (e.g., "mon tue wed thu fri", "sat sun")               |
| `dayOfMonth`   | `number`  | No       | Specific day of month (1-31)                                        |
| `lastRunTime`  | `number`  | No       | Timestamp of last execution (default: 0)                            |
| `timezone`     | `string`  | No       | IANA timezone string for the time (e.g., 'America/New_York', 'UTC') |

## Schedule Configuration

### Time Intervals

Supported time units:

- `second`, `seconds`
- `minute`, `minutes`
- `hour`, `hours`
- `day`, `days`

Format: `"<number> <unit>"` (e.g., "5 minutes", "2 hours")

### Time Windows

Use `after` and `before` to define time windows:

- `after`: Time to start running (HH:MM format)
- `before`: Time to stop running (HH:MM format)

### Days of Week

Use three-letter abbreviations: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`

Multiple days: `"mon tue wed thu fri"` or `"sat sun"`

## Examples

### Run Every Hour During Business Hours

```javascript
{
  message: "/chat Sync data",
  repeat: "1 hour",
  after: "09:00",
  before: "17:00",
  weekdays: "mon tue wed thu fri"
}
```

### Run Once Daily at Specific Time

```javascript
{
  message: "/chat Generate morning briefing",
  repeat: "1 day",
  after: "08:00"
}
```

### Run Every 30 Minutes with Timezone

```javascript
{
  message: "/chat Quick system check",
  repeat: "30 minutes",
  after: "00:00",
  before: "23:59",
  timezone: "America/New_York"
}
```

### Run on Specific Days of Week

```javascript
{
  message: "/chat Generate monthly report",
  repeat: "1 week",
  weekdays: "sun"
}
```

### Run on Specific Day of Month

```javascript
{
  message: "/chat Generate monthly report",
  repeat: "1 month",
  dayOfMonth: 1
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
- `autoStart`: Whether the scheduler should auto-start
- `abortController`: Controls the scheduler loop

**State Persistence**: Task state is stored in the agent's state and persists across agent restarts if the agent's state is persisted.

## Error Handling

- **Runtime Timeout**: Tasks may exceed configured time windows but are not terminated
- **Agent Errors**: Execution errors are captured in run history with error message
- **Configuration Validation**: Invalid configurations prevent agent attachment
- **Graceful Shutdown**: Scheduler stops scheduling new tasks and aborts running tasks

## Monitoring and Logging

- **Agent Output**: Real-time logging of task scheduling and execution through agent info/error lines
- **Run History**: All executions tracked with timing and status information
- **Status Monitoring**: Real-time task status through `/schedule show` command
- **Performance Tracking**: Runtime duration and time window monitoring

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
