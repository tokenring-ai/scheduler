# @tokenring-ai/scheduler

Schedule AI agents to run at specified intervals with comprehensive timing control, runtime monitoring, and task state management.

## Overview

The Scheduler service runs within an AI agent to provide automated scheduling of other agents with flexible timing options, runtime monitoring, and task state management. It integrates seamlessly with the TokenRing ecosystem through automatic service attachment and provides real-time monitoring through chat commands.

## Installation

```bash
bun install @tokenring-ai/scheduler
```

## Features

- **Flexible Scheduling**: Support for interval-based and time-based scheduling
- **Time Window Control**: Define start and end times for task execution
- **Day Conditions**: Schedule tasks on specific days of the week or month
- **Timezone Support**: Full IANA timezone support for global scheduling
- **Runtime Monitoring**: Real-time task status and execution history
- **Interactive Task Management**: Chat commands for adding, removing, and monitoring tasks
- **Programmatic API**: Tools for integrating scheduling into agent workflows
- **State Persistence**: Task configurations persist across agent restarts
- **Graceful Shutdown**: Clean task cancellation and state cleanup

## Core Components/API

### SchedulerService

The core service that manages scheduled tasks within an agent.

**Constructor:**

```typescript
constructor(app: TokenRingApp, options: z.output<typeof SchedulerConfigSchema>)
```

**Methods:**

#### attach(agent: Agent): void

Attaches the scheduler to an agent, initializing task and execution state. Merges configuration and optionally auto-starts the scheduler.

#### runScheduler(agent: Agent): void

Starts the scheduler loop for the given agent. Creates a background task that watches for task executions.

#### stopScheduler(agent: Agent): void

Stops the scheduler loop for the given agent by aborting the running scheduler.

#### addTask(name: string, task: ScheduledTask, agent: Agent): void

Adds a new scheduled task to the agent. If autoStart is enabled and the scheduler is not running, it will start automatically.

#### removeTask(name: string, agent: Agent): void

Removes a scheduled task from the agent, clearing any timers or running tasks.

#### watchTasks(agent: Agent, signal: AbortSignal): Promise<void>

Watches task state and schedules executions. Monitors for task changes and updates timers accordingly.

#### runTask(name: string, task: ScheduledTask, agent: Agent): Promise<void>

Executes a scheduled task by sending the task message to the agent and monitoring execution.

### Tools

#### scheduler_add_task

Adds a new scheduled task to run an agent at specified intervals.

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
await agent.executeTool('scheduler_add_task', {
  taskName: "Daily Backup",
  task: {
    description: "Run a full backup of all critical data. This includes user documents, database exports, and configuration files.",
    context: "Backup should run after regular business hours to minimize system impact.",
    repeat: "1 day",
    after: "02:00",
    before: "03:00",
    timezone: "America/New_York"
  }
});
```

#### scheduler_remove_task

Removes a scheduled task by name.

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

#### scheduler_get_schedule

Gets the current schedule of all scheduled tasks with their status and next run times.

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

Daily Report : 
  Message: /chat Generate daily report
  Status: pending
  Next Run: Mon, Jan 15, 2024, 9:00:00 AM
  Last Run: Sun, Jan 14, 2024, 9:00:00 AM
```

### State Interfaces

#### ScheduleTaskState

Tracks configured tasks and their execution history:

```typescript
class ScheduleTaskState {
  tasks: Map<string, ScheduledTask>;
  history: Map<string, TaskRunHistory[]>;
}
```

**Properties:**
- `tasks`: Map of task name to ScheduledTask configuration
- `history`: Map of task name to array of execution history entries

#### ScheduleExecutionState

Tracks runtime execution state:

```typescript
class ScheduleExecutionState {
  tasks: Map<string, ExecutionScheduleEntry>;
  autoStart: boolean;
  abortController: AbortController | null;
}
```

**Properties:**
- `tasks`: Map of task name to execution schedule entry
- `autoStart`: Whether the scheduler should auto-start
- `abortController`: Controls the scheduler loop

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

## Usage Examples

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

### Programmatic Task Management

```typescript
// Add a scheduled task
await agent.executeTool('scheduler_add_task', {
  taskName: "Morning Briefing",
  task: {
    description: "Generate a morning briefing with news, weather, and schedule",
    repeat: "1 day",
    after: "07:00",
    before: "08:00"
  }
});

// Get current schedule
const schedule = await agent.executeTool('scheduler_get_schedule', {});

// Remove a task
await agent.executeTool('scheduler_remove_task', {
  taskName: "Morning Briefing"
});
```

### Chat Command Management

Use chat commands to manage scheduled tasks interactively:

```bash
# Start the scheduler
/schedule start

# Stop the scheduler
/schedule stop

# Show all scheduled tasks
/schedule show

# Add a new task interactively
/schedule add

# Remove a task
/schedule remove Daily Report

# View execution history
/schedule history
```

## Configuration

### Plugin Configuration

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

### Agent Configuration

The scheduler is configured per-agent through the agent's configuration. Configuration is validated using Zod schemas.

**Configuration Schema:**

```typescript
const SchedulerAgentConfigSchema = z.object({
  autoStart: z.boolean().default(true),
  tasks: z.record(z.string(), ScheduledTaskSchema).default({})
});
```

**Configuration Example:**

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

## Chat Commands

The scheduler provides comprehensive chat commands for management and monitoring.

### /schedule Command

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

### /schedule add

Interactively add a new scheduled task. Prompts for name, instructions, repeat interval, and optional time window.

**Example:**

```
/schedule add
```

