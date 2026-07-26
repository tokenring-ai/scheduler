# @tokenring-ai/scheduler

Cron-like service for triggering agent actions at specific intervals.

## Overview

The `@tokenring-ai/scheduler` package provides automated scheduling of AI agents with flexible timing options, runtime
monitoring, and task state management. It runs within an AI agent to schedule and execute tasks based on configurable
schedules.

**Key Features:**

- **Flexible Scheduling**: Support for interval-based, one-time, and repeating scheduling
- **Time Window Control**: Define start and end times for task execution
- **Day Conditions**: Schedule tasks on specific days of the week or month
- **Timezone Support**: Full IANA timezone support for global scheduling
- **Runtime Monitoring**: Real-time task status and execution history
- **Interactive Task Management**: Chat commands for adding, removing, and monitoring tasks
- **Programmatic API**: Tools for integrating scheduling into agent workflows
- **RPC Interface**: Remote procedure call endpoint for external task management
- **State Persistence**: Task configurations persist across agent restarts
- **Graceful Shutdown**: Clean task cancellation and state cleanup
- **Loop Commands**: Quick scheduling of repeated prompts via `/loop` command

**Integration Points:**

- Integrates with `@tokenring-ai/agent` for state management and background task execution
- Registers tools with `@tokenring-ai/chat` for programmatic task management
- Registers commands with `@tokenring-ai/agent` for interactive CLI operations
- Registers RPC endpoint with `@tokenring-ai/rpc` for remote access
- Uses `@tokenring-ai/utility` for configuration utilities

## Installation

The scheduler is installed as a plugin in your TokenRing application:

```bash
bun install @tokenring-ai/scheduler
```

**Note:** This package is typically installed as part of the TokenRing application ecosystem and is not meant to be used
standalone.

## Features

- **Flexible Scheduling**: Support for interval-based, one-time, and repeating scheduling
- **Time Window Control**: Define start and end times for task execution with `after` and `before` parameters
- **Day Conditions**: Schedule tasks on specific days of the week (`weekdays`) or month (`dayOfMonth`)
- **Timezone Support**: Full IANA timezone support for global scheduling
- **Runtime Monitoring**: Real-time task status and execution history via `/schedule show` and `/schedule history`
- **Interactive Task Management**: Chat commands for adding, removing, and monitoring tasks
- **Programmatic API**: Tools for integrating scheduling into agent workflows (`scheduler_add_task`,
  `scheduler_remove_task`, `scheduler_get_schedule`)
- **RPC Interface**: Remote procedure call endpoint at `/rpc/scheduler` for external task management
- **State Persistence**: Task configurations persist across agent restarts (execution history is not persisted)
- **Graceful Shutdown**: Clean task cancellation and state cleanup via abort controllers
- **Loop Commands**: Quick scheduling of repeated prompts via `/loop` command
- **Background Task Execution**: Tasks run in background without blocking agent operations
- **Event-Driven Architecture**: Watches for task state changes and updates schedules automatically
- **Error Handling**: Comprehensive error handling with detailed logging and history recording

## Chat Commands

| Command                        | Description                                       |
|--------------------------------|---------------------------------------------------|
| `/schedule start`              | Start the scheduler service                       |
| `/schedule stop`               | Stop the scheduler service                        |
| `/schedule show`               | Display current scheduled tasks with status       |
| `/schedule add`                | Interactively add a new scheduled task            |
| `/schedule remove <name>`      | Remove a scheduled task by name                   |
| `/schedule history`            | Display task execution history                    |
| `/loop [interval] <prompt>`    | Schedule a prompt to run repeatedly               |

## Tools

| Name                       | Display Name          | Description                                                    |
|----------------------------|-----------------------|----------------------------------------------------------------|
| `scheduler_add_task`       | Scheduler/add_task    | Add a scheduled task to run at specified intervals             |
| `scheduler_remove_task`    | Scheduler/removeTask  | Remove a scheduled task by name                                |
| `scheduler_get_schedule`   | Scheduler/get_schedule | Get the current schedule of all scheduled tasks                |

## Configuration

### Plugin Configuration

The scheduler plugin is configured at the application level. Configuration is validated using Zod schemas and merged
with agent-specific configuration using deep clone.

**Configuration Example:**

```yaml
scheduler:
  agentDefaults:
    autoStart: true
    tasks:
      Daily Report:
        message: "/chat Generate daily report"
        repeat: "1 day"
        after: "09:00"
        before: "17:00"
        weekdays: "mon tue wed thu fri"
      Health Check:
        message: "/chat Check system health"
        repeat: "30 minutes"
        after: "00:00"
        before: "23:59"
      Weekly Cleanup:
        message: "/chat Clean up old files"
        repeat: "1 week"
        weekdays: "sun"
```

### Configuration Options

| Option                    | Type     | Default | Description                                                            |
|---------------------------|----------|---------|------------------------------------------------------------------------|
| `agentDefaults.autoStart` | `boolean` | `true`  | Whether to automatically start the scheduler when tasks are configured |
| `agentDefaults.tasks`     | `object` | `{}`    | Initial task configurations keyed by task name                         |

### ScheduledTask Schema

| Property      | Type     | Required | Description                                                         |
|---------------|----------|----------|---------------------------------------------------------------------|
| `message`     | `string` | Yes      | Message/prompt delivered to the agent when this task fires          |
| `repeat`      | `string` | No       | Run at fixed intervals (e.g., "30 seconds", "5 minutes", "2 hours") |
| `after`       | `string` | No       | Start time in HH:MM format (e.g., "09:00")                          |
| `before`      | `string` | No       | End time in HH:MM format (e.g., "17:00")                            |
| `weekdays`    | `string` | No       | Days of week (e.g., "mon tue wed thu fri", "sat sun")               |
| `dayOfMonth`  | `number` | No       | Specific day of month (1-31)                                        |
| `lastRunTime` | `number` | No       | Timestamp of last execution (default: 0, hidden from UI)            |
| `timezone`    | `string` | No       | IANA timezone string (e.g., 'America/New_York', 'UTC')              |

**Note:** Tasks without `repeat` run only once. For one-time tasks, omit the `repeat` field. The task will run on the
next available day that matches any day conditions (weekdays, dayOfMonth) and falls within the time window
(after/before).

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

## License

MIT License - see [LICENSE](./LICENSE) file for details.
