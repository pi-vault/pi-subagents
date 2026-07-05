import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import {
  findAgentByName,
  parseAgentCommandArgs,
  registerAgentCommand,
  registerSubagentTool,
} from "../src/core/subagent.js";
import type { RuntimeDeps } from "../src/shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  AgentRecord,
  LifetimeUsage,
} from "../src/shared/types.js";

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "Scout",
    description: "Scout files",
    tools: ["read", "bash"],
    subagentAgents: [],
    systemPrompt: "You are Scout.",
    sourcePath: "/repo/agents/scout.md",
    ...overrides,
  };
}

function createDiscovery(agents: AgentDefinition[] = []): AgentDiscoveryResult {
  return { agents, diagnostics: [] };
}

function emptyUsage(): LifetimeUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
  };
}

function completedRecord(result = "done"): AgentRecord {
  return {
    id: "test-inv",
    type: "subagent",
    status: "completed",
    startedAt: 1000,
    durationMs: 42,
    result,
    error: undefined,
    toolUses: 0,
    turnCount: 0,
    lifetimeUsage: emptyUsage(),
    compactionCount: 0,
  };
}

function createDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return {
    resolvePaths: () => ({
      agentDir: "/tmp/pi-agent",
      configPath: "/tmp/pi-agent/extensions/subagents.json",
      userAgentsDir: "/tmp/pi-agent/agents",
      bundledAgentsDir: "/repo/agents",
      sessionsDir: "/tmp/pi-agent/sessions",
    }),
    loadConfig: () => ({
      exists: false,
      config: { maxConcurrency: 3, maxRecursiveLevel: 3, defaultMaxTurns: 0, graceTurns: 5, defaultJoinMode: "smart" as const },
    }),
    discoverAgents: () => createDiscovery([createAgent()]),
    discoverToolNames: () => ["bash", "read"],
    createAgentFile: () => { throw new Error("not used"); },
    exportAgentToUserScope: () => { throw new Error("not used"); },
    disableAgentInUserScope: () => { throw new Error("not used"); },
    deleteUserAgentOverride: () => {},
    saveConfig: () => {},
    manager: new AgentManager(),
    ...overrides,
  };
}

type ToolDef = Parameters<ExtensionAPI["registerTool"]>[0];

function createPi(): {
  pi: ExtensionAPI;
  registeredTool: () => ToolDef;
  registeredCommand: (name: string) => { handler: (...args: unknown[]) => unknown } | undefined;
  sentMessages: Array<{ customType: string; content: string }>;
} {
  let toolDef: ToolDef | undefined;
  const commands = new Map<string, { handler: (...args: unknown[]) => unknown }>();
  const sentMessages: Array<{ customType: string; content: string }> = [];

  const pi = {
    registerTool(def: ToolDef) {
      toolDef = def;
    },
    registerCommand(name: string, def: { handler: (...args: unknown[]) => unknown }) {
      commands.set(name, def);
    },
    sendMessage(msg: { customType: string; content: string }) {
      sentMessages.push(msg);
    },
    getAllTools() { return []; },
    on() {},
    registerMessageRenderer() {},
    sendUserMessage() {},
  } as unknown as ExtensionAPI;

  return {
    pi,
    registeredTool: () => {
      if (!toolDef) throw new Error("registerTool was not called");
      return toolDef;
    },
    registeredCommand: (name) => commands.get(name),
    sentMessages,
  };
}

// ---------------------------------------------------------------------------
// findAgentByName
// ---------------------------------------------------------------------------

describe("findAgentByName", () => {
  test("finds agent by exact name", () => {
    const discovery = createDiscovery([createAgent({ name: "Scout" })]);
    const result = findAgentByName(discovery, "Scout");
    expect(result?.name).toBe("Scout");
  });

  test("finds agent case-insensitively", () => {
    const discovery = createDiscovery([createAgent({ name: "Scout" })]);
    const result = findAgentByName(discovery, "scout");
    expect(result?.name).toBe("Scout");
  });

  test("returns undefined for unknown name", () => {
    const discovery = createDiscovery([createAgent({ name: "Scout" })]);
    expect(findAgentByName(discovery, "Planner")).toBeUndefined();
  });

  test("trims whitespace before comparing", () => {
    const discovery = createDiscovery([createAgent({ name: "Scout" })]);
    expect(findAgentByName(discovery, "  Scout  ")?.name).toBe("Scout");
  });
});

// ---------------------------------------------------------------------------
// parseAgentCommandArgs
// ---------------------------------------------------------------------------

describe("parseAgentCommandArgs", () => {
  test("returns empty agent and task for blank input", () => {
    expect(parseAgentCommandArgs("")).toEqual({ agent: "", task: "" });
    expect(parseAgentCommandArgs("   ")).toEqual({ agent: "", task: "" });
  });

  test("parses agent-only when no whitespace follows", () => {
    expect(parseAgentCommandArgs("Scout")).toEqual({ agent: "Scout", task: "" });
  });

  test("parses agent and task separated by a space", () => {
    expect(parseAgentCommandArgs("Scout explore the codebase")).toEqual({
      agent: "Scout",
      task: "explore the codebase",
    });
  });

  test("trims leading/trailing whitespace from the full input", () => {
    expect(parseAgentCommandArgs("  Scout  explore  ")).toEqual({
      agent: "Scout",
      task: "explore",
    });
  });

  test("handles tab as separator between agent and task", () => {
    const result = parseAgentCommandArgs("Scout\texplore");
    expect(result.agent).toBe("Scout");
    expect(result.task).toBe("explore");
  });
});

