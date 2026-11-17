import { afterEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentManager } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent.test";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import ChatService, { type CheckToolApprovalOptions } from "@tokenring-ai/chat/ChatService";
import SchedulerService from "../SchedulerService.ts";
import addScheduledTask from "../tools/addScheduledTask.ts";
import getSchedule from "../tools/getSchedule.ts";
import removeScheduledTask from "../tools/removeScheduledTask.ts";
import setScheduledTaskEnabled from "../tools/setScheduledTaskEnabled.ts";
import updateScheduledTask from "../tools/updateScheduledTask.ts";
import tools from "../tools.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(approve = true) {
  const app = createTestingApp() as TokenRingApp;
  const real = createTestingAgent(app);
  app.requireService(AgentManager).addAgentConfigs(real.config);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-tools-"));
  dirs.push(dir);
  const scheduler = new SchedulerService(app, { storeFile: path.join(dir, "schedules.json") });
  const checkToolApproval = mock(async (_request: CheckToolApprovalOptions, _agent: Agent) => approve);
  const agent = {
    id: real.id,
    config: real.config,
    requireService: (cls: unknown) => {
      if (cls === SchedulerService) return scheduler;
      if (cls === ChatService) return { checkToolApproval };
      throw new Error("service not stubbed");
    },
  } as unknown as Agent;
  return { agent, scheduler, checkToolApproval };
}

const approval = (checkToolApproval: ReturnType<typeof setup>["checkToolApproval"], index = 0) => checkToolApproval.mock.calls[index]![0];

describe("scheduler tools", () => {
  it("keeps the tool names stable", () => {
    expect(tools.map(tool => tool.name)).toEqual([
      "scheduler_add_task",
      "scheduler_remove_task",
      "scheduler_get_schedule",
      "scheduler_update_task",
      "scheduler_set_enabled",
    ]);
  });

  it("adds a recurring schedule that starts a new agent by default (level 7)", async () => {
    const { agent, scheduler, checkToolApproval } = setup();
    await addScheduledTask.execute(
      { name: "report", prompt: "Write the report", context: "ctx", runIn: "new agent", repeat: "1 day", after: "09:00", timezone: "UTC" },
      agent,
    );
    expect(approval(checkToolApproval)).toMatchObject({ toolName: "scheduler_add_task", safetyLevel: 7, default: false });
    expect(scheduler.getSchedule("report")!.definition).toEqual({
      repeat: "1 day",
      after: "09:00",
      timezone: "UTC",
      action: { kind: "job", agentType: "mock-agent", prompt: "Write the report\n\nADDITIONAL CONTEXT:\nctx" },
    });
  });

  it("adds a one-time schedule in this chat (level 5)", async () => {
    const { agent, scheduler, checkToolApproval } = setup();
    await addScheduledTask.execute({ name: "check back", prompt: "Check the deploy", runIn: "this chat" }, agent);
    expect(approval(checkToolApproval).safetyLevel).toBe(5);
    expect(scheduler.getSchedule("check back")!.definition).toEqual({ once: true, action: { kind: "agent", agentId: agent.id, prompt: "Check the deploy" } });
  });

  it("refuses a schedule that could never run before asking, and adds nothing when not approved", async () => {
    const { agent, scheduler, checkToolApproval } = setup(false);
    await expect(addScheduledTask.execute({ name: "x", prompt: "p", runIn: "new agent", repeat: "1 hour", timezone: "Nope/Zone" }, agent)).rejects.toThrow(
      /not a known timezone/,
    );
    expect(checkToolApproval).not.toHaveBeenCalled();
    await expect(addScheduledTask.execute({ name: "x", prompt: "p", runIn: "new agent", repeat: "1 hour" }, agent)).rejects.toThrow(/did not approve/);
    expect(scheduler.listSchedules()).toEqual([]);
  });

  it("updates the prompt and timing (level 7), keeping the action kind, days and pause", async () => {
    const { agent, scheduler, checkToolApproval } = setup();
    scheduler.addSchedule("report", {
      repeat: "1 hour",
      weekdays: "mon",
      dayOfMonth: 3,
      enabled: false,
      action: { kind: "agent", agentId: agent.id, prompt: "old" },
    });
    await updateScheduledTask.execute({ name: "report", prompt: "new", repeat: "2 hours", after: "09:00", timezone: "UTC" }, agent);
    expect(approval(checkToolApproval)).toMatchObject({ toolName: "scheduler_update_task", safetyLevel: 7, default: false });
    expect(scheduler.getSchedule("report")!.definition).toEqual({
      repeat: "2 hours",
      after: "09:00",
      timezone: "UTC",
      weekdays: "mon",
      dayOfMonth: 3,
      enabled: false,
      action: { kind: "agent", agentId: agent.id, prompt: "new" },
    });
  });

  it("removes at level 6, and pauses at 4 / resumes at 7", async () => {
    const { agent, scheduler, checkToolApproval } = setup();
    scheduler.addSchedule("report", { repeat: "1 hour", action: { kind: "job", agentType: "mock-agent", prompt: "p" } });
    await setScheduledTaskEnabled.execute({ name: "report", enabled: false }, agent);
    expect(approval(checkToolApproval, 0)).toMatchObject({ toolName: "scheduler_set_enabled", safetyLevel: 4 });
    expect(scheduler.getSchedule("report")!.state).toBe("paused");
    await setScheduledTaskEnabled.execute({ name: "report", enabled: true }, agent);
    expect(approval(checkToolApproval, 1).safetyLevel).toBe(7);

    expect(getSchedule.execute({}, agent).result).toContain("Start a new mock-agent agent with: p");
    await removeScheduledTask.execute({ name: "report" }, agent);
    expect(approval(checkToolApproval, 2)).toMatchObject({ toolName: "scheduler_remove_task", safetyLevel: 6 });
    expect(scheduler.listSchedules()).toEqual([]);
    await expect(removeScheduledTask.execute({ name: "report" }, agent)).rejects.toThrow(/not found/);
  });
});
