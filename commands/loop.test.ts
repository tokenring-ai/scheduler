import {describe, expect, it, vi, beforeEach} from "vitest";
import loop from "./loop.ts";
import SchedulerService from "../SchedulerService.ts";
import {ScheduleExecutionState} from "../state/scheduleExecutionState.ts";

describe("/loop command", () => {
  const scheduler = {
    addTask: vi.fn(),
    runScheduler: vi.fn(),
  };

  let agent: any;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = {
      requireServiceByType: vi.fn((service: unknown) => {
        if (service === SchedulerService) return scheduler;
        throw new Error("Unknown service");
      }),
      getState: vi.fn((state: unknown) => {
        if (state === ScheduleExecutionState) {
          return {abortController: null};
        }
        throw new Error("Unknown state");
      })
    };
  });

  it("schedules a recurring prompt with a leading interval", async () => {
    const result = await loop.execute("5m check deployment", agent);

    expect(scheduler.addTask).toHaveBeenCalledWith(
      expect.stringMatching(/^loop-[a-z0-9]{8}$/),
      {message: "check deployment", repeat: "5 minutes", lastRunTime: 0},
      agent
    );
    expect(scheduler.runScheduler).toHaveBeenCalledWith(agent);
    expect(result).toContain("every 5 minutes");
  });

  it("uses the default interval when no interval is provided", async () => {
    await loop.execute("check deployment", agent);

    expect(scheduler.addTask).toHaveBeenCalledWith(
      expect.any(String),
      {message: "check deployment", repeat: "10 minutes", lastRunTime: 0},
      agent
    );
  });

  it("does not start the scheduler again when it is already running", async () => {
    agent.getState.mockReturnValue({abortController: new AbortController()});

    await loop.execute("check deployment every 2h", agent);

    expect(scheduler.addTask).toHaveBeenCalledWith(
      expect.any(String),
      {message: "check deployment", repeat: "2 hours", lastRunTime: 0},
      agent
    );
    expect(scheduler.runScheduler).not.toHaveBeenCalled();
  });
});
