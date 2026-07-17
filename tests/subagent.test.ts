import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import { DEFAULT_SETTINGS } from "../src/core/settings.js";
import {
  findAgentByName,
  parseAgentCommandArgs,
  registerAgentCommand,
  registerSubagentTool,
} from "../src/core/subagent.js";
import type { RuntimeDeps } from "../src/shared/runtime-deps.js";
import {
  completedRecord,
  createAgent,
  createDeps,
  createDiscovery,
  emptyUsage,
} from "./_test-helpers.js";

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

  test("uses the active settings snapshot when params.cwd differs", async () => {
    const { pi, registeredTool } = createPi();
    const manager = new AgentManager();
    const spawnAndWait = vi.spyOn(manager, "spawnAndWait").mockResolvedValue({
      id: "run-settings",
      record: completedRecord("done"),
    });
    registerSubagentTool(
      pi,
      createDeps({
        manager,
        settings: {
          ...DEFAULT_SETTINGS,
          defaultMaxTurns: 17,
          graceTurns: 2,
        },
      }),
    );

    await registeredTool().execute(
      "tool-call-settings",
      { agent: "Scout", task: "explore", cwd: "/tmp" },
      undefined,
      undefined,
      { cwd: "/repo" } as ExtensionContext,
    );

    expect(spawnAndWait).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        cwd: "/tmp",
        maxTurns: 17,
        graceTurns: 2,
      }),
    );
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
// background / resume / isolation paths
// ---------------------------------------------------------------------------

describe("background spawn", () => {
  test("run_in_background returns isError=false with agent id", async () => {
    const { pi, registeredTool } = createPi();
    const manager = new AgentManager();
    const spawnSpy = vi.spyOn(manager, "spawn").mockReturnValue("agent-bg-1");
    vi.spyOn(manager, "getRecord").mockReturnValue({
      id: "agent-bg-1",
      type: "Scout",
      description: "background task",
      status: "running",
      toolUses: 0,
      turnCount: 0,
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    });

    registerSubagentTool(
      pi,
      createDeps({ manager, discoverAgents: () => createDiscovery([createAgent()]) }),
    );

    const tool = registeredTool();
    const result = await (tool as unknown as {
      execute: (
        id: string,
        params: { agent: string; task: string; run_in_background?: boolean },
        signal: undefined,
        onUpdate: undefined,
        ctx: ExtensionContext,
      ) => Promise<{ isError: boolean; content: Array<{ type: string; text: string }>; details: unknown }>;
    }).execute(
      "tool-call-bg",
      { agent: "Scout", task: "explore", run_in_background: true },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(false);
    expect(spawnSpy).toHaveBeenCalledOnce();
    expect(result.content[0]?.text).toContain("Agent ID: agent-bg-1");
  });

  test("resume with unknown agent returns isError=true", async () => {
    const { pi, registeredTool } = createPi();
    const manager = new AgentManager();
    vi.spyOn(manager, "resume").mockResolvedValue(undefined);

    registerSubagentTool(
      pi,
      createDeps({ manager, discoverAgents: () => createDiscovery([createAgent()]) }),
    );

    const tool = registeredTool();
    const result = await (tool as unknown as {
      execute: (
        id: string,
        params: { agent: string; task: string; resume?: string },
        signal: undefined,
        onUpdate: undefined,
        ctx: ExtensionContext,
      ) => Promise<{ isError: boolean; content: Array<{ type: string; text: string }> }>;
    }).execute(
      "tool-call-resume",
      { agent: "Scout", task: "explore", resume: "agent-unknown" },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Agent not found");
  });

  test("isolation param passes through to spawnAndWait without error", async () => {
    const { pi, registeredTool } = createPi();
    const manager = new AgentManager();
    const spawnAndWaitSpy = vi.spyOn(manager, "spawnAndWait").mockResolvedValue({
      id: "run-iso",
      record: completedRecord("isolated result"),
    });

    registerSubagentTool(
      pi,
      createDeps({ manager, discoverAgents: () => createDiscovery([createAgent()]) }),
    );

    const tool = registeredTool();
    const result = await (tool as unknown as {
      execute: (
        id: string,
        params: { agent: string; task: string; isolation?: string },
        signal: undefined,
        onUpdate: undefined,
        ctx: ExtensionContext,
      ) => Promise<{ isError: boolean; content: Array<{ type: string; text: string }> }>;
    }).execute(
      "tool-call-iso",
      { agent: "Scout", task: "explore", isolation: "worktree" },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(false);
    expect(spawnAndWaitSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// background spawn activity wiring
// ---------------------------------------------------------------------------

describe("background spawn activity wiring", () => {
  function makeSpawnDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
    const manager = new AgentManager();
    vi.spyOn(manager, "spawn").mockReturnValue("agent-bg-act");
    vi.spyOn(manager, "getRecord").mockReturnValue({
      id: "agent-bg-act",
      type: "Scout",
      description: "background task",
      status: "running",
      toolUses: 0,
      turnCount: 0,
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    });
    return createDeps({
      manager,
      discoverAgents: () => createDiscovery([createAgent()]),
      ...overrides,
    });
  }

  async function spawnBackground(deps: RuntimeDeps): Promise<unknown> {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, deps);
    const tool = registeredTool();
    return (tool as unknown as {
      execute: (
        id: string,
        params: { agent: string; task: string; run_in_background?: boolean },
        signal: undefined,
        onUpdate: undefined,
        ctx: ExtensionContext,
      ) => Promise<unknown>;
    }).execute(
      "tool-call-act",
      { agent: "Scout", task: "explore", run_in_background: true },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );
  }

  test("stores activity state in agentActivity when spawning background agent", async () => {
    const agentActivity = new Map();
    const deps = makeSpawnDeps({ agentActivity });
    await spawnBackground(deps);
    expect(agentActivity.size).toBe(1);
  });

  test("calls ensureTimers when spawning background agent", async () => {
    const ensureTimers = vi.fn();
    const deps = makeSpawnDeps({ ensureTimers });
    await spawnBackground(deps);
    expect(ensureTimers).toHaveBeenCalled();
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
