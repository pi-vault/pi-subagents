import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ChainStep, SequentialStep, ResolvedPaths } from "../shared/types.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";

export interface PromptWorkflow {
  name: string;
  description: string;
  agent: string;
  body: string;
  filePath: string;
  model?: string;
  skills?: string[] | false;
  cwd?: string;
  chain?: string;
}

// Reserved names that conflict with registered command names
const RESERVED_NAMES = new Set([
  "chain-prompts",
  "prompt-workflow",
  "chain",
  "run-chain",
]);

type Frontmatter = Record<string, string>;

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm: Frontmatter = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) fm[kv[1]!] = kv[2]!.trim();
  }
  return { frontmatter: fm, body: (match[2] ?? "").trim() };
}

function readPromptDir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

function loadPromptWorkflow(filePath: string): PromptWorkflow | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const name = basename(filePath, ".md");
    if (RESERVED_NAMES.has(name)) return null;

    const { frontmatter, body } = parseFrontmatter(content);

    const description =
      frontmatter["description"] ??
      body.split("\n").find((l) => l.trim().length > 0)?.trim() ??
      name;

    const agent = frontmatter["subagent"] ?? "delegate";

    let skills: string[] | false | undefined;
    const skillRaw = frontmatter["skill"];
    if (skillRaw !== undefined) {
      if (skillRaw === "false") {
        skills = false;
      } else {
        skills = skillRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (skills.length === 0) skills = undefined;
      }
    }

    return {
      name,
      description,
      agent,
      body,
      filePath,
      ...(frontmatter["model"] ? { model: frontmatter["model"] } : {}),
      ...(skills !== undefined ? { skills } : {}),
      ...(frontmatter["cwd"] ? { cwd: frontmatter["cwd"] } : {}),
      ...(frontmatter["chain"] ? { chain: frontmatter["chain"] } : {}),
    };
  } catch {
    return null;
  }
}

/** Discover prompt workflows in priority order: bundled < user < project. */
export function discoverPromptWorkflows(
  paths: ResolvedPaths,
  cwd?: string,
): PromptWorkflow[] {
  const map = new Map<string, PromptWorkflow>();

  const dirs = [
    paths.bundledPromptsDir,
    paths.userPromptsDir,
    ...(cwd ? [join(cwd, ".pi", "prompts")] : []),
  ];

  for (const dir of dirs) {
    for (const filePath of readPromptDir(dir)) {
      const wf = loadPromptWorkflow(filePath);
      if (wf) map.set(wf.name, wf);
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Replace $1, $@, $ARGUMENTS, and ${N:-fallback} in a prompt body. */
export function substituteArgs(body: string, args: string[]): string {
  return body
    .replace(/\$ARGUMENTS|\$@/g, args.join(" "))
    .replace(
      /\$\{(\d+):-([^}]*)\}/g,
      (_, n: string, fallback: string) => args[parseInt(n) - 1] ?? fallback,
    )
    .replace(/\$(\d+)/g, (_, n: string) => args[parseInt(n) - 1] ?? "");
}

/** Convert a workflow to a SequentialStep applying arg substitution. */
export function workflowToChainStep(
  workflow: PromptWorkflow,
  args: string[],
): SequentialStep {
  const task = substituteArgs(workflow.body, args).trim();
  return {
    agent: workflow.agent,
    task,
    ...(workflow.model ? { model: workflow.model } : {}),
    ...(workflow.skills !== undefined ? { skills: workflow.skills } : {}),
    ...(workflow.cwd ? { cwd: workflow.cwd } : {}),
  };
}

export interface RuntimeOptions {
  args: string[];
  agentOverride?: string;
  bg?: boolean;
}

/** Tokenize raw args respecting single and double quotes. */
export function shellWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

/** Parse runtime flags from tokenized words. */
export function parseRuntimeOptions(words: string[]): RuntimeOptions {
  const args: string[] = [];
  let agentOverride: string | undefined;
  let bg = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === "--bg" || w === "--async") {
      bg = true;
      continue;
    }
    if (w === "--subagent" && i + 1 < words.length) {
      agentOverride = words[++i];
      continue;
    }
    const eq = w.match(/^--subagent[=:](.+)$/);
    if (eq) {
      agentOverride = eq[1];
      continue;
    }
    args.push(w);
  }
  return { args, agentOverride, bg };
}

