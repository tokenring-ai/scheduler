import { describe, expect, it } from "bun:test";
import moment from "moment-timezone";
import { getNextRunTime, parseAt, pastAtProblem, ScheduleTimingError } from "./getNextRunTime.ts";

const NY = "America/New_York";
const at = (iso: string, tz = NY) => moment.tz(iso, tz).valueOf();
const wall = (ts: number | null, tz = NY) => (ts === null ? null : moment.tz(ts, tz).format("YYYY-MM-DD HH:mm"));
const HOUR = 3_600_000;

describe("getNextRunTime", () => {
  it("a new schedule runs now; a one-time schedule that ran is done", () => {
    const now = at("2026-11-14 10:00");
    expect(getNextRunTime({ repeat: "1 hour", timezone: NY }, {}, now)).toBe(now);
    expect(getNextRunTime({ once: true, timezone: NY }, {}, now)).toBe(now);
    expect(getNextRunTime({ once: true, timezone: NY }, { lastRunTime: now - HOUR }, now)).toBeNull();
  });

  it("keeps repeats on their grid: the next slot is counted from the anchor, not from when a run finished", () => {
    const anchor = at("2026-11-14 10:00");
    // The 13:00 run is recorded at its slot; however long it took, the next one is 14:00.
    expect(wall(getNextRunTime({ repeat: "1 hour", timezone: NY }, { anchorTime: anchor, lastRunTime: anchor + 3 * HOUR }, at("2026-11-14 13:40")))).toBe(
      "2026-11-14 14:00",
    );
    // A run now (manual or a catch-up) is off the grid: the next slot is still on it.
    expect(wall(getNextRunTime({ repeat: "2 hours", timezone: NY }, { anchorTime: anchor, lastRunTime: at("2026-11-14 11:17") }, at("2026-11-14 11:18")))).toBe(
      "2026-11-14 12:00",
    );
  });

  it("catches up once after downtime, then returns to the grid", () => {
    const anchor = at("2026-11-14 10:00");
    const now = at("2026-11-14 15:30");
    expect(getNextRunTime({ repeat: "1 hour", timezone: NY }, { anchorTime: anchor, lastRunTime: anchor }, now)).toBe(now);
    expect(wall(getNextRunTime({ repeat: "1 hour", timezone: NY }, { anchorTime: anchor, lastRunTime: now }, now))).toBe("2026-11-14 16:00");
  });

  it("a catch-up outside the time window waits for the window to open", () => {
    const timing = { repeat: "1 hour", after: "09:00", before: "17:00", timezone: NY };
    const runs = { anchorTime: at("2026-11-12 09:00"), lastRunTime: at("2026-11-13 16:00") };
    // Woke at 07:00: not now, but when the window opens.
    expect(wall(getNextRunTime(timing, runs, at("2026-11-14 07:00")))).toBe("2026-11-14 09:00");
    // Woke at 20:00: tomorrow's opening.
    expect(wall(getNextRunTime(timing, runs, at("2026-11-14 20:00")))).toBe("2026-11-15 09:00");
    // Woke inside the window: now.
    expect(getNextRunTime(timing, runs, at("2026-11-14 12:34"))).toBe(at("2026-11-14 12:34"));
    // A weekday-only schedule missed over the weekend fires on Monday's opening.
    const weekdays = { ...timing, weekdays: "mon tue wed thu fri" };
    expect(wall(getNextRunTime(weekdays, runs, at("2026-11-14 12:00")))).toBe("2026-11-16 09:00");
  });

  it("finds days 29 to 31 more than 30 days ahead", () => {
    const now = at("2026-11-14 10:00");
    expect(wall(getNextRunTime({ dayOfMonth: 31, after: "09:00", timezone: NY }, {}, now))).toBe("2026-12-31 09:00");
    // February has no 30th: the next is March 30, 136 days ahead.
    expect(wall(getNextRunTime({ dayOfMonth: 30, timezone: NY }, {}, at("2027-01-31 10:00")))).toBe("2027-03-30 00:00");
    // Leap day.
    expect(wall(getNextRunTime({ dayOfMonth: 29, weekdays: "tue", timezone: NY }, {}, at("2027-12-01 00:00")))).toBe("2028-02-29 00:00");
  });

  it("daily repeats keep their wall-clock time across a DST change", () => {
    const anchor = at("2026-03-07 09:00");
    const next = getNextRunTime({ repeat: "1 day", timezone: NY }, { anchorTime: anchor, lastRunTime: anchor }, at("2026-03-07 09:01"));
    expect(wall(next)).toBe("2026-03-08 09:00");
    // Only 23 hours later: the clocks went forward.
    expect(next! - anchor).toBe(23 * HOUR);
    // A fixed 24-hour repeat does not.
    expect(wall(getNextRunTime({ repeat: "24 hours", timezone: NY }, { anchorTime: anchor, lastRunTime: anchor }, at("2026-03-07 09:01")))).toBe(
      "2026-03-08 10:00",
    );
  });

  it("monthly repeats are calendar months from the anchor: clamped to short months, never drifting", () => {
    const timing = { repeat: "1 month", timezone: NY };
    const anchor = at("2026-01-31 09:00");
    const feb = getNextRunTime(timing, { anchorTime: anchor, lastRunTime: anchor }, at("2026-02-01 00:00"));
    expect(wall(feb)).toBe("2026-02-28 09:00");
    // From the anchor, not from Feb 28: back to the 31st, at 09:00 after DST began.
    expect(wall(getNextRunTime(timing, { anchorTime: anchor, lastRunTime: feb! }, at("2026-03-01 00:00")))).toBe("2026-03-31 09:00");
    expect(wall(getNextRunTime(timing, { anchorTime: anchor, lastRunTime: at("2026-03-31 09:00") }, at("2026-04-01 00:00")))).toBe("2026-04-30 09:00");
  });

  it("without repeat, runs once a day from the start of the next day", () => {
    const timing = { after: "08:00", timezone: NY };
    expect(wall(getNextRunTime(timing, { lastRunTime: at("2026-11-14 08:00") }, at("2026-11-14 08:05")))).toBe("2026-11-15 08:00");
  });

  it("evaluates days and windows in the schedule's timezone", () => {
    const now = at("2026-11-14 23:30", "UTC");
    // 23:30 UTC is 08:30 in Tokyo on the 15th.
    expect(wall(getNextRunTime({ after: "09:00", timezone: "Asia/Tokyo" }, {}, now), "Asia/Tokyo")).toBe("2026-11-15 09:00");
  });

  it("refuses an invalid timezone, interval or day list with a clear error", () => {
    expect(() => getNextRunTime({ repeat: "1 hour", timezone: "Mars/Olympus" })).toThrow(ScheduleTimingError);
    expect(() => getNextRunTime({ repeat: "1 hour", timezone: "Mars/Olympus" })).toThrow(/not a known timezone/);
    expect(() => getNextRunTime({ repeat: "30 seconds" })).toThrow(/at most once a minute/);
    expect(() => getNextRunTime({ repeat: "400 days" })).toThrow(/at least once a year/);
    expect(() => getNextRunTime({ repeat: "NaN minutes" })).toThrow(/not an interval/);
    expect(() => getNextRunTime({ weekdays: "someday" })).toThrow(/weekdays/);
    expect(() => getNextRunTime({ after: "9am" })).toThrow(/24-hour time/);
    expect(() => getNextRunTime({ after: "18:00", before: "06:00" })).toThrow(/earlier than/);
  });
});

