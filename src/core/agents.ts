import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  normalizeOptionalString,
  parseAgentContent,
  serializeAgent,
  uniqueStrings,
} from "./agent-format.js";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryDiagnostic,
  AgentDiscoveryResult,
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

/** @deprecated Use parseAgentContent from agent-format.ts directly */
export const parseAgentFile = parseAgentContent;

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
    const filePath = resolve(directory, fileName);
    const parsed = parseAgentFile(filePath, readFileSync(filePath, "utf8"));
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

/** @deprecated Use serializeAgent from agent-format.ts directly */
export const createAgentMarkdown = serializeAgent;

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
    timeoutMs: agent.timeoutMs,
    skills: agent.skills,
    systemPrompt: agent.systemPrompt,
  });
  writeFileSync(filePath, markdown, "utf8");

  const parsed = parseAgentFile(filePath, markdown);
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

  const parsed = parseAgentFile(filePath, markdown);
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

  if (input.timeoutMs !== undefined) {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new Error("timeout_ms must be a positive finite number");
    }
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
    timeoutMs: input.timeoutMs,
    systemPrompt,
  });
  writeFileSync(filePath, markdown, { encoding: "utf8", flag: "wx" });

  const parsed = parseAgentFile(filePath, markdown);
  if (!parsed.ok) {
    throw new Error(
      `created invalid agent file: ${basename(filePath)}: ${parsed.diagnostic.reason}`,
    );
  }

  return parsed.agent;
}
