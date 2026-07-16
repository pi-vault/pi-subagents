import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isUnsafeName, safeReadFile } from "./safe-fs.js";
import {
  normalizeOptionalString,
  parseAgentContent,
  serializeAgent,
  uniqueStrings,
} from "./agent-format.js";
import { parseChain, parseJsonChain } from "./chain-serializer.js";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryDiagnostic,
  AgentDiscoveryResult,
  ChainConfig,
  ChainDiscoveryDiagnostic,
  ChainDiscoveryResult,
  ResolvedPaths,
} from "../shared/types.js";

export const BUILT_IN_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
] as const;

function normalizeNameForComparison(value: string): string {
  return value.trim().toLowerCase();
}

function ensureUserAgentsDir(paths: ResolvedPaths): void {
  mkdirSync(paths.userAgentsDir, { recursive: true });
}

function fileSlugForAgent(agent: AgentDefinition): string {
  return agent.name.trim().toLowerCase();
}

function findAgentDefinition(
  discovery: AgentDiscoveryResult,
  agentName: string,
): AgentDefinition | undefined {
  const normalized = normalizeNameForComparison(agentName);
  return discovery.agents.find(
    (agent) => normalizeNameForComparison(agent.name) === normalized,
  );
}

export function discoverToolNames(
  runtimeToolNames: readonly string[] = [],
): string[] {
  return [...new Set([...BUILT_IN_TOOL_NAMES, ...runtimeToolNames])].sort(
    (left, right) => left.localeCompare(right),
  );
}

function discoverAgentsFromDirectory(directory: string): AgentDiscoveryResult {
  if (!existsSync(directory)) {
    return { agents: [], diagnostics: [] };
  }

  const agents: AgentDefinition[] = [];
  const diagnostics: AgentDiscoveryDiagnostic[] = [];
  const fileNames = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of fileNames) {
    const baseName = fileName.slice(0, -3);
    if (isUnsafeName(baseName)) {
      diagnostics.push({
        path: resolve(directory, fileName),
        reason: "unsafe filename",
      });
      continue;
    }
    const filePath = resolve(directory, fileName);
    const content = safeReadFile(filePath);
    if (content === undefined) {
      diagnostics.push({ path: filePath, reason: "unreadable or symlink" });
      continue;
    }
    const parsed = parseAgentContent(filePath, content);
    if (parsed.ok) {
      agents.push(parsed.agent);
    } else {
      diagnostics.push(parsed.diagnostic);
    }
  }

  return { agents, diagnostics };
}

export function discoverAgents(paths: ResolvedPaths): AgentDiscoveryResult {
  const userResult = discoverAgentsFromDirectory(paths.userAgentsDir);
  const bundledResult = discoverAgentsFromDirectory(paths.bundledAgentsDir);
  const agentsByName = new Map<string, AgentDefinition>();
  const blockedNames = new Set<string>();
  const diagnostics = [...userResult.diagnostics, ...bundledResult.diagnostics];

  for (const agent of userResult.agents) {
    const comparisonName = normalizeNameForComparison(agent.name);
    if (agentsByName.has(comparisonName) || blockedNames.has(comparisonName)) {
      diagnostics.push({
        path: agent.sourcePath,
        reason: `duplicate agent name "${agent.name}" skipped; first definition wins`,
      });
      continue;
    }

    if (agent.enabled === false) {
      blockedNames.add(comparisonName);
      continue;
    }

    agentsByName.set(comparisonName, agent);
  }

  for (const agent of bundledResult.agents) {
    const comparisonName = normalizeNameForComparison(agent.name);
    if (agentsByName.has(comparisonName) || blockedNames.has(comparisonName)) {
      diagnostics.push({
        path: agent.sourcePath,
        reason: `duplicate agent name "${agent.name}" skipped; user agent wins`,
      });
      continue;
    }

    agentsByName.set(comparisonName, agent);
  }

  return {
    agents: [...agentsByName.values()],
    diagnostics,
  };
}

export interface AgentCatalogEntry {
  name: string;
  state: "bundled" | "override" | "disabled";
  bundled?: AgentDefinition;
  override?: AgentDefinition;
}

export interface AgentCatalog {
  entries: AgentCatalogEntry[];
  userDiagnostics: AgentDiscoveryDiagnostic[];
  bundledDiagnostics: AgentDiscoveryDiagnostic[];
}

function indexCatalogAgents(
  discovery: AgentDiscoveryResult,
): Map<string, AgentDefinition> {
  const indexed = new Map<string, AgentDefinition>();
  for (const agent of discovery.agents) {
    const name = normalizeNameForComparison(agent.name);
    if (indexed.has(name)) {
      discovery.diagnostics.push({
        path: agent.sourcePath,
        reason: `duplicate agent name "${agent.name}" skipped; first definition wins`,
      });
      continue;
    }
    indexed.set(name, agent);
  }
  return indexed;
}

