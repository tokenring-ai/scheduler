import {describe, expect, it} from "vitest";
import {parseInterval} from "./parseInterval.ts";

describe("parseInterval", () => {
  it("parses seconds", () => {
    expect(parseInterval("30 seconds")).toBe(30);
    expect(parseInterval("1 second")).toBe(1);
  });

  it("parses minutes", () => {
    expect(parseInterval("5 minutes")).toBe(300);
    expect(parseInterval("1 minute")).toBe(60);
  });

  it("parses hours", () => {
    expect(parseInterval("2 hours")).toBe(7200);
    expect(parseInterval("1 hour")).toBe(3600);
  });

  it("parses days", () => {
    expect(parseInterval("3 days")).toBe(259200);
    expect(parseInterval("1 day")).toBe(86400);
  });

  it("handles whitespace", () => {
    expect(parseInterval("  10   minutes  ")).toBe(600);
  });

  it("returns null for invalid format", () => {
    expect(parseInterval("invalid")).toBeNull();
    expect(parseInterval("10")).toBeNull();
    expect(parseInterval("minutes")).toBeNull();
  });

  it("returns null for unknown unit", () => {
    expect(parseInterval("5 weeks")).toBeNull();
  });
});