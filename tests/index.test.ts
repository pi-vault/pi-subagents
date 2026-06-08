import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import extension, { registerSubagentsExtension } from "../src/index.js";
import {
  runAgentsMenuAction,
  runAgentsMenuSettingsFlow,
} from "../src/tui/agents-menu.js";
import type {
  AgentCreationInput,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
  RuntimeDeps,
  SubagentsConfig,
} from "../src/shared/types.js";

function createPaths(): ResolvedPaths {
  return {
    agentDir: "/tmp/pi-agent",
    configPath: "/tmp/pi-agent/extensions/subagents.json",
    userAgentsDir: "/tmp/pi-agent/agents",
    bundledAgentsDir: "/repo/agents",
    sessionsDir: "/tmp/pi-agent/sessions",
  };
}

function createPi(
  registerCommand?: (name: string, command: RegisteredCommand) => void,
  registerMessageRenderer?: (customType: string, renderer: unknown) => void,
) {
  return {
    on() {},
    registerTool() {},
    registerCommand(name: string, command: RegisteredCommand) {
      registerCommand?.(name, command);
    },
    registerMessageRenderer(customType: string, renderer: unknown) {
      registerMessageRenderer?.(customType, renderer);
    },
    sendMessage() {},
    sendUserMessage() {},
    getAllTools() {
      return [];
    },
  } as unknown as ExtensionAPI;
}

function createMenuDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  const paths = createPaths();
  const config: SubagentsConfig = {
    maxConcurrency: 3,
    maxRecursiveLevel: 3,
    defaultTimeoutMs: 600_000,
  };
  const discovery: AgentDiscoveryResult = {
    agents: [
      {
        name: "Scout",
        description: "Scout files",
        tools: ["read", "bash"],
        subagentAgents: [],
        systemPrompt: "You are Scout.",
        sourcePath: "/repo/agents/scout.md",
      },
    ],
    diagnostics: [],
  };

  return {
    resolvePaths: () => paths,
    loadConfig: () => ({ exists: false, config }),
    discoverAgents: () => discovery,
    discoverToolNames: () => ["bash", "read", "write"],
    createAgentFile: () => discovery.agents[0]!,
    exportAgentToUserScope: () => discovery.agents[0]!,
    disableAgentInUserScope: () => ({ ...discovery.agents[0]!, disabled: true }),
    deleteUserAgentOverride: () => {},
    saveConfig: () => {},
    ...overrides,
  };
}

