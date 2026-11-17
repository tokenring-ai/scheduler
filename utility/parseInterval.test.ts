import { describe, expect, it } from "bun:test";
import { parseInterval, parseRepeat, repeatProblem } from "./parseInterval.ts";

describe("parseInterval", () => {
  it("parses fixed units to seconds", () => {
    expect(parseInterval("30 seconds")).toBe(30);
    expect(parseInterval("5 minutes")).toBe(300);
    expect(parseInterval("2 hours")).toBe(7200);
    expect(parseInterval("3 days")).toBe(259200);
    expect(parseInterval("  10   minutes  ")).toBe(600);
  });

  it("returns null for invalid input", () => {
    expect(parseInterval("invalid")).toBeNull();
    expect(parseInterval("10")).toBeNull();
    expect(parseInterval("minutes")).toBeNull();
    expect(parseInterval("5 foos")).toBeNull();
    expect(parseInterval("0 minutes")).toBeNull();
    // Too many digits to be a real interval (and to stay exact).
    expect(parseInterval("99999999999999999999 minutes")).toBeNull();
  });
});

describe("parseRepeat", () => {
  it("marks days, weeks and months as calendar units", () => {
    expect(parseRepeat("1 month")).toMatchObject({ amount: 1, unit: "month", calendar: true });
    expect(parseRepeat("2 weeks")).toMatchObject({ amount: 2, unit: "week", calendar: true });
    expect(parseRepeat("90 minutes")).toMatchObject({ amount: 90, unit: "minute", calendar: false, approxMs: 5_400_000 });
  });

  it("enforces a minimum of a minute and a maximum of a year", () => {
    expect(repeatProblem("30 seconds")).toContain("at most once a minute");
    expect(repeatProblem("59 seconds")).toContain("at most once a minute");
    expect(repeatProblem("60 seconds")).toBeNull();
    expect(repeatProblem("1 minute")).toBeNull();
    expect(repeatProblem("12 months")).toBeNull();
    expect(repeatProblem("13 months")).toContain("at least once a year");
    expect(repeatProblem("999999999 days")).toContain("at least once a year");
    expect(repeatProblem("fortnightly")).toContain("not an interval");
  });
});
