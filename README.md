# @tokenring-ai/scheduler

Schedule AI agents to run at specified intervals with a user-friendly JSON configuration.

## Installation

```bash
npm install @tokenring-ai/scheduler
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

### Configuration

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

- **name** (required): Task identifier for logging
- **agentType** (required): Agent type to spawn
- **message** (required): Message to send to the agent

### Timing Options

- **every**: Run at fixed intervals (e.g., "30 seconds", "5 minutes", "2 hours")
- **spaced**: Run with spacing between completions (e.g., "10 minutes")
- **once**: Run once per day (boolean)
- **from**: Start time in HH:MM format (e.g., "09:00")
- **to**: End time in HH:MM format (e.g., "17:00")
- **on**: Days of week (e.g., "mon tue wed", "sat sun")
- **dayOfMonth**: Specific day (1-31)

### Execution Options

- **several**: Allow multiple simultaneous runs (default: false)
- **noLongerThan**: Maximum runtime (e.g., "10 minutes")

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
class SchedulerService {
  constructor(app: TokenRingApp, tasks: ScheduleTask[]);
  start(): Promise<void>;
  stop(): Promise<void>;
}
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

## License

MIT License - see LICENSE file for details.