describe("getNextRunTime with an exact time (at)", () => {
  const AT = "2026-11-20T09:00:00-05:00";
  const slot = Date.parse(AT);

  it("runs at that instant, and only once", () => {
    expect(getNextRunTime({ at: AT }, {}, slot - 5 * HOUR)).toBe(slot);
    expect(getNextRunTime({ at: AT }, {}, slot)).toBe(slot);
    expect(getNextRunTime({ at: AT }, { lastRunTime: slot }, slot + HOUR)).toBeNull();
    // `once` is implied: no repeat grid, no next day.
    expect(getNextRunTime({ at: AT }, { lastRunTime: slot }, slot + 3 * 24 * HOUR)).toBeNull();
  });

  it("a missed slot fires once as soon as the app is back, then is done", () => {
    const back = slot + 2 * 24 * HOUR;
    expect(getNextRunTime({ at: AT }, {}, back)).toBe(back);
    expect(getNextRunTime({ at: AT }, { lastRunTime: back }, back + HOUR)).toBeNull();
  });

  it("accepts Z and offsets, and refuses anything without one", () => {
    expect(getNextRunTime({ at: "2026-11-20T14:00:00Z" }, {}, 0)).toBe(slot);
    expect(getNextRunTime({ at: "2026-11-20T14:00:00.000+00:00" }, {}, 0)).toBe(slot);
    expect(() => getNextRunTime({ at: "2026-11-20T09:00:00" }, {}, 0)).toThrow(ScheduleTimingError);
    expect(() => getNextRunTime({ at: "tomorrow" }, {}, 0)).toThrow(/ISO-8601/);
  });

  it("cannot be combined with repeat, a window, weekdays or a day of month", () => {
    expect(() => getNextRunTime({ at: AT, repeat: "1 day" }, {}, 0)).toThrow(/cannot be combined with "repeat"/);
    expect(() => getNextRunTime({ at: AT, after: "09:00" }, {}, 0)).toThrow(/exact moment/);
    expect(() => getNextRunTime({ at: AT, weekdays: "mon" }, {}, 0)).toThrow(/exact moment/);
    expect(() => getNextRunTime({ at: AT, dayOfMonth: 3 }, {}, 0)).toThrow(/exact moment/);
  });

  it("pastAtProblem names a time that has passed", () => {
    expect(pastAtProblem({ at: AT }, slot + 1)).toContain("in the past");
    expect(pastAtProblem({ at: AT }, slot - 1)).toBeNull();
    expect(pastAtProblem({}, slot)).toBeNull();
  });
});

describe("parseAt", () => {
  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(parseAt("2026-02-31T09:00:00Z")).toBeNull();
    expect(parseAt("2026-04-31T09:00:00+01:00")).toBeNull();
    expect(parseAt("2025-02-29T09:00:00Z")).toBeNull();
    expect(parseAt("2026-13-01T09:00:00Z")).toBeNull();
    expect(parseAt("2026-02-28T09:00:00Z")).toBe(Date.parse("2026-02-28T09:00:00Z"));
    expect(parseAt("2028-02-29T09:00:00Z")).toBe(Date.parse("2028-02-29T09:00:00Z"));
    expect(parseAt("2026-02-28T09:00:00")).toBeNull();
  });
});
