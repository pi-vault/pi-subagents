import { describe, it, expect } from "vitest";
import { formatWatchdogWarningText } from "../src/core/watchdog-render.js";

describe("formatWatchdogWarningText", () => {
  it("formats blocker with Blocker subject", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Null pointer dereference",
      evidence: "src/foo.ts:42",
      recommendedAction: "Add null check",
      category: "correctness",
    });
    expect(result.header).toContain("Blocker");
    expect(result.header).toContain("Null pointer dereference");
  });

  it("formats concern with Concern subject", () => {
    const result = formatWatchdogWarningText({
      severity: "concern",
      summary: "Missing test coverage",
      evidence: "src/bar.ts",
      recommendedAction: "Add unit test",
      category: "test-gap",
    });
    expect(result.header).toContain("Concern");
    expect(result.header).not.toContain("Blocker");
  });

  it("uses error color for blockers", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Bug",
      evidence: "x.ts:1",
      recommendedAction: "Fix",
      category: "correctness",
    });
    expect(result.color).toBe("error");
  });

  it("uses warning color for concerns", () => {
    const result = formatWatchdogWarningText({
      severity: "concern",
      summary: "Style issue",
      evidence: "x.ts:1",
      recommendedAction: "Refactor",
      category: "other",
    });
    expect(result.color).toBe("warning");
  });

  it("includes no state label when state is absent", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Bug",
      evidence: "x.ts:1",
      recommendedAction: "Fix",
      category: "correctness",
    });
    expect(result.header).not.toContain("(");
  });

  it("includes displayed state label", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Bug",
      evidence: "x.ts:1",
      recommendedAction: "Fix",
      category: "correctness",
      state: "displayed",
    });
    expect(result.header).toContain("displayed");
  });

  it("includes stalemate state label", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Bug",
      evidence: "x.ts:1",
      recommendedAction: "Fix",
      category: "correctness",
      state: "stalemate",
    });
    expect(result.header).toContain("stalemate");
  });

  it("includes auto-follow attempt number", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Bug",
      evidence: "x.ts:1",
      recommendedAction: "Fix",
      category: "correctness",
      autoFollowAttempt: 2,
    });
    expect(result.header).toContain("auto-follow attempt 2");
  });

  it("returns evidence and action in detail lines", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Bug",
      evidence: "src/foo.ts:99",
      recommendedAction: "Rewrite the function",
      category: "correctness",
    });
    expect(result.evidenceLine).toContain("src/foo.ts:99");
    expect(result.actionLine).toContain("Rewrite the function");
  });

  it("returns category in detail line", () => {
    const result = formatWatchdogWarningText({
      severity: "blocker",
      summary: "Bug",
      evidence: "x.ts:1",
      recommendedAction: "Fix",
      category: "unsafe-change",
      agentId: "agent-xyz",
    });
    expect(result.categoryLine).toContain("unsafe-change");
    expect(result.categoryLine).toContain("agent-xyz");
  });
});
