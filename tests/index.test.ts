import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import { runAgent } from "../src/core/agent-runner.js";
import * as subagentsIndex from "../src/index.js";
import extension, { createRuntimeDeps, registerSubagentsExtension } from "../src/index.js";
import type { UICtx } from "../src/tui/agent-widget.js";

// Mock the agent runner and worktree so TUI-wiring tests can spawn agents synchronously.
vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: { messages: [], subscribe: vi.fn().mockReturnValue(() => {}) },
    aborted: false,
    steered: false,
  }),
  resumeAgent: vi.fn().mockResolvedValue(""),
  getAgentConversation: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/core/worktree.js", () => ({
  createWorktree: vi.fn().mockReturnValue(undefined),
  cleanupWorktree: vi.fn().mockReturnValue(undefined),
  pruneWorktrees: vi.fn(),
}));

import type { RuntimeDeps } from "../src/shared/runtime-deps.js";
import type { AgentDiscoveryResult, ResolvedPaths, SubagentsConfig } from "../src/shared/types.js";
import {
  buildAlignedRows,
  describeAgentEntry,
  runAgentsMenuAction,
  runAgentsMenuSettingsFlow,
  SETTINGS_MENU_ITEMS,
} from "../src/tui/agents-menu.js";

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
    defaultMaxTurns: 0,
    graceTurns: 5,
    defaultJoinMode: "smart",
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
    manager: new AgentManager(),
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
    expect(commands).not.toContainEqual(expect.objectContaining({ name: "agents:add" }));
  });

  test("registerSubagentsExtension no longer exports slash-live controller helpers", () => {
    expect("createSlashLiveControllerFromContext" in subagentsIndex).toBe(false);
  });

  test("registers get_subagent_result and steer_subagent tools", () => {
    const registeredTools: string[] = [];
    const pi = {
      on() {},
      registerTool(def: { name: string }) {
        registeredTools.push(def.name);
      },
      registerCommand() {},
      registerMessageRenderer() {},
      sendMessage() {},
      sendUserMessage() {},
      getAllTools() {
        return [];
      },
    } as unknown as ExtensionAPI;

    registerSubagentsExtension(pi, createMenuDeps());

    expect(registeredTools).toContain("subagent");
    expect(registeredTools).toContain("get_subagent_result");
    expect(registeredTools).toContain("steer_subagent");
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
      "Default Max Turns",
      "Grace Turns",
      "Default Join Mode",
      "Widget Mode",
      "Fleet View",
    ]);
    expect(SETTINGS_MENU_ITEMS.map((item) => item.promptTitle)).toEqual([
      "Max Concurrency",
      "Max Recursive Level",
      "Default Max Turns (0 = unlimited)",
      "Grace Turns (extra turns after soft limit)",
      "Default Join Mode (async, group, smart)",
      "Widget Mode (all / background / off)",
      "Fleet View (true / false)",
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
        defaultMaxTurns: 0,
        graceTurns: 5,
        defaultJoinMode: "smart",
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

    expect(seenOptions.some((options) => options.includes("Max Concurrency      3"))).toBe(true);
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

// ---- TUI wiring tests ----

function makeAgentDef() {
  return {
    name: "test-agent",
    description: "A test agent",
    tools: ["read", "bash"],
    subagentAgents: [],
    systemPrompt: "You are a test agent.",
    sourcePath: "/fake/path/test-agent.md",
  };
}

function createPiWithEventCapture() {
  const registeredEvents: string[] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      registeredEvents.push(event);
      handlers.set(event, handler);
    },
    registerTool() {},
    registerCommand() {},
    registerMessageRenderer() {},
    sendMessage() {},
    sendUserMessage() {},
    getAllTools() {
      return [];
    },
  } as unknown as ExtensionAPI;
  return { pi, registeredEvents, handlers };
}

