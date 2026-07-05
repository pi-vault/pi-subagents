import { describe, expect, it } from "vitest";
import { resolveModel } from "../src/core/model-resolver.js";
import type { ModelInfo } from "../src/core/model-resolver.js";

const mockModels: ModelInfo[] = [
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    name: "Claude Sonnet 4",
  },
  {
    id: "claude-haiku-4-5-20250514",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
  },
  { id: "gpt-4o", provider: "openai", name: "GPT-4o" },
];

describe("resolveModel", () => {
  it("exact provider/id match", () => {
    const result = resolveModel(
      "anthropic/claude-sonnet-4-20250514",
      mockModels,
    );
    expect(result).toEqual({
      id: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });
  });

  it("exact id match without provider prefix", () => {
    const result = resolveModel("gpt-4o", mockModels);
    expect(result).toEqual({ id: "gpt-4o", provider: "openai" });
  });

  it("fuzzy match on 'sonnet'", () => {
    const result = resolveModel("sonnet", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-sonnet-4-20250514");
    expect(result?.provider).toBe("anthropic");
  });

  it("fuzzy match on 'haiku'", () => {
    const result = resolveModel("haiku", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-haiku-4-5-20250514");
    expect(result?.provider).toBe("anthropic");
  });

  it("returns undefined for no match", () => {
    const result = resolveModel("nonexistent-model", mockModels);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty query", () => {
    const result = resolveModel("", mockModels);
    expect(result).toBeUndefined();
  });

  it("returns undefined for whitespace-only query", () => {
    const result = resolveModel("   ", mockModels);
    expect(result).toBeUndefined();
  });

  it("case-insensitive matching", () => {
    const result = resolveModel("ANTHROPIC/GPT-4O", mockModels);
    // provider doesn't match (anthropic != openai), so should be undefined
    expect(result).toBeUndefined();

    const result2 = resolveModel("OPENAI/GPT-4O", mockModels);
    expect(result2).toEqual({ id: "gpt-4o", provider: "openai" });
  });

  it("multi-part fuzzy match on 'claude sonnet'", () => {
    const result = resolveModel("claude sonnet", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-sonnet-4-20250514");
  });
});
