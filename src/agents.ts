import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type {
  AgentDefinition,
  AgentDiscoveryDiagnostic,
  AgentDiscoveryResult,
  ResolvedPaths,
} from "./types.js";

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
          return { ok: false, reason: `${fieldName} must not contain empty strings` };
        }

        return { ok: true, value: normalized };
      } catch {
        return { ok: false, reason: `${fieldName} must be a comma-separated string or string array` };
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
      return { ok: false, reason: `${fieldName} must not contain empty strings` };
    }

    return { ok: true, value: normalized };
  }

  return { ok: false, reason: `${fieldName} must be a comma-separated string or string array` };
}

function parseFrontmatter(content: string):
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

export function parseAgentFile(
  filePath: string,
  content: string,
): { ok: true; agent: AgentDefinition } | { ok: false; diagnostic: AgentDiscoveryDiagnostic } {
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
  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
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

  const model =
    typeof frontmatter.model === "string" && frontmatter.model.trim()
      ? frontmatter.model.trim()
      : undefined;
  const thinking =
    typeof frontmatter.thinking === "string" && frontmatter.thinking.trim()
      ? frontmatter.thinking.trim()
      : undefined;

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
  const diagnostics = [...userResult.diagnostics, ...bundledResult.diagnostics];

  for (const agent of userResult.agents) {
    if (agentsByName.has(agent.name)) {
      diagnostics.push({
        path: agent.sourcePath,
        reason: `duplicate agent name "${agent.name}" skipped; first definition wins`,
      });
      continue;
    }

    agentsByName.set(agent.name, agent);
  }

  for (const agent of bundledResult.agents) {
    if (agentsByName.has(agent.name)) {
      diagnostics.push({
        path: agent.sourcePath,
        reason: `duplicate agent name "${agent.name}" skipped; user agent wins`,
      });
      continue;
    }

    agentsByName.set(agent.name, agent);
  }

  return {
    agents: [...agentsByName.values()],
    diagnostics,
  };
}
