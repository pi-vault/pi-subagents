# Chain Execution — Phase 8: Slash Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/chain` and `/run-chain` slash commands with a quote/paren-aware inline chain expression parser in `src/core/slash-chain.ts`.

**Architecture:** Two-phase parsing ported from the reference. Phase 1 parses the raw expression string into an intermediate AST (`ParsedGroupStep[]`) using quote/paren-aware tokenizers. Phase 2 (`buildChainSteps`) validates agent names against discovery, resolves inline config, and produces `ChainStep[]` for `executeChain()`. Command registration goes in `registerChainCommands()` called from `src/index.ts`.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents/src/slash/slash-commands.ts`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 5 (discoverChains), Phase 6 (executeChain), Phase 7 (chain/chain_append tool modes).

---

## Task 9a: Chain Expression Parser (pure functions)

**Files:**

- Create: `src/core/slash-chain.ts`
- Test: `tests/slash-chain.test.ts`

Port from: reference `src/slash/slash-commands.ts` (lines 55–913, parsing functions only)

- [ ] **Step 1: Write failing tests for the parser**

Create `tests/slash-chain.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  parseSingleTaskToken,
  parseGroupSegment,
  hasGroupSyntax,
  parseChainExpression,
  extractExecutionFlags,
  SlashParseError,
} from "../src/core/slash-chain.js";

describe("extractExecutionFlags", () => {
  test("extracts --bg flag", () => {
    const result = extractExecutionFlags('scout "task" --bg');
    expect(result.bg).toBe(true);
    expect(result.fork).toBe(false);
    expect(result.args).toBe('scout "task"');
  });

  test("extracts --fork flag", () => {
    const result = extractExecutionFlags('scout "task" --fork');
    expect(result.fork).toBe(true);
    expect(result.bg).toBe(false);
    expect(result.args).toBe('scout "task"');
  });

  test("extracts both flags", () => {
    const result = extractExecutionFlags('scout "task" --bg --fork');
    expect(result.bg).toBe(true);
    expect(result.fork).toBe(true);
    expect(result.args).toBe('scout "task"');
  });

  test("returns clean args when no flags", () => {
    const result = extractExecutionFlags('scout "task"');
    expect(result.bg).toBe(false);
    expect(result.fork).toBe(false);
    expect(result.args).toBe('scout "task"');
  });
});

describe("parseSingleTaskToken", () => {
  test("parses a quoted task", () => {
    const parsed = parseSingleTaskToken('reviewer "review auth module"');
    expect(parsed.kind).toBe("step");
    expect(parsed.name).toBe("reviewer");
    expect(parsed.task).toBe("review auth module");
  });

  test("parses single-quoted task", () => {
    const parsed = parseSingleTaskToken("reviewer 'review auth module'");
    expect(parsed.name).toBe("reviewer");
    expect(parsed.task).toBe("review auth module");
  });

  test("parses an agent with inline config and no task", () => {
    const parsed = parseSingleTaskToken(
      "scout[output=ctx.md,outputMode=file-only]",
    );
    expect(parsed.name).toBe("scout");
    expect(parsed.config.output).toBe("ctx.md");
    expect(parsed.config.outputMode).toBe("file-only");
    expect(parsed.task).toBeUndefined();
  });

  test("parses a task via -- delimiter", () => {
    const parsed = parseSingleTaskToken("reviewer -- Review {previous}");
    expect(parsed.name).toBe("reviewer");
    expect(parsed.task).toBe("Review {previous}");
  });

  test("parses agent with no task", () => {
    const parsed = parseSingleTaskToken("scout");
    expect(parsed.name).toBe("scout");
    expect(parsed.task).toBeUndefined();
  });

  test("parses extended metadata in inline config", () => {
    const parsed = parseSingleTaskToken(
      'reviewer[as=rev,label=Review,phase=p1,cwd=sub,count=3] "task"',
    );
    expect(parsed.config.as).toBe("rev");
    expect(parsed.config.label).toBe("Review");
    expect(parsed.config.phase).toBe("p1");
    expect(parsed.config.cwd).toBe("sub");
    expect(parsed.config.count).toBe(3);
    expect(parsed.task).toBe("task");
  });

  test("parses progress boolean flag", () => {
    const parsed = parseSingleTaskToken("scout[progress]");
    expect(parsed.config.progress).toBe(true);
  });

  test("parses reads config", () => {
    const parsed = parseSingleTaskToken("scout[reads=a.md+b.md]");
    expect(parsed.config.reads).toEqual(["a.md", "b.md"]);
  });

  test("parses reads=false", () => {
    const parsed = parseSingleTaskToken("scout[reads=false]");
    expect(parsed.config.reads).toBe(false);
  });

  test("parses skills config", () => {
    const parsed = parseSingleTaskToken("scout[skills=lint+test]");
    expect(parsed.config.skills).toEqual(["lint", "test"]);
  });

  test("parses skills=false", () => {
    const parsed = parseSingleTaskToken("scout[skills=false]");
    expect(parsed.config.skills).toBe(false);
  });

  test("ignores a non-positive count", () => {
    expect(parseSingleTaskToken("scout[count=0]").config.count).toBeUndefined();
    expect(parseSingleTaskToken("scout[count=x]").config.count).toBeUndefined();
  });
});