export function discoverAgentCatalog(paths: ResolvedPaths): AgentCatalog {
  const user = discoverAgentsFromDirectory(paths.userAgentsDir);
  const bundled = discoverAgentsFromDirectory(paths.bundledAgentsDir);
  const userByName = indexCatalogAgents(user);
  const bundledByName = indexCatalogAgents(bundled);
  const names = [...new Set([...userByName.keys(), ...bundledByName.keys()])]
    .sort((left, right) => left.localeCompare(right));

  const entries = names.map((name): AgentCatalogEntry => {
    const override = userByName.get(name);
    const bundledAgent = bundledByName.get(name);
    if (override?.enabled === false) {
      return {
        name: override.name,
        state: "disabled",
        bundled: bundledAgent,
        override,
      };
    }
    if (override) {
      return {
        name: override.name,
        state: "override",
        bundled: bundledAgent,
        override,
      };
    }
    return {
      name: bundledAgent?.name ?? name,
      state: "bundled",
      bundled: bundledAgent,
    };
  });

  return {
    entries,
    userDiagnostics: user.diagnostics,
    bundledDiagnostics: bundled.diagnostics,
  };
}

function requireUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
): { filePath: string; markdown: string } {
  const filePath = resolve(sourcePath);
  const fileName = basename(filePath);
  if (
    dirname(filePath) !== resolve(paths.userAgentsDir) ||
    !fileName.endsWith(".md") ||
    isUnsafeName(fileName.slice(0, -3))
  ) {
    throw new Error("invalid user agent override path");
  }

  const markdown = safeReadFile(filePath);
  if (markdown === undefined) {
    throw new Error("user agent override is missing, unreadable, or symlinked");
  }
  return { filePath, markdown };
}

export function readUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
): string {
  return requireUserAgentOverride(paths, sourcePath).markdown;
}

export function updateUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
  markdown: string,
): AgentDefinition {
  const { filePath } = requireUserAgentOverride(paths, sourcePath);
  const parsed = parseAgentContent(filePath, markdown);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostic.reason);
  }
  writeFileSync(filePath, markdown, "utf8");
  return parsed.agent;
}

export function exportAgentToUserScope(
  paths: ResolvedPaths,
  discovery: AgentDiscoveryResult,
  agentName: string,
): AgentDefinition {
  const agent = findAgentDefinition(discovery, agentName);
  if (!agent) {
    throw new Error(`unknown agent: ${agentName}`);
  }

  ensureUserAgentsDir(paths);
  const filePath = join(paths.userAgentsDir, `${fileSlugForAgent(agent)}.md`);
  const markdown = serializeAgent({
    name: agent.name,
    description: agent.description,
    tools: agent.tools,
    model: agent.model,
    thinking: agent.thinking,
    subagentAgents: agent.subagentAgents,
    skills: agent.skills,
    systemPrompt: agent.systemPrompt,
  });
  writeFileSync(filePath, markdown, "utf8");

  const parsed = parseAgentContent(filePath, markdown);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostic.reason);
  }
  return parsed.agent;
}

export function disableAgentInUserScope(
  paths: ResolvedPaths,
  discovery: AgentDiscoveryResult,
  agentName: string,
): AgentDefinition {
  const agent = findAgentDefinition(discovery, agentName);
  if (!agent) {
    throw new Error(`unknown agent: ${agentName}`);
  }

  ensureUserAgentsDir(paths);
  const filePath = join(paths.userAgentsDir, `${fileSlugForAgent(agent)}.md`);
  const markdown = [
    "---",
    `name: ${agent.name}`,
    `description: ${agent.description}`,
    "tools:",
    "enabled: false",
    "---",
    agent.systemPrompt.trim(),
    "",
  ].join("\n");
  writeFileSync(filePath, markdown, "utf8");

  const parsed = parseAgentContent(filePath, markdown);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostic.reason);
  }
  return parsed.agent;
}