// ---------------------------------------------------------------------------
// registerSubagentTool
// ---------------------------------------------------------------------------

describe("registerSubagentTool", () => {
  test("registers a tool named 'subagent'", () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());
    expect(registeredTool().name).toBe("subagent");
  });

  test("execute returns isError=false on success", async () => {
    const { pi, registeredTool } = createPi();
    const manager = new AgentManager();
    vi.spyOn(manager, "spawnAndWait").mockResolvedValue({
      id: "run-1",
      record: completedRecord("found it"),
    });

    registerSubagentTool(
      pi,
      createDeps({ manager, discoverAgents: () => createDiscovery([createAgent()]) }),
    );

    const tool = registeredTool();
    const result = await (tool as unknown as {
      execute: (
        id: string,
        params: { agent: string; task: string },
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: ExtensionContext,
      ) => Promise<{ isError: boolean; content: unknown[] }>;
    }).execute(
      "tool-call-1",
      { agent: "Scout", task: "explore" },
      undefined,
      undefined,
      {
        cwd: "/repo",
        sessionManager: { getSessionFile: () => "/s.jsonl", getSessionDir: () => "/s" },
        model: undefined,
      } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContainEqual({ type: "text", text: "found it" });
  });

  test("execute returns isError=true when agent is unknown", async () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(
      pi,
      createDeps({ discoverAgents: () => createDiscovery([createAgent()]) }),
    );

    const tool = registeredTool();
    const result = await (tool as unknown as {
      execute: (
        id: string,
        params: { agent: string; task: string },
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: ExtensionContext,
      ) => Promise<{ isError: boolean; content: Array<{ type: string; text: string }> }>;
    }).execute(
      "tool-call-2",
      { agent: "Planner", task: "plan" },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown agent");
  });
});

// ---------------------------------------------------------------------------
// stub parameters
// ---------------------------------------------------------------------------

describe("stub parameters", () => {
  test("returns error for run_in_background stub", async () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());

    const tool = registeredTool();
    const result = await (
      tool as unknown as {
        execute: (
          id: string,
          params: { agent: string; task: string; run_in_background?: boolean },
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: ExtensionContext,
        ) => Promise<{
          isError: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }
    ).execute(
      "tool-call-bg",
      { agent: "Scout", task: "explore", run_in_background: true },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "run_in_background is not yet implemented",
    );
  });

  test("returns error for resume stub", async () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());

    const tool = registeredTool();
    const result = await (
      tool as unknown as {
        execute: (
          id: string,
          params: { agent: string; task: string; resume?: string },
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: ExtensionContext,
        ) => Promise<{
          isError: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }
    ).execute(
      "tool-call-resume",
      { agent: "Scout", task: "explore", resume: "agent-123" },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("resume is not yet implemented");
  });

  test("returns error for isolation stub", async () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());

    const tool = registeredTool();
    const result = await (
      tool as unknown as {
        execute: (
          id: string,
          params: { agent: string; task: string; isolation?: string },
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: ExtensionContext,
        ) => Promise<{
          isError: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }
    ).execute(
      "tool-call-iso",
      { agent: "Scout", task: "explore", isolation: "worktree" },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "isolation is not yet implemented",
    );
  });
});

// ---------------------------------------------------------------------------
// registerAgentCommand
// ---------------------------------------------------------------------------

describe("registerAgentCommand", () => {
  test("registers a command named 'agent'", () => {
    const { pi, registeredCommand } = createPi();
    registerAgentCommand(pi, createDeps());
    expect(registeredCommand("agent")).toBeDefined();
  });

  test("sends a pi-subagent-result message on success", async () => {
    const { pi, registeredCommand, sentMessages } = createPi();
    const manager = new AgentManager();
    vi.spyOn(manager, "spawnAndWait").mockResolvedValue({
      id: "run-2",
      record: completedRecord("summary output"),
    });

    registerAgentCommand(
      pi,
      createDeps({ manager, discoverAgents: () => createDiscovery([createAgent()]) }),
    );

    await registeredCommand("agent")?.handler(
      "Scout explore this codebase",
      { cwd: "/repo", model: undefined } as unknown as ExtensionCommandContext,
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.customType).toBe("pi-subagent-result");
    expect(sentMessages[0]?.content).toBe("summary output");
  });

  test("sends error message when agent name is unknown", async () => {
    const { pi, registeredCommand, sentMessages } = createPi();
    registerAgentCommand(
      pi,
      createDeps({ discoverAgents: () => createDiscovery([createAgent()]) }),
    );

    await registeredCommand("agent")?.handler(
      "Planner do something",
      { cwd: "/repo", model: undefined } as unknown as ExtensionCommandContext,
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toContain("Unknown agent");
  });
});
