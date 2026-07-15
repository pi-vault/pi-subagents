import { describe, it, expect } from "vitest";
import { recommendWatchdogModel, detectProviderFamily } from "../src/core/watchdog-model-selection.js";

describe("detectProviderFamily", () => {
  it("detects openai family by provider name", () => {
    expect(detectProviderFamily("openai-codex", "gpt-5.5")).toBe("openai");
    expect(detectProviderFamily("openai", "gpt-5-5")).toBe("openai");
  });

  it("detects openai family by model id containing gpt", () => {
    expect(detectProviderFamily("", "gpt-4")).toBe("openai");
  });

  it("detects anthropic family by provider name", () => {
    expect(detectProviderFamily("anthropic", "claude-opus-4-8")).toBe("anthropic");
  });

  it("detects anthropic family by model id containing claude or opus", () => {
    expect(detectProviderFamily("", "claude-3-5-sonnet")).toBe("anthropic");
    expect(detectProviderFamily("", "opus-4.8")).toBe("anthropic");
  });

  it("returns unknown for unrecognized providers", () => {
    expect(detectProviderFamily("google", "gemini-2")).toBe("unknown");
  });

  it("returns unknown for undefined inputs", () => {
    expect(detectProviderFamily(undefined, undefined)).toBe("unknown");
  });
});

describe("recommendWatchdogModel", () => {
  it("recommends anthropic opus for openai sessions", () => {
    const result = recommendWatchdogModel("openai");
    expect(result.model).toContain("anthropic");
    expect(result.family).toBe("opus");
    expect(result.thinking).toBe("high");
  });

  it("recommends openai gpt for anthropic sessions", () => {
    const result = recommendWatchdogModel("anthropic");
    expect(result.model).toContain("openai");
    expect(result.family).toBe("gpt");
    expect(result.thinking).toBe("high");
  });

  it("defaults to opus for unknown provider", () => {
    const result = recommendWatchdogModel("unknown");
    expect(result.family).toBe("opus");
    expect(result.model).toContain("anthropic");
  });

  it("returns a non-empty human-readable reason", () => {
    const result = recommendWatchdogModel("openai");
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(20);
  });

  it("recommendation model is a valid provider/model string", () => {
    for (const family of ["openai", "anthropic", "unknown"] as const) {
      const result = recommendWatchdogModel(family);
      expect(result.model).toMatch(/^[a-z0-9-]+\/[a-z0-9._-]+$/i);
    }
  });
});
