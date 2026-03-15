# @tokenring-ai/scheduler

Schedule AI agents to run at specified intervals with comprehensive timing control, runtime monitoring, and task state management.

## Overview

The Scheduler service runs within an AI agent to provide automated scheduling of other agents with flexible timing options, runtime monitoring, and task state management. It integrates seamlessly with the TokenRing ecosystem through automatic service attachment and provides real-time monitoring through chat commands and tools.

## Installation

```bash
bun install @tokenring-ai/scheduler
```

## Features

- **Flexible Scheduling**: Support for interval-based, one-time, and repeating scheduling
- **Time Window Control**: Define start and end times for task execution
- **Day Conditions**: Schedule tasks on specific days of the week or month
- **Timezone Support**: Full IANA timezone support for global scheduling
- **Runtime Monitoring**: Real-time task status and execution history
- **Interactive Task Management**: Chat commands for adding, removing, and monitoring tasks
- **Programmatic API**: Tools for integrating scheduling into agent workflows
- **State Persistence**: Task configurations persist across agent restarts
- **Graceful Shutdown**: Clean task cancellation and state cleanup
- **Loop Commands**: Quick scheduling of repeated prompts via `/loop` command

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

Starts the scheduler loop for the given agent. Creates a background task that watches for task executions. Starts a scheduler only if:
- No scheduler is already running
- At least one task is configured
- Sets up abort handling and cleanup

#### stopScheduler(agent: Agent): void

Stops the scheduler loop for the given agent by aborting the running scheduler.

#### addTask(name: string, task: ScheduledTask, agent: Agent): void

Adds a new scheduled task to the agent. If autoStart is enabled and the scheduler is not running, it will start automatically.

#### removeTask(name: string, agent: Agent): void

Removes a scheduled task from the agent, clearing any timers or running tasks. Throws `Error` if task not found.

#### watchTasks(agent: Agent, signal: AbortSignal): Promise<void>

Watches task state and schedules executions. Monitors for task changes and updates timers accordingly. Subscribes to `ScheduleTaskState` changes and manages execution state.

#### runTask(name: string, task: ScheduledTask, agent: Agent): Promise<void>

Executes a scheduled task by sending the task message to the agent and monitoring execution. Tracks execution state and records history.

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

**Note:** The tool combines `description` and `context` into the task message with the format:
```
{description}

ADDITIONAL CONTEXT:{context}
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

**Throws:** `Error` if task not found

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

The current date and time is {current datetime}, and the following tasks are scheduled

Daily Backup : 
  Message: Run a full backup...
  Status: pending
  Next Run: Mon, Jan 15, 2024, 2:00:00 AM
  Last Run: Sun, Jan 14, 2024, 2:00:00 AM
```

### State Interfaces

#### ScheduleTaskState

Tracks configured tasks and their execution history:

```typescript
class ScheduleTaskState implements AgentStateSlice {
  tasks: Map<string, ScheduledTask>;
  history: Map<string, TaskRunHistory[]>;
}
```

**Properties:**
- `tasks`: Map of task name to ScheduledTask configuration
- `history`: Map of task name to array of execution history entries

**Serialization:** Only `tasks` are persisted (not `history`)

#### ScheduleExecutionState

Tracks runtime execution state:

```typescript
class ScheduleExecutionState implements AgentStateSlice {
  tasks: Map<string, ExecutionScheduleEntry>;
  autoStart: boolean;
  abortController: AbortController | null;
}
```

**Properties:**
- `tasks`: Map of task name to execution schedule entry
- `autoStart`: Whether the scheduler should auto-start
- `abortController`: Controls the scheduler loop

**Serialization:** Only `autoStart` is persisted

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

