import { describe, expect, it } from "vitest";
import { matchesPattern, parseModelScopeConfig } from "../src/core/model-scope.js";

describe("matchesPattern", () => {
  it("matches exact string (case-insensitive)", () => {
    expect(
      matchesPattern(
        "anthropic/claude-sonnet-4-20250514",
        "anthropic/claude-sonnet-4-20250514",
      ),
    ).toBe(true);
    expect(
      matchesPattern(
        "Anthropic/Claude-Sonnet-4-20250514",
        "anthropic/claude-sonnet-4-20250514",
      ),
    ).toBe(true);
  });

  it("matches wildcard at end", () => {
    expect(
      matchesPattern("anthropic/claude-sonnet-4-20250514", "anthropic/*"),
    ).toBe(true);
    expect(
      matchesPattern("anthropic/claude-opus-4-20250514", "anthropic/*"),
    ).toBe(true);
    expect(matchesPattern("openai/gpt-5-turbo", "anthropic/*")).toBe(false);
  });

  it("matches wildcard at start", () => {
    expect(
      matchesPattern("anthropic/claude-sonnet-4-20250514", "*sonnet*"),
    ).toBe(true);
  });

  it("matches wildcard in middle", () => {
    expect(matchesPattern("openai/gpt-5-turbo", "openai/gpt-5-*")).toBe(true);
    expect(matchesPattern("openai/gpt-4o", "openai/gpt-5-*")).toBe(false);
  });

  it("handles multiple wildcards", () => {
    expect(
      matchesPattern("anthropic/claude-sonnet-4-20250514", "*claude*sonnet*"),
    ).toBe(true);
  });

  it("empty pattern matches nothing", () => {
    expect(matchesPattern("anthropic/anything", "")).toBe(false);
  });

  it("* alone matches everything", () => {
    expect(matchesPattern("anything/at-all", "*")).toBe(true);
  });
});

describe("parseModelScopeConfig", () => {
  it("parses valid config", () => {
    const result = parseModelScopeConfig({
      enforce: true,
      allow: ["anthropic/*", "openai/gpt-5-*"],
    });
    expect(result).toEqual({
      enforce: true,
      allow: ["anthropic/*", "openai/gpt-5-*"],
    });
  });

  it("returns undefined for null/undefined", () => {
    expect(parseModelScopeConfig(null)).toBeUndefined();
    expect(parseModelScopeConfig(undefined)).toBeUndefined();
  });

  it("returns undefined for non-object", () => {
    expect(parseModelScopeConfig("string")).toBeUndefined();
    expect(parseModelScopeConfig(42)).toBeUndefined();
  });

  it("returns undefined when enforce is not boolean", () => {
    expect(
      parseModelScopeConfig({ enforce: "yes", allow: [] }),
    ).toBeUndefined();
  });

  it("returns undefined when allow is not array", () => {
    expect(
      parseModelScopeConfig({ enforce: true, allow: "anthropic/*" }),
    ).toBeUndefined();
  });

  it("filters non-string entries from allow", () => {
    const result = parseModelScopeConfig({
      enforce: true,
      allow: ["anthropic/*", 42, null, "openai/*"],
    });
    expect(result).toEqual({
      enforce: true,
      allow: ["anthropic/*", "openai/*"],
    });
  });

  it("defaults enforce to false when missing", () => {
    const result = parseModelScopeConfig({ allow: ["anthropic/*"] });
    expect(result).toEqual({ enforce: false, allow: ["anthropic/*"] });
  });
});