export function deleteUserAgentOverride(
  paths: ResolvedPaths,
  agentName: string,
): void {
  const filePath = join(paths.userAgentsDir, `${agentName.trim().toLowerCase()}.md`);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

export function createAgentFile(
  paths: ResolvedPaths,
  input: AgentCreationInput,
  discovery: AgentDiscoveryResult,
  toolNames: string[],
): AgentDefinition {
  const name = normalizeOptionalString(input.name);
  if (input.name !== undefined && !name) {
    throw new Error("name must match ^[A-Za-z0-9_-]+$");
  }
  if (name && !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("name must match ^[A-Za-z0-9_-]+$");
  }

  const filenameSlug = name
    ? name.toLowerCase()
    : normalizeOptionalString(input.filenameSlug);
  if (!filenameSlug || !/^[a-z0-9_-]+$/.test(filenameSlug)) {
    throw new Error("filename slug must match ^[a-z0-9_-]+$");
  }

  const description = input.description.trim();
  if (!description) {
    throw new Error("description must be non-empty");
  }

  const systemPrompt = input.systemPrompt.replace(/\r\n/g, "\n").trim();
  if (!systemPrompt) {
    throw new Error("markdown body must be non-empty");
  }

  const knownToolNames = new Set(toolNames);
  const tools = uniqueStrings(
    input.tools.map((value) => value.trim()).filter(Boolean),
  );
  const unknownTools = tools.filter(
    (toolName) => !knownToolNames.has(toolName),
  );
  if (unknownTools.length > 0) {
    throw new Error(`unknown tools: ${unknownTools.join(", ")}`);
  }

  const knownAgentNames = new Set(discovery.agents.map((agent) => agent.name));
  const subagentAgents = uniqueStrings(
    input.subagentAgents.map((value) => value.trim()).filter(Boolean),
  );
  const unknownAgents = subagentAgents.filter(
    (agentName) => !knownAgentNames.has(agentName),
  );
  if (unknownAgents.length > 0) {
    throw new Error(`unknown subagent_agents: ${unknownAgents.join(", ")}`);
  }

  const targetName = name ?? filenameSlug;
  const targetNameKey = normalizeNameForComparison(targetName);
  const existingNameKeys = new Set(
    discovery.agents.map((agent) => normalizeNameForComparison(agent.name)),
  );
  if (existingNameKeys.has(targetNameKey)) {
    throw new Error(`duplicate agent name: ${targetName}`);
  }

  ensureUserAgentsDir(paths);
  const filePath = join(paths.userAgentsDir, `${filenameSlug}.md`);
  const markdown = serializeAgent({
    name,
    description,
    tools,
    model: normalizeOptionalString(input.model),
    thinking: normalizeOptionalString(input.thinking),
    subagentAgents,
    skills: input.skills,
    systemPrompt,
  });
  writeFileSync(filePath, markdown, { encoding: "utf8", flag: "wx" });

  const parsed = parseAgentContent(filePath, markdown);
  if (!parsed.ok) {
    throw new Error(
      `created invalid agent file: ${basename(filePath)}: ${parsed.diagnostic.reason}`,
    );
  }

  return parsed.agent;
}

// ---------------------------------------------------------------------------
// Chain discovery
// ---------------------------------------------------------------------------

function discoverChainsFromDirectory(
  directory: string,
): ChainDiscoveryResult {
  if (!existsSync(directory)) return { chains: [], diagnostics: [] };

  const diagnostics: ChainDiscoveryDiagnostic[] = [];
  const fileNames = readdirSync(directory)
    .filter((f) => f.endsWith(".chain.md") || f.endsWith(".chain.json"))
    .sort();

  // Parse all files, dedup by name within directory.
  // .chain.json wins over .chain.md for the same chain name (spec §4).
  const byName = new Map<string, ChainConfig>();
  for (const fileName of fileNames) {
    const filePath = resolve(directory, fileName);
    const content = safeReadFile(filePath);
    if (content === undefined) {
      diagnostics.push({ filePath, error: "unreadable or symlink" });
      continue;
    }
    try {
      const config = fileName.endsWith(".chain.json")
        ? parseJsonChain(filePath, content)
        : parseChain(filePath, content);
      const key = config.name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        if (
          existing.filePath.endsWith(".chain.json") &&
          filePath.endsWith(".chain.md")
        ) {
          // JSON already registered — skip the .md variant silently
          continue;
        }
        // Same-format or .md being replaced by .json — emit diagnostic for the overwritten entry
        diagnostics.push({
          filePath: existing.filePath,
          error: `duplicate chain name "${config.name}" in same directory; "${fileName}" wins`,
        });
      }
      byName.set(key, config);
    } catch (e) {
      diagnostics.push({
        filePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { chains: [...byName.values()], diagnostics };
}

export function discoverChains(
  paths: ResolvedPaths,
  cwd?: string,
): ChainDiscoveryResult {
  // Priority: project > user > bundled (higher priority = inserted first, wins on conflict)
  const projectChainsDir = cwd ? join(cwd, ".pi", "chains") : undefined;
  const projectResult = projectChainsDir
    ? discoverChainsFromDirectory(projectChainsDir)
    : { chains: [], diagnostics: [] };
  const userResult = discoverChainsFromDirectory(paths.userChainsDir);
  const bundledResult = discoverChainsFromDirectory(paths.bundledChainsDir);
  const chainsByName = new Map<string, ChainConfig>();
  const diagnostics = [
    ...projectResult.diagnostics,
    ...userResult.diagnostics,
    ...bundledResult.diagnostics,
  ];

  for (const chain of [
    ...projectResult.chains,
    ...userResult.chains,
    ...bundledResult.chains,
  ]) {
    const key = chain.name.toLowerCase();
    if (chainsByName.has(key)) {
      diagnostics.push({
        filePath: chain.filePath,
        error: `duplicate chain name "${chain.name}" skipped; higher-priority scope wins`,
      });
      continue;
    }
    chainsByName.set(key, chain);
  }

  return {
    chains: [...chainsByName.values()],
    diagnostics,
  };
}
