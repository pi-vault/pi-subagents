import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, parse, resolve } from "node:path";
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

function parseStringArray(
  value: unknown,
  fieldName: string,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: true, value: [] };
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!Array.isArray(parsed)) {
          return { ok: false, reason: `${fieldName} must be a string array` };
        }

        const normalized = parsed.map((entry) => {
          if (typeof entry !== "string") {
            throw new Error(fieldName);
          }
          return entry.trim();
        });

        if (normalized.some((entry) => !entry)) {
          return {
            ok: false,
            reason: `${fieldName} must not contain empty strings`,
          };
        }

        return { ok: true, value: normalized };
      } catch {
        return {
          ok: false,
          reason: `${fieldName} must be a comma-separated string or string array`,
        };
      }
    }

    return {
      ok: true,
      value: trimmed
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    };
  }

  if (Array.isArray(value)) {
    const normalized: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        return { ok: false, reason: `${fieldName} must be a string array` };
      }
      normalized.push(entry.trim());
    }

    if (normalized.some((entry) => !entry)) {
      return {
        ok: false,
        reason: `${fieldName} must not contain empty strings`,
      };
    }

    return { ok: true, value: normalized };
  }

  return {
    ok: false,
    reason: `${fieldName} must be a comma-separated string or string array`,
  };
}

function parseFrontmatter(
  content: string,
):
  | { ok: true; frontmatter: Record<string, unknown>; systemPrompt: string }
  | { ok: false; reason: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { ok: false, reason: "missing leading frontmatter delimiter" };
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return { ok: false, reason: "missing closing frontmatter delimiter" };
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  let systemPrompt = normalized.slice(closingIndex + 5);
  if (systemPrompt.startsWith("\n")) {
    systemPrompt = systemPrompt.slice(1);
  }

  const frontmatter: Record<string, unknown> = {};
  const lines = frontmatterBlock.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const match = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      return { ok: false, reason: `malformed frontmatter line: ${line}` };
    }

    const [, key, rawValue] = match;
    if (!rawValue) {
      const values: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        if (!nextLine.trim()) {
          cursor += 1;
          continue;
        }
        if (/^\w+\s*:/.test(nextLine)) {
          break;
        }
        const itemMatch = /^\s*-\s*(.+?)\s*$/.exec(nextLine);
        if (!itemMatch) {
          return {
            ok: false,
            reason: `malformed frontmatter list item: ${nextLine}`,
          };
        }
        values.push(itemMatch[1]);
        cursor += 1;
      }

      frontmatter[key] = values;
      index = cursor - 1;
      continue;
    }

    frontmatter[key] = rawValue;
  }

  return { ok: true, frontmatter, systemPrompt };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAgentModel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") {
    return undefined;
  }

  return trimmed;
}

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

export function parseAgentFile(
  filePath: string,
  content: string,
):
  | { ok: true; agent: AgentDefinition }
  | { ok: false; diagnostic: AgentDiscoveryDiagnostic } {
  const parsed = parseFrontmatter(content);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostic: {
        path: filePath,
        reason: parsed.reason,
      },
    };
  }

  const { frontmatter, systemPrompt } = parsed;
  const explicitName =
    typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const inferredName = parse(filePath).name.toLowerCase();
  const name = explicitName || inferredName;
  if (!name) {
    return {
      ok: false,
      diagnostic: {
        path: filePath,
        reason: "missing required non-empty name",
      },
    };
  }

  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : "";
  if (!description) {
    return {
      ok: false,
      diagnostic: {
        path: filePath,
        reason: "missing required non-empty description",
      },
    };
  }

  const tools = parseStringArray(frontmatter.tools, "tools");
  if (!tools.ok) {
    return {
      ok: false,
      diagnostic: {
        path: filePath,
        reason: tools.reason,
      },
    };
  }

  const subagentAgents = parseStringArray(
    frontmatter.subagent_agents,
    "subagent_agents",
  );
  if (!subagentAgents.ok) {
    return {
      ok: false,
      diagnostic: {
        path: filePath,
        reason: subagentAgents.reason,
      },
    };
  }

  let timeoutMs: number | undefined;
  if (frontmatter.timeout_ms !== undefined) {
    const parsedTimeout = Number(frontmatter.timeout_ms);
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
      return {
        ok: false,
        diagnostic: {
          path: filePath,
          reason: "timeout_ms must be a positive finite number",
        },
      };
    }
    timeoutMs = parsedTimeout;
  }

  const model = normalizeAgentModel(frontmatter.model);
  const thinking =
    typeof frontmatter.thinking === "string" && frontmatter.thinking.trim()
      ? frontmatter.thinking.trim()
      : undefined;
  const disabled =
    typeof frontmatter.disabled === "string"
      ? frontmatter.disabled.trim().toLowerCase() === "true"
      : false;

  return {
    ok: true,
    agent: {
      name,
      description,
      tools: tools.value,
      model,
      thinking,
      subagentAgents: subagentAgents.value,
      timeoutMs,
      disabled,
      systemPrompt,
      sourcePath: filePath,
    },
  };
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

    if (agent.disabled) {
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

function serializeStringList(fieldName: string, values: string[]): string {
  return values.length > 0
    ? `${fieldName}: ${values.join(", ")}`
    : `${fieldName}:`;
}

export function createAgentMarkdown(input: AgentCreationInput): string {
  const name = normalizeOptionalString(input.name);
  const description = input.description.trim();
  const tools = uniqueStrings(
    input.tools.map((value) => value.trim()).filter(Boolean),
  );
  const model = normalizeOptionalString(input.model);
  const thinking = normalizeOptionalString(input.thinking);
  const subagentAgents = uniqueStrings(
    input.subagentAgents.map((value) => value.trim()).filter(Boolean),
  );
  const systemPrompt = input.systemPrompt.replace(/\r\n/g, "\n").trim();

  const frontmatter = ["---"];
  if (name) {
    frontmatter.push(`name: ${name}`);
  }
  frontmatter.push(`description: ${description}`);
  frontmatter.push(serializeStringList("tools", tools));
  if (model && model.toLowerCase() !== "default") {
    frontmatter.push(`model: ${model}`);
  }
  if (thinking) {
    frontmatter.push(`thinking: ${thinking}`);
  }
  if (subagentAgents.length > 0) {
    frontmatter.push(`subagent_agents: ${subagentAgents.join(", ")}`);
  }
  if (input.timeoutMs !== undefined) {
    frontmatter.push(`timeout_ms: ${input.timeoutMs}`);
  }
  frontmatter.push("---", systemPrompt);

  return `${frontmatter.join("\n")}\n`;
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
  const markdown = createAgentMarkdown({
    name: agent.name,
    description: agent.description,
    tools: agent.tools,
    model: agent.model,
    thinking: agent.thinking,
    subagentAgents: agent.subagentAgents,
    timeoutMs: agent.timeoutMs,
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
    "disabled: true",
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
  const markdown = createAgentMarkdown({
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
