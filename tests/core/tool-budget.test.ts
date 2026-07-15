import { describe, it, expect } from "vitest";
import { evaluateToolCall } from "../../src/core/tool-budget.js";
import type { ResolvedToolBudget } from "../../src/shared/types.js";

describe("evaluateToolCall", () => {
  it("returns within-budget below limits", () => {
    const budget: ResolvedToolBudget = { hard: 10, block: ["read"] };
    expect(evaluateToolCall(budget, 5, "read").outcome).toBe("within-budget");
  });

  it("returns soft-reached at soft limit", () => {
    const budget: ResolvedToolBudget = { soft: 3, hard: 10, block: ["read"] };
    const result = evaluateToolCall(budget, 3, "read");
    expect(result.outcome).toBe("soft-reached");
    expect(result.message).toBeDefined();
  });

  it("returns hard-blocked for blocked tool past hard limit", () => {
    const budget: ResolvedToolBudget = { hard: 5, block: ["read"] };
    const result = evaluateToolCall(budget, 6, "read");
    expect(result.outcome).toBe("hard-blocked");
    expect(result.message).toContain("read");
  });

  it("allows non-blocked tools past hard limit", () => {
    const budget: ResolvedToolBudget = { hard: 5, block: ["read"] };
    const result = evaluateToolCall(budget, 6, "bash");
    expect(result.outcome).not.toBe("hard-blocked");
  });

  it("blocks all tools when block is '*'", () => {
    const budget: ResolvedToolBudget = { hard: 5, block: "*" };
    const result = evaluateToolCall(budget, 6, "bash");
    expect(result.outcome).toBe("hard-blocked");
  });
});