# Schedule a repeated prompt
/loop 5m check if the deployment finished
/loop check the build every 2 hours
```

## Configuration

### Plugin Configuration

The scheduler plugin is configured at the application level in `.tokenring/config.mjs`:

```javascript
export default {
  scheduler: {\
    agentDefaults: {
      autoStart: true,
      tasks: {}
    }
  }
};
```

The `agentDefaults` are merged with per-agent configuration using deep merge, allowing global defaults while supporting agent-specific overrides.

### Agent Configuration

The scheduler is configured per-agent through the agent's configuration. Configuration is validated using Zod schemas.

**Configuration Schema:**

```typescript
const SchedulerConfigSchema = z.object({
  agentDefaults: z.object({
    autoStart: z.boolean().default(true),
    tasks: z.record(z.string(), ScheduledTaskSchema).default({})
  })
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
- **Task Name**: Unique identifier for the task
- **Instructions for the agent**: The message to send to the agent when the task runs
- **How often to run**: One of:
  - Once (runs only one time, no repeat)
  - Every 5 minutes
  - Every hour
  - Every day
- **Earliest time of day**: Optional start time (hh:mm, 24-hour clock)
- **Latest time of day**: Optional end time (hh:mm, 24-hour clock)

**Note:** If "Once" is selected, the task is scheduled to run once at the specified time window without repetition.

### /schedule remove

Remove a scheduled task by name.

**Example:**

```
/schedule remove myTask
```

**Throws:** `CommandFailedError` if no name provided or task not found

### /schedule show

Display all current scheduled tasks with their next and last run times.

**Example:**

```
/schedule show
```

**Output Format:**

```
=== Scheduled Tasks ===

**TaskName**
  Message: {task message}
  Status: {pending|running|Not scheduled}
  Next Run: {datetime or "Not scheduled"}
  Last Run: {datetime or "Never"}
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

### /loop

Schedule a prompt to run repeatedly in the current session. This is a quick way to schedule repeated tasks without using the full `/schedule add` interface.

**Usage:**

```
/loop [interval] <prompt>
/loop <prompt> every <interval>
```

If no interval is provided, the prompt runs every 10 minutes.

**Examples:**

```bash
# Run every 5 minutes
/loop 5m check if the deployment finished

# Run every 2 hours
/loop check the build every 2 hours

# Run every 20 minutes (default format)
/loop /review-pr 1234 every 20m

# Run every 10 minutes (default interval)
/loop monitor the logs
```

**Supported Intervals:**
- Seconds: `s`, `sec`, `secs`, `second`, `seconds` (rounded up to minutes)
- Minutes: `m`, `min`, `mins`, `minute`, `minutes`
- Hours: `h`, `hr`, `hrs`, `hour`, `hours`
- Days: `d`, `day`, `days`

**Note:** Seconds are rounded up to the nearest minute since the scheduler operates on minute granularity. A task name is automatically generated (e.g., `loop-abc123def`).

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

**Note:** Tasks without `repeat` run only once at the specified time.

## Schedule Configuration

### Time Intervals

Supported time units:

- `second`, `seconds`
- `minute`, `minutes`
- `hour`, `hours`
- `day`, `days`
- `week`, `weeks`
- `month`, `months`

Format: `"<number> <unit>"` (e.g., "5 minutes", "2 hours", "30 minute")

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

If not specified, uses the user's detected timezone via `moment-timezone`.

## Utility Functions

The scheduler package provides several utility functions for time calculations:

### parseInterval

Parses interval strings into seconds.

**Location:** `@tokenring-ai/scheduler/utility/parseInterval`

```typescript
import { parseInterval } from "@tokenring-ai/scheduler/utility/parseInterval";

// Returns 60 (1 minute in seconds)
const interval = parseInterval("1 minute");

// Returns 3600 (1 hour in seconds)
const interval = parseInterval("1 hour");

// Returns 1728000 (20 days in seconds)
const interval = parseInterval("20 days");

// Returns null for invalid formats
const invalid = parseInterval("invalid");
```

**Supported Units:**
- `second`/`seconds`: 1 second
- `minute`/`minutes`: 60 seconds
- `hour`/`hours`: 3600 seconds
- `day`/`days`: 86400 seconds
- `week`/`weeks`: 604800 seconds (86400 × 7)
- `month`/`months`: 2678400 seconds (86400 × 31)

### getNextRunTime

Calculates the next run time for a scheduled task.

**Location:** `@tokenring-ai/scheduler/utility/getNextRunTime`

```typescript
import { getNextRunTime } from "@tokenring-ai/scheduler/utility/getNextRunTime";

// For a task configured to run daily at 9:00 AM
const task = {
  message: "/chat Generate daily report",
  repeat: "1 day",
  after: "09:00"
};

const nextRun = getNextRunTime(task);
// Returns timestamp for next scheduled run (or null if not schedulable)
```

**Behavior:**
- For tasks with `repeat`: Calculates next run time based on `lastRunTime + interval`
- For one-time tasks (no `repeat`): Calculates next run time from today/tomorrow
- Respects `after` and `before` time windows
- Respects `weekdays` and `dayOfMonth` conditions
- Searches up to 30 days ahead (`MAX_DAYS_AHEAD`)
- Returns `null` if no valid run time found within search window

### checkDayConditions

Checks if a date matches day conditions for scheduling.

**Location:** `@tokenring-ai/scheduler/utility/checkDayConditions`

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

**Behavior:**
- Checks if `dayOfMonth` matches (if specified)
- Checks if current day of week is in `weekdays` list (if specified)
- Returns `true` if both conditions match (or if no conditions specified)

### parseLoopCommand

Parses `/loop` command syntax into structured task configuration.

**Location:** `@tokenring-ai/scheduler/utility/parseLoopCommand`

```typescript
import { parseLoopCommand } from "@tokenring-ai/scheduler/utility/parseLoopCommand";

// Parse leading interval format
const result1 = parseLoopCommand("5m check deployment");
// { prompt: "check deployment", repeat: "5 minutes", displayInterval: "5 minutes" }

// Parse trailing "every" format
const result2 = parseLoopCommand("check build every 2 hours");
// { prompt: "check build", repeat: "2 hours", displayInterval: "2 hours" }

// Parse default interval (10 minutes)
const result3 = parseLoopCommand("monitor logs");
// { prompt: "monitor logs", repeat: "10 minutes", displayInterval: "10 minutes" }

// Parse seconds (rounded up to minutes)
const result4 = parseLoopCommand("30s ping server");
// { prompt: "ping server", repeat: "1 minute", displayInterval: "1 minute", note: "Rounded 30 seconds up to 1 minute..." }
```

**Behavior:**
- Supports leading interval format: `<interval> <prompt>`
- Supports trailing "every" format: `<prompt> every <interval>`
- Defaults to 10 minutes if no interval specified
- Rounds seconds up to the nearest minute
- Returns `null` for invalid input

## Integration

### Plugin Registration

The scheduler is registered as a TokenRing plugin that automatically:

1. Registers tools with the `ChatService`
2. Registers commands with the `AgentCommandService`
3. Creates and attaches `SchedulerService` to agents

### Service Registration

```typescript
import SchedulerService from "@tokenring-ai/scheduler/SchedulerService";

// The service is automatically registered when the plugin is installed
// No manual registration required
```

### Agent Attachment

When an agent is created with scheduler configuration:

1. Validates configuration using Zod schemas
2. Deep merges `agentDefaults` with agent-specific configuration
3. Initializes `ScheduleTaskState` and `ScheduleExecutionState` on the agent
4. Optionally auto-starts the scheduler if `autoStart` is true and tasks exist
5. Provides real-time task monitoring through chat commands and tools

## State Management

The scheduler maintains task state within the agent using two state slices:

### ScheduleTaskState

Tracks configured tasks and their execution history:
- `tasks`: Map of task name to ScheduledTask configuration
- `history`: Map of task name to array of TaskRunHistory entries

**Persistence:** Only `tasks` are serialized and persisted across agent restarts. Execution history is not persisted.

### ScheduleExecutionState

Tracks runtime execution state:
- `tasks`: Map of task name to ExecutionScheduleEntry
- `autoStart`: Whether the scheduler should auto-start
- `abortController`: Controls the scheduler loop

**Persistence:** Only `autoStart` is serialized and persisted. Runtime state (running tasks, timers) is not persisted and will be reset on restart.

**State Restoration Pattern:**
```typescript
// On agent restart, task configurations are restored from serialization
// The scheduler can be manually started with /schedule start
// Or automatically if autoStart is true and tasks exist
```

## Error Handling

- **Task Not Found**: `removeTask` throws `Error` when task doesn't exist
- **Configuration Validation**: Invalid configurations prevent agent attachment via Zod validation
- **Graceful Shutdown**: Scheduler stops scheduling new tasks and aborts running tasks via abort controller
- **Runtime Errors**: Execution errors are captured in run history with error message
- **Cancelled Operations**: Interactive task creation throws `CommandFailedError` when cancelled (e.g., user cancels form)
- **Missing Task Name**: `/schedule remove` throws `CommandFailedError` if no name provided
- **Task Exited Without Reason**: If task execution completes without proper event handling, marked as failed with "Task exited without any reason given"
- **Invalid Loop Command**: `/loop` throws `CommandFailedError` if command syntax is invalid

## Best Practices

### Task Naming

- Use descriptive, unique task names
- Avoid names with special characters or spaces
- Consider using prefixes for related tasks (e.g., "backup_daily", "backup_weekly")
- Ensure task names match between tools and commands

### Scheduling

- Set appropriate time windows to avoid overlapping executions
- Use timezones to ensure consistent scheduling across regions
- Consider system load when scheduling frequent tasks
- Test task configurations before deploying to production
- Use `weekdays` for business-day-only tasks
- Use `dayOfMonth` for monthly tasks (e.g., billing, reports)

### Monitoring

- Regularly check execution history for failed tasks with `/schedule history`
- Use `/schedule show` to verify task status
- Monitor agent logs for scheduler warnings and errors
- Review task duration in history to identify performance issues

### Task Design

- Keep task messages concise and focused
- Include context in task description for clarity
- Use appropriate repeat intervals (avoid too frequent execution)
- Consider using time windows to limit execution to off-peak hours

### State Management

- Understand that execution history is not persisted
- Plan for scheduler restart behavior (use `/schedule start` if needed)
- Verify task configurations after agent restarts

### Loop Command Usage

- Use `/loop` for quick, temporary repeated tasks
- Use `/schedule add` for permanent, configurable tasks
- Remember that loop tasks are auto-generated and may be harder to manage
- Use `/schedule show` to see all running tasks including loops

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

**Test Files:**
- `utility/getNextRunTime.test.ts` - Tests for next run time calculation
- `utility/parseInterval.test.ts` - Tests for interval parsing
- `utility/checkDayConditions.test.ts` - Tests for day condition checking
- `utility/parseLoopCommand.test.ts` - Tests for loop command parsing

## Dependencies

- `@tokenring-ai/app`: 0.2.0
- `@tokenring-ai/agent`: 0.2.0
- `@tokenring-ai/chat`: 0.2.0
- `@tokenring-ai/rpc`: 0.2.0
- `@tokenring-ai/utility`: 0.2.0
- `zod`: ^4.3.6
- `moment-timezone`: ^0.6.0

**Dev Dependencies:**
- `vitest`: ^4.1.0
- `typescript`: ^5.9.3

## Related Components

- `@tokenring-ai/agent`: Core agent system that the scheduler attaches to
- `@tokenring-ai/chat`: Chat service that provides tool integration
- `@tokenring-ai/app`: Base application framework for plugin registration
- `@tokenring-ai/utility`: Shared utilities including `deepMerge` for configuration

## License

MIT License - see [LICENSE](./LICENSE) file for details.
