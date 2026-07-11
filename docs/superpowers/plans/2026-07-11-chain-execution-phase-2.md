# Chain Execution — Phase 2: Chain Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/core/chain-settings.ts` with type guards, template resolution, step behavior resolution, chain instruction builder, and chain directory helpers.

**Architecture:** Pure functions for chain step discrimination and configuration resolution. No runtime dependencies beyond `node:path` and `node:fs` (for `mkdirSync`/`rmSync` in directory helpers).

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 complete (chain types exist in `src/shared/types.ts`).

---

### Task 3: Create `src/core/chain-settings.ts`

**Files:**

- Create: `src/core/chain-settings.ts`
- Test: `tests/chain-settings.test.ts`

Port from: reference `src/shared/settings.ts` (chain-related exports only)

- [ ] **Step 1: Write failing tests**

Create `tests/chain-settings.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  isParallelStep,
  isDynamicParallelStep,
  resolveChainTemplates,
  resolveStepBehavior,
  buildChainInstructions,
} from "../src/core/chain-settings.js";
import type {
  ChainStep,
  SequentialStep,
  ParallelStep,
  DynamicParallelStep,
} from "../src/shared/types.js";

describe("isParallelStep", () => {
  test("true for parallel step", () => {
    const step: ParallelStep = { parallel: [{ agent: "a", task: "t" }] };
    expect(isParallelStep(step)).toBe(true);
  });

  test("false for sequential step", () => {
    const step: SequentialStep = { agent: "a", task: "t" };
    expect(isParallelStep(step)).toBe(false);
  });

  test("false for dynamic parallel step", () => {
    const step: DynamicParallelStep = {
      expand: { from: { output: "x", path: "/items" } },
      parallel: { agent: "a" },
      collect: { as: "results" },
    };
    expect(isParallelStep(step)).toBe(false);
  });
});

describe("isDynamicParallelStep", () => {
  test("true for dynamic parallel step", () => {
    const step: DynamicParallelStep = {
      expand: { from: { output: "x", path: "/items" } },
      parallel: { agent: "a" },
      collect: { as: "results" },
    };
    expect(isDynamicParallelStep(step)).toBe(true);
  });

  test("false for static parallel step", () => {
    const step: ParallelStep = { parallel: [{ agent: "a", task: "t" }] };
    expect(isDynamicParallelStep(step)).toBe(false);
  });

  test("false for sequential step", () => {
    const step: SequentialStep = { agent: "a", task: "t" };
    expect(isDynamicParallelStep(step)).toBe(false);
  });
});

describe("resolveChainTemplates", () => {
  test("first step defaults to {task}", () => {
    const steps: ChainStep[] = [{ agent: "a" }];
    expect(resolveChainTemplates(steps)).toEqual(["{task}"]);
  });

  test("subsequent steps default to {previous}", () => {
    const steps: ChainStep[] = [{ agent: "a" }, { agent: "b" }];
    expect(resolveChainTemplates(steps)).toEqual(["{task}", "{previous}"]);
  });

  test("explicit task overrides default", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "custom task" },
      { agent: "b", task: "use {outputs.x}" },
    ];
    expect(resolveChainTemplates(steps)).toEqual([
      "custom task",
      "use {outputs.x}",
    ]);
  });

  test("parallel step returns array of templates", () => {
    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "task A" },
          { agent: "b", task: "task B" },
        ],
      },
    ];
    expect(resolveChainTemplates(steps)).toEqual([["task A", "task B"]]);
  });

  test("parallel item without task defaults to {previous}", () => {
    const steps: ChainStep[] = [{ parallel: [{ agent: "a" }, { agent: "b" }] }];
    expect(resolveChainTemplates(steps)).toEqual([
      ["{previous}", "{previous}"],
    ]);
  });

  test("dynamic parallel returns template string", () => {
    const steps: ChainStep[] = [
      {
        expand: { from: { output: "x", path: "/items" } },
        parallel: { agent: "a", task: "review {target}" },
        collect: { as: "reviews" },
      },
    ];
    expect(resolveChainTemplates(steps)).toEqual(["review {target}"]);
  });
});

describe("resolveStepBehavior", () => {
  test("step overrides take priority over agent defaults", () => {
    const result = resolveStepBehavior(
      {
        output: "agent-default.md",
        reads: false,
        progress: false,
        skills: false,
        model: "gpt-4",
      },
      { output: "step-override.md", model: "claude" },
    );
    expect(result.output).toBe("step-override.md");
    expect(result.model).toBe("claude");
  });

  test("falls back to agent defaults when no overrides", () => {
    const result = resolveStepBehavior(
      {
        output: "default.md",
        reads: ["ctx.md"],
        progress: true,
        skills: ["s1"],
        model: "gpt-4",
      },
      {},
    );
    expect(result.output).toBe("default.md");
    expect(result.reads).toEqual(["ctx.md"]);
    expect(result.progress).toBe(true);
    expect(result.model).toBe("gpt-4");
  });

  test("returns defaults when agent has no chain-relevant config", () => {
    const result = resolveStepBehavior(
      { output: false, reads: false, progress: false, skills: false },
      {},
    );
    expect(result.output).toBe(false);
    expect(result.reads).toBe(false);
    expect(result.progress).toBe(false);
  });
});

describe("buildChainInstructions", () => {
  test("includes read instructions when reads is set", () => {
    const { prefix } = buildChainInstructions(
      {
        output: false,
        outputMode: "inline",
        reads: ["ctx.md"],
        progress: false,
        skills: false,
      },
      "/tmp/chain",
      false,
    );
    expect(prefix).toContain("ctx.md");
  });

  test("includes write instructions when output is set", () => {
    const { prefix } = buildChainInstructions(
      {
        output: "result.md",
        outputMode: "inline",
        reads: false,
        progress: false,
        skills: false,
      },
      "/tmp/chain",
      false,
    );
    expect(prefix).toContain("result.md");
  });

  test("includes progress instructions for first progress agent", () => {
    const { suffix } = buildChainInstructions(
      {
        output: false,
        outputMode: "inline",
        reads: false,
        progress: true,
        skills: false,
      },
      "/tmp/chain",
      true,
    );
    expect(suffix).toContain("progress");
  });

  test("returns empty strings when no behavior configured", () => {
    const { prefix, suffix } = buildChainInstructions(
      {
        output: false,
        outputMode: "inline",
        reads: false,
        progress: false,
        skills: false,
      },
      "/tmp/chain",
      false,
    );
    expect(prefix).toBe("");
    expect(suffix).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-settings.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-settings.ts`**

