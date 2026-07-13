import { describe, expect, it } from "vitest";
import { matchesPattern, parseModelScopeConfig, checkModelScope } from "../src/core/model-scope.js";
import type { ModelScopeConfig } from "../src/core/model-scope.js";

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

describe("checkModelScope", () => {
  const scope: ModelScopeConfig = {
    enforce: true,
    allow: ["anthropic/*", "openai/gpt-5-*"],
  };

  it("returns undefined (pass) when scope is undefined", () => {
    expect(checkModelScope("anything", undefined, "explicit")).toBeUndefined();
  });

  it("returns undefined (pass) when enforce is false", () => {
    const noEnforce: ModelScopeConfig = { enforce: false, allow: [] };
    expect(checkModelScope("anything", noEnforce, "explicit")).toBeUndefined();
  });

  it("passes when model matches allow patterns", () => {
    expect(
      checkModelScope("anthropic/claude-sonnet-4-20250514", scope, "explicit"),
    ).toBeUndefined();
    expect(
      checkModelScope("openai/gpt-5-turbo", scope, "explicit"),
    ).toBeUndefined();
  });

  it("returns error violation for explicit out-of-scope model", () => {
    const violation = checkModelScope("google/gemini-pro", scope, "explicit");
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe("error");
    expect(violation!.model).toBe("google/gemini-pro");
    expect(violation!.allowedPatterns).toEqual(["anthropic/*", "openai/gpt-5-*"]);
  });

  it("returns warn violation for inherited out-of-scope model", () => {
    const violation = checkModelScope("google/gemini-pro", scope, "inherited");
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe("warn");
  });

  it("normalizes model: strips :thinking suffix, lowercases", () => {
    expect(
      checkModelScope(
        "Anthropic/Claude-Sonnet-4-20250514:thinking",
        scope,
        "explicit",
      ),
    ).toBeUndefined();
  });

  it("returns error when allow list is empty and enforce is true", () => {
    const emptyScope: ModelScopeConfig = { enforce: true, allow: [] };
    const violation = checkModelScope(
      "anthropic/claude-sonnet-4-20250514",
      emptyScope,
      "explicit",
    );
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe("error");
  });
});