describe("parseGroupSegment", () => {
  test("parses a parallel group with two quoted tasks", () => {
    const parsed = parseGroupSegment('(reviewer "A" | reviewer "B")');
    expect(parsed.kind).toBe("group");
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0]!.name).toBe("reviewer");
    expect(parsed.tasks[0]!.task).toBe("A");
    expect(parsed.tasks[1]!.task).toBe("B");
  });

  test("rejects groups with a single task", () => {
    expect(() => parseGroupSegment('(reviewer "A")')).toThrow(SlashParseError);
  });

  test("rejects groups with unbalanced parentheses", () => {
    expect(() => parseGroupSegment('(reviewer "A"')).toThrow(SlashParseError);
  });

  test("parses a trailing group-options suffix", () => {
    const parsed = parseGroupSegment(
      '(reviewer "A" | reviewer "B")[concurrency=2,failFast,worktree]',
    );
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.config.concurrency).toBe(2);
    expect(parsed.config.failFast).toBe(true);
    expect(parsed.config.worktree).toBe(true);
  });

  test("defaults to empty group config without a suffix", () => {
    expect(parseGroupSegment('(a "x" | b "y")').config).toEqual({});
  });

  test("rejects a non-bracketed group suffix", () => {
    expect(() =>
      parseGroupSegment('(a "x" | b "y") concurrency=2'),
    ).toThrow(SlashParseError);
  });
});

describe("hasGroupSyntax", () => {
  test("detects parentheses in a step position", () => {
    expect(hasGroupSyntax("a -> (b | c)")).toBe(true);
  });

  test("does not treat a bare pipe as group syntax", () => {
    expect(hasGroupSyntax("a -> b | c")).toBe(false);
  });

  test("ignores parens inside quotes", () => {
    expect(hasGroupSyntax('a -> b "with (paren) inside"')).toBe(false);
  });

  test("returns false for plain chain input", () => {
    expect(hasGroupSyntax("scout -> reviewer")).toBe(false);
  });

  test("still detects a group that opens a step", () => {
    expect(hasGroupSyntax('scout "x" -> (a "y" | b "z")')).toBe(true);
    expect(hasGroupSyntax('(a "y" | b "z") -> writer')).toBe(true);
  });
});

