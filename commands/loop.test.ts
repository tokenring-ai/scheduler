import type { Agent } from "@tokenring-ai/agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SchedulerService from "../SchedulerService.ts";
import { ScheduleExecutionState } from "../state/scheduleExecutionState.ts";
import loop from "./loop.ts";

describe("/loop command", () => {
  const scheduler = {
    addTask: vi.fn(),
    runScheduler: vi.fn(),
  };

  let agent: Agent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = {
      requireServiceByType: vi.fn((service: unknown) => {
        if (service === SchedulerService) return scheduler;
        throw new Error("Unknown service");
      }),
      getState: vi.fn((state: unknown) => {
        if (state === ScheduleExecutionState) {
          return { abortController: null };
        }
        throw new Error("Unknown state");
      })
    } as unknown as Agent;
  });

  it("schedules a recurring prompt with a leading interval", async () => {
    const result = await loop.execute({ remainder: "5m check deployment", agent } as any);

    expect(scheduler.addTask).toHaveBeenCalledWith(
      expect.stringMatching(/^loop-[a-z0-9]{8}$/),
      { message: "check deployment", repeat: "5 minutes", lastRunTime: expect.any(Number) },
      agent
    );
    expect(scheduler.runScheduler).toHaveBeenCalledWith(agent);
    expect(result).toContain("every 5 minutes");
  });

  it("uses the default interval when no interval is provided", async () => {
    const result = await loop.execute({ remainder: "check deployment", agent } as any);

    expect(scheduler.addTask).toHaveBeenCalledWith(
      expect.stringMatching(/^loop-[a-z0-9]{8}$/),
      { message: "check deployment", repeat: "10 minutes", lastRunTime: expect.any(Number) },
      agent
    );
    expect(result).toContain("every 10 minutes");
  });

  it("does not start the scheduler again when it is already running", async () => {
    vi.mocked(agent.getState).mockReturnValue({ abortController: new AbortController() } as any);

    await loop.execute({ remainder: "check deployment every 2h", agent } as any);

    expect(scheduler.addTask).toHaveBeenCalledWith(
      expect.stringMatching(/^loop-[a-z0-9]{8}$/),
      { message: "check deployment", repeat: "2 hours", lastRunTime: expect.any(Number) },
      agent
    );
    expect(scheduler.runScheduler).not.toHaveBeenCalled();
  });
});
