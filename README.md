# @tokenring-ai/scheduler

Fires schedules: agent jobs, chat prompts, queue items, workflows and task dispatches at set times.

## Overview

`SchedulerService` is an app-level trigger: named schedules (from config, or added by people and agents) fire an
action at set times — start an agent job, prompt a chat, add a queue item, start a workflow, or dispatch a task's
agent. Unattended runs go through the agent job engine (`AgentJobService`), so they get its approval snapshot,
limits, time limits, cleanup and job records.

## Schedules

Schedules belong to the app, not to an agent: deleting an agent leaves them alone, and config schedules are not
copied into agents. Each has a timing and an **action**:

| Action kind | Does | Run status comes from |
|---|---|---|
| `job` `{ agentType, prompt }` | Starts an agent job (owner `scheduler`, origin the schedule): a fresh agent runs the prompt and is cleaned up | the job |
| `agent` `{ agentId, prompt }` | Prompts an existing agent (a chat); queues behind its work, and stopping the run cancels only its own request. `/loop` uses this | the agent's response |
| `queue` `{ queue, item: { name, prompt } }` | Adds an item to a work queue (needs the queue plugin) | enqueued = completed |
| `workflow` `{ name }` | Starts a workflow run (needs the workflow plugin) | the run's job |
| `task` `{ ref: { board, taskId }, assignmentId }` | Dispatches a task's assigned agent (needs the tasks plugin) | the dispatch |

Every job a schedule starts — directly, or through the queue item, workflow run or task dispatch it creates — records
the schedule as its origin (`{ kind: "schedule", scheduleId }`), so the Agents app's Agent jobs page shows which
schedule started it.

User-added schedules, every schedule's run bookkeeping (`lastRunTime`, repeat anchor, pause of a config schedule)
and run history (capped per schedule) are saved atomically to `schedules.json` in the workspace. Older versions kept
tasks in each agent's state; a restored agent's tasks move into the store once, as `agent` schedules on that agent.

**Timing.** Repeats stay on a grid counted from their first run (an edit of the timing starts a new grid from the
last run), so long runs do not make them drift. `day`, `week` and `month` repeats follow the calendar in the
schedule's timezone (DST-correct; a month from the 31st is the last day of a shorter month, then the 31st again).
Without `repeat` a schedule runs once a day; with `once` it runs once and is then disabled. A slot missed while the
app was down fires once when it is back, if its days and window allow, otherwise when the window next opens. Days
are searched a full year ahead. Repeats are at least 1 minute and at most a year; timezones must be known IANA
names. A schedule whose next run cannot be computed shows an **error** state.

**Runs.** A run takes its slot when it starts (`lastRunTime` = the scheduled time), so a restart never fires it
twice, and a failed run is not retried before the next slot. Runs link to their agent job (`jobId`). A run in
flight when the app stops or crashes is recorded `interrupted` and not re-run.

**Exact time (`at`).** `at` is an ISO-8601 instant with `Z` or a UTC offset (`2026-11-20T09:00:00-05:00`). The
schedule runs once at that instant (or once, as soon as the app is back, if it was down then) and is then done. It
cannot be combined with `repeat`, a window, weekdays or a day of month, and a new schedule cannot be in the past.

**Tool action.** `{ kind: "tool", agentType, tool, input, maxCostUsd?, maxApprovalLevel? }` starts a fresh agent job
(owner `scheduler`) and runs the named chat tool once with the fixed `input`, with no model turn. The tool's own
approval runs, so a tool that needs a permission grant (for example `x_createPost`) is refused, and the refusal is
recorded on the job, when none exists. The tool and input are checked when the schedule is saved and again when it
fires. Only config, the RPC and plugin code create these; the `scheduler_add_task` and `scheduler_update_task` tools
cannot, and refuse to edit one. `x_schedulePost` and `reddit_schedulePost` use it to schedule social posts.

## RPC

Endpoint `/rpc/scheduler`: `listSchedules`, `addSchedule`, `updateSchedule` (user schedules; keeps `lastRunTime`),
`removeSchedule`, `setScheduleEnabled` (pause/resume, also for config schedules), `runSchedule` (run now),
`setSchedulerRunning` (start/stop firing, saved across restarts), `getHistory`, `clearHistory` and `previewNextRun`
(next run of an unsaved timing, or why it cannot run).

## Web UI

The Scheduler app's **Schedules** view adds (any action kind), edits, pauses/resumes, runs and removes schedules, and
starts or stops the scheduler; its form shows a live "Next run" preview. The **Runs** view lists every schedule's runs
with a **Job** link to each run's agent job (`/agents/jobs?job=<id>`), filtered by schedule and status.

## Chat Commands

| Command                        | Description                                       |
|--------------------------------|---------------------------------------------------|
| `/schedule start`              | Start firing schedules (whole app)                |
| `/schedule stop`               | Stop firing schedules and the runs in progress    |
| `/schedule show`               | Display every schedule with its status            |
| `/schedule add`                | Interactively add a schedule (new agent or this chat) |
| `/schedule remove <name>`      | Remove a schedule by name                         |
| `/schedule history [name]`     | Display run history                               |
| `/loop [interval] <prompt>`    | Prompt this chat repeatedly                       |

## Tools

| Name                       | Approval | Description                                                    |
|----------------------------|----------|----------------------------------------------------------------|
| `scheduler_add_task`       | 5 once / 7 repeating | Add a schedule: a new agent (default) or this chat         |
| `scheduler_update_task`    | 7        | Replace a schedule's prompt and timing                         |
| `scheduler_set_enabled`    | 4 pause / 7 resume | Pause or resume a schedule                       |
| `scheduler_remove_task`    | 6        | Remove a schedule and its history                              |
| `scheduler_get_schedule`   | —        | List every schedule                                            |

## Configuration

```yaml
scheduler:
  autoStart: true            # fire schedules when the app starts (until /schedule stop)
  maxHistoryPerSchedule: 50  # runs kept per schedule
  schedules:
    Daily Report:
      repeat: "1 day"
      after: "09:00"
      before: "17:00"
      weekdays: "mon tue wed thu fri"
      timezone: "America/New_York"
      action: { kind: job, agentType: code, prompt: "Generate the daily report" }
    Weekly Docs:
      repeat: "1 week"
      weekdays: "sun"
      action: { kind: queue, queue: docs, item: { name: "Refresh docs", prompt: "Refresh the docs" } }
```

Config schedules are edited in config; they can be paused and run from the app. The old `agentDefaults` block
(tasks copied into every agent) is gone.

Timing fields: `repeat` (`"<number> <unit>"`, units second…month), `once`, `after` / `before` (`HH:mm`, 24-hour),
`weekdays` (e.g. `"mon tue"`), `dayOfMonth` (1–31), `timezone` (IANA; default the server's), `enabled`.

## License

MIT License - see [LICENSE](./LICENSE) file for details.
