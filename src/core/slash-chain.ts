import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type { AgentDefinition, ChainStep, SequentialStep } from "../shared/types.js";
import { discoverChains } from "./agents.js";
import { materializeSavedChainSteps, normalizeChainSteps } from "./chain-serializer.js";
import { getStepAgents } from "./chain-settings.js";
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

export interface ExecutionFlags {
  args: string;
  bg: boolean;
  yes: boolean;
}

/** Extract and strip trailing --bg / --fork / --yes flags. */
export function stripExecutionFlags(rawArgs: string): ExecutionFlags {
  let args = rawArgs.trim();
  let bg = false;
  let yes = false;
  for (;;) {
    if (args.endsWith(" --bg") || args === "--bg") {
      args = args === "--bg" ? "" : args.slice(0, -5).trim();
      bg = true;
    } else if (args.endsWith(" --fork") || args === "--fork") {
      args = args === "--fork" ? "" : args.slice(0, -7).trim();
    } else if (args.endsWith(" --yes") || args === "--yes") {
      args = args === "--yes" ? "" : args.slice(0, -6).trim();
      yes = true;
    } else break;
  }
  return { args, bg, yes };
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
  if (closeIdx === -1) throw new SlashParseError(`Unmatched parentheses in group: '${trimmed}'`);
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
    throw new SlashParseError(`Parallel group must be wrapped in parentheses: '${trimmed}'`);
  }
  const { inner, config } = splitGroupBody(trimmed);
  const rawParts = splitGroupTasks(inner)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (rawParts.length < 2) {
    throw new SlashParseError("Parallel group must contain at least two tasks separated by ' | '");
  }
  return { kind: "group", tasks: rawParts.map((part) => parseSingleTaskToken(part)), config };
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

const mapParsedStep = (
  step: ParsedStep,
  fallbackTask: string | undefined,
  isFirst: boolean,
  inGroup: boolean,
) => {
  const obj: { agent: string; [k: string]: unknown } = { agent: step.name };
  if (step.task) obj.task = step.task;
  else if (isFirst && fallbackTask) obj.task = fallbackTask;
  for (const [k, v] of Object.entries(step.config)) {
    if (v === undefined) continue;
    if (k === "count" && !inGroup) continue;
    obj[k] = v;
  }
  return obj;
};

/**
 * Parse a chain expression string, validate agent names, and produce
 * `ChainStep[]` ready for `executeChain()`.
 *
 * Returns `null` and calls `notify` on failure.
 */
