// Pure chain expression parser — no fs, no network, no external imports.

export class SlashParseError extends Error {}

export interface InlineConfig {
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  as?: string;
  label?: string;
  phase?: string;
  cwd?: string;
  count?: number;
  outputSchema?: string;
  acceptance?: string;
}

export interface GroupConfig {
  concurrency?: number;
  failFast?: boolean;
  worktree?: boolean;
}

export interface ParsedStep {
  kind: "step";
  name: string;
  config: InlineConfig;
  task?: string;
}

export interface ParsedGroup {
  kind: "group";
  tasks: ParsedStep[];
  config: GroupConfig;
}

export type ParsedGroupStep = ParsedStep | ParsedGroup;

// ---------------------------------------------------------------------------
// Flag extraction
// ---------------------------------------------------------------------------

export function extractExecutionFlags(rawArgs: string): {
  args: string;
  bg: boolean;
  fork: boolean;
} {
  let args = rawArgs.trim();
  let bg = false;
  let fork = false;

  while (true) {
    if (args.endsWith(" --bg") || args === "--bg") {
      bg = true;
      args = args === "--bg" ? "" : args.slice(0, -5).trim();
      continue;
    }
    if (args.endsWith(" --fork") || args === "--fork") {
      fork = true;
      args = args === "--fork" ? "" : args.slice(0, -7).trim();
      continue;
    }
    break;
  }

  return { args, bg, fork };
}

// ---------------------------------------------------------------------------
// Inline config parser
// ---------------------------------------------------------------------------

const parseInlineConfig = (raw: string): InlineConfig => {
  const config: InlineConfig = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      if (trimmed === "progress") config.progress = true;
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    switch (key) {
      case "output":
        config.output = val === "false" ? false : val;
        break;
      case "outputMode":
        if (val === "inline" || val === "file-only") config.outputMode = val;
        break;
      case "reads":
        config.reads = val === "false" ? false : val.split("+").filter(Boolean);
        break;
      case "model":
        config.model = val || undefined;
        break;
      case "skill":
      case "skills":
        config.skills = val === "false" ? false : val.split("+").filter(Boolean);
        break;
      case "progress":
        config.progress = val !== "false";
        break;
      case "as":
        config.as = val || undefined;
        break;
      case "label":
        config.label = val || undefined;
        break;
      case "phase":
        config.phase = val || undefined;
        break;
      case "cwd":
        config.cwd = val || undefined;
        break;
      case "count": {
        const n = Number(val);
        if (Number.isInteger(n) && n > 0) config.count = n;
        break;
      }
      case "outputSchema":
        config.outputSchema = val || undefined;
        break;
      case "acceptance":
        config.acceptance = val || undefined;
        break;
    }
  }
  return config;
};

const parseAgentToken = (token: string): { name: string; config: InlineConfig } => {
  const bracket = token.indexOf("[");
  if (bracket === -1) return { name: token, config: {} };
  const end = token.lastIndexOf("]");
  return {
    name: token.slice(0, bracket),
    config: parseInlineConfig(token.slice(bracket + 1, end !== -1 ? end : undefined)),
  };
};

// ---------------------------------------------------------------------------
// Group config parser
// ---------------------------------------------------------------------------

const parseGroupConfig = (raw: string): GroupConfig => {
  const config: GroupConfig = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? trimmed : trimmed.slice(0, eq).trim();
    const val = eq === -1 ? "" : trimmed.slice(eq + 1).trim();
    switch (key) {
      case "concurrency": {
        const n = Number(val);
        if (Number.isInteger(n) && n > 0) config.concurrency = n;
        break;
      }
      case "failFast":
        config.failFast = eq === -1 ? true : val !== "false";
        break;
      case "worktree":
        config.worktree = eq === -1 ? true : val !== "false";
        break;
    }
  }
  return config;
};

// ---------------------------------------------------------------------------
// Paren/quote-aware helpers
// ---------------------------------------------------------------------------

