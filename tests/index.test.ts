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
import type { LoadedConfig, ResolvedPaths } from "../src/types.js";

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
      description: "Show pi-subagents extension diagnostics",
    });
  });

  test("registers /agents and reports resolved paths", async () => {
    const paths = createPaths();
    const loadedConfig: LoadedConfig = {
      exists: false,
      config: {
        maxConcurrency: 4,
        maxRecursiveLevel: 2,
        defaultTimeoutMs: 600_000,
      },
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
        message: buildAgentsStatusMessage(paths, loadedConfig.config),
      },
    ]);
  });
});
