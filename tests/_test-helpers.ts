import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AgentManager } from "../src/core/agent-manager.js";
import { DEFAULT_SETTINGS } from "../src/core/settings.js";
import { registerSubagentTool } from "../src/core/subagent.js";
import type { RuntimeDeps } from "../src/shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  AgentRecord,
  LifetimeUsage,
  SubagentToolInput,
} from "../src/shared/types.js";

export function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
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

export function createDiscovery(agents: AgentDefinition[] = []): AgentDiscoveryResult {
  return { agents, diagnostics: [] };
}

export function emptyUsage(): LifetimeUsage {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
}

export function completedRecord(result = "done"): AgentRecord {
  return {
    id: "test-inv",
    type: "subagent",
    description: "test task",
    status: "completed",
    startedAt: 1000,
    durationMs: 42,
    result,
    error: undefined,
    toolUses: 0,
    turnCount: 0,
    lifetimeUsage: emptyUsage(),
  };
}

export function createDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return {
    resolvePaths: () => ({
      agentDir: "/tmp/pi-agent",
      configPath: "/tmp/pi-agent/extensions/subagents.json",
      userAgentsDir: "/tmp/pi-agent/agents",
      bundledAgentsDir: "/repo/agents",
      sessionsDir: "/tmp/pi-agent/sessions",
      userChainsDir: "/tmp/pi-agent/chains",
      bundledChainsDir: "/repo/chains",
      userPromptsDir: "/tmp/pi-agent/prompts",
      bundledPromptsDir: "/repo/prompts",
    }),
    settings: { ...DEFAULT_SETTINGS },
    loadSettings: () => ({ ...DEFAULT_SETTINGS }),
    saveSetting: async () => true,
    refreshSettings: () => {},
    discoverAgents: () => createDiscovery([createAgent()]),
    discoverAgentCatalog: () => ({
      entries: [],
      userDiagnostics: [],
      bundledDiagnostics: [],
    }),
    readUserAgentOverride: () => "",
    updateUserAgentOverride: () => {
      throw new Error("not used");
    },
    discoverToolNames: () => ["bash", "read"],
    createAgentFile: () => { throw new Error("not used"); },
    exportAgentToUserScope: () => { throw new Error("not used"); },
    disableAgentInUserScope: () => { throw new Error("not used"); },
    deleteUserAgentOverride: () => {},
    manager: new AgentManager(),
    ...overrides,
  };
}

type ToolDef = {
  execute: (...args: unknown[]) => Promise<unknown>;
  [k: string]: unknown;
};

export function createPi() {
  let toolDef: ToolDef | undefined;
  const pi = {
    registerTool(def: ToolDef) {
      toolDef = def;
    },
    registerCommand() {},
    sendMessage() {},
    getAllTools() {
      return [];
    },
    on() {},
    registerMessageRenderer() {},
    sendUserMessage() {},
  } as unknown as Parameters<typeof registerSubagentTool>[0];

  return {
    pi,
    registeredTool: () => {
      if (!toolDef) throw new Error("registerTool was not called");
      return toolDef;
    },
  };
}

export const CTX = { cwd: "/repo" } as unknown as ExtensionContext;

export async function executeTool(
  deps: RuntimeDeps,
  params: Partial<SubagentToolInput>,
): Promise<{
  isError: boolean;
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}> {
  const { pi, registeredTool } = createPi();
  registerSubagentTool(pi, deps);
  const tool = registeredTool();
  return tool.execute("tc-1", params, undefined, undefined, CTX) as Promise<{
    isError: boolean;
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
}
