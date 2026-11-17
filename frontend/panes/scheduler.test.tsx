import { beforeEach, describe, expect, it, mock } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createLayoutRegistry } from "@tokenring-ai/one-frontend/layout/registry.ts";
import { renderLayoutApp } from "@tokenring-ai/one-frontend/test/layout.tsx";
import type React from "react";
import type { ScheduleRun, ScheduleView } from "../../schema.ts";

const agent = {
  id: "agent-1",
  createdAt: 1_700_000_000_000,
  agentType: "code",
  displayName: "Code Engineer #1",
  description: "Writes code",
  idle: true,
  currentActivity: "",
};

const nextRun = Date.now() + 60 * 60_000;

function dailyStandup(overrides: Partial<ScheduleView> = {}): ScheduleView {
  return {
    name: "Daily standup",
    source: "user",
    definition: {
      repeat: "1 day",
      after: "09:00",
      before: "17:00",
      weekdays: "mon tue wed thu fri",
      timezone: "UTC",
      action: { kind: "job", agentType: "code", prompt: "Summarize overnight CI failures and open a draft status update." },
    },
    enabled: true,
    state: "scheduled",
    lastRunTime: 0,
    nextRunTime: nextRun,
    error: null,
    currentRun: null,
    ...overrides,
  };
}

function run(overrides: Partial<ScheduleRun>): ScheduleRun {
  return {
    id: crypto.randomUUID(),
    scheduledFor: Date.now() - 3_600_000,
    startTime: Date.now() - 3_600_000,
    endTime: Date.now() - 3_540_000,
    status: "completed",
    message: "Brief generated successfully",
    actionKind: "job",
    jobId: "job-1",
    manual: false,
    ...overrides,
  };
}

const state = {
  running: true,
  error: undefined as Error | undefined,
  schedules: [] as ScheduleView[],
  history: {} as Record<string, ScheduleRun[]>,
  rollup: undefined as unknown,
  jobs: [] as { id: string; refusalCount: number; unansweredCount: number }[],
};
const rollupCalls: { days: number; groupBy: string }[] = [];
const rollupRow = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: key,
  runs: 0,
  active: 0,
  succeeded: 0,
  failed: 0,
  interrupted: 0,
  cancelled: 0,
  refusedActions: 0,
  totalCostUsd: null,
  costUnavailableJobs: 0,
  averageDurationMs: null,
  lastRunAt: Date.now() - 3_600_000,
  lastStatus: "succeeded",
  ...over,
});

const ok = (message: string) => mock(async () => ({ message }));
const setSchedulerRunning = ok("Scheduler stopped");
const removeSchedule = ok('Schedule "Daily standup" removed');
const runSchedule = mock(async () => ({ message: 'Schedule "Daily standup" started', run: run({ status: "running" }) }));
const addSchedule = ok('Schedule "New" added');
const updateSchedule = ok('Schedule "Daily standup" updated');
const setScheduleEnabled = ok('Schedule "Daily standup" paused');
const clearHistory = ok("Run history cleared");
const previewNextRun = mock(async () => ({ nextRunTime: (Date.now() + 2 * 60 * 60_000) as number | null, error: null as string | null }));
const mutateNoop = mock(async (): Promise<void> => {});

function defaultState() {
  state.running = true;
  state.error = undefined;
  state.schedules = [dailyStandup()];
  state.jobs = [];
  state.history = {
    "Daily standup": [
      run({}),
      run({ startTime: Date.now() - 86_400_000, endTime: Date.now() - 86_300_000, status: "failed", message: "Agent busy", jobId: "job-0" }),
    ],
  };
}

