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
  AgentCreationInput,
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
    sessionsDir: "/tmp/pi-agent/sessions",
    runtimeCacheDir: "/tmp/pi-agent/cache/pi-subagents",
  };
}

function createPi(
  registerCommand?: (name: string, command: RegisteredCommand) => void,
  registerMessageRenderer?: (customType: string, renderer: unknown) => void,
) {
  return {
    registerTool() {},
    registerCommand(name: string, command: RegisteredCommand) {
      registerCommand?.(name, command);
    },
    registerMessageRenderer(customType: string, renderer: unknown) {
      registerMessageRenderer?.(customType, renderer);
    },
    sendMessage() {},
    getAllTools() {
      return [];
    },
  } as unknown as ExtensionAPI;
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
      description: "List discovered pi-subagents agents",
    });
    expect(commands).toContainEqual({
      name: "agents:add",
      description: "Create a new pi-subagents agent markdown file",
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
    const pi = createPi((name, command) => {
      if (name === "agents") {
        handler = command.handler;
      }
    });

    registerSubagentsExtension(pi, {
      resolvePaths: () => paths,
      loadConfig: () => loadedConfig,
      discoverAgents: () => discovery,
      discoverToolNames: () => [],
      createAgentFile: () => {
        throw new Error("not used");
      },
    });

    expect(handler).toBeDefined();
    await handler?.("", {
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

  test("/agents:add collects inputs, writes an agent, and lists refreshed discovery", async () => {
    const paths = createPaths();
    const loadedConfig: LoadedConfig = {
      exists: false,
      config: {
        maxConcurrency: 3,
        maxRecursiveLevel: 3,
        defaultTimeoutMs: 600_000,
      },
    };
    const beforeDiscovery: AgentDiscoveryResult = {
      agents: [
        {
          name: "worker",
          description: "Does work",
          tools: ["read"],
          subagentAgents: [],
          systemPrompt: "Do work",
          sourcePath: "/repo/agents/worker.md",
        },
      ],
      diagnostics: [],
    };
    const afterDiscovery: AgentDiscoveryResult = {
      agents: [
        ...beforeDiscovery.agents,
        {
          name: "Scout",
          description: "Scout files",
          tools: ["bash", "read"],
          model: "default",
          thinking: "medium",
          subagentAgents: ["worker"],
          timeoutMs: 180000,
          systemPrompt: "# Prompt\nInspect the repo.",
          sourcePath: "/tmp/pi-agent/agents/scout.md",
        },
      ],
      diagnostics: [],
    };

    let addHandler: RegisteredCommand["handler"] | undefined;
    const notifications: Array<{ message: string; level: string }> = [];
    const capturedInputs: AgentCreationInput[] = [];
    let discoveryCalls = 0;
    const pi = createPi((name, command) => {
      if (name === "agents:add") {
        addHandler = command.handler;
      }
    });

    registerSubagentsExtension(pi, {
      resolvePaths: () => paths,
      loadConfig: () => loadedConfig,
      discoverAgents: () => {
        discoveryCalls += 1;
        return discoveryCalls >= 2 ? afterDiscovery : beforeDiscovery;
      },
      discoverToolNames: () => ["bash", "read", "write"],
      createAgentFile: (_paths, input) => {
        capturedInputs.push(input);
        return afterDiscovery.agents[1];
      },
    });

    expect(addHandler).toBeDefined();

    const inputs = [
      "Scout",
      "Scout files",
      "bash, read",
      "default",
      "medium",
      "worker",
      "180000",
    ];

    await addHandler?.("", {
      ui: {
        input() {
          return Promise.resolve(inputs.shift());
        },
        editor() {
          return Promise.resolve("# Prompt\nInspect the repo.");
        },
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as unknown as ExtensionCommandContext);

    expect(capturedInputs).toEqual([
      {
        name: "Scout",
        filenameSlug: undefined,
        description: "Scout files",
        tools: ["bash", "read"],
        model: "default",
        thinking: "medium",
        subagentAgents: ["worker"],
        timeoutMs: 180000,
        systemPrompt: "# Prompt\nInspect the repo.",
      },
    ]);
    expect(notifications).toEqual([
      {
        level: "info",
        message: [
          'Created agent "Scout" at /tmp/pi-agent/agents/scout.md',
          "",
          buildAgentsStatusMessage(paths, loadedConfig.config, afterDiscovery),
        ].join("\n"),
      },
    ]);
  });

  test("/agents:add reports validation errors from creation and supports missing frontmatter name", async () => {
    const paths = createPaths();
    const loadedConfig: LoadedConfig = {
      exists: false,
      config: {
        maxConcurrency: 3,
        maxRecursiveLevel: 3,
        defaultTimeoutMs: 600_000,
      },
    };
    const discovery: AgentDiscoveryResult = {
      agents: [],
      diagnostics: [],
    };

    let addHandler: RegisteredCommand["handler"] | undefined;
    const notifications: Array<{ message: string; level: string }> = [];
    const capturedInputs: AgentCreationInput[] = [];
    const pi = createPi((name, command) => {
      if (name === "agents:add") {
        addHandler = command.handler;
      }
    });

    registerSubagentsExtension(pi, {
      resolvePaths: () => paths,
      loadConfig: () => loadedConfig,
      discoverAgents: () => discovery,
      discoverToolNames: () => ["read"],
      createAgentFile: (_paths, input) => {
        capturedInputs.push(input);
        throw new Error("description must be non-empty");
      },
    });

    expect(addHandler).toBeDefined();

    const inputs = ["", "planner", "   ", "read", "", "", "", ""];

    await addHandler?.("", {
      ui: {
        input() {
          return Promise.resolve(inputs.shift());
        },
        editor() {
          return Promise.resolve("Body");
        },
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as unknown as ExtensionCommandContext);

    expect(capturedInputs).toEqual([
      {
        name: "",
        filenameSlug: "planner",
        description: "   ",
        tools: ["read"],
        model: "",
        thinking: "",
        subagentAgents: [],
        timeoutMs: undefined,
        systemPrompt: "Body",
      },
    ]);
    expect(notifications).toEqual([
      {
        level: "error",
        message: "Could not create agent: description must be non-empty",
      },
    ]);
  });
});
