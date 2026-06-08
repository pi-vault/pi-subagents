import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAgentFile,
  deleteUserAgentOverride,
  disableAgentInUserScope,
  discoverAgents,
  discoverToolNames,
  exportAgentToUserScope,
} from "./core/agents.js";
import { loadConfig, saveConfig } from "./core/config.js";
import { resolvePaths } from "./core/paths.js";
import {
  registerAgentCommand,
  registerSlashAgentBridge,
  registerSubagentTool,
} from "./core/subagent.js";
import type { RuntimeDeps } from "./shared/types.js";
import { showAgentsMenu } from "./tui/agents-menu.js";
import { renderSubagentMessage } from "./tui/render.js";

export function createRuntimeDeps(pi: ExtensionAPI): RuntimeDeps {
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
  };
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(pi),
): void {
  pi.registerMessageRenderer("pi-subagent-result", renderSubagentMessage);
  registerSlashAgentBridge(pi, deps);
  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps, undefined, () => true);

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