void mock.module("@tokenring-ai/one-frontend/rpc.ts", () => ({
  useAgentList: () => ({ data: [agent], isLoading: false, error: undefined, mutate: mutateNoop }),
  useAgentTypes: () => ({
    data: [{ type: "code", displayName: "Code Engineer", description: "", category: "Engineering", enabledTools: [] }],
    isLoading: false,
    mutate: mutateNoop,
  }),
  useBots: () => ({ data: undefined }),
  botRPCClient: { setEscalation: async () => ({ status: "success" }), testEscalation: async () => ({ status: "success", target: "telegram:1" }) },
  useJobPolicy: () => ({ data: { defaultApprovalLevel: 5, approvalCeiling: 6, defaultMaxCostUsd: null, escalationConfigured: false }, isLoading: false }),
  chatRPCClient: {},
  usePermissionGrants: () => ({ data: { status: "success", grants: [], maxGrantLevel: 8 }, isLoading: false, error: undefined, mutate: async () => undefined }),
  useAgentJobs: () => ({ data: { jobs: state.jobs }, isLoading: false }),
  useJobRollup: (options: { days: number; groupBy: string }) => {
    rollupCalls.push(options);
    return { data: state.rollup, isLoading: false, error: undefined, mutate: mutateNoop };
  },
  useQueues: () => ({ data: { status: "success", queues: { docs: {} } }, isLoading: false, mutate: mutateNoop }),
  useWorkflows: () => ({ data: [{ name: "deploy", displayName: "Deploy" }], isLoading: false, mutate: mutateNoop }),
  useSchedules: () => ({
    data: state.error ? undefined : { running: state.running, schedules: state.schedules },
    isLoading: false,
    isValidating: false,
    error: state.error,
    mutate: mutateNoop,
  }),
  useSchedulerHistory: () => ({
    data: { history: state.history },
    isLoading: false,
    isValidating: false,
    error: undefined,
    mutate: mutateNoop,
  }),
  schedulerRPCClient: { setSchedulerRunning, removeSchedule, addSchedule, runSchedule, updateSchedule, setScheduleEnabled, clearHistory, previewNextRun },
}));

void mock.module("@tokenring-ai/one-frontend/components/ui/toast.tsx", () => ({
  toastManager: {
    success: mock(),
    error: mock(),
    warning: mock(),
    info: mock(),
  },
}));

// focus-trap refuses to activate in jsdom
const PassThroughFocusTrap = ({ children }: { children: React.ReactNode }) => children;
void mock.module("focus-trap-react", () => ({ FocusTrap: PassThroughFocusTrap, default: PassThroughFocusTrap }));

const { SCHEDULER_APP, default: layout } = await import("../layout.ts");
const { default: schedulerViews } = await import("../views.tsx");

const registry = createLayoutRegistry({
  apps: [SCHEDULER_APP],
  views: [...schedulerViews.views],
  kinds: [...(layout.kinds ?? [])],
});

function renderScheduler(url = "/scheduler") {
  return renderLayoutApp({ registry, url });
}

const PROMPT_PLACEHOLDER = "Summarize overnight CI failures and open a draft status update.";

