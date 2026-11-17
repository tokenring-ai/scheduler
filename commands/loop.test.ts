import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Agent } from "@tokenring-ai/agent";
import SchedulerService from "../SchedulerService.ts";
import loop from "./loop.ts";

describe("/loop command", () => {
  const scheduler = {
    addSchedule: mock(),
    isRunning: mock(() => true),
  };

  let agent: Agent;

  beforeEach(() => {
    mock.clearAllMocks();
    agent = {
      id: "chat-1",
      requireService: mock((service: unknown) => {
        if (service === SchedulerService) return scheduler;
        throw new Error("Unknown service");
      }),
    } as unknown as Agent;
  });

  it("schedules a recurring prompt in this chat, first run one interval from now", () => {
    const before = Date.now();
    const result = loop.execute({ remainder: "5m check deployment", agent } as any);

    expect(scheduler.addSchedule).toHaveBeenCalledWith(
      expect.stringMatching(/^loop-[a-z0-9]{8}$/),
      { repeat: "5 minutes", action: { kind: "agent", agentId: "chat-1", prompt: "check deployment" } },
      { startsAt: expect.any(Number) },
    );
    expect((scheduler.addSchedule.mock.calls[0] as unknown as [string, unknown, { startsAt: number }])[2].startsAt).toBeGreaterThanOrEqual(before);
    expect(result).toContain("every 5 minutes");
  });

  it("uses the default interval when no interval is provided", () => {
    const result = loop.execute({ remainder: "check deployment", agent } as any);
    expect(scheduler.addSchedule.mock.calls[0]![1]).toMatchObject({ repeat: "10 minutes" });
    expect(result).toContain("every 10 minutes");
  });

  it("says so when the scheduler is stopped", () => {
    scheduler.isRunning.mockReturnValueOnce(false);
    const result = loop.execute({ remainder: "check deployment every 2h", agent } as any);
    expect(scheduler.addSchedule.mock.calls[0]![1]).toMatchObject({ repeat: "2 hours" });
    expect(result).toContain("/schedule start");
  });
});