The command will prompt for:
- Task Name
- Instructions for the agent
- How often to run (Once, Every 5 minutes, Every hour, Every day)
- Earliest time of day (optional)
- Latest time of day (optional)

### /schedule remove

Remove a scheduled task by name.

**Example:**

```
/schedule remove myTask
```

### /schedule show

Display all current scheduled tasks with their next and last run times.

**Example:**

```
/schedule show
```

### /schedule history

Display the execution history for all scheduled tasks, including status and duration.

**Example:**

```
/schedule history
```

**Output Format:**

```
=== Task Execution History ===

**Daily Report**
- [Mon, Jan 15, 2024, 9:00:00 AM] Daily Report - completed (120s) Task completed successfully
- [Sun, Jan 14, 2024, 9:00:00 AM] Daily Report - failed (45s) Task failed with error: ...
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
| `timezone`     | `string`  | No       | IANA timezone string (e.g., 'America/New_York', 'UTC')              |

## Schedule Configuration

### Time Intervals

Supported time units:

- `second`, `seconds`
- `minute`, `minutes`
- `hour`, `hours`
- `day`, `days`
- `week`, `weeks`
- `month`, `months`

Format: `"<number> <unit>"` (e.g., "5 minutes", "2 hours")

### Time Windows

Use `after` and `before` to define time windows:

- `after`: Time to start running (HH:MM format, 24-hour clock)
- `before`: Time to stop running (HH:MM format, 24-hour clock)

### Days of Week

Use three-letter abbreviations: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`

Multiple days: `"mon tue wed thu fri"` or `"sat sun"`

### Day of Month

Specify a specific day of the month (1-31) for monthly tasks.

### Timezone Support

Use IANA timezone strings to schedule tasks in specific timezones:

- `"America/New_York"`
- `"Europe/London"`
- `"Asia/Tokyo"`
- `"UTC"`

## Utility Functions

The scheduler package provides several utility functions for time calculations:

### parseInterval

Parses interval strings into seconds.

```typescript
import { parseInterval } from "@tokenring-ai/scheduler/utility/parseInterval";

// Returns 60 (1 minute in seconds)
const interval = parseInterval("1 minute");

// Returns 3600 (1 hour in seconds)
const interval = parseInterval("1 hour");

// Returns null for invalid formats
const invalid = parseInterval("invalid");
```

### getNextRunTime

Calculates the next run time for a scheduled task.

```typescript
import { getNextRunTime } from "@tokenring-ai/scheduler/utility/getNextRunTime";

// For a task configured to run daily at 9:00 AM
const task = {
  message: "/chat Generate daily report",
  repeat: "1 day",
  after: "09:00"
};

const nextRun = getNextRunTime(task);
// Returns timestamp for next scheduled run
```

### checkDayConditions

Checks if a date matches day conditions for scheduling.

```typescript
import { checkDayConditions } from "@tokenring-ai/scheduler/utility/checkDayConditions";
import moment from "moment-timezone";

const task = {
  weekdays: "mon wed fri",
  dayOfMonth: 15
};

const now = moment.tz("America/New_York");

// Check if today matches the day conditions
const matches = checkDayConditions(task, now);
```

## Integration

### Plugin Registration

The scheduler is registered as a TokenRing plugin that automatically:

1. Registers tools with the ChatService
2. Registers commands with the AgentCommandService
3. Creates and attaches SchedulerService to agents

### Service Registration

```typescript
import SchedulerService from "@tokenring-ai/scheduler/SchedulerService";

// The service is automatically registered when the plugin is installed
// No manual registration required
```

### Agent Attachment

When an agent is created with scheduler configuration:

1. Validates configuration using Zod schemas
2. Initializes task and execution state on the agent
3. Optionally auto-starts the scheduler if configured
4. Provides real-time task monitoring through chat commands

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

**State Persistence**: Task configurations are serialized and persist across agent restarts. Note that execution state (running tasks, timers) is not persisted and will be reset on restart.

## Error Handling

- **Task Not Found**: Remove operations throw `Error` when task doesn't exist
- **Configuration Validation**: Invalid configurations prevent agent attachment
- **Graceful Shutdown**: Scheduler stops scheduling new tasks and aborts running tasks
- **Runtime Errors**: Execution errors are captured in run history with error message
- **Cancelled Operations**: Interactive task creation throws `CommandFailedError` when cancelled

## Best Practices

### Task Naming

- Use descriptive, unique task names
- Avoid names with special characters or spaces
- Consider using prefixes for related tasks (e.g., "backup_daily", "backup_weekly")

### Scheduling

- Set appropriate time windows to avoid overlapping executions
- Use timezones to ensure consistent scheduling across regions
- Consider system load when scheduling frequent tasks
- Test task configurations before deploying to production

### Monitoring

- Regularly check execution history for failed tasks
- Use `/schedule show` to verify task status
- Monitor agent logs for scheduler warnings and errors

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

## Dependencies

- `@tokenring-ai/app`: 0.2.0
- `@tokenring-ai/agent`: 0.2.0
- `@tokenring-ai/chat`: 0.2.0
- `@tokenring-ai/rpc`: 0.2.0
- `@tokenring-ai/utility`: 0.2.0
- `zod`: ^4.3.6
- `moment-timezone`: ^0.6.0

## Related Components

- `@tokenring-ai/agent`: Core agent system that the scheduler attaches to
- `@tokenring-ai/chat`: Chat service that provides tool integration
- `@tokenring-ai/app`: Base application framework for plugin registration

## License

MIT License - see [LICENSE](./LICENSE) file for details.
