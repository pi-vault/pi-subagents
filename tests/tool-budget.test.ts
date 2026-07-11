import { describe, expect, test } from "vitest";
import {
  DEFAULT_TOOL_BUDGET_BLOCK,
  evaluateToolCall,
  hardBlockMessage,
  softNudgeMessage,
  validateToolBudget,
} from "../src/core/tool-budget.js";

describe("validateToolBudget", () => {
  test("returns undefined budget for undefined input", () => {
    const result = validateToolBudget(undefined);
    expect(result.budget).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("accepts valid config with all fields", () => {
    const result = validateToolBudget({
      soft: 5,
      hard: 10,
      block: ["read", "grep"],
    });
    expect(result.error).toBeUndefined();
    expect(result.budget).toEqual({
      soft: 5,
      hard: 10,
      block: ["read", "grep"],
    });
  });

  test("accepts valid config with only hard", () => {
    const result = validateToolBudget({ hard: 10 });
    expect(result.error).toBeUndefined();
    expect(result.budget).toEqual({
      hard: 10,
      block: [...DEFAULT_TOOL_BUDGET_BLOCK],
    });
  });

  test('accepts block: "*"', () => {
    const result = validateToolBudget({ hard: 10, block: "*" });
    expect(result.error).toBeUndefined();
    expect(result.budget?.block).toBe("*");
  });

  test("rejects hard < 1", () => {
    expect(validateToolBudget({ hard: 0 }).error).toContain("hard");
  });

  test("rejects non-integer hard", () => {
    expect(validateToolBudget({ hard: 1.5 }).error).toContain("hard");
  });

  test("rejects soft > hard", () => {
    expect(validateToolBudget({ soft: 15, hard: 10 }).error).toContain("soft");
  });

  test("rejects soft < 1", () => {
    expect(validateToolBudget({ soft: 0, hard: 10 }).error).toContain("soft");
  });

  test("rejects empty block array", () => {
    expect(validateToolBudget({ hard: 10, block: [] }).error).toContain(
      "block",
    );
  });

  test("rejects non-string items in block array", () => {
    expect(validateToolBudget({ hard: 10, block: [123] }).error).toContain(
      "block",
    );
  });

  test("rejects non-object input", () => {
    expect(validateToolBudget("bad").error).toBeDefined();
    expect(validateToolBudget(42).error).toBeDefined();
    expect(validateToolBudget([]).error).toBeDefined();
  });

  test("deduplicates block entries", () => {
    const result = validateToolBudget({
      hard: 10,
      block: ["read", "read", "grep"],
    });
    expect(result.budget?.block).toEqual(["read", "grep"]);
  });
});

describe("evaluateToolCall", () => {
  const budget = { soft: 5, hard: 10, block: ["read", "grep"] as string[] };

  test("returns within-budget when under both limits", () => {
    const result = evaluateToolCall(budget, 3, "read");
    expect(result.outcome).toBe("within-budget");
    expect(result.message).toBeUndefined();
  });

  test("returns soft-reached at soft threshold", () => {
    const result = evaluateToolCall(budget, 5, "read");
    expect(result.outcome).toBe("soft-reached");
    expect(result.message).toBeDefined();
  });

  test("returns soft-reached between soft and hard", () => {
    const result = evaluateToolCall(budget, 8, "read");
    expect(result.outcome).toBe("soft-reached");
  });

  test("returns hard-blocked for listed tool over hard", () => {
    const result = evaluateToolCall(budget, 11, "read");
    expect(result.outcome).toBe("hard-blocked");
    expect(result.message).toContain("read");
  });

  test("returns soft-reached for non-listed tool over hard (not blocked)", () => {
    const result = evaluateToolCall(budget, 11, "edit");
    expect(result.outcome).toBe("soft-reached");
  });

  test('block: "*" blocks all tools over hard', () => {
    const wildBudget = { soft: 5, hard: 10, block: "*" as const };
    const result = evaluateToolCall(wildBudget, 11, "edit");
    expect(result.outcome).toBe("hard-blocked");
  });

  test("returns within-budget when no soft defined and under hard", () => {
    const noSoftBudget = { hard: 10, block: ["read"] as string[] };
    const result = evaluateToolCall(noSoftBudget, 8, "read");
    expect(result.outcome).toBe("within-budget");
  });

  test("returns within-budget for non-listed tool over hard with no soft", () => {
    const noSoftBudget = { hard: 10, block: ["read"] as string[] };
    const result = evaluateToolCall(noSoftBudget, 11, "edit");
    expect(result.outcome).toBe("within-budget");
  });
});

describe("message formatters", () => {
  test("softNudgeMessage includes counts", () => {
    const msg = softNudgeMessage({ soft: 5, hard: 10, block: ["read"] }, 5);
    expect(msg).toContain("5");
    expect(msg).toContain("soft");
  });

  test("hardBlockMessage includes tool name and counts", () => {
    const msg = hardBlockMessage({ hard: 10, block: ["read"] }, "read", 11);
    expect(msg).toContain("read");
    expect(msg).toContain("11");
    expect(msg).toContain("hard");
  });
});
