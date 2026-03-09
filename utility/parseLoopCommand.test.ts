import {describe, expect, it} from "vitest";
import {parseLoopCommand} from "./parseLoopCommand.ts";

describe("parseLoopCommand", () => {
  it("parses a leading shorthand interval", () => {
    expect(parseLoopCommand("5m check deployment")).toEqual({
      prompt: "check deployment",
      repeat: "5 minutes",
      displayInterval: "5 minutes",
    });
  });

  it("parses a trailing every clause", () => {
    expect(parseLoopCommand("check deployment every 2 hours")).toEqual({
      prompt: "check deployment",
      repeat: "2 hours",
      displayInterval: "2 hours",
    });
  });

  it("defaults to ten minutes without an interval", () => {
    expect(parseLoopCommand("check deployment")).toEqual({
      prompt: "check deployment",
      repeat: "10 minutes",
      displayInterval: "10 minutes",
    });
  });

  it("rounds seconds up to minutes", () => {
    expect(parseLoopCommand("30s check deployment")).toEqual({
      prompt: "check deployment",
      repeat: "1 minute",
      displayInterval: "1 minute",
      note: "Rounded 30 seconds up to 1 minute to match minute-based scheduling."
    });
  });

  it("rejects empty input", () => {
    expect(parseLoopCommand("   ")).toBeNull();
  });

  it("rejects missing prompts when interval syntax is used", () => {
    expect(parseLoopCommand("5m")).toBeNull();
    expect(parseLoopCommand("every 5m")).toEqual({
      prompt: "every 5m",
      repeat: "10 minutes",
      displayInterval: "10 minutes",
    });
  });
});
