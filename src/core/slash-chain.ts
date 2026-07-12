// Pure chain expression parser — no fs, no network, no external imports.

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentDefinition,
  ChainStep,
  SequentialStep,
  ParallelTaskItem,
} from "../shared/types.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import { discoverChains } from "./agents.js";
import { findAgentByName } from "./subagent.js";

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

// ---------------------------------------------------------------------------
// Step object mapping (ParsedStep → ChainStep fields)
// ---------------------------------------------------------------------------

type ChainStepObject = {
  agent: string;
  task?: string;
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
};

const mapParsedStepToObject = (
  step: ParsedStep,
  fallbackTask: string | undefined,
  isFirst: boolean,
  opts: { inGroup: boolean },
): ChainStepObject => {
  const { name, config, task: stepTask } = step;
  return {
    agent: name,
    ...(stepTask
      ? { task: stepTask }
      : isFirst && fallbackTask
        ? { task: fallbackTask }
        : {}),
    ...(config.output !== undefined ? { output: config.output } : {}),
    ...(config.outputMode !== undefined
      ? { outputMode: config.outputMode }
      : {}),
    ...(config.reads !== undefined ? { reads: config.reads } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.skills !== undefined ? { skills: config.skills } : {}),
    ...(config.progress !== undefined ? { progress: config.progress } : {}),
    ...(config.as ? { as: config.as } : {}),
    ...(config.label ? { label: config.label } : {}),
    ...(config.phase ? { phase: config.phase } : {}),
    ...(config.cwd ? { cwd: config.cwd } : {}),
    ...(opts.inGroup && config.count !== undefined
      ? { count: config.count }
      : {}),
  };
};

/**
 * Parse a chain expression string, validate agent names, and produce
 * `ChainStep[]` ready for `executeChain()`.
 *
 * Returns `null` and calls `notify` on failure. All errors are reported
 * to the user via `notify` rather than thrown.
 */
export function buildChainSteps(
  input: string,
  agents: Pick<AgentDefinition, "name">[],
  notify: (message: string) => void,
): { chain: ChainStep[]; task: string } | null {
  // If no group syntax, parse as simple linear chain
  if (!hasGroupSyntax(input)) {
    return buildLinearChainSteps(input, agents, notify);
  }

  // Parse full expression with groups
  let expression: { steps: ParsedGroupStep[] };
  try {
    expression = parseChainExpression(input);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    return null;
  }

  // Validate all agent names exist
  const stepAgentNames = expression.steps.flatMap((step) =>
    step.kind === "group" ? step.tasks.map((t) => t.name) : [step.name],
  );
  for (const name of stepAgentNames) {
    if (!agents.find((a) => a.name.toLowerCase() === name.toLowerCase())) {
      notify(`Unknown agent: ${name}`);
      return null;
    }
  }

  // Validate every parallel group task has its own task text
  for (const step of expression.steps) {
    if (step.kind === "group" && step.tasks.some((t) => !t.task)) {
      notify(
        'Each task in a parallel group needs a task: (agent "a" | agent "b")',
      );
      return null;
    }
  }

  // First step must have a task
  const firstStep = expression.steps[0]!;
  const firstHasTask =
    firstStep.kind === "group"
      ? firstStep.tasks.some((t) => Boolean(t.task))
      : Boolean(firstStep.task);
  if (!firstHasTask) {
    notify('First step must have a task: /chain agent "task" -> agent2');
    return null;
  }
  const sharedTask =
    firstStep.kind === "group"
      ? (firstStep.tasks.find((t) => t.task)?.task ?? "")
      : (firstStep.task ?? "");

  // Build ChainStep[]
  let chain: ChainStep[];
  try {
    chain = expression.steps.map((step): ChainStep => {
      if (step.kind === "group") {
        const parallel: ParallelTaskItem[] = step.tasks.map((t) =>
          mapParsedStepToObject(t, undefined, false, { inGroup: true }),
        ) as ParallelTaskItem[];
        return {
          parallel,
          ...(step.config.concurrency !== undefined
            ? { concurrency: step.config.concurrency }
            : {}),
          ...(step.config.failFast !== undefined
            ? { failFast: step.config.failFast }
            : {}),
          ...(step.config.worktree !== undefined
            ? { worktree: step.config.worktree }
            : {}),
        } as ChainStep;
      }
      return mapParsedStepToObject(step, sharedTask || undefined, false, {
        inGroup: false,
      }) as SequentialStep;
    });
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    return null;
  }

  return { chain, task: sharedTask };
}

