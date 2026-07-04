import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAgentFile,
  deleteUserAgentOverride,
  disableAgentInUserScope,
  discoverAgents,
  discoverToolNames,
  exportAgentToUserScope,
} from "./core/agents.js";
import { AgentManager } from "./core/agent-manager.js";
import { loadConfig, saveConfig } from "./core/config.js";
import { resolvePaths } from "./core/paths.js";
import {
  registerAgentCommand,
  registerSubagentTool,
} from "./core/subagent.js";
import type { RuntimeDeps } from "./shared/runtime-deps.js";
import { showAgentsMenu } from "./tui/agents-menu.js";
import { renderSubagentMessage } from "./tui/render.js";

export function createRuntimeDeps(pi: ExtensionAPI): RuntimeDeps {
  const manager = new AgentManager();
  return {
    resolvePaths,
    loadConfig,
    discoverAgents,
    discoverToolNames: () =>
      discoverToolNames(pi.getAllTools().map((tool) => tool.name)),
    createAgentFile,
    exportAgentToUserScope,
    disableAgentInUserScope,
    deleteUserAgentOverride,
    saveConfig,
    manager,
  };
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(pi),
): void {
  pi.registerMessageRenderer("pi-subagent-result", (msg, opts, theme) =>
    renderSubagentMessage(
      msg as Parameters<typeof renderSubagentMessage>[0],
      opts,
      theme,
    ),
  );
  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps);

  // Cleanup on session shutdown
  pi.on("session_shutdown", () => {
    deps.manager.dispose();
  });

  pi.registerCommand("agents", {
    description: "Open the interactive pi-subagents agents menu",
    handler: async (_args, ctx) => {
      await showAgentsMenu(ctx, deps);
    },
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
