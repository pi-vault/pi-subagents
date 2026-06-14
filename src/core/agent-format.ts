import { parse } from "node:path";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryDiagnostic,
} from "../shared/types.js";

type ParseResult =
  | { ok: true; agent: AgentDefinition }
  | { ok: false; diagnostic: AgentDiscoveryDiagnostic };

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

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function normalizeOptionalString(
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

function serializeStringList(fieldName: string, values: string[]): string {
  return values.length > 0
    ? `${fieldName}: ${values.join(", ")}`
    : `${fieldName}:`;
}

export function parseAgentContent(
  filePath: string,
  content: string,
): ParseResult {
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
  let enabled: boolean | undefined;
  if (frontmatter.enabled !== undefined) {
    const raw =
      typeof frontmatter.enabled === "string"
        ? frontmatter.enabled.trim().toLowerCase()
        : "";
    enabled = raw !== "false";
  } else if (frontmatter.disabled !== undefined) {
    // Backward compat: support legacy `disabled: true` in user files
    const raw =
      typeof frontmatter.disabled === "string"
        ? frontmatter.disabled.trim().toLowerCase()
        : "";
    enabled = raw !== "true";
  }

  let skills: string[] | boolean | undefined;
  if (frontmatter.skills !== undefined) {
    if (typeof frontmatter.skills === "string") {
      const raw = frontmatter.skills.trim().toLowerCase();
      if (raw === "none" || raw === "false") {
        skills = false;
      } else if (raw === "true" || raw === "all") {
        skills = true;
      } else if (raw === "") {
        skills = undefined;
      } else {
        // Comma-separated list (use original case, not lowered)
        const parsed = parseStringArray(frontmatter.skills, "skills");
        if (!parsed.ok) {
          return {
            ok: false,
            diagnostic: { path: filePath, reason: parsed.reason },
          };
        }
        skills = parsed.value.length > 0 ? parsed.value : undefined;
      }
    } else if (Array.isArray(frontmatter.skills)) {
      const parsed = parseStringArray(frontmatter.skills, "skills");
      if (!parsed.ok) {
        return {
          ok: false,
          diagnostic: { path: filePath, reason: parsed.reason },
        };
      }
      skills = parsed.value.length > 0 ? parsed.value : undefined;
    }
  }

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
      enabled,
      skills,
      systemPrompt,
      sourcePath: filePath,
    },
  };
}

export function serializeAgent(input: AgentCreationInput): string {
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
  if (input.skills === false) {
    frontmatter.push("skills: none");
  } else if (input.skills === true) {
    frontmatter.push("skills: all");
  } else if (Array.isArray(input.skills) && input.skills.length > 0) {
    frontmatter.push(`skills: ${uniqueStrings(input.skills).join(", ")}`);
  }
  frontmatter.push("---", systemPrompt);

  return `${frontmatter.join("\n")}\n`;
}