describe("Scheduler views", () => {
  beforeEach(() => {
    defaultState();
    for (const fn of [setSchedulerRunning, removeSchedule, addSchedule, runSchedule, updateSchedule, setScheduleEnabled, clearHistory, previewNextRun]) {
      fn.mockClear();
    }
    window.localStorage.clear();
  });

  describe("schedules", () => {
    it("lists the app's schedules with what they run", async () => {
      renderScheduler();
      expect(await screen.findByRole("heading", { name: "Schedules" })).toBeInTheDocument();
      expect(screen.getAllByText("Daily standup").length).toBeGreaterThan(0);
      expect(screen.getByText("New code agent")).toBeInTheDocument();
      expect(screen.getByText(/Every 1 day/)).toBeInTheDocument();
      expect(screen.getByText("Scheduled")).toBeInTheDocument();
      expect(screen.getByText("Scheduler started")).toBeInTheDocument();
    });

    it("shows a schedule's error, and that a config schedule is edited in config", async () => {
      state.schedules = [dailyStandup({ source: "config", state: "error", error: '"Mars/Olympus" is not a known timezone', nextRunTime: null })];
      renderScheduler();
      expect(await screen.findByText('"Mars/Olympus" is not a known timezone')).toBeInTheDocument();
      expect(screen.getByText("config")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit schedule Daily standup" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Remove schedule Daily standup" })).toBeDisabled();
    });

    it("asks before stopping the scheduler while schedules are running", async () => {
      state.schedules = [dailyStandup({ state: "running", currentRun: run({ status: "running", endTime: null, jobId: "job-9" }) })];
      const user = userEvent.setup();
      renderScheduler();

      expect((await screen.findByRole("link", { name: "Open agent job job-9" })).getAttribute("href")).toBe("/agents/jobs?job=job-9");
      await user.click(screen.getByRole("button", { name: "Stop" }));
      let dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/1 schedule is running right now/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(setSchedulerRunning).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Stop" }));
      dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Stop and cancel runs" }));
      await waitFor(() => expect(setSchedulerRunning).toHaveBeenCalledWith({ running: false }));
    });

    it("starts a stopped scheduler", async () => {
      state.running = false;
      const user = userEvent.setup();
      renderScheduler();
      await user.click(await screen.findByRole("button", { name: "Start" }));
      await waitFor(() => expect(setSchedulerRunning).toHaveBeenCalledWith({ running: true }));
    });

    it("runs a schedule now from the expanded row", async () => {
      const user = userEvent.setup();
      renderScheduler();
      await user.click(await screen.findByRole("button", { name: "Expand Daily standup" }));
      await user.click(screen.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(runSchedule).toHaveBeenCalledWith({ name: "Daily standup" }));
    });

    it("adds a schedule that starts a new agent", async () => {
      const user = userEvent.setup();
      renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Add schedule" }));
      await user.type(screen.getByPlaceholderText("Daily standup brief"), "New");
      await user.type(screen.getByPlaceholderText(PROMPT_PLACEHOLDER), "Say hi");
      const addButtons = screen.getAllByRole("button", { name: "Add schedule" });
      await user.click(addButtons[addButtons.length - 1]!);

      await waitFor(() =>
        expect(addSchedule).toHaveBeenCalledWith({
          name: "New",
          schedule: expect.objectContaining({ action: { kind: "job", agentType: "code", prompt: "Say hi" }, repeat: "1 day" }),
        }),
      );
    });

    it("adds a one-time schedule that prompts an existing agent", async () => {
      const user = userEvent.setup();
      renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Add schedule" }));
      await user.type(screen.getByPlaceholderText("Daily standup brief"), "Ping");
      await user.selectOptions(screen.getByLabelText("Action"), "agent");
      await user.selectOptions(screen.getByLabelText("Agent"), "agent-1");
      await user.type(screen.getByPlaceholderText(PROMPT_PLACEHOLDER), "Check back");
      await user.selectOptions(screen.getByLabelText("Repeat"), "");
      const addButtons = screen.getAllByRole("button", { name: "Add schedule" });
      await user.click(addButtons[addButtons.length - 1]!);

      await waitFor(() => expect(addSchedule).toHaveBeenCalled());
      const [call] = addSchedule.mock.calls[0] as unknown as [{ schedule: Record<string, unknown> }];
      expect(call.schedule).toMatchObject({ once: true, action: { kind: "agent", agentId: "agent-1", prompt: "Check back" } });
      expect(call.schedule).not.toHaveProperty("repeat");
    });

    it("adds a schedule that runs a workflow", async () => {
      const user = userEvent.setup();
      renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Add schedule" }));
      await user.type(screen.getByPlaceholderText("Daily standup brief"), "Nightly deploy");
      await user.selectOptions(screen.getByLabelText("Action"), "workflow");
      await user.selectOptions(screen.getByLabelText("Workflow"), "deploy");
      const addButtons = screen.getAllByRole("button", { name: "Add schedule" });
      await user.click(addButtons[addButtons.length - 1]!);

      await waitFor(() =>
        expect(addSchedule).toHaveBeenCalledWith({
          name: "Nightly deploy",
          schedule: expect.objectContaining({ action: { kind: "workflow", name: "deploy" } }),
        }),
      );
    });

    it("edits a schedule in place through the prefilled form", async () => {
      const user = userEvent.setup();
      renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Edit schedule Daily standup" }));
      expect(screen.getByText('Edit "Daily standup"')).toBeInTheDocument();
      const nameField = screen.getByPlaceholderText("Daily standup brief");
      expect(nameField).toHaveValue("Daily standup");
      expect(nameField).toBeDisabled();
      const prompt = screen.getByPlaceholderText(PROMPT_PLACEHOLDER);
      await user.clear(prompt);
      await user.type(prompt, "Updated prompt");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(updateSchedule).toHaveBeenCalledWith({
          name: "Daily standup",
          schedule: expect.objectContaining({
            action: { kind: "job", agentType: "code", prompt: "Updated prompt" },
            repeat: "1 day",
            after: "09:00",
            before: "17:00",
            weekdays: "mon tue wed thu fri",
          }),
        }),
      );
      expect(addSchedule).not.toHaveBeenCalled();
    });

    it("shows a live next-run preview, and why a timing cannot run", async () => {
      const user = userEvent.setup();
      renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Add schedule" }));
      await waitFor(() => expect(previewNextRun).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId("next-run-preview")).toHaveTextContent(/Next run: .*in 2 hours|Next run: .*2h/));
      const [call] = previewNextRun.mock.calls.at(-1) as unknown as [{ timing: Record<string, unknown> }];
      expect(call.timing).toMatchObject({ repeat: "1 day" });
      expect(call.timing).not.toHaveProperty("action");

      previewNextRun.mockImplementationOnce(async () => ({ nextRunTime: null, error: "It never matches within the next year" }));
      await user.selectOptions(screen.getByLabelText("Repeat"), "1 hour");
      await waitFor(() => expect(screen.getByTestId("next-run-preview")).toHaveTextContent("It never matches within the next year"));
    });

    it("pauses an active schedule and resumes a paused one", async () => {
      const user = userEvent.setup();
      const { unmount } = renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Pause schedule Daily standup" }));
      await waitFor(() => expect(setScheduleEnabled).toHaveBeenCalledWith({ name: "Daily standup", enabled: false }));
      unmount();

      state.schedules = [dailyStandup({ enabled: false, state: "paused", nextRunTime: null })];
      renderScheduler();
      expect(await screen.findAllByText("Paused")).not.toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "Resume schedule Daily standup" }));
      await waitFor(() => expect(setScheduleEnabled).toHaveBeenCalledWith({ name: "Daily standup", enabled: true }));
    });

    it("offers no Resume for a finished exact-time schedule, and says a missed one was not run", async () => {
      const when = new Date(Date.now() - 3_600_000).toISOString();
      const at = { at: when, action: { kind: "tool" as const, agentType: "code", tool: "x_createPost", input: { text: "hi" } } };
      state.schedules = [
        dailyStandup({ name: "Posted", definition: at, enabled: false, state: "done", lastRunTime: Date.now() - 1000, nextRunTime: null }),
        dailyStandup({ name: "Late", definition: at, enabled: false, state: "missed", lastRunTime: Date.now() - 1000, nextRunTime: null }),
      ];
      renderScheduler();
      expect(await screen.findByText("Missed, not run")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Resume schedule/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Pause schedule/ })).toBeNull();
    });

    it("confirms and removes a schedule", async () => {
      const user = userEvent.setup();
      renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Remove schedule Daily standup" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(removeSchedule).toHaveBeenCalledWith({ name: "Daily standup" }));
    });

    it("opens the Runs view from an expanded row", async () => {
      const user = userEvent.setup();
      const app = renderScheduler();

      await user.click(await screen.findByRole("button", { name: "Expand Daily standup" }));
      await user.click(screen.getByRole("button", { name: "View run history" }));
      await waitFor(() => expect(app.location().pathname).toBe("/scheduler/runs"));
    });
  });

  describe("runs", () => {
    it("lists every schedule's runs and filters by status and schedule", async () => {
      state.history = {
        ...state.history,
        "Nightly backup": [run({ startTime: Date.now() - 7_200_000, endTime: Date.now() - 7_100_000, message: "Backup finished", jobId: null })],
        "Weekly docs": [run({ status: "interrupted", message: "Interrupted by a restart", jobId: null })],
      };
      const user = userEvent.setup();
      renderScheduler("/scheduler/runs");

      expect(await screen.findByText("Brief generated successfully")).toBeInTheDocument();
      expect(screen.getByText("Agent busy")).toBeInTheDocument();
      expect(screen.getByText("Backup finished")).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Open agent job job-1" })[0]!.getAttribute("href")).toBe("/agents/jobs?job=job-1");

      await user.click(screen.getByRole("button", { name: "Failed" }));
      expect(screen.queryByText("Brief generated successfully")).not.toBeInTheDocument();
      expect(screen.getByText("Agent busy")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancelled / interrupted" }));
      expect(screen.getByText("Interrupted by a restart")).toBeInTheDocument();
      expect(screen.queryByText("Agent busy")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "All statuses" }));
      await user.selectOptions(screen.getByLabelText("Filter history by schedule"), "Nightly backup");
      expect(screen.queryByText("Brief generated successfully")).not.toBeInTheDocument();
      expect(screen.getByText("Backup finished")).toBeInTheDocument();
    });

    describe("job warnings", () => {
      // The history is job-1 (completed) and job-0 (failed); the live job list says what each one hit.
      const job = (id: string, over: { refusalCount?: number; unansweredCount?: number } = {}) => ({ id, refusalCount: 0, unansweredCount: 0, ...over });

      it("flags a run whose job had actions refused", async () => {
        state.jobs = [job("job-1", { refusalCount: 2 }), job("job-0")];
        renderScheduler("/scheduler/runs");

        expect(await screen.findByText("2 actions refused")).toBeInTheDocument();
        expect(screen.queryByText(/answered by default/)).not.toBeInTheDocument();
        expect(screen.getAllByText(/actions? refused/)).toHaveLength(1);
      });

      it("flags a run whose job had questions answered by default", async () => {
        state.jobs = [job("job-1"), job("job-0", { unansweredCount: 1 })];
        renderScheduler("/scheduler/runs");

        expect(await screen.findByText("1 question answered by default")).toBeInTheDocument();
        expect(screen.queryByText(/actions? refused/)).not.toBeInTheDocument();
      });

      it("shows both warnings for a run that had both", async () => {
        state.jobs = [job("job-1", { refusalCount: 1, unansweredCount: 3 })];
        renderScheduler("/scheduler/runs");

        expect(await screen.findByText("1 action refused")).toBeInTheDocument();
        expect(screen.getByText("3 questions answered by default")).toBeInTheDocument();
      });

      it("shows neither warning for a quiet run", async () => {
        state.jobs = [job("job-1"), job("job-0")];
        renderScheduler("/scheduler/runs");

        await screen.findByText("Brief generated successfully");
        expect(screen.queryByText(/refused/)).not.toBeInTheDocument();
        expect(screen.queryByText(/answered by default/)).not.toBeInTheDocument();
      });
    });

    it("clears the history of the filtered schedule after confirming", async () => {
      const user = userEvent.setup();
      renderScheduler("/scheduler/runs");

      await screen.findByText("Brief generated successfully");
      await user.selectOptions(screen.getByLabelText("Filter history by schedule"), "Daily standup");
      await user.click(screen.getByRole("button", { name: "Clear history of Daily standup" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/Clear the run history of "Daily standup"/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Clear history" }));
      await waitFor(() => expect(clearHistory).toHaveBeenCalledWith({ name: "Daily standup" }));
    });

    it("clears every schedule's history when no filter is set", async () => {
      const user = userEvent.setup();
      renderScheduler("/scheduler/runs");

      await screen.findByText("Brief generated successfully");
      await user.click(screen.getByRole("button", { name: "Clear history" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear history" }));
      await waitFor(() => expect(clearHistory).toHaveBeenCalledWith({}));
    });

    it("summarizes each schedule's outcomes and spend, flags trouble, and switches window", async () => {
      state.rollup = {
        days: 7,
        since: 0,
        groupBy: "schedule",
        truncated: true,
        rows: [
          rollupRow("Daily standup", { runs: 5, succeeded: 3, failed: 2, totalCostUsd: 1.25, lastStatus: "failed" }),
          rollupRow("Nightly backup", { runs: 2, succeeded: 2 }),
          rollupRow("Weekly docs", { runs: 1, succeeded: 1, refusedActions: 3, totalCostUsd: 0.5 }),
        ],
        totals: rollupRow("total", { label: "Total", runs: 8, succeeded: 6, failed: 2, refusedActions: 3, totalCostUsd: 1.75 }),
      };
      rollupCalls.length = 0;
      const user = userEvent.setup();
      renderScheduler("/scheduler/runs");
      const list = within(await screen.findByRole("list", { name: "Schedules" }));
      expect(rollupCalls.at(-1)).toMatchObject({ days: 7, groupBy: "schedule" });
      const rows = list.getAllByRole("listitem");
      const daily = rows.find(r => r.getAttribute("data-schedule") === "Daily standup")!;
      expect(daily.getAttribute("data-tone")).toBe("danger");
      expect(within(daily).getByText("2 failed")).toBeInTheDocument();
      expect(within(daily).getByText("$1.25")).toBeInTheDocument();
      expect(within(daily).getByRole("link", { name: "Jobs" }).getAttribute("href")).toBe("/agents/jobs?owner=scheduler");
      const nightly = rows.find(r => r.getAttribute("data-schedule") === "Nightly backup")!;
      expect(nightly.getAttribute("data-tone")).toBeNull();
      expect(within(nightly).getByText("Cost not available")).toBeInTheDocument();
      expect(rows.find(r => r.getAttribute("data-schedule") === "Weekly docs")!.getAttribute("data-tone")).toBe("warning");
      expect(rows.at(-1)!.textContent).toContain("Total");
      expect(screen.getByText(/Only the newest 1000 jobs/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "30 days" }));
      expect(rollupCalls.at(-1)).toMatchObject({ days: 30 });

      await user.click(within(daily).getByRole("button", { name: "Daily standup" }));
      expect(screen.queryByText("No matching runs")).not.toBeInTheDocument();
      state.rollup = undefined;
    });

    it("shows the no-runs empty state", async () => {
      state.history = {};
      renderScheduler("/scheduler/runs");
      expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    });
  });

  describe("app definition", () => {
    it("lays schedules beside runs on /scheduler and keeps its id and path", () => {
      expect(SCHEDULER_APP.id).toBe("scheduler");
      expect(SCHEDULER_APP.path).toBe("/scheduler");
      expect(SCHEDULER_APP.layout).toMatchObject({
        split: "row",
        children: [{ items: ["scheduler-tasks"] }, { items: ["scheduler-runs"] }],
      });
      expect(registry.routes.resolve("/scheduler")?.app).toBe("scheduler");
      expect(registry.routes.resolve("/scheduler/runs")?.app).toBe("scheduler");
    });
  });
});