describe("parseChainExpression", () => {
  test("parses sequential + group + sequential", () => {
    const expression = parseChainExpression(
      'scout "scan" -> (reviewer "A" | reviewer "B") -> writer "fix"',
    );
    expect(expression.steps).toHaveLength(3);
    expect(expression.steps[0]!.kind).toBe("step");
    expect(expression.steps[1]!.kind).toBe("group");
    if (expression.steps[1]!.kind === "group") {
      expect(expression.steps[1]!.tasks).toHaveLength(2);
    }
    if (expression.steps[0]!.kind === "step") {
      expect(expression.steps[0]!.name).toBe("scout");
    }
    if (expression.steps[2]!.kind === "step") {
      expect(expression.steps[2]!.name).toBe("writer");
    }
  });

  test("rejects expression without arrows", () => {
    expect(() =>
      parseChainExpression('(reviewer "A" | reviewer "B")'),
    ).toThrow(SlashParseError);
  });

  test("rejects groups with one task", () => {
    expect(() =>
      parseChainExpression('scout "scan" -> (reviewer "A")'),
    ).toThrow(SlashParseError);
  });

  test("respects quotes when splitting on arrows", () => {
    const expression = parseChainExpression(
      'scout "scan -> quick" -> reviewer "Review"',
    );
    expect(expression.steps).toHaveLength(2);
    if (expression.steps[0]!.kind === "step") {
      expect(expression.steps[0]!.task).toBe("scan -> quick");
    }
  });

  test("allows balanced parens in a -- task after a group", () => {
    const expression = parseChainExpression(
      'scout "scan" -> (reviewer "A" | reviewer "B") -> writer -- fix (backend)',
    );
    expect(expression.steps).toHaveLength(3);
  });

  test("rejects truly unmatched parens", () => {
    expect(() =>
      parseChainExpression(
        'scout "scan" -> (reviewer "A" | reviewer "B") -> writer -- fix (backend',
      ),
    ).toThrow(SlashParseError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement parser in `src/core/slash-chain.ts`**

Create `src/core/slash-chain.ts`. Port from reference `src/slash/slash-commands.ts` lines 55–913, adapting field names to match our `src/shared/types.ts` (e.g. `skills` instead of `skill`).

```typescript
// ---------------------------------------------------------------------------
// Chain expression parser — pure functions, zero runtime deps.
// Ported from reference: nicobailon-pi-subagents/src/slash/slash-commands.ts
// ---------------------------------------------------------------------------

// -- Types ------------------------------------------------------------------

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

export class SlashParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlashParseError";
  }
}

// -- Flag extraction --------------------------------------------------------

export function extractExecutionFlags(rawArgs: string): {
  args: string;
  bg: boolean;
  fork: boolean;
} {
  let bg = false;
  let fork = false;
  let cleaned = rawArgs;
  if (cleaned.includes("--bg")) {
    bg = true;
    cleaned = cleaned.replace(/--bg/g, "").trim();
  }
  if (cleaned.includes("--fork")) {
    fork = true;
    cleaned = cleaned.replace(/--fork/g, "").trim();
  }
  return { args: cleaned, bg, fork };
}

// -- Quote/paren-aware splitting --------------------------------------------

/** Walk `input` tracking quote/paren state; returns true if parens are unbalanced. */
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

/** Split on top-level ` -> `, ignoring arrows inside quotes or parentheses. */
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
    else if (
      depth === 0 &&
      ch === "-" &&
      input[i + 1] === ">" &&
      input[i + 2] === " "
    ) {
      segments.push(input.slice(start, i));
      i += 2;
      start = i + 1;
    }
  }
  segments.push(input.slice(start));
  return segments;
}

/** Split a group's inner text on top-level ` | `, ignoring pipes inside quotes/parens. */
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

// -- Inline config ----------------------------------------------------------

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
        config.reads =
          val === "false" ? false : val.split("+").filter(Boolean);
        break;
      case "model":
        config.model = val || undefined;
        break;
      case "skill":
      case "skills":
        config.skills =
          val === "false" ? false : val.split("+").filter(Boolean);
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
    }
  }
  return config;
};

const parseAgentToken = (
  token: string,
): { name: string; config: InlineConfig } => {
  const bracket = token.indexOf("[");
  if (bracket === -1) return { name: token, config: {} };
  const end = token.lastIndexOf("]");
  return {
    name: token.slice(0, bracket),
    config: parseInlineConfig(
      token.slice(bracket + 1, end !== -1 ? end : undefined),
    ),
  };
};

// -- Token / group parsing --------------------------------------------------

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

// -- Group parsing ----------------------------------------------------------

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

/** Split `(...)` from an optional trailing `[...]` group-config suffix. */
const splitGroupBody = (
  trimmed: string,
): { inner: string; config: GroupConfig } => {
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
    throw new SlashParseError(
      `Unmatched parentheses in group: '${trimmed}'`,
    );
  const inner = trimmed.slice(1, closeIdx);
  const suffix = trimmed.slice(closeIdx + 1).trim();
  if (!suffix) return { inner, config: {} };
  if (!suffix.startsWith("[") || !suffix.endsWith("]")) {
    throw new SlashParseError(
      `Group options must be wrapped in [...]: '${suffix}'`,
    );
  }
  return { inner, config: parseGroupConfig(suffix.slice(1, -1)) };
};

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
  return {
    kind: "group",
    tasks: rawParts.map((part) => parseSingleTaskToken(part)),
    config,
  };
}

// -- Top-level expression ---------------------------------------------------

/**
 * True if `input` uses inline parallel-group syntax. A group is a *step*
 * that begins with `(` at the top level after splitting on ` -> `.
 */
export function hasGroupSyntax(input: string): boolean {
  return splitOnArrow(input).some((seg) => seg.trim().startsWith("("));
}

export function parseChainExpression(input: string): {
  steps: ParsedGroupStep[];
} {
  const trimmed = input.trim();
  if (!trimmed.includes(" -> ")) {
    throw new SlashParseError(
      'Chain expressions require " -> " between steps',
    );
  }
  if (findUnmatchedCloseParen(trimmed)) {
    throw new SlashParseError(
      "Unmatched parentheses in /chain expression",
    );
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
      throw new SlashParseError(
        `Unmatched parentheses in chain segment: '${t}'`,
      );
    }
    steps.push(parseSingleTaskToken(t));
  }
  if (steps.length === 0) {
    throw new SlashParseError(
      "/chain expression must include at least one step",
    );
  }
  return { steps };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/slash-chain.ts tests/slash-chain.test.ts
git commit -m "feat(slash-chain): add quote/paren-aware chain expression parser"
```

---

## Task 9b: Chain Step Builder & Command Registration

**Files:**

- Modify: `src/core/slash-chain.ts` (add `buildChainSteps`, `registerChainCommands`)
- Modify: `src/index.ts` (wire `registerChainCommands`)
- Test: `tests/slash-chain.test.ts` (add `buildChainSteps` tests)

Port from: reference `src/slash/slash-commands.ts` lines 915–1305

- [ ] **Step 1: Write failing tests for `buildChainSteps`**

Append to `tests/slash-chain.test.ts`:

```typescript
import { buildChainSteps } from "../src/core/slash-chain.js";
import type { AgentDefinition } from "../src/shared/types.js";

// Minimal agent stubs for testing
const stubAgent = (name: string): AgentDefinition =>
  ({
    name,
    description: name,
    sourcePath: `/fake/${name}.md`,
    scope: "project" as const,
    systemPrompt: "",
  }) as AgentDefinition;

const AGENTS = [stubAgent("scout"), stubAgent("reviewer"), stubAgent("writer")];

describe("buildChainSteps", () => {
  test("builds a linear chain with per-step tasks", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> reviewer "review"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    expect(result!.chain).toHaveLength(2);
    expect(result!.chain[0]).toHaveProperty("agent", "scout");
    expect(result!.chain[1]).toHaveProperty("agent", "reviewer");
    expect(result!.task).toBe("scan");
  });

  test("builds a chain with a parallel group", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer "A" | reviewer "B") -> writer "fix"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    expect(result!.chain).toHaveLength(3);
    const group = result!.chain[1]!;
    expect(group).toHaveProperty("parallel");
    if ("parallel" in group) {
      expect(group.parallel).toHaveLength(2);
    }
  });

  test("rejects unknown agent", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'ghost "scan" -> reviewer "review"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatch(/ghost/i);
  });

  test("rejects chain where first step has no task", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      "scout -> reviewer",
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications.some((m) => /task/i.test(m))).toBe(true);
  });

  test("rejects parallel group tasks without individual tasks", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer | writer)',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications).toHaveLength(1);
  });

  test("propagates inline metadata onto chain steps", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout[as=ctx,label=Scan,phase=recon] "scan" -> reviewer "review"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    const first = result!.chain[0] as Record<string, unknown>;
    expect(first.as).toBe("ctx");
    expect(first.label).toBe("Scan");
    expect(first.phase).toBe("recon");
  });

  test("applies count only inside a parallel group", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout[count=2] "scan" -> (reviewer[count=3] "A" | writer "B")',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    // sequential first step: count not applied
    expect((result!.chain[0] as Record<string, unknown>).count).toBeUndefined();
    const parallel = (result!.chain[1] as { parallel: Array<Record<string, unknown>> }).parallel;
    expect(parallel[0]?.count).toBe(3);
    expect(parallel[1]?.count).toBeUndefined();
  });

  test("propagates group-level options onto the parallel step", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer "A" | writer "B")[concurrency=2,failFast]',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    const group = result!.chain[1] as Record<string, unknown>;
    expect(group.concurrency).toBe(2);
    expect(group.failFast).toBe(true);
    expect(group.worktree).toBeUndefined();
  });

  test("handles single-step parse error gracefully", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer "A")',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatch(/at least two/i);
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: FAIL (buildChainSteps not found)

- [ ] **Step 3: Implement `buildChainSteps` in `src/core/slash-chain.ts`**

Append to `src/core/slash-chain.ts`:

```typescript
import type {
  AgentDefinition,
  ChainStep,
  SequentialStep,
  ParallelTaskItem,
} from "../shared/types.js";

// -- Step object mapping (ParsedStep → ChainStep fields) --------------------

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
  outputSchema?: string;
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
    ...(config.outputSchema ? { outputSchema: config.outputSchema } : {}),
  };
};

// -- Chain step builder (parsed AST → ChainStep[]) --------------------------

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
    chain = expression.steps.map((step) => {
      if (step.kind === "group") {
        const parallel: ParallelTaskItem[] = step.tasks.map((t) =>
          mapParsedStepToObject(t, undefined, false, {
            inGroup: true,
          }),
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
        };
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
    // Single step with -- delimiter or quoted task
    steps = [parseSingleTaskToken(trimmed)];
  }

  if (steps.length === 0) {
    notify("No steps parsed from chain expression");
    return null;
  }

  // Extract shared task from first step that has one
  const sharedTask = steps.find((s) => s.task)?.task ?? "";
  if (!sharedTask) {
    notify(
      'First step must include a task: /chain agent "task" -> agent2',
    );
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `registerChainCommands` in `src/core/slash-chain.ts`**

Append to `src/core/slash-chain.ts`:

```typescript
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import { discoverChains } from "./agents.js";
import { findAgentByName } from "./subagent.js";

/** Execute a chain and send the result as a message. Shared by /chain and /run-chain. */
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
    const result = await executeChain({
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
      content: result.content,
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
      'Run agents in sequence: /chain scout "task" -> planner [--bg] [--fork]',
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
    handler: async (args, ctx) => {
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
      "Run a saved chain: /run-chain chainName -- task [--bg] [--fork]",
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
    handler: async (args, ctx) => {
      const { args: cleanedArgs } = extractExecutionFlags(args);
      const usage = "Usage: /run-chain <chainName> -- <task> [--bg] [--fork]";

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

      // ChainStepConfig[] is structurally compatible with ChainStep[]
      // at runtime — the execution engine uses runtime type guards.
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
```

**Important:** The import of `ExtensionCommandContext` type may need adjustment based on what the `@earendil-works/pi-coding-agent` package actually exports. Check the existing imports in `src/index.ts` and `src/core/subagent.ts` for the correct type name. The handler's `ctx` parameter type is the second argument of `RegisteredCommand.handler` — inspect the package's type exports to confirm. If the type is not directly importable, use the inferred type from the handler signature.

- [ ] **Step 6: Wire `registerChainCommands` in `src/index.ts`**

In `src/index.ts`, add the import and call:

```typescript
// Add import near the top with other core imports:
import { registerChainCommands } from "./core/slash-chain.js";

// Inside registerSubagentsExtension(), after registerAgentCommand(pi, deps):
registerChainCommands(pi, deps);
```

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

Fix any type errors. Common issues to watch for:
- The `ctx` parameter type in command handlers — check what the pi SDK exports
- The `ExtensionCommandContext` vs `ExtensionContext` distinction — command handlers receive the command context which extends the base context
- The `ChainStep` import may need to come from `../shared/types.js` not re-exported

- [ ] **Step 8: Commit**

```bash
git add src/core/slash-chain.ts tests/slash-chain.test.ts src/index.ts
git commit -m "feat(slash): add /chain and /run-chain commands with expression parser

- Quote/paren-aware splitting (arrows in quoted tasks don't break parsing)
- Inline config: agent[as=ctx,output=file.md] \"task\"
- Parallel groups: (agentA \"task\" | agentB \"task\")[concurrency=2]
- Agent name validation against discovery
- Tab completion for agent and chain names
- /run-chain loads saved .chain.md/.chain.json files"
```