export function buildChainSteps(
  input: string,
  agents: Pick<AgentDefinition, "name">[],
  notify: (message: string) => void,
): { chain: ChainStep[]; task: string } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    notify("Empty chain expression");
    return null;
  }

  // Parse into steps — single-step (no arrow) or multi-step expression
  let parsedSteps: ParsedGroupStep[];
  if (!trimmed.includes(" -> ")) {
    parsedSteps = [parseSingleTaskToken(trimmed)];
  } else {
    try {
      parsedSteps = parseChainExpression(trimmed).steps;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  // Validate all agent names exist
  for (const step of parsedSteps) {
    const names = step.kind === "group" ? step.tasks.map((t) => t.name) : [step.name];
    for (const name of names) {
      if (!agents.find((a) => a.name.toLowerCase() === name.toLowerCase())) {
        notify(`Unknown agent: ${name}`);
        return null;
      }
    }
  }

  // Validate parallel group tasks have task text
  for (const step of parsedSteps) {
    if (step.kind === "group" && step.tasks.some((t) => !t.task)) {
      notify('Each task in a parallel group needs a task: (agent "a" | agent "b")');
      return null;
    }
  }

  // First step must have a task
  const firstStep = parsedSteps[0]!;
  const sharedTask =
    firstStep.kind === "group"
      ? (firstStep.tasks.find((t) => t.task)?.task ?? "")
      : (firstStep.task ?? "");
  if (!sharedTask) {
    notify('First step must include a task: /chain agent "task" -> agent2');
    return null;
  }

  // Build ChainStep[]
  const chain: ChainStep[] = parsedSteps.map((step, i): ChainStep => {
    if (step.kind === "group") {
      return {
        parallel: step.tasks.map((t) => mapParsedStep(t, undefined, false, true)),
        ...(step.config.concurrency !== undefined ? { concurrency: step.config.concurrency } : {}),
        ...(step.config.failFast !== undefined ? { failFast: step.config.failFast } : {}),
        ...(step.config.worktree !== undefined ? { worktree: step.config.worktree } : {}),
      } as ChainStep;
    }
    return mapParsedStep(step, sharedTask, i === 0, false) as SequentialStep;
  });

  return { chain, task: sharedTask };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/** Execute a chain and send the result. Shared by /chain, /run-chain, and prompt-workflows. */
export async function executeSlashChain(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  inputChain: ChainStep[],
  task: string,
  bg = false,
  yes = false,
): Promise<void> {
  const paths = deps.resolvePaths();
  const settings = deps.settings;
  const discovery = deps.discoverAgents(paths);
  const chainRunId = `chain-${Date.now().toString(36)}`;

  const spawnAndWait = async (
    agentDef: AgentDefinition,
    prompt: string,
    stepCwd: string,
    options?: import("./chain-execution.js").StepSpawnOptions,
  ) => {
    let effectiveAgentDef = options?.skills ? { ...agentDef, skills: options.skills } : agentDef;
    if (options?.model) effectiveAgentDef = { ...effectiveAgentDef, model: options.model };
    return deps.manager.spawnAndWait(ctx, effectiveAgentDef, {
      prompt,
      cwd: stepCwd || ctx.cwd,
      maxTurns: settings.defaultMaxTurns,
      toolBudget: options?.toolBudget,
      isolation: options?.isolation,
    });
  };

  const findAgent = (name: string) => {
    const agent = findAgentByName(discovery, name);
    if (!agent) throw new Error(`Unknown agent: "${name}"`);
    return agent;
  };

  const normalizeAndPreflight = (value: unknown) => {
    const steps = normalizeChainSteps(value, "slash chain");
    for (const step of steps) {
      for (const name of getStepAgents(step)) findAgent(name);
    }
    return steps;
  };
  let chain: ChainStep[];
  try {
    chain = normalizeAndPreflight(inputChain);
  } catch (error) {
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: error instanceof Error ? error.message : String(error),
      display: true,
    });
    return;
  }

  // Clarification TUI — show step preview before foreground execution
  // Skip when: --bg (background), --yes (auto-confirm), or no UI available
  if (!bg && !yes) {
    const { ChainClarifyComponent } = await import("../tui/chain-clarify.js");
    type ClarifyResult = import("../tui/chain-clarify.js").ChainClarifyResult;

    const result = await ctx.ui.custom<ClarifyResult>(
      (tui, theme, _kb, done) => new ChainClarifyComponent(tui, theme, chain, done),
      { overlay: true, overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" } },
    );

    if (!result || result.action === "cancel") return;
    try {
      chain = normalizeAndPreflight(result.steps); // Apply and validate TUI edits
    } catch (error) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: error instanceof Error ? error.message : String(error),
        display: true,
      });
      return;
    }
    if (result.action === "bg") bg = true;
  }

  // Background chain path
  if (bg) {
    const { executeChain } = await import("./chain-execution.js");
    deps.manager.fireAndForgetChain(
      chainRunId,
      task,
      executeChain({
        steps: chain,
        task,
        spawnAndWait,
        findAgent,
        cwd: ctx.cwd,
        runId: chainRunId,
        onGraphUpdate: (snapshot) => {
          deps.chainWidget?.update(snapshot);
          const record = deps.manager.getRecord(chainRunId);
          if (record) {
            record.chainSteps = snapshot.nodes
              .filter((n) => n.kind === "step" || n.kind === "agent")
              .map((n) => ({ label: n.label, status: n.status, error: n.error }));
          }
        },
        getSpawnBudget: () => deps.manager.getSpawnBudget(),
      }),
      ctx.cwd,
      () => deps.chainWidget?.clear(),
    );
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: `Chain started in background.\nChain ID: ${chainRunId}\nYou will be notified when this chain completes.`,
      display: true,
    });
    return;
  }

  try {
    const { executeChain } = await import("./chain-execution.js");
    const chainResult = await executeChain({
      steps: chain,
      task,
      spawnAndWait,
      findAgent,
      cwd: ctx.cwd,
      runId: chainRunId,
      onGraphUpdate: (snapshot) => deps.chainWidget?.update(snapshot),
      getSpawnBudget: () => deps.manager.getSpawnBudget(),
    });
    deps.chainWidget?.clear();
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: chainResult.content,
      display: true,
    });
  } catch (error) {
    deps.chainWidget?.clear();
    const message = error instanceof Error ? error.message : String(error);
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: message,
      display: true,
    });
  }
}

