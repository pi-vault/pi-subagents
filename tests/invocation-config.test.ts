import { describe, expect, it } from "vitest";
import { resolveInvocationConfig } from "../src/core/invocation-config.js";

describe("resolveInvocationConfig", () => {
  it("frontmatter model takes priority over tool param", () => {
    const result = resolveInvocationConfig(
      { model: "anthropic/claude-sonnet-4" },
      { model: "anthropic/claude-haiku-4-5" },
      {},
    );
    expect(result.model).toBe("anthropic/claude-sonnet-4");
  });

  it("tool param model used when frontmatter omits it", () => {
    const result = resolveInvocationConfig(
      {},
      { model: "anthropic/claude-haiku-4-5" },
      {},
    );
    expect(result.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("parent model used as fallback", () => {
    const result = resolveInvocationConfig(
      {},
      {},
      { model: "anthropic/claude-sonnet-4" },
    );
    expect(result.model).toBe("anthropic/claude-sonnet-4");
  });

  it("returns undefined model when all sources omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.model).toBeUndefined();
  });

  it("frontmatter thinking takes priority", () => {
    const result = resolveInvocationConfig(
      { thinking: "high" },
      { thinking: "low" },
      { thinking: "medium" },
    );
    expect(result.thinking).toBe("high");
  });

  it("frontmatter maxTurns takes priority over tool param", () => {
    const result = resolveInvocationConfig(
      { maxTurns: 10 },
      { maxTurns: 20 },
      { defaultMaxTurns: 30 },
    );
    expect(result.maxTurns).toBe(10);
  });

  it("tool param maxTurns used when frontmatter omits it", () => {
    const result = resolveInvocationConfig(
      {},
      { maxTurns: 20 },
      { defaultMaxTurns: 30 },
    );
    expect(result.maxTurns).toBe(20);
  });

  it("config defaultMaxTurns used as fallback", () => {
    const result = resolveInvocationConfig({}, {}, { defaultMaxTurns: 30 });
    expect(result.maxTurns).toBe(30);
  });

  it("defaults maxTurns to 0 (unlimited) when all omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.maxTurns).toBe(0);
  });

  it("frontmatter isolated takes priority", () => {
    const result = resolveInvocationConfig(
      { isolated: true },
      { isolated: false },
      {},
    );
    expect(result.isolated).toBe(true);
  });

  it("tool param isolated used when frontmatter omits it", () => {
    const result = resolveInvocationConfig({}, { isolated: true }, {});
    expect(result.isolated).toBe(true);
  });

  it("defaults to false for isolated when both omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.isolated).toBe(false);
  });

  it("frontmatter inheritContext takes priority", () => {
    const result = resolveInvocationConfig(
      { inheritContext: true },
      { inheritContext: false },
      {},
    );
    expect(result.inheritContext).toBe(true);
  });

  it("defaults to false for inheritContext when both omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.inheritContext).toBe(false);
  });
});

describe("toolBudget resolution (inverted priority)", () => {
  it("tool param toolBudget takes priority over frontmatter", () => {
    const result = resolveInvocationConfig(
      { toolBudget: { hard: 20 } },
      { toolBudget: { soft: 5, hard: 10 } },
      {},
    );
    expect(result.toolBudget).toEqual({ soft: 5, hard: 10 });
  });

  it("frontmatter toolBudget used when tool param omits it", () => {
    const result = resolveInvocationConfig(
      { toolBudget: { hard: 20 } },
      {},
      {},
    );
    expect(result.toolBudget).toEqual({ hard: 20 });
  });

  it("config toolBudget used as fallback", () => {
    const result = resolveInvocationConfig(
      {},
      {},
      { toolBudget: { hard: 30 } },
    );
    expect(result.toolBudget).toEqual({ hard: 30 });
  });

  it("returns undefined when all sources omit toolBudget", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.toolBudget).toBeUndefined();
  });
});