/** Handle simple linear chains (no group syntax). */
function buildLinearChainSteps(
  input: string,
  agents: Pick<AgentDefinition, "name">[],
  notify: (message: string) => void,
): { chain: ChainStep[]; task: string } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    notify("Empty chain expression");
    return null;
  }

  let steps: ParsedStep[];
  if (trimmed.includes(" -> ")) {
    const segments = splitOnArrow(trimmed);
    steps = [];
    for (const seg of segments) {
      const t = seg.trim();
      if (!t) continue;
      steps.push(parseSingleTaskToken(t));
    }
  } else {
    steps = [parseSingleTaskToken(trimmed)];
  }

  if (steps.length === 0) {
    notify("No steps parsed from chain expression");
    return null;
  }

  // Extract shared task from first step that has one
  const sharedTask = steps.find((s) => s.task)?.task ?? "";
  if (!sharedTask) {
    notify('First step must include a task: /chain agent "task" -> agent2');
    return null;
  }

  // Validate agent names
  for (const step of steps) {
    if (!agents.find((a) => a.name.toLowerCase() === step.name.toLowerCase())) {
      notify(`Unknown agent: ${step.name}`);
      return null;
    }
  }

  // Build ChainStep[]
  const chain: ChainStep[] = steps.map((step, i) =>
    mapParsedStepToObject(step, sharedTask || undefined, i === 0, {
      inGroup: false,
    }) as SequentialStep,
  );

  return { chain, task: sharedTask };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/** Execute a chain and send the result. Shared by /chain and /run-chain. */
async function executeSlashChain(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  chain: ChainStep[],
  task: string,
): Promise<void> {
  const paths = deps.resolvePaths();
  const loadedConfig = deps.loadConfig(paths);
  const discovery = deps.discoverAgents(paths);

  try {
    const { executeChain } = await import("./chain-execution.js");
    const chainResult = await executeChain({
      steps: chain,
      task,
      spawnAndWait: async (agentDef, prompt, stepCwd) => {
        return deps.manager.spawnAndWait(ctx, agentDef, {
          prompt,
          cwd: stepCwd || ctx.cwd,
          maxTurns: loadedConfig.config.defaultMaxTurns,
        });
      },
      findAgent: (name) => {
        const agent = findAgentByName(discovery, name);
        if (!agent) throw new Error(`Unknown agent: "${name}"`);
        return agent;
      },
      cwd: ctx.cwd,
      runId: `chain-${Date.now().toString(36)}`,
    });
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: chainResult.content,
      display: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: message,
      display: true,
    });
  }
}

export function registerChainCommands(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  // /chain — inline chain expression
  pi.registerCommand("chain", {
    description:
      'Run agents in sequence: /chain scout "task" -> planner',
    getArgumentCompletions: (prefix) => {
      try {
        const paths = deps.resolvePaths();
        const agents = deps.discoverAgents(paths).agents;
        const lower = prefix.toLowerCase();
        const matches = agents.filter((a) =>
          a.name.toLowerCase().startsWith(lower),
        );
        return matches.length > 0
          ? matches.map((a) => ({ value: a.name, label: a.name }))
          : null;
      } catch {
        return null;
      }
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const { args: cleanedArgs } = extractExecutionFlags(args);
      const paths = deps.resolvePaths();
      const agents = deps.discoverAgents(paths).agents;

      const built = buildChainSteps(cleanedArgs, agents, (msg) =>
        ctx.ui.notify(msg, "error"),
      );
      if (!built) return;

      await executeSlashChain(pi, ctx, deps, built.chain, built.task);
    },
  });

  // /run-chain — execute a saved chain file
  pi.registerCommand("run-chain", {
    description:
      "Run a saved chain: /run-chain chainName -- task",
    getArgumentCompletions: (prefix) => {
      try {
        const paths = deps.resolvePaths();
        const chains = discoverChains(paths).chains;
        const lower = prefix.toLowerCase();
        const matches = chains.filter((c) =>
          c.name.toLowerCase().startsWith(lower),
        );
        return matches.length > 0
          ? matches.map((c) => ({ value: c.name, label: c.name }))
          : null;
      } catch {
        return null;
      }
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const { args: cleanedArgs } = extractExecutionFlags(args);
      const usage = "Usage: /run-chain <chainName> -- <task>";

      const delimiterIndex = cleanedArgs.indexOf(" -- ");
      if (delimiterIndex === -1) {
        ctx.ui.notify(usage, "error");
        return;
      }
      const chainName = cleanedArgs.slice(0, delimiterIndex).trim();
      const task = cleanedArgs.slice(delimiterIndex + 4).trim();
      if (!chainName || !task) {
        ctx.ui.notify(usage, "error");
        return;
      }

      const paths = deps.resolvePaths();
      const chainDiscovery = discoverChains(paths, ctx.cwd);
      const chain = chainDiscovery.chains.find((c) => c.name === chainName);
      if (!chain) {
        const available =
          chainDiscovery.chains.map((c) => c.name).join(", ") || "(none)";
        ctx.ui.notify(
          `Unknown chain: "${chainName}". Available: ${available}`,
          "error",
        );
        return;
      }

      // ChainStepConfig[] is structurally compatible with ChainStep[] at runtime
      await executeSlashChain(
        pi,
        ctx,
        deps,
        chain.steps as ChainStep[],
        task,
      );
    },
  });
}