Create `src/core/chain-settings.ts`:

```typescript
import { isAbsolute, join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import type {
  ChainStep,
  ParallelStep,
  DynamicParallelStep,
  SequentialStep,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isParallelStep(step: ChainStep): step is ParallelStep {
  return "parallel" in step && Array.isArray((step as ParallelStep).parallel);
}

export function isDynamicParallelStep(
  step: ChainStep,
): step is DynamicParallelStep {
  return (
    "expand" in step &&
    "collect" in step &&
    "parallel" in step &&
    !Array.isArray((step as { parallel?: unknown }).parallel)
  );
}

export function getStepAgents(step: ChainStep): string[] {
  if (isParallelStep(step)) return step.parallel.map((t) => t.agent);
  if (isDynamicParallelStep(step)) return [step.parallel.agent];
  return [(step as SequentialStep).agent];
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export type ResolvedTemplates = (string | string[])[];

export function resolveChainTemplates(steps: ChainStep[]): ResolvedTemplates {
  return steps.map((step, i) => {
    if (isParallelStep(step)) {
      return step.parallel.map((task) => task.task ?? "{previous}");
    }
    if (isDynamicParallelStep(step)) {
      return step.parallel.task ?? "{previous}";
    }
    const seq = step as SequentialStep;
    if (seq.task) return seq.task;
    return i === 0 ? "{task}" : "{previous}";
  });
}

// ---------------------------------------------------------------------------
// Step behavior resolution
// ---------------------------------------------------------------------------

export type OutputMode = "inline" | "file-only";

export interface StepOverrides {
  output?: string | false;
  outputMode?: OutputMode;
  reads?: string[] | false;
  progress?: boolean;
  skills?: string[] | false;
  model?: string;
}

export interface ResolvedStepBehavior {
  output: string | false;
  outputMode: OutputMode;
  reads: string[] | false;
  progress: boolean;
  skills: string[] | false;
  model?: string;
}

export interface AgentBehaviorDefaults {
  output?: string | false;
  reads?: string[] | false;
  progress?: boolean;
  skills?: string[] | false;
  model?: string;
}

export function resolveStepBehavior(
  agentDefaults: AgentBehaviorDefaults,
  overrides: StepOverrides,
): ResolvedStepBehavior {
  return {
    output:
      overrides.output !== undefined
        ? overrides.output
        : (agentDefaults.output ?? false),
    outputMode: overrides.outputMode ?? "inline",
    reads:
      overrides.reads !== undefined
        ? overrides.reads
        : (agentDefaults.reads ?? false),
    progress:
      overrides.progress !== undefined
        ? overrides.progress
        : (agentDefaults.progress ?? false),
    skills:
      overrides.skills !== undefined
        ? overrides.skills
        : (agentDefaults.skills ?? false),
    model: overrides.model ?? agentDefaults.model,
  };
}

// ---------------------------------------------------------------------------
// Chain instructions builder
// ---------------------------------------------------------------------------

function resolveChainPath(filePath: string, chainDir: string): string {
  return isAbsolute(filePath) ? filePath : join(chainDir, filePath);
}

export function buildChainInstructions(
  behavior: ResolvedStepBehavior,
  chainDir: string,
  isFirstProgressAgent: boolean,
): { prefix: string; suffix: string } {
  const prefixParts: string[] = [];
  const suffixParts: string[] = [];

  if (behavior.reads && behavior.reads.length > 0) {
    const paths = behavior.reads.map((f) => resolveChainPath(f, chainDir));
    prefixParts.push(`[Read from: ${paths.join(", ")}]`);
  }
  if (behavior.output) {
    const path = resolveChainPath(behavior.output, chainDir);
    prefixParts.push(`[Write to: ${path}]`);
  }
  if (behavior.progress) {
    const progressPath = join(chainDir, "progress.md");
    if (isFirstProgressAgent) {
      suffixParts.push(`Create and maintain progress at: ${progressPath}`);
    } else {
      suffixParts.push(`Update progress at: ${progressPath}`);
    }
  }

  return {
    prefix: prefixParts.join("\n"),
    suffix: suffixParts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Chain directory helpers
// ---------------------------------------------------------------------------

export function createChainDir(runId: string, baseDir?: string): string {
  const dir = join(baseDir ?? "/tmp/pi-subagents-chain-runs", runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeChainDir(chainDir: string): void {
  try {
    rmSync(chainDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-settings.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-settings.ts tests/chain-settings.test.ts
git commit -m "feat(chain-settings): add type guards, template resolution, behavior resolution"
```
