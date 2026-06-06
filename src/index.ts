import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { resolvePaths } from "./paths.js";
import type { RuntimeDeps, SubagentsConfig } from "./types.js";

export function createRuntimeDeps(): RuntimeDeps {
  return {
    resolvePaths,
    loadConfig,
  };
}

export function buildAgentsStatusMessage(
  paths: ReturnType<RuntimeDeps["resolvePaths"]>,
  config: SubagentsConfig,
): string {
  return [
    "pi-subagents: loaded",
    `config: ${paths.configPath}`,
    `user agents: ${paths.userAgentsDir}`,
    `bundled agents: ${paths.bundledAgentsDir}`,
    `transcript/cache: ${paths.transcriptCacheDir}`,
    `defaults: maxConcurrency=${config.maxConcurrency}, maxRecursiveLevel=${config.maxRecursiveLevel}, defaultTimeoutMs=${config.defaultTimeoutMs}`,
  ].join("\n");
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(),
): void {
  pi.registerCommand("agents", {
    description: "Show pi-subagents extension diagnostics",
    handler: async (_args, ctx) => {
      const paths = deps.resolvePaths();
      const { config } = deps.loadConfig(paths);
      ctx.ui.notify(buildAgentsStatusMessage(paths, config), "info");
    },
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
