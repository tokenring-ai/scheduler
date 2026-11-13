import { beforeEach, describe, expect, it, mock } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defineView } from "@tokenring-ai/one-frontend/layout/define.ts";
import { createLayoutRegistry } from "@tokenring-ai/one-frontend/layout/registry.ts";
import { renderLayoutApp } from "@tokenring-ai/one-frontend/test/layout.tsx";
import { MessageSquare } from "lucide-react";
import type React from "react";

const agent = {
  id: "agent-1",
  createdAt: 1_700_000_000_000,
  agentType: "code",
  displayName: "Code Engineer #1",
  description: "Writes code",
  idle: true,
  currentActivity: "",
};

const dailyTask = {
  message: "Summarize overnight CI failures and open a draft status update.",
  lastRunTime: 0,
  repeat: "1 day",
  after: "09:00",
  before: "17:00",
  weekdays: "mon tue wed thu fri",
  timezone: "UTC",
};

const nextRun = Date.now() + 60 * 60_000;

type RunRecord = { startTime: number; endTime: number; status: "completed" | "failed"; message: string };

const state = {
  agentList: [agent] as Array<typeof agent>,
  schedulerRunning: false,
  statusError: undefined as Error | undefined,
  tasks: { "Daily standup": dailyTask } as Record<string, typeof dailyTask>,
  executions: { "Daily standup": { nextRunTime: nextRun, status: "pending" as const } } as Record<
    string,
    { nextRunTime: number; status: "pending" | "running" }
  >,
  history: {
    "Daily standup": [
      {
        startTime: Date.now() - 3_600_000,
        endTime: Date.now() - 3_540_000,
        status: "completed" as const,
        message: "Brief generated successfully",
      },
      {
        startTime: Date.now() - 86_400_000,
        endTime: Date.now() - 86_300_000,
        status: "failed" as const,
        message: "Agent busy",
      },
    ],
  } as Record<string, RunRecord[]>,
};

const startScheduler = mock(async () => ({ status: "success" as const, success: true, message: "Scheduler started" }));
const stopScheduler = mock(async () => ({ status: "success" as const, success: true, message: "Scheduler stopped" }));
const removeTask = mock(async () => ({ status: "success" as const, success: true, message: 'Task "Daily standup" removed' }));
const runTask = mock(async () => ({ status: "success" as const, success: true, message: 'Task "Daily standup" started' }));
const addTask = mock(async () => ({ status: "success" as const, success: true, message: 'Task "New task" added' }));
const updateTask = mock(async () => ({ status: "success" as const, success: true, message: 'Task "Daily standup" updated' }));
const setTaskEnabled = mock(async () => ({ status: "success" as const, success: true, message: 'Task "Daily standup" paused' }));
const clearHistory = mock(async () => ({ status: "success" as const, success: true, message: "Run history cleared" }));
const previewNextRun = mock(async () => ({ nextRunTime: (Date.now() + 2 * 60 * 60_000) as number | null }));
const createAgent = mock(async () => ({ id: "agent-2", displayName: "New", description: "" }));
const mutateNoop = mock(async (): Promise<void> => {});

function defaultState() {
  state.agentList = [agent];
  state.schedulerRunning = false;
  state.statusError = undefined;
  state.tasks = { "Daily standup": dailyTask };
  state.executions = { "Daily standup": { nextRunTime: nextRun, status: "pending" } };
  state.history = {
    "Daily standup": [
      {
        startTime: Date.now() - 3_600_000,
        endTime: Date.now() - 3_540_000,
        status: "completed",
        message: "Brief generated successfully",
      },
      {
        startTime: Date.now() - 86_400_000,
        endTime: Date.now() - 86_300_000,
        status: "failed",
        message: "Agent busy",
      },
    ],
  };
}