// Walk `input` tracking quote/paren state; returns true if parens are unbalanced.
function findUnmatchedCloseParen(input: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

// Split on top-level " -> ", ignoring arrows inside quotes or parentheses.
function splitOnArrow(input: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && ch === "-" && input[i + 1] === ">" && input[i + 2] === " ") {
      segments.push(input.slice(start, i));
      i += 2;
      start = i + 1;
    }
  }
  segments.push(input.slice(start));
  return segments;
}

// Split a group's inner text on top-level " | ", ignoring pipes inside quotes/parens.
function splitGroupTasks(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "|" && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

// Split `(...)` from an optional trailing `[...]` group-config suffix, respecting
// quotes and nested parens. Returns the inner group text and the parsed config.
const splitGroupBody = (trimmed: string): { inner: string; config: GroupConfig } => {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let closeIdx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1)
    throw new SlashParseError(`Unmatched parentheses in group: '${trimmed}'`);
  const inner = trimmed.slice(1, closeIdx);
  const suffix = trimmed.slice(closeIdx + 1).trim();
  if (!suffix) return { inner, config: {} };
  if (!suffix.startsWith("[") || !suffix.endsWith("]")) {
    throw new SlashParseError(`Group options must be wrapped in [...]: '${suffix}'`);
  }
  return { inner, config: parseGroupConfig(suffix.slice(1, -1)) };
};

// ---------------------------------------------------------------------------
// Public parsing API
// ---------------------------------------------------------------------------

export function parseSingleTaskToken(token: string): ParsedStep {
  let agentPart: string;
  let task: string | undefined;
  const qMatch = token.match(/^(\S+(?:\[[^\]]*\])?)\s+(?:"([^"]*)"|'([^']*)')$/);
  if (qMatch) {
    agentPart = qMatch[1]!;
    task = (qMatch[2] ?? qMatch[3]) || undefined;
  } else {
    const dashIdx = token.indexOf(" -- ");
    if (dashIdx !== -1) {
      agentPart = token.slice(0, dashIdx).trim();
      task = token.slice(dashIdx + 4).trim() || undefined;
    } else {
      agentPart = token;
    }
  }
  return { kind: "step", ...parseAgentToken(agentPart), task };
}

export function parseGroupSegment(segment: string): ParsedGroup {
  const trimmed = segment.trim();
  if (!trimmed.startsWith("(")) {
    throw new SlashParseError(
      `Parallel group must be wrapped in parentheses: '${trimmed}'`,
    );
  }
  const { inner, config } = splitGroupBody(trimmed);
  const rawParts = splitGroupTasks(inner)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (rawParts.length < 2) {
    throw new SlashParseError(
      "Parallel group must contain at least two tasks separated by ' | '",
    );
  }
  return { kind: "group", tasks: rawParts.map((part) => parseSingleTaskToken(part)), config };
}

// True if `input` uses inline parallel-group syntax. A group is a *step* that begins
// with `(` at the top level, so we split on top-level ` -> ` arrows and look for a
// segment that opens with `(`. Parentheses appearing inside a task (e.g.
// `scout -- inspect auth (backend)`) do not count.
export function hasGroupSyntax(input: string): boolean {
  return splitOnArrow(input).some((seg) => seg.trim().startsWith("("));
}

export function parseChainExpression(input: string): { steps: ParsedGroupStep[] } {
  const trimmed = input.trim();
  if (!trimmed.includes(" -> ")) {
    throw new SlashParseError('Parallel groups in /chain require " -> " between steps');
  }
  if (findUnmatchedCloseParen(trimmed)) {
    throw new SlashParseError("Unmatched parentheses in /chain expression");
  }
  const steps: ParsedGroupStep[] = [];
  for (const seg of splitOnArrow(trimmed)) {
    const t = seg.trim();
    if (!t) continue;
    if (t.startsWith("(")) {
      steps.push(parseGroupSegment(t));
      continue;
    }
    if (findUnmatchedCloseParen(t)) {
      throw new SlashParseError(`Unmatched parentheses in chain segment: '${t}'`);
    }
    steps.push(parseSingleTaskToken(t));
  }
  if (steps.length === 0) {
    throw new SlashParseError("/chain expression must include at least one step");
  }
  return { steps };
}
