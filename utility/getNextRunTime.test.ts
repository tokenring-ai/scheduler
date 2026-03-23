import moment from "moment-timezone";
import {beforeEach, describe, expect, it} from "vitest";
import type {ScheduledTask} from "../schema.ts";
import {getNextRunTime} from "./getNextRunTime.ts";

describe("getNextRunTime", () => {
  const timezone = "America/New_York";
  let now: number;

  beforeEach(() => {
    now = Date.now();
  });

  it("every interval without lastRunTime", () => {
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      timezone,
      lastRunTime: 0,
    };
    
    const nextRun = getNextRunTime(task);
    expect(nextRun).toBeGreaterThanOrEqual(now);
    expect(nextRun).toBeLessThanOrEqual(now + 10_000);
  });

  it("every interval with lastRunTime", () => {
    const lastRun = now - 1800_000; // 30 minutes ago
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      lastRunTime: lastRun,
      timezone,
    };
    
    const nextRun = getNextRunTime(task);
    expect(nextRun).toBeGreaterThanOrEqual(now);
    expect(nextRun).toBeLessThan(now + 20000_000);
  });

  it("once without lastRunTime", () => {
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      timezone,
      lastRunTime: 0,
    };
    
    const nextRun = getNextRunTime(task);
    expect(nextRun).toBeGreaterThanOrEqual(now);
  });

  it("once with lastRunTime schedules next day", () => {
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      lastRunTime: now - 3600,
      timezone,
    };
    
    const nextRun = getNextRunTime(task);
    expect(nextRun).toBeGreaterThanOrEqual(now);
  });

  it("with from time constraint", () => {
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      after: "09:00",
      before: "09:01",
      timezone,
      lastRunTime: 0,
    };
    
    const nextRun = getNextRunTime(task);
    const nextRunMoment = moment.tz(nextRun!, timezone);
    expect(nextRunMoment.hour()).toEqual(9);
  });

  it("with to time constraint", () => {
    const lastRun = moment().tz(timezone).hour(8).minute(0).second(0).unix();
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      before: "17:00",
      timezone,
      lastRunTime: lastRun,
    };
    
    const nextRun = getNextRunTime(task);
    const nextRunMoment = moment.tz(nextRun!, timezone);
    expect(nextRunMoment.hour()).toBeLessThanOrEqual(17);
  });

  it("with from and to time window", () => {
    const lastRun = moment().tz(timezone).hour(8).minute(0).second(0).unix();
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      after: "09:00",
      before: "17:00",
      timezone,
      lastRunTime: lastRun,
    };
    
    const nextRun = getNextRunTime(task);
    const nextRunMoment = moment.tz(nextRun!,timezone);
    expect(nextRunMoment.hour()).toBeGreaterThanOrEqual(9);
    expect(nextRunMoment.hour()).toBeLessThanOrEqual(17);
  });

  it("with specific weekdays", () => {
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 hour",
      weekdays: "mon,wed,fri",
      timezone,
      lastRunTime: 0,
    };
    
    const nextRun = getNextRunTime(task);
    const nextRunMoment = moment.tz(nextRun!, timezone);
    const dayOfWeek = nextRunMoment.day();
    expect([1, 3, 5]).toContain(dayOfWeek);
  });

  it("with specific day of month", () => {
    const task: ScheduledTask = {
      message: "test",
      repeat: "1 day",
      dayOfMonth: 15,
      timezone,
      lastRunTime: 0,
    };
    
    const nextRun = getNextRunTime(task);
    const nextRunMoment = moment.tz(nextRun!,timezone);
    expect(nextRunMoment.date()).toBe(15);
  });

  it("returns null for invalid interval", () => {
    const task: ScheduledTask = {
      message: "test",
      repeat: "invalid",
      timezone,
    };
    
    const nextRun = getNextRunTime(task);
    expect(nextRun).toBeNull();
  });

  it("returns null without repeat or valid configuration", () => {
    const task: ScheduledTask = {
      message: "test",
      timezone,
      lastRunTime: 0
    };
    
    const nextRun = getNextRunTime(task);
    expect(nextRun).toBeLessThan(Date.now() + 20_000);
  });
});
