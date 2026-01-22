import moment from "moment-timezone";
import {describe, expect, it} from "vitest";
import type {ScheduledTask} from "../schema.ts";
import {checkDayConditions} from "./checkDayConditions.ts";

describe("checkDayConditions", () => {
  const timezone = "America/New_York";

  it("returns true when no conditions specified", () => {
    const task: ScheduledTask = {
      agentType: "test",
      message: "test",
      timezone,
    };
    const now = moment().tz(timezone);
    expect(checkDayConditions(task, now)).toBe(true);
  });

  it("checks dayOfMonth", () => {
    const task: ScheduledTask = {
      agentType: "test",
      message: "test",
      dayOfMonth: 15,
      timezone,
    };
    const day15 = moment().tz(timezone).date(15);
    const day20 = moment().tz(timezone).date(20);
    expect(checkDayConditions(task, day15)).toBe(true);
    expect(checkDayConditions(task, day20)).toBe(false);
  });

  it("checks weekdays with on property", () => {
    const task: ScheduledTask = {
      agentType: "test",
      message: "test",
      weekdays: "mon,wed,fri",
      timezone,
    };
    const monday = moment().tz(timezone).day(1);
    const tuesday = moment().tz(timezone).day(2);
    const wednesday = moment().tz(timezone).day(3);
    expect(checkDayConditions(task, monday)).toBe(true);
    expect(checkDayConditions(task, tuesday)).toBe(false);
    expect(checkDayConditions(task, wednesday)).toBe(true);
  });

  it("checks both dayOfMonth and weekday", () => {
    const task: ScheduledTask = {
      agentType: "test",
      message: "test",
      dayOfMonth: 15,
      weekdays: "mon",
      timezone,
      lastRunTime: 0,
    };

    const day15Monday = moment.tz("2025-12-15", timezone);
    const day15Tuesday = moment.tz("2024-10-15", timezone);
    const day20Monday = moment.tz("2025-01-20", timezone);

    expect(checkDayConditions(task, day15Monday)).toBe(true);
    expect(checkDayConditions(task, day15Tuesday)).toBe(false);
    expect(checkDayConditions(task, day20Monday)).toBe(false);
  });
});