export function registerChainCommands(pi: ExtensionAPI, deps: RuntimeDeps): void {
  // /chain — inline chain expression
  pi.registerCommand("chain", {
    description: 'Run agents in sequence: /chain scout "task" -> planner',
    getArgumentCompletions: (prefix) => {
      try {
        const paths = deps.resolvePaths();
        const agents = deps.discoverAgents(paths).agents;
        const lower = prefix.toLowerCase();
        const matches = agents.filter((a) => a.name.toLowerCase().startsWith(lower));
        return matches.length > 0 ? matches.map((a) => ({ value: a.name, label: a.name })) : null;
      } catch {
        return null;
      }
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();

      // Subcommand: /chain status [id]
      if (trimmed === "status" || trimmed.startsWith("status ")) {
        const chainId = trimmed === "status" ? "" : trimmed.slice(7).trim();
        const { formatChainStatus } = await import("./chain-status.js");
        const chains = deps.manager.listAgents().filter((r) => r.type === "(chain)");
        if (chainId) {
          const record = chains.find((r) => r.id === chainId || r.id.startsWith(chainId));
          if (!record) {
            ctx.ui.notify(`Chain not found: ${chainId}`, "error");
            return;
          }
          ctx.ui.notify(formatChainStatus(record), "info");
        } else {
          if (chains.length === 0) {
            ctx.ui.notify("No chains running.", "info");
            return;
          }
          ctx.ui.notify(chains.map(formatChainStatus).join("\n\n"), "info");
        }
        return;
      }

      // Subcommand: /chain cancel <id>
      if (trimmed === "cancel" || trimmed.startsWith("cancel ")) {
        const chainId = trimmed === "cancel" ? "" : trimmed.slice(7).trim();
        if (!chainId) {
          ctx.ui.notify("Usage: /chain cancel <id>", "error");
          return;
        }
        const success = deps.manager.abort(chainId);
        ctx.ui.notify(
          success
            ? `Chain ${chainId} cancelled.`
            : `Chain not found or already completed: ${chainId}`,
          success ? "info" : "error",
        );
        return;
      }

      // Normal chain execution
      const { args: cleanedArgs, bg, yes } = stripExecutionFlags(args);
      const paths = deps.resolvePaths();
      const agents = deps.discoverAgents(paths).agents;

      const built = buildChainSteps(cleanedArgs, agents, (msg) => ctx.ui.notify(msg, "error"));
      if (!built) return;

      await executeSlashChain(pi, ctx, deps, built.chain, built.task, bg, yes);
    },
  });

  // /run-chain — execute a saved chain file
  pi.registerCommand("run-chain", {
    description: "Run a saved chain: /run-chain chainName -- task",
    getArgumentCompletions: (prefix) => {
      try {
        const paths = deps.resolvePaths();
        const chains = discoverChains(paths).chains;
        const lower = prefix.toLowerCase();
        const matches = chains.filter((c) => c.name.toLowerCase().startsWith(lower));
        return matches.length > 0 ? matches.map((c) => ({ value: c.name, label: c.name })) : null;
      } catch {
        return null;
      }
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const { args: cleanedArgs, bg, yes } = stripExecutionFlags(args);
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
        const available = chainDiscovery.chains.map((c) => c.name).join(", ") || "(none)";
        ctx.ui.notify(`Unknown chain: "${chainName}". Available: ${available}`, "error");
        return;
      }

      try {
        await executeSlashChain(pi, ctx, deps, materializeSavedChainSteps(chain), task, bg, yes);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