void mock.module("@tokenring-ai/one-frontend/rpc.ts", () => ({
  useAgentList: () => ({ data: state.agentList, isLoading: false, error: undefined, mutate: mutateNoop }),
  useAgentTypes: () => ({
    data: [{ type: "code", displayName: "Code Engineer", description: "", category: "Engineering", enabledTools: [] }],
    isLoading: false,
    mutate: mutateNoop,
  }),
  useSchedulerTasks: () => ({
    data: { status: "success" as const, tasks: state.tasks, count: Object.keys(state.tasks).length },
    isLoading: false,
    isValidating: false,
    error: undefined,
    mutate: mutateNoop,
  }),
  useSchedulerStatus: () => ({
    data: state.statusError ? undefined : { status: "success" as const, running: state.schedulerRunning, autoStart: true, executions: state.executions },
    isLoading: false,
    isValidating: false,
    error: state.statusError,
    mutate: mutateNoop,
  }),
  useSchedulerHistory: () => ({
    data: { status: "success" as const, history: state.history },
    isLoading: false,
    isValidating: false,
    error: undefined,
    mutate: mutateNoop,
  }),
  agentRPCClient: { createAgent },
  schedulerRPCClient: { startScheduler, stopScheduler, removeTask, addTask, runTask, updateTask, setTaskEnabled, clearHistory, previewNextRun },
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

function ChatStub() {
  return <p>chat stub</p>;
}

const chatView = defineView({
  id: "chat",
  kind: "agent",
  title: params => params.agentId ?? "Chat",
  icon: MessageSquare,
  route: "agent/:agentId",
  instanceKey: params => params.agentId ?? "",
  component: ChatStub,
});

const registry = createLayoutRegistry({
  apps: [SCHEDULER_APP],
  views: [...schedulerViews.views, chatView],
  kinds: [...(layout.kinds ?? []), { id: "agent", label: "Agents", plural: "agent chats" }],
});

/** Renders the Scheduler app at a URL; both views are open, so tests query by role/text. */
function renderSchedulerView(viewId: string) {
  const app = renderLayoutApp({ registry, url: viewId === "scheduler-runs" ? "/scheduler/runs" : "/scheduler" });
  return { ...app, app };
}

describe("Scheduler views", () => {
  beforeEach(() => {
    defaultState();
    startScheduler.mockClear();
    stopScheduler.mockClear();
    removeTask.mockClear();
    addTask.mockClear();
    runTask.mockClear();
    updateTask.mockClear();
    setTaskEnabled.mockClear();
    clearHistory.mockClear();
    previewNextRun.mockClear();
    createAgent.mockClear();
    window.localStorage.clear();
  });

  describe("tasks", () => {
    it("lists scheduled tasks for the selected agent under a Tasks header", async () => {
      renderSchedulerView("scheduler-tasks");

      expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
      // The Runs pane beside it lists the task's history under the same name.
      expect(screen.getAllByText("Daily standup").length).toBeGreaterThan(0);
      expect(screen.getByText(/Every 1 day/)).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    });

    it("shows empty agents state with create action", async () => {
      state.agentList = [];
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      expect(screen.getByText("No agents available")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Create agent" }));
      await waitFor(() => expect(createAgent).toHaveBeenCalledWith({ agentType: "code", headless: false }));
    });

    it("enables the scheduler once an agent with tasks is attached", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      const enable = await screen.findByRole("button", { name: "Enable" });
      await waitFor(() => expect(enable).toBeEnabled());
      await user.click(enable);
      await waitFor(() => {
        expect(startScheduler).toHaveBeenCalledWith({ agentId: "agent-1" });
      });
    });

    it("disables the scheduler when enabled", async () => {
      state.schedulerRunning = true;
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      expect(await screen.findByText("Scheduler enabled")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Disable" }));
      await waitFor(() => {
        expect(stopScheduler).toHaveBeenCalledWith({ agentId: "agent-1" });
      });
    });

    it("shows an error with retry and an unknown status when the status query fails", async () => {
      state.statusError = new Error("socket closed");
      renderSchedulerView("scheduler-tasks");

      expect(await screen.findByText("Unable to load scheduler status")).toBeInTheDocument();
      expect(screen.getByText("Unknown")).toBeInTheDocument();
      expect(screen.getByText("Scheduler status unknown")).toBeInTheDocument();
      expect(screen.queryByText("Scheduler disabled")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enable" })).toBeDisabled();
    });

    it("asks before disabling while tasks are running and stops only on confirm", async () => {
      state.schedulerRunning = true;
      state.executions = { "Daily standup": { nextRunTime: nextRun, status: "running" } };
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Disable" }));
      let dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/1 task is running right now/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(stopScheduler).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Disable" }));
      dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Disable and abort" }));
      await waitFor(() => expect(stopScheduler).toHaveBeenCalledWith({ agentId: "agent-1" }));
    });

    it("runs a task now from the expanded row", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Expand Daily standup" }));
      await user.click(screen.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(runTask).toHaveBeenCalledWith({ agentId: "agent-1", name: "Daily standup" }));
    });

    it("submits One-time tasks with once: true and no repeat", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Add task" }));
      await user.type(screen.getByPlaceholderText("Daily standup brief"), "Once task");
      await user.type(screen.getByPlaceholderText("Summarize overnight CI failures and open a draft status update."), "Do it once");
      await user.selectOptions(screen.getByLabelText("Repeat"), "");
      const addButtons = screen.getAllByRole("button", { name: "Add task" });
      await user.click(addButtons[addButtons.length - 1]!);

      await waitFor(() => expect(addTask).toHaveBeenCalled());
      const call = addTask.mock.calls[0] as unknown as [{ task: Record<string, unknown> }];
      expect(call[0].task.once).toBe(true);
      expect(call[0].task).not.toHaveProperty("repeat");
    });

    it("opens the add task form and creates a task through it", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Add task" }));
      expect(screen.getByText("Add scheduled task")).toBeInTheDocument();
      const name = screen.getByPlaceholderText("Daily standup brief");
      await user.type(name, "New task");
      await user.type(screen.getByPlaceholderText("Summarize overnight CI failures and open a draft status update."), "Say hi");
      // The form's submit shares its label with the header button; the form's own is the last.
      const addButtons = screen.getAllByRole("button", { name: "Add task" });
      await user.click(addButtons[addButtons.length - 1]!);

      await waitFor(() =>
        expect(addTask).toHaveBeenCalledWith({
          agentId: "agent-1",
          name: "New task",
          task: expect.objectContaining({ message: "Say hi", repeat: "1 day" }),
        }),
      );
    });

    it("edits a task in place through the prefilled form", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Edit task Daily standup" }));
      expect(screen.getByText('Edit "Daily standup"')).toBeInTheDocument();
      const nameField = screen.getByPlaceholderText("Daily standup brief");
      expect(nameField).toHaveValue("Daily standup");
      expect(nameField).toBeDisabled();
      const message = screen.getByPlaceholderText("Summarize overnight CI failures and open a draft status update.");
      expect(message).toHaveValue(dailyTask.message);
      await user.clear(message);
      await user.type(message, "Updated prompt");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(updateTask).toHaveBeenCalledWith({
          agentId: "agent-1",
          name: "Daily standup",
          task: expect.objectContaining({ message: "Updated prompt", repeat: "1 day", after: "09:00", before: "17:00", weekdays: "mon tue wed thu fri" }),
        }),
      );
      expect(addTask).not.toHaveBeenCalled();
    });

    it("shows a live next-run preview in the form", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Add task" }));
      await waitFor(() => expect(previewNextRun).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId("next-run-preview")).toHaveTextContent(/Next run: .*in 2 hours|Next run: .*2h/));
      const call = previewNextRun.mock.calls.at(-1) as unknown as [{ task: Record<string, unknown> }];
      expect(call[0].task).toMatchObject({ repeat: "1 day" });

      previewNextRun.mockImplementationOnce(async () => ({ nextRunTime: null }));
      await user.selectOptions(screen.getByLabelText("Repeat"), "1 hour");
      await waitFor(() => expect(screen.getByTestId("next-run-preview")).toHaveTextContent("Not scheduled within the next 30 days"));
    });

    it("pauses an active task and resumes a paused one", async () => {
      const user = userEvent.setup();
      const { unmount } = renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Pause task Daily standup" }));
      await waitFor(() => expect(setTaskEnabled).toHaveBeenCalledWith({ agentId: "agent-1", name: "Daily standup", enabled: false }));
      unmount();

      state.tasks = { "Daily standup": { ...dailyTask, enabled: false } as typeof dailyTask };
      renderSchedulerView("scheduler-tasks");
      expect(await screen.findAllByText("Paused")).not.toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "Resume task Daily standup" }));
      await waitFor(() => expect(setTaskEnabled).toHaveBeenCalledWith({ agentId: "agent-1", name: "Daily standup", enabled: true }));
    });

    it("confirms and removes a task", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Remove task Daily standup" }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Remove" }));
      await waitFor(() => {
        expect(removeTask).toHaveBeenCalledWith({ agentId: "agent-1", name: "Daily standup" });
      });
    });

    it("opens the Runs view from an expanded task row", async () => {
      const user = userEvent.setup();
      const app = renderSchedulerView("scheduler-tasks");

      await user.click(await screen.findByRole("button", { name: "Expand Daily standup" }));
      await user.click(screen.getByRole("button", { name: "View run history" }));
      await waitFor(() => expect(app.location().pathname).toBe("/scheduler/runs"));
    });
  });

  describe("runs", () => {
    it("lists run history and filters by status and task", async () => {
      state.history = {
        ...state.history,
        "Nightly backup": [
          {
            startTime: Date.now() - 7_200_000,
            endTime: Date.now() - 7_100_000,
            status: "completed",
            message: "Backup finished",
          },
        ],
      };
      const user = userEvent.setup();
      renderSchedulerView("scheduler-runs");

      expect(await screen.findByText("Brief generated successfully")).toBeInTheDocument();
      expect(screen.getByText("Agent busy")).toBeInTheDocument();
      expect(screen.getByText("Backup finished")).toBeInTheDocument();
      expect(screen.getByLabelText("Filter history by task")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Failed" }));
      expect(screen.queryByText("Brief generated successfully")).not.toBeInTheDocument();
      expect(screen.queryByText("Backup finished")).not.toBeInTheDocument();
      expect(screen.getByText("Agent busy")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "All statuses" }));
      await user.selectOptions(screen.getByLabelText("Filter history by task"), "Nightly backup");
      expect(screen.queryByText("Brief generated successfully")).not.toBeInTheDocument();
      expect(screen.getByText("Backup finished")).toBeInTheDocument();
    });

    it("clears the history of the filtered task after confirming", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-runs");

      await screen.findByText("Brief generated successfully");
      await user.selectOptions(screen.getByLabelText("Filter history by task"), "Daily standup");
      await user.click(screen.getByRole("button", { name: "Clear history of Daily standup" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/Clear the run history of "Daily standup"/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Clear history" }));
      await waitFor(() => expect(clearHistory).toHaveBeenCalledWith({ agentId: "agent-1", taskName: "Daily standup" }));
    });

    it("clears every task's history when no task filter is set", async () => {
      const user = userEvent.setup();
      renderSchedulerView("scheduler-runs");

      await screen.findByText("Brief generated successfully");
      await user.click(screen.getByRole("button", { name: "Clear history" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear history" }));
      await waitFor(() => expect(clearHistory).toHaveBeenCalledWith({ agentId: "agent-1" }));
    });

    it("shows the no-runs empty state", async () => {
      state.history = {};
      renderSchedulerView("scheduler-runs");

      expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    });

    it("asks for an agent when none is attached", async () => {
      state.agentList = [];
      renderSchedulerView("scheduler-runs");

      expect(await screen.findByText("No agent selected")).toBeInTheDocument();
    });
  });

  describe("app definition", () => {
    it("lays tasks beside runs on /scheduler and keeps its id and path", () => {
      expect(SCHEDULER_APP.id).toBe("scheduler");
      expect(SCHEDULER_APP.path).toBe("/scheduler");
      expect(SCHEDULER_APP.views).toContain("chat");
      expect(SCHEDULER_APP.layout).toMatchObject({
        split: "row",
        children: [{ items: ["scheduler-tasks"] }, { items: ["scheduler-runs"] }],
      });
      expect(registry.routes.resolve("/scheduler")?.app).toBe("scheduler");
      expect(registry.routes.resolve("/scheduler/runs")?.app).toBe("scheduler");
    });

    it("attaches the selected agent's chat beside the tasks", async () => {
      renderSchedulerView("scheduler-tasks");
      expect(await screen.findByText("chat stub")).toBeInTheDocument();
    });
  });
});
