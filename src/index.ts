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
import { ExecutionStateStore } from "./core/execution-state.js";
import { resolvePaths } from "./core/paths.js";
import {
  registerAgentCommand,
  registerSlashAgentBridge,
  registerSubagentTool,
} from "./core/subagent.js";
import type { RuntimeDeps } from "./shared/runtime-deps.js";
import { showAgentsMenu } from "./tui/agents-menu.js";
import { renderSubagentMessage } from "./tui/render.js";

export function createRuntimeDeps(pi: ExtensionAPI): RuntimeDeps {
  const stateStore = new ExecutionStateStore();
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
    stateStore,
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
      deps.stateStore,
    ),
  );
  registerSlashAgentBridge(pi, deps);
  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps, undefined, () => true);

  pi.registerCommand("agents", {
    description: "Open the interactive pi-subagents agents menu",
    handler: async (_args, ctx) => {
      await showAgentsMenu(ctx, deps);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    deps.stateStore.hydrateFromSession(ctx.sessionManager);
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
