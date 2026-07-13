import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { matchesPattern, parseModelScopeConfig, checkModelScope } from "../src/core/model-scope.js";
import type { ModelScopeConfig } from "../src/core/model-scope.js";
import { createAgent, createDeps, createDiscovery } from "./_test-helpers.js";
import { registerSubagentTool } from "../src/core/subagent.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AgentManager } from "../src/core/agent-manager.js";

vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: {},
    aborted: false,
    steered: false,
  }),
}));

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

describe("subagent tool: model scope enforcement", () => {
  const testDir = join(tmpdir(), `pi-model-scope-test-${Date.now()}`);
  const piDir = join(testDir, ".pi");

  beforeEach(() => {
    mkdirSync(piDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function setupScopeTest(modelScope: object) {
    writeFileSync(
      join(piDir, "subagents.json"),
      JSON.stringify({ modelScope }),
    );

    const manager = new AgentManager();
    const sentMessages: Array<{ customType: string; content: string }> = [];
    const deps = createDeps({
      discoverAgents: () =>
        createDiscovery([createAgent({ name: "Scout", model: undefined })]),
      manager,
    });

    let toolDef: { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
    const pi = {
      registerTool(def: unknown) { toolDef = def as typeof toolDef; },
      registerCommand() {},
      sendMessage(msg: { customType: string; content: string }) {
        sentMessages.push(msg);
      },
      getAllTools() { return []; },
      on() {},
      registerMessageRenderer() {},
      sendUserMessage() {},
    } as unknown as ExtensionAPI;

    registerSubagentTool(pi, deps);
    const ctx = { cwd: testDir } as unknown as ExtensionContext;

    return {
      execute: (params: Record<string, unknown>) =>
        toolDef!.execute("tc-1", params, undefined, undefined, ctx) as Promise<{
          isError: boolean;
          content: Array<{ type: string; text: string }>;
        }>,
      sentMessages,
    };
  }

  it("blocks explicit out-of-scope model with error", async () => {
    const { execute } = setupScopeTest({
      enforce: true,
      allow: ["anthropic/*"],
    });

    const result = await execute({
      agent: "Scout",
      task: "do something",
      model: "google/gemini-pro",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not in the allowed scope");
    expect(result.content[0]?.text).toContain("google/gemini-pro");
  });

  it("allows model matching scope patterns", async () => {
    const { execute } = setupScopeTest({
      enforce: true,
      allow: ["anthropic/*"],
    });

    // This should NOT be blocked by scope, but will fail at spawn
    // (no real session). We verify it doesn't return a scope error.
    const result = await execute({
      agent: "Scout",
      task: "do something",
      model: "anthropic/claude-sonnet-4-20250514",
    });

    // Should not have a scope error — might have a different error (spawn fails)
    if (result.isError) {
      expect(result.content[0]?.text).not.toContain("not in the allowed scope");
    }
  });

  it("warns for inherited out-of-scope model (from agent frontmatter)", async () => {
    // Agent has a model set in frontmatter → inherited source → warn, don't block
    const manager = new AgentManager();
    const sentMessages: Array<{ customType: string; content: string }> = [];
    const deps = createDeps({
      discoverAgents: () =>
        createDiscovery([createAgent({ name: "Scout", model: "google/gemini-pro" })]),
      manager,
    });

    writeFileSync(
      join(piDir, "subagents.json"),
      JSON.stringify({ modelScope: { enforce: true, allow: ["anthropic/*"] } }),
    );

    let toolDef: { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
    const pi = {
      registerTool(def: unknown) { toolDef = def as typeof toolDef; },
      registerCommand() {},
      sendMessage(msg: { customType: string; content: string }) {
        sentMessages.push(msg);
      },
      getAllTools() { return []; },
      on() {},
      registerMessageRenderer() {},
      sendUserMessage() {},
    } as unknown as ExtensionAPI;

    registerSubagentTool(pi, deps);
    const ctx = { cwd: testDir } as unknown as ExtensionContext;

    const result = await (toolDef!.execute as Function)(
      "tc-1",
      { agent: "Scout", task: "do something" },
      undefined,
      undefined,
      ctx,
    ) as { isError: boolean; content: Array<{ type: string; text: string }> };

    // Should NOT be blocked (inherited = warn, not error)
    // It will fail at spawn, but not due to scope
    if (result.isError) {
      expect(result.content[0]?.text).not.toContain("not in the allowed scope");
    }
    // Should have emitted a warning
    expect(sentMessages.some((m) => m.customType === "model_scope_warning")).toBe(true);
  });

  it("skips scope check when enforce is false", async () => {
    const { execute } = setupScopeTest({
      enforce: false,
      allow: ["anthropic/*"],
    });

    const result = await execute({
      agent: "Scout",
      task: "do something",
      model: "google/gemini-pro",
    });

    // Should not be blocked by scope
    if (result.isError) {
      expect(result.content[0]?.text).not.toContain("not in the allowed scope");
    }
  });
});
