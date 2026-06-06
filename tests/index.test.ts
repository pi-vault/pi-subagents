import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import extension, {
  buildAgentsStatusMessage,
  registerSubagentsExtension,
} from "../src/index.js";
import type {
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
} from "../src/types.js";

function createPaths(): ResolvedPaths {
  return {
    agentDir: "/tmp/pi-agent",
    configPath: "/tmp/pi-agent/extensions/subagents.json",
    userAgentsDir: "/tmp/pi-agent/agents",
    bundledAgentsDir: "/repo/agents",
    transcriptCacheDir: "/tmp/pi-agent/cache/pi-subagents",
  };
}

describe("subagents extension", () => {
  test("loads without throwing", () => {
    const commands: Array<{ name: string; description?: string }> = [];
    const pi = {
      registerCommand(name: string, command: RegisteredCommand) {
        commands.push({ name, description: command.description });
      },
    } as unknown as ExtensionAPI;

    expect(() => extension(pi)).not.toThrow();
    expect(commands).toContainEqual({
      name: "agents",
      description: "List discovered pi-subagents agents",
    });
  });

  test("registers /agents and reports discovered agents plus diagnostics", async () => {
    const paths = createPaths();
    const loadedConfig: LoadedConfig = {
      exists: false,
      config: {
        maxConcurrency: 4,
        maxRecursiveLevel: 2,
        defaultTimeoutMs: 600_000,
      },
    };
    const discovery: AgentDiscoveryResult = {
      agents: [
        {
          name: "planner",
          description: "Plans work",
          tools: ["read", "bash"],
          model: "default",
          thinking: "medium",
          subagentAgents: ["worker", "researcher"],
          timeoutMs: 180000,
          systemPrompt: "Plan the work",
          sourcePath: "/repo/agents/planner.md",
        },
      ],
      diagnostics: [
        {
          path: "/tmp/pi-agent/agents/bad.md",
          reason: "missing required non-empty description",
        },
      ],
    };

    let handler: RegisteredCommand["handler"] | undefined;
    const notifications: Array<{ message: string; level: string }> = [];

    const pi = {
      registerCommand(name: string, command: RegisteredCommand) {
        if (name === "agents") {
          handler = command.handler;
        }
      },
    } as unknown as ExtensionAPI;

    registerSubagentsExtension(pi, {
      resolvePaths: () => paths,
      loadConfig: () => loadedConfig,
      discoverAgents: () => discovery,
    });

    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /agents handler to be registered");
    }

    await handler("", {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as ExtensionCommandContext);

    expect(notifications).toEqual([
      {
        level: "info",
        message: buildAgentsStatusMessage(paths, loadedConfig.config, discovery),
      },
    ]);
  });
});
