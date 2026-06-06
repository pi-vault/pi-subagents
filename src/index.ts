import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents.js";
import { loadConfig } from "./config.js";
import { resolvePaths } from "./paths.js";
import type { AgentDiscoveryResult, RuntimeDeps, SubagentsConfig } from "./types.js";

export function createRuntimeDeps(): RuntimeDeps {
  return {
    resolvePaths,
    loadConfig,
    discoverAgents,
  };
}

function formatValue(value: string | number | undefined, emptyLabel = "-"): string {
  return value === undefined || value === "" ? emptyLabel : String(value);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

export function buildAgentsStatusMessage(
  paths: ReturnType<RuntimeDeps["resolvePaths"]>,
  config: SubagentsConfig,
  discovery: AgentDiscoveryResult,
): string {
  const lines = [
    "pi-subagents: discovered agents",
    `config: ${paths.configPath}`,
    `user agents: ${paths.userAgentsDir}`,
    `bundled agents: ${paths.bundledAgentsDir}`,
    `transcript/cache: ${paths.transcriptCacheDir}`,
    `defaults: maxConcurrency=${config.maxConcurrency}, maxRecursiveLevel=${config.maxRecursiveLevel}, defaultTimeoutMs=${config.defaultTimeoutMs}`,
    `agents: ${discovery.agents.length}`,
  ];

  for (const agent of discovery.agents) {
    lines.push(
      `- ${agent.name}`,
      `  description: ${agent.description}`,
      `  tools: ${formatList(agent.tools)}`,
      `  model: ${formatValue(agent.model)}`,
      `  thinking: ${formatValue(agent.thinking)}`,
      `  child allowlist: ${formatList(agent.subagentAgents)}`,
      `  source: ${agent.sourcePath}`,
    );
  }

  if (discovery.diagnostics.length > 0) {
    lines.push("skipped:");
    for (const diagnostic of discovery.diagnostics) {
      lines.push(`- ${diagnostic.path}: ${diagnostic.reason}`);
    }
  }

  return lines.join("\n");
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(),
): void {
  pi.registerCommand("agents", {
    description: "List discovered pi-subagents agents",
    handler: async (_args, ctx) => {
      const paths = deps.resolvePaths();
      const { config } = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);
      ctx.ui.notify(buildAgentsStatusMessage(paths, config, discovery), "info");
    },
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
