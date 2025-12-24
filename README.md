# @tokenring-ai/scheduler

Schedule AI agents to run at specified intervals with comprehensive timing control, runtime monitoring, and task state management.

## Overview

The Scheduler service provides automated scheduling for AI agents with flexible timing options, runtime monitoring, and task state management. It integrates seamlessly with the TokenRing ecosystem through automatic service registration and provides real-time monitoring through chat commands.

## Installation

```bash
bun install @tokenring-ai/scheduler
```

## Usage

### Basic Integration

```typescript
import TokenRingApp from "@tokenring-ai/app";
import scheduler from "@tokenring-ai/scheduler";

const app = new TokenRingApp({
  // Your app configuration
});

app.install(scheduler);
```

### Automatic Service Registration

The scheduler service automatically registers with TokenRing applications when tasks are configured. The plugin:

1. Validates configuration using Zod schemas
2. Registers chat commands automatically
3. Creates and manages the SchedulerService instance
4. Provides real-time task monitoring

## Configuration

Add a `scheduler` section to your `.tokenring/config.mjs`:

```javascript
export default {
  scheduler: {
    tasks: [
      {
        name: "Daily Report",
        agentType: "reportGenerator",
        message: "/chat Generate daily report",
        once: true,
        from: "09:00",
        on: "mon tue wed thu fri"
      },
      {
        name: "Health Check",
        agentType: "healthMonitor",
        message: "/chat Check system health",
        every: "30 minutes",
        noLongerThan: "5 minutes"
      },
      {
        name: "Weekly Cleanup",
        agentType: "cleanupAgent",
        message: "/chat Clean up old files",
        once: true,
        on: "sun",
        from: "02:00"
      }
    ]
  }
};
```

## Schedule Configuration

### Task Properties

- **name** (required): Unique task identifier for logging and monitoring
- **agentType** (required): Agent type to spawn (must be available in AgentManager)
- **message** (required): Message to send to the spawned agent

### Timing Options

- **every**: Run at fixed intervals (e.g., "30 seconds", "5 minutes", "2 hours")
- **spaced**: Run with spacing between completions (e.g., "10 minutes")
- **once**: Run once per day (boolean)
- **from**: Start time in HH:MM format (e.g., "09:00")
- **to**: End time in HH:MM format (e.g., "17:00")
- **on**: Days of week (e.g., "mon tue wed", "sat sun")
- **dayOfMonth**: Specific day of month (1-31)

### Execution Options

- **several**: Allow multiple simultaneous runs (default: false)
- **noLongerThan**: Maximum runtime duration (e.g., "10 minutes")

## Chat Commands

### /schedule Command

The scheduler provides a comprehensive chat command for monitoring:

```
/schedule
```

**Output:**
- Current scheduled tasks with next/last run times
- Task execution status (Running/Idle)
- Last 50 agent execution runs with status and duration
- Error information for failed runs

**Example Output:**
```
=== Scheduled Tasks ===

**Daily Report** (reportGenerator)
  Message: /chat Generate daily report
  Status: Idle
  Next Run: Mon, Jan 15, 2024, 9:00:00 AM
  Last Run: Sun, Jan 14, 2024, 9:00:00 AM

**Health Check** (healthMonitor)
  Message: /chat Check system health
  Status: Running
  Next Run: Mon, Jan 14, 2024, 2:30:00 PM

Last 10 Runs ===

[Mon, Jan 15, 2024, 9:00:00 AM] Daily Report - completed (45s)
[Mon, Jan 15, 2024, 8:30:00 AM] Health Check - failed (300s)
  Error: Agent timeout exceeded
```

## Examples

### Run Every Hour During Business Hours

```javascript
{
  name: "Hourly Sync",
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
  name: "Morning Briefing",
  agentType: "briefingAgent",
  message: "/chat Generate morning briefing",
  once: true,
  from: "08:00"
}
```

### Run Every 30 Minutes with Timeout

```javascript
{
  name: "Quick Check",
  agentType: "monitorAgent",
  message: "/chat Quick system check",
  every: "30 minutes",
  noLongerThan: "5 minutes"
}
```

### Run on Specific Day of Month

```javascript
{
  name: "Monthly Report",
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
  name: "Parallel Processing",
  agentType: "processingAgent",
  message: "/chat Process queue",
  every: "5 minutes",
  several: true
}
```

## API Reference

### ScheduleTask

```typescript
interface ScheduleTask {
  name: string;
  agentType: string;
  message: string;
  every?: string;
  spaced?: string;
  once?: boolean;
  from?: string;
  to?: string;
  on?: string;
  dayOfMonth?: number;
  noLongerThan?: string;
  several?: boolean;
}
```

### SchedulerService

```typescript
class SchedulerService implements TokenRingService {
  name = "SchedulerService";
  description = "Schedules AI agents to run at specified intervals";
  
  constructor(app: TokenRingApp, tasks: ScheduleTask[]);
  run(signal: AbortSignal): Promise<void>;
  getStatus(): SchedulerStatus;
}
```

### SchedulerStatus

```typescript
interface SchedulerStatus {
  tasks: TaskStatus[];
  history: TaskRunHistory[];
}

interface TaskStatus {
  name: string;
  agentType: string;
  message: string;
  isRunning: boolean;
  nextRun?: number;
  lastRun?: number;
}

interface TaskRunHistory {
  taskName: string;
  startTime: number;
  endTime?: number;
  error?: string;
}
```

## Configuration Schema

The scheduler uses Zod for configuration validation:

```typescript
const SchedulerConfigSchema = z.object({
  tasks: z.array(ScheduleTaskSchema)
}).optional();

const ScheduleTaskSchema = z.object({
  name: z.string(),
  agentType: z.string(),
  every: z.string().optional(),
  spaced: z.string().optional(),
  once: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  on: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  noLongerThan: z.string().optional(),
  several: z.boolean().optional(),
  message: z.string(),
});
```

## Time Intervals

Supported time units:
- `second`, `seconds`
- `minute`, `minutes`
- `hour`, `hours`
- `day`, `days`

Format: `"<number> <unit>"` (e.g., "5 minutes", "2 hours")

## Days of Week

Use three-letter abbreviations: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`

Multiple days: `"mon tue wed thu fri"` or `"sat sun"`

## Task State Management

The scheduler maintains detailed state for each task:

- **nextRun**: Timestamp for next execution
- **lastRun**: Timestamp of last execution
- **isRunning**: Current execution status
- **startTime**: When current run started
- **maxRunTime**: Runtime limit for timeout detection

## Error Handling

- **Runtime Timeout**: Tasks exceeding `noLongerThan` are logged and terminated
- **Agent Errors**: Execution errors are captured in run history
- **Configuration Validation**: Invalid configurations prevent service startup
- **Graceful Shutdown**: Tasks complete before service termination

## Monitoring and Logging

- **Service Output**: Real-time logging of task scheduling and execution
- **Run History**: Last 50 executions tracked with timing and error information
- **Status Monitoring**: Real-time task status through `/schedule` command
- **Performance Tracking**: Runtime duration and timeout monitoring

## Integration Features

- **Automatic Registration**: Plugin automatically registers services and commands
- **Agent Integration**: Seamless integration with AgentManager for agent spawning
- **Event Streaming**: Real-time event monitoring during agent execution
- **State Persistence**: Task state maintained across service restarts
- **Headless Operation**: All scheduled agents run in headless mode by default

## Dependencies

- `@tokenring-ai/app`: Application framework integration
- `@tokenring-ai/agent`: Agent spawning and management
- `zod`: Configuration validation

## License

MIT License - see LICENSE file for details.