import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ExecutionStateStore } from "../src/core/execution-state.js";
import * as subagentsIndex from "../src/index.js";
import extension, { registerSubagentsExtension } from "../src/index.js";
import {
  runAgentsMenuAction,
  runAgentsMenuSettingsFlow,
  SETTINGS_MENU_ITEMS,
  buildAlignedRows,
  describeAgentEntry,
} from "../src/tui/agents-menu.js";
import type { RuntimeDeps } from "../src/shared/runtime-deps.js";
import type {
  AgentDiscoveryResult,
  ResolvedPaths,
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
  onRegister?: (event: string, handler: (...args: unknown[]) => unknown) => void,
) {
  return {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      onRegister?.(event, handler);
    },
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
  const primaryAgent = discovery.agents[0];

  if (!primaryAgent) {
    throw new Error("Expected a default discovered agent for test setup");
  }

  return {
    resolvePaths: () => paths,
    loadConfig: () => ({ exists: false, config }),
    discoverAgents: () => discovery,
    discoverToolNames: () => ["bash", "read", "write"],
    createAgentFile: () => primaryAgent,
    exportAgentToUserScope: () => primaryAgent,
    disableAgentInUserScope: () => ({ ...primaryAgent, enabled: false }),
    deleteUserAgentOverride: () => {},
    saveConfig: () => {},
    stateStore: new ExecutionStateStore(),
    ...overrides,
  };
}

describe("subagents extension", () => {
  test("hydrates deferred slash requests on session_start", async () => {
    const eventHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const pi = createPi(undefined, undefined, (event, handler) => {
      eventHandlers.set(event, handler);
    });

    const deps = createMenuDeps();
    registerSubagentsExtension(pi, deps);

    const sessionManager = {
      getEntries() {
        return [
          {
            type: "custom",
            customType: "pi-subagents:deferred-request",
            data: {
              requestId: "hydrate-1",
              agent: "Scout",
              task: "explore",
              cwd: "/repo",
              createdAt: 1000,
            },
          },
        ] as never[];
      },
    };

    await eventHandlers.get("session_start")?.({}, { sessionManager });

    expect(deps.stateStore.getDeferredRequest("hydrate-1")).toMatchObject({
      requestId: "hydrate-1",
      agent: "Scout",
    });
  });

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

  test("registerSubagentsExtension no longer exports slash-live controller helpers", () => {
    expect("createSlashLiveControllerFromContext" in subagentsIndex).toBe(false);
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

  test("settings labels come from centralized metadata", () => {
    expect(SETTINGS_MENU_ITEMS.map((item) => item.label)).toEqual([
      "Max Concurrency",
      "Max Recursive Level",
      "Default Timeout MS",
    ]);
    expect(SETTINGS_MENU_ITEMS.map((item) => item.promptTitle)).toEqual([
      "Max Concurrency",
      "Max Recursive Level",
      "Default Timeout MS",
    ]);
  });

  test("settings flow edits one selected setting and writes only that change", async () => {
    const writes: SubagentsConfig[] = [];
    const selections = ["Max Concurrency      3", "Back"];
    const inputs = ["7"];

    await runAgentsMenuSettingsFlow(
      {
        ui: {
          select(_title: string, options: string[]) {
            const next = selections.shift();
            return Promise.resolve(options.find((option) => option === next));
          },
          input() {
            return Promise.resolve(inputs.shift());
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

    expect(writes).toEqual([
      {
        maxConcurrency: 7,
        maxRecursiveLevel: 3,
        defaultTimeoutMs: 600_000,
      },
    ]);
  });

  test("menu settings rejects invalid numeric input and does not save", async () => {
    const writes: SubagentsConfig[] = [];
    const notifications: Array<{ message: string; level: string }> = [];
    const selections = ["Max Concurrency      3", "Back"];
    const inputs = ["abc"];

    await runAgentsMenuSettingsFlow(
      {
        ui: {
          select(_title: string, options: string[]) {
            const next = selections.shift();
            return Promise.resolve(options.find((option) => option === next));
          },
          input() {
            return Promise.resolve(inputs.shift());
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

  test("describeAgentEntry returns label/detail instead of one concatenated string", () => {
    expect(
      describeAgentEntry({
        name: "planner",
        state: "bundled",
      } as never),
    ).toEqual({
      label: "planner",
      detail: "[bundled]",
    });
  });

  test("buildAlignedRows pads labels so status starts in the same column", () => {
    const rows = buildAlignedRows([
      { label: "planner", detail: "[bundled]", value: "planner" },
      { label: "researcher", detail: "[bundled]", value: "researcher" },
      { label: "worker", detail: "[bundled]", value: "worker" },
    ]);

    expect(rows).toEqual([
      "planner     [bundled]",
      "researcher  [bundled]",
      "worker      [bundled]",
    ]);
  });

  test("settings fallback without ui.custom still shows current values in select labels", async () => {
    const seenOptions: string[][] = [];
    const selections = ["Max Concurrency      3", "Back"];

    await runAgentsMenuSettingsFlow(
      {
        ui: {
          select(_title: string, options: string[]) {
            seenOptions.push(options);
            const next = selections.shift();
            return Promise.resolve(options.find((option) => option === next));
          },
          input() {
            return Promise.resolve(undefined);
          },
          notify() {},
        },
      } as unknown as ExtensionCommandContext,
      createMenuDeps(),
    );

    expect(
      seenOptions.some((options) =>
        options.includes("Max Concurrency      3"),
      ),
    ).toBe(true);
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