// ---------------------------------------------------------------------------
// Execute a prompt chain via the slash chain machinery
// ---------------------------------------------------------------------------

async function executePromptChain(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  chain: ChainStep[],
  task: string,
  bg: boolean,
): Promise<void> {
  // Defer to the shared executeSlashChain path by dynamic-importing slash-chain
  const { executeSlashChainPublic } = await import("./slash-chain.js");
  await executeSlashChainPublic(pi, ctx, deps, chain, task, bg);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerPromptWorkflowCommands(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  // /prompt-workflow — run or list prompt workflows
  pi.registerCommand("prompt-workflow", {
    description: "Run a prompt template: /prompt-workflow <name> [args]",
    getArgumentCompletions: (prefix) => {
      try {
        const paths = deps.resolvePaths();
        const workflows = discoverPromptWorkflows(paths);
        const lower = prefix.toLowerCase();
        const matches = workflows.filter((w) =>
          w.name.toLowerCase().startsWith(lower),
        );
        return matches.length > 0
          ? matches.map((w) => ({ value: w.name, label: w.name }))
          : null;
      } catch {
        return null;
      }
    },
    handler: async (rawArgs, ctx: ExtensionCommandContext) => {
      const words = shellWords(rawArgs);
      const name = words.shift();
      const paths = deps.resolvePaths();
      const workflows = discoverPromptWorkflows(paths, ctx.cwd);

      if (!name || name === "list") {
        const list =
          workflows.length === 0
            ? "No prompt workflows found."
            : workflows.map((w) => `- ${w.name}: ${w.description}`).join("\n");
        pi.sendMessage({ customType: "pi-subagent-result", content: list, display: true });
        return;
      }

      const workflow = workflows.find((w) => w.name === name);
      if (!workflow) {
        ctx.ui.notify(`Unknown prompt workflow: ${name}`, "error");
        return;
      }

      const runtime = parseRuntimeOptions(words);

      try {
        if (workflow.chain) {
          const chainNames = workflow.chain
            .split("->")
            .map((s) => s.trim())
            .filter(Boolean);
          const chain = chainNames.map((stepName) => {
            const step = workflows.find((w) => w.name === stepName);
            if (!step)
              throw new Error(
                `Unknown workflow in chain '${workflow.name}': ${stepName}`,
              );
            return workflowToChainStep(step, runtime.args);
          });
          await executePromptChain(
            pi,
            ctx,
            deps,
            chain,
            runtime.args.join(" "),
            runtime.bg ?? false,
          );
          return;
        }
        const step = workflowToChainStep(workflow, runtime.args);
        await executePromptChain(
          pi,
          ctx,
          deps,
          [step],
          step.task ?? workflow.body,
          runtime.bg ?? false,
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });

  // /chain-prompts — chain prompt templates inline: /chain-prompts a -> b -- args
  pi.registerCommand("chain-prompts", {
    description: "Chain prompt templates: /chain-prompts analyze -> fix -- args",
    handler: async (rawArgs, ctx: ExtensionCommandContext) => {
      const delimiterIdx = rawArgs.indexOf(" -- ");
      const declaration =
        delimiterIdx === -1 ? rawArgs.trim() : rawArgs.slice(0, delimiterIdx).trim();
      const argsText =
        delimiterIdx === -1 ? "" : rawArgs.slice(delimiterIdx + 4).trim();

      const paths = deps.resolvePaths();
      const workflows = discoverPromptWorkflows(paths, ctx.cwd);

      if (!declaration || declaration === "list") {
        const list =
          workflows.length === 0
            ? "No prompt workflows found."
            : workflows.map((w) => `- ${w.name}: ${w.description}`).join("\n");
        pi.sendMessage({ customType: "pi-subagent-result", content: list, display: true });
        return;
      }

      const runtime = parseRuntimeOptions(shellWords(argsText));
      const names = declaration
        .split("->")
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length === 0) {
        ctx.ui.notify(
          "Usage: /chain-prompts prompt-a -> prompt-b -- args",
          "error",
        );
        return;
      }

      try {
        const chain = names.map((name) => {
          const workflow = workflows.find((w) => w.name === name);
          if (!workflow)
            throw new Error(`Unknown prompt workflow: ${name}`);
          return workflowToChainStep(workflow, runtime.args);
        });
        await executePromptChain(
          pi,
          ctx,
          deps,
          chain,
          runtime.args.join(" "),
          runtime.bg ?? false,
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
}