describe("subagents extension", () => {
  test("loads without throwing and registers the subagent result message renderer", () => {
    const commands: Array<{ name: string; description?: string }> = [];
    const renderers: Array<{ customType: string; renderer: unknown }> = [];
    const pi = createPi(
      (name, command) => {
        commands.push({ name, description: command.description });
      },
      (customType, renderer) => {
        renderers.push({ customType, renderer });
      },
    );

    expect(() => extension(pi)).not.toThrow();
    expect(renderers).toContainEqual(
      expect.objectContaining({
        customType: "pi-subagent-result",
        renderer: expect.any(Function),
      }),
    );
    expect(commands).toContainEqual({
      name: "agent",
      description: "Run a discovered pi-subagents agent in the foreground",
    });
    expect(commands).toContainEqual({
      name: "agents",
      description: "Open the interactive pi-subagents agents menu",
    });
    expect(commands).not.toContainEqual(
      expect.objectContaining({ name: "agents:add" }),
    );
  });

  test("/agents opens a custom menu instead of sending a notify dump", async () => {
    let handler: RegisteredCommand["handler"] | undefined;
    const notifications: Array<{ message: string; level: string }> = [];
    const customCalls: string[] = [];
    const pi = createPi((name, command) => {
      if (name === "agents") {
        handler = command.handler;
      }
    });

    registerSubagentsExtension(pi, createMenuDeps());

    await handler?.("", {
      ui: {
        custom() {
          customCalls.push("opened");
          return Promise.resolve(undefined);
        },
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as unknown as ExtensionCommandContext);

    expect(customCalls).toEqual(["opened"]);
    expect(notifications).toEqual([]);
  });

  test("/agents falls back to select-based browsing when custom UI is unavailable", async () => {
    let handler: RegisteredCommand["handler"] | undefined;
    const exported: string[] = [];
    const selections = ["Agents (1)", "Scout  [bundled]", "Export to global"];
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-menu-"));
    const paths = {
      agentDir: join(rootDir, "agent"),
      configPath: join(rootDir, "agent", "extensions", "subagents.json"),
      userAgentsDir: join(rootDir, "agent", "agents"),
      bundledAgentsDir: join(rootDir, "bundled-agents"),
      sessionsDir: join(rootDir, "agent", "sessions"),
    };
    mkdirSync(paths.bundledAgentsDir, { recursive: true });
    writeFileSync(
      join(paths.bundledAgentsDir, "scout.md"),
      [
        "---",
        "name: Scout",
        "description: Scout files",
        "tools: read, bash",
        "---",
        "You are Scout.",
        "",
      ].join("\n"),
      "utf8",
    );
    const pi = createPi((name, command) => {
      if (name === "agents") {
        handler = command.handler;
      }
    });

    registerSubagentsExtension(
      pi,
      createMenuDeps({
        resolvePaths: () => paths,
        exportAgentToUserScope(_paths, _discovery, name) {
          exported.push(name);
          return {
            name,
            description: "Scout files",
            tools: ["read"],
            subagentAgents: [],
            systemPrompt: "You are Scout.",
            sourcePath: "/tmp/pi-agent/agents/scout.md",
          };
        },
      }),
    );

    await handler?.("", {
      ui: {
        select(_title: string, options: string[]) {
          const next = selections.shift();
          return Promise.resolve(options.find((option) => option === next));
        },
        notify() {},
      },
    } as unknown as ExtensionCommandContext);

    expect(exported).toEqual(["Scout"]);
  });

  test("menu exports a bundled agent to global scope", async () => {
    const exported: string[] = [];
    await runAgentsMenuAction(
      { kind: "export-agent", agentName: "Scout" },
      {
        ui: {
          notify() {},
        },
      } as unknown as ExtensionCommandContext,
      createMenuDeps({
        exportAgentToUserScope(_paths, _discovery, name) {
          exported.push(name);
          return {
            name,
            description: "Scout files",
            tools: ["read"],
            subagentAgents: [],
            systemPrompt: "You are Scout.",
            sourcePath: "/tmp/pi-agent/agents/scout.md",
          };
        },
      }),
    );

    expect(exported).toEqual(["Scout"]);
  });

  test("menu settings writes maxConcurrency, maxRecursiveLevel, and defaultTimeoutMs", async () => {
    const writes: SubagentsConfig[] = [];
    const values = ["7", "5", "120000"];

    await runAgentsMenuSettingsFlow(
      {
        ui: {
          input() {
            return Promise.resolve(values.shift());
          },
          notify() {},
        },
      } as unknown as ExtensionCommandContext,
      createMenuDeps({
        saveConfig(_paths, nextConfig) {
          writes.push(nextConfig);
        },
      }),
    );

    expect(writes.at(-1)).toEqual({
      maxConcurrency: 7,
      maxRecursiveLevel: 5,
      defaultTimeoutMs: 120000,
    });
  });

  test("menu settings rejects invalid numeric input and does not save", async () => {
    const writes: SubagentsConfig[] = [];
    const notifications: Array<{ message: string; level: string }> = [];
    const values = ["abc", "5", "120000"];

    await runAgentsMenuSettingsFlow(
      {
        ui: {
          input() {
            return Promise.resolve(values.shift());
          },
          notify(message: string, level: string) {
            notifications.push({ message, level });
          },
        },
      } as unknown as ExtensionCommandContext,
      createMenuDeps({
        saveConfig(_paths, nextConfig) {
          writes.push(nextConfig);
        },
      }),
    );

    expect(writes).toEqual([]);
    expect(notifications).toContainEqual({
      message: "Settings not saved: all values must be positive numbers.",
      level: "error",
    });
  });

  test("menu action reports export errors instead of throwing", async () => {
    const notifications: Array<{ message: string; level: string }> = [];

    await runAgentsMenuAction(
      { kind: "export-agent", agentName: "Missing" },
      {
        ui: {
          notify(message: string, level: string) {
            notifications.push({ message, level });
          },
        },
      } as unknown as ExtensionCommandContext,
      createMenuDeps({
        exportAgentToUserScope() {
          throw new Error("unknown agent: Missing");
        },
      }),
    );

    expect(notifications).toContainEqual({
      message: "Could not export agent: unknown agent: Missing",
      level: "error",
    });
  });
});
