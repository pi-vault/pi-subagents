import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentFile,
  discoverAgents,
  discoverToolNames,
} from "./agents.js";
import { loadConfig } from "./config.js";
import { resolvePaths } from "./paths.js";
import type {
  AgentCreationInput,
  AgentDiscoveryResult,
  RuntimeDeps,
  SubagentsConfig,
} from "./types.js";

export function createRuntimeDeps(pi: ExtensionAPI): RuntimeDeps {
  return {
    resolvePaths,
    loadConfig,
    discoverAgents,
    discoverToolNames: () =>
      discoverToolNames(pi.getAllTools().map((tool) => tool.name)),
    createAgentFile,
  };
}

function formatValue(
  value: string | number | undefined,
  emptyLabel = "-",
): string {
  return value === undefined || value === "" ? emptyLabel : String(value);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function parseCommaSeparatedList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

async function promptForValue(
  ctx: ExtensionCommandContext,
  title: string,
  placeholder?: string,
): Promise<string | undefined> {
  return ctx.ui.input(title, placeholder);
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

export async function runAddAgentCommand(
  deps: RuntimeDeps,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const paths = deps.resolvePaths();
  const { config } = deps.loadConfig(paths);
  const discovery = deps.discoverAgents(paths);
  const toolNames = deps.discoverToolNames();

  const name = await promptForValue(ctx, "Agent name (optional)", "planner");
  if (name === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  let filenameSlug: string | undefined;
  if (!name.trim()) {
    filenameSlug = await promptForValue(ctx, "Filename slug", "planner");
    if (filenameSlug === undefined) {
      ctx.ui.notify("Agent creation cancelled", "info");
      return;
    }
  }

  const description = await promptForValue(
    ctx,
    "Description",
    "Brief agent description",
  );
  if (description === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const tools = await promptForValue(
    ctx,
    `Tools (comma-separated) [${toolNames.join(", ")}]`,
    "read, bash",
  );
  if (tools === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const model = await promptForValue(ctx, "Model (optional)", "provider/model");
  if (model === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const thinking = await promptForValue(
    ctx,
    "Thinking (optional)",
    "low | medium | high",
  );
  if (thinking === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const subagentAgents = await promptForValue(
    ctx,
    `Child allowlist (optional) [${
      discovery.agents.map((agent) => agent.name).join(", ") || "none"
    }]`,
    "worker, researcher",
  );
  if (subagentAgents === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const timeoutInput = await promptForValue(
    ctx,
    "Timeout ms (optional)",
    "180000",
  );
  if (timeoutInput === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const systemPrompt = await ctx.ui.editor("Agent markdown body", "");
  if (systemPrompt === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const input: AgentCreationInput = {
    name,
    filenameSlug,
    description,
    tools: parseCommaSeparatedList(tools),
    model,
    thinking,
    subagentAgents: parseCommaSeparatedList(subagentAgents),
    timeoutMs: timeoutInput.trim() ? Number(timeoutInput) : undefined,
    systemPrompt,
  };

  try {
    const agent = deps.createAgentFile(paths, input, discovery, toolNames);
    const updatedDiscovery = deps.discoverAgents(paths);
    ctx.ui.notify(
      [
        `Created agent "${agent.name}" at ${agent.sourcePath}`,
        "",
        buildAgentsStatusMessage(paths, config, updatedDiscovery),
      ].join("\n"),
      "info",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not create agent: ${message}`, "error");
  }
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(pi),
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

  pi.registerCommand("agents:add", {
    description: "Create a new pi-subagents agent markdown file",
    handler: async (_args, ctx) => runAddAgentCommand(deps, ctx),
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