describe("TUI wiring", () => {
  test("registerSubagentsExtension registers a tool_execution_start handler", () => {
    const { pi, registeredEvents } = createPiWithEventCapture();
    registerSubagentsExtension(pi, createMenuDeps());
    expect(registeredEvents).toContain("tool_execution_start");
  });

  test("fleet registers onTerminalInput when tool_execution_start fires", async () => {
    const { pi, handlers } = createPiWithEventCapture();
    const deps = createRuntimeDeps(pi);
    registerSubagentsExtension(pi, deps);

    let inputHandlerRegistered = false;
    const mockCtx = {
      ui: {
        setWidget() {},
        setStatus() {},
        onTerminalInput(_handler: unknown) {
          inputHandlerRegistered = true;
          return () => {};
        },
        getEditorText() {
          return "";
        },
        notify() {},
        custom() {
          return Promise.resolve(undefined);
        },
      },
    };

    const handler = handlers.get("tool_execution_start");
    await handler?.({}, mockCtx);

    expect(inputHandlerRegistered).toBe(true);
  });

  test("widget.markFinished and fleet.onAgentFinished are called when agent completes", async () => {
    const { pi } = createPiWithEventCapture();
    const deps = createRuntimeDeps(pi);

    const widget = deps.widget;
    const fleet = deps.fleet;
    if (!widget || !fleet) throw new Error("widget/fleet not initialized");

    const markFinishedIds: string[] = [];
    const onAgentFinishedIds: string[] = [];

    const origMarkFinished = widget.markFinished.bind(widget);
    widget.markFinished = (id: string) => {
      markFinishedIds.push(id);
      origMarkFinished(id);
    };

    const origOnAgentFinished = fleet.onAgentFinished.bind(fleet);
    fleet.onAgentFinished = (id: string) => {
      onAgentFinishedIds.push(id);
      origOnAgentFinished(id);
    };

    const { id } = await deps.manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });

    expect(markFinishedIds).toContain(id);
    expect(onAgentFinishedIds).toContain(id);
  });

  test("widget setWidget is called after agent completes when UICtx is set", async () => {
    const { pi } = createPiWithEventCapture();
    const deps = createRuntimeDeps(pi);

    const widget = deps.widget;
    if (!widget) throw new Error("widget not initialized");

    // Use "all" mode so both foreground and background agents appear in the widget.
    deps.setWidgetMode?.("all");

    const setWidgetKeys: string[] = [];
    const mockUiCtx = {
      setWidget(key: string) {
        setWidgetKeys.push(key);
      },
      setStatus() {},
    };
    widget.setUICtx(mockUiCtx as UICtx);

    await deps.manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });

    // After completion, markFinished is called then widget.update() triggers setWidget
    expect(setWidgetKeys).toContain("agents");
  });

  test("sets working message during foreground agent execution", async () => {
    // Capture the subagent tool execute function.
    let subagentExecute:
      | ((
          toolCallId: string,
          params: { agent: string; task: string },
          signal: AbortSignal | undefined,
          onUpdate: unknown,
          ctx: ExtensionContext,
        ) => Promise<unknown>)
      | undefined;

    const pi = {
      on() {},
      registerTool(def: { name: string; execute: typeof subagentExecute }) {
        if (def.name === "subagent") subagentExecute = def.execute;
      },
      registerCommand() {},
      registerMessageRenderer() {},
      sendMessage() {},
      sendUserMessage() {},
      getAllTools() {
        return [];
      },
    } as unknown as ExtensionAPI;

    registerSubagentsExtension(pi, createMenuDeps());

    if (!subagentExecute) throw new Error("subagent tool not registered");

    // Override runAgent for this one call to simulate a live tool activity event.
    vi.mocked(runAgent).mockImplementationOnce(async (_def, opts) => {
      opts.onToolActivity?.({ type: "start", toolName: "read" });
      return {
        responseText: "done",
        session: { messages: [], subscribe: vi.fn().mockReturnValue(() => {}) },
        aborted: false,
        steered: false,
      };
    });

    const setWorkingMessageCalls: Array<string | undefined> = [];
    const mockCtx = {
      ui: {
        setWorkingMessage(msg?: string) {
          setWorkingMessageCalls.push(msg);
        },
        notify() {},
      },
      cwd: "/tmp",
      mode: "tui",
    } as unknown as ExtensionContext;

    await subagentExecute(
      "call-1",
      { agent: "Scout", task: "do something" },
      undefined,
      undefined,
      mockCtx,
    );

    // During execution: setWorkingMessage called with "Scout: reading…"
    expect(
      setWorkingMessageCalls.some(
        (msg) => typeof msg === "string" && msg.startsWith("Scout:"),
      ),
    ).toBe(true);
    // After completion: setWorkingMessage called with no args to reset
    expect(setWorkingMessageCalls.at(-1)).toBeUndefined();
  });
});
