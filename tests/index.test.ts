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
      getAllTools() {
        return [];
      },
    } as unknown as ExtensionAPI;

    expect(() => extension(pi)).not.toThrow();
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

    const pi = {
      registerCommand(name: string, command: RegisteredCommand) {
        if (name === "agents") {
          handler = command.handler;
        }
      },
      getAllTools() {
        return [];
      },
    } as unknown as ExtensionAPI;

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

    const pi = {
      registerCommand(name: string, command: RegisteredCommand) {
        if (name === "agents:add") {
          addHandler = command.handler;
        }
      },
      getAllTools() {
        return [];
      },
    } as unknown as ExtensionAPI;

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
    if (!addHandler) {
      throw new Error("Expected /agents:add handler to be registered");
    }

    const inputs = [
      "Scout",
      "Scout files",
      "bash, read",
      "default",
      "medium",
      "worker",
      "180000",
    ];

    await addHandler("", {
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

    const pi = {
      registerCommand(name: string, command: RegisteredCommand) {
        if (name === "agents:add") {
          addHandler = command.handler;
        }
      },
      getAllTools() {
        return [];
      },
    } as unknown as ExtensionAPI;

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
    if (!addHandler) {
      throw new Error("Expected /agents:add handler to be registered");
    }

    const inputs = [
      "",
      "planner",
      "   ",
      "read",
      "",
      "",
      "",
      "",
    ];

    await addHandler("", {
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
