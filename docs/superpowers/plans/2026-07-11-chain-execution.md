# Chain Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the complete Chain Execution feature — sequential pipelines, parallel groups, dynamic fanout, named outputs, chain discovery, slash commands, async append, and TUI widget — from the reference implementation into `src/core/`.

**Architecture:** Direct port with adaptation. New chain modules land in `src/core/` alongside existing files. The chain execution engine (`executeChain()`) orchestrates a step loop that dispatches sequential, parallel, and dynamic-parallel steps. Each step spawns through the existing `AgentManager.spawnAndWait()`, inheriting spawn limits, tool budgets, and concurrency for free. Async chains run as in-process background tasks (not detached processes like the source). Chain files (`.chain.md`, `.chain.json`) are discovered from dedicated `chains/` directories.

**Tech Stack:** TypeScript, Vitest, TypeBox schemas, `@earendil-works/pi-coding-agent` SDK, `@earendil-works/pi-tui`

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

---

## File Map

### New Files

| File                           | Responsibility                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/chain-outputs.ts`    | Named output validation (`validateChainOutputBindings`), reference resolution (`resolveOutputReferences`), output entry creation                                                                                                   |
| `src/core/chain-settings.ts`   | Type guards (`isParallelStep`, `isDynamicParallelStep`), template resolution (`resolveChainTemplates`), behavior resolution (`resolveStepBehavior`), chain instruction builder (`buildChainInstructions`), chain directory helpers |
| `src/core/chain-serializer.ts` | Parse/serialize `.chain.md` and `.chain.json` files                                                                                                                                                                                |
| `src/core/chain-append.ts`     | In-memory queue for appending steps to running async chains                                                                                                                                                                        |
| `src/core/chain-execution.ts`  | `executeChain()` orchestrator — the main step loop                                                                                                                                                                                 |
| `src/tui/chain-widget.ts`      | Workflow graph rendering for chain progress display                                                                                                                                                                                |

### New Test Files

| File                             | Covers                                                                    |
| -------------------------------- | ------------------------------------------------------------------------- |
| `tests/chain-outputs.test.ts`    | Output binding validation, reference resolution                           |
| `tests/chain-settings.test.ts`   | Type guards, template resolution, behavior resolution, chain instructions |
| `tests/chain-serializer.test.ts` | Parse/serialize roundtrips for both formats                               |
| `tests/chain-append.test.ts`     | Enqueue, consume, pending count                                           |
| `tests/chain-execution.test.ts`  | Integration: sequential, parallel, dynamic, error handling                |
| `tests/slash-chain.test.ts`      | Inline chain expression parsing                                           |

### Modified Files

| File                         | Changes                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `src/shared/types.ts`        | Add all chain types (spec section 2)                                      |
| `src/core/paths.ts`          | Add `userChainsDir`, `bundledChainsDir` to `ResolvedPaths`                |
| `src/core/agents.ts`         | Add `discoverChains()`                                                    |
| `src/core/subagent.ts`       | Add `chain` + `chain_append` to tool schema; dispatch to `executeChain()` |
| `src/shared/runtime-deps.ts` | Add optional `chainWidget`, `discoverChains` fields                       |
| `src/index.ts`               | Register `/chain`, `/run-chain`; create chain widget; wire deps           |

---

## Phase 1: Types & Chain Outputs

Pure types and pure functions with no runtime dependencies. Fully testable in isolation.

### Task 1: Add chain types to `src/shared/types.ts`

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add ported helper types at end of file**

```typescript
// ---------------------------------------------------------------------------
// Chain execution types (spec section 2)
// ---------------------------------------------------------------------------

export interface AcceptanceInput {
  description: string;
  command?: string;
}

export type JsonSchemaObject = Record<string, unknown>;
```

- [ ] **Step 2: Add chain step types**

```typescript
export interface SequentialStep {
  agent: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: JsonSchemaObject;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
}

export interface ParallelTaskItem {
  agent: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: JsonSchemaObject;
  count?: number;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
}

export interface ParallelStep {
  parallel: ParallelTaskItem[];
  concurrency?: number;
  failFast?: boolean;
  worktree?: boolean;
  cwd?: string;
}

export interface DynamicParallelStep {
  expand: {
    from: { output: string; path: string };
    item?: string;
    key?: string;
    maxItems?: number;
    onEmpty?: "skip" | "fail";
  };
  parallel: DynamicParallelTemplate;
  collect: { as: string; outputSchema?: JsonSchemaObject };
  concurrency?: number;
  failFast?: boolean;
  acceptance?: AcceptanceInput;
}

export type DynamicParallelTemplate = Omit<ParallelTaskItem, "as" | "count">;

export type ChainStep = SequentialStep | ParallelStep | DynamicParallelStep;
```

- [ ] **Step 3: Add output map, config, workflow graph, and run mode types**

```typescript
export interface ChainOutputMapEntry {
  text: string;
  structured?: unknown;
  agent: string;
  stepIndex: number;
}

export type ChainOutputMap = Record<string, ChainOutputMapEntry>;

export interface ChainConfig {
  name: string;
  localName?: string;
  packageName?: string;
  description: string;
  filePath: string;
  steps: ChainStepConfig[];
  extraFields?: Record<string, string>;
}

export interface ChainStepConfig {
  agent?: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: string | JsonSchemaObject;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
  parallel?: ChainStepConfig[];
  concurrency?: number;
  failFast?: boolean;
  worktree?: boolean;
  expand?: DynamicParallelStep["expand"];
  collect?: DynamicParallelStep["collect"];
}

export type WorkflowNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "paused"
  | "stopped";

export interface WorkflowGraphNode {
  id: string;
  kind: "step" | "parallel-group" | "dynamic-parallel-group" | "agent";
  agent?: string;
  phase?: string;
  label: string;
  status: WorkflowNodeStatus;
  flatIndex?: number;
  stepIndex?: number;
  children?: WorkflowGraphNode[];
  dynamic?: {
    sourceOutput: string;
    sourcePath: string;
    itemName: string;
    maxItems?: number;
    collectAs?: string;
  };
  itemKey?: string;
  outputName?: string;
  structured?: boolean;
  error?: string;
}

export interface WorkflowGraphSnapshot {
  runId: string;
  mode: SubagentRunMode;
  phases: Array<{ title: string; nodeIds: string[] }>;
  nodes: WorkflowGraphNode[];
  currentNodeId?: string;
}

export type SubagentRunMode = "single" | "parallel" | "chain";

export interface ChainDiscoveryDiagnostic {
  filePath: string;
  error: string;
}

export interface ChainDiscoveryResult {
  chains: ChainConfig[];
  diagnostics: ChainDiscoveryDiagnostic[];
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors — new types are additive, no existing code references them yet)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add chain execution type definitions"
```

---

### Task 2: Create `src/core/chain-outputs.ts`

**Files:**

- Create: `src/core/chain-outputs.ts`
- Test: `tests/chain-outputs.test.ts`

Port from: reference `src/runs/shared/chain-outputs.ts`

- [ ] **Step 1: Write failing tests for output validation**

Create `tests/chain-outputs.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  validateChainOutputBindings,
  resolveOutputReferences,
  outputEntryFromResult,
  ChainOutputValidationError,
} from "../src/core/chain-outputs.js";
import type { ChainStep, ChainOutputMap } from "../src/shared/types.js";

describe("validateChainOutputBindings", () => {
  test("accepts valid sequential chain with named outputs", () => {
    const steps: ChainStep[] = [
      { agent: "scout", task: "scan", as: "context" },
      { agent: "planner", task: "plan from {outputs.context}" },
    ];
    expect(() => validateChainOutputBindings(steps)).not.toThrow();
  });

  test("rejects duplicate output names", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t", as: "dup" },
      { agent: "b", task: "t", as: "dup" },
    ];
    expect(() => validateChainOutputBindings(steps)).toThrow(
      ChainOutputValidationError,
    );
  });

  test("rejects reference to nonexistent output", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "use {outputs.missing}" }];
    expect(() => validateChainOutputBindings(steps)).toThrow(
      ChainOutputValidationError,
    );
  });

  test("rejects invalid output name characters", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "t", as: "bad-name" }];
    expect(() => validateChainOutputBindings(steps)).toThrow(
      ChainOutputValidationError,
    );
  });

  test("accepts parallel step with named outputs", () => {
    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "t", as: "out_a" },
          { agent: "b", task: "t", as: "out_b" },
        ],
      },
      { agent: "c", task: "use {outputs.out_a} and {outputs.out_b}" },
    ];
    expect(() => validateChainOutputBindings(steps)).not.toThrow();
  });

  test("rejects forward reference (output used before defined)", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "use {outputs.later}" },
      { agent: "b", task: "t", as: "later" },
    ];
    expect(() => validateChainOutputBindings(steps)).toThrow(
      ChainOutputValidationError,
    );
  });
});

describe("resolveOutputReferences", () => {
  test("replaces {outputs.name} with entry text", () => {
    const outputs: ChainOutputMap = {
      context: {
        text: "found 3 files",
        structured: undefined,
        agent: "scout",
        stepIndex: 0,
      },
    };
    expect(
      resolveOutputReferences("Plan from {outputs.context}", outputs),
    ).toBe("Plan from found 3 files");
  });

  test("replaces multiple references", () => {
    const outputs: ChainOutputMap = {
      a: { text: "A", structured: undefined, agent: "x", stepIndex: 0 },
      b: { text: "B", structured: undefined, agent: "y", stepIndex: 1 },
    };
    expect(resolveOutputReferences("{outputs.a} + {outputs.b}", outputs)).toBe(
      "A + B",
    );
  });

  test("throws on unknown reference", () => {
    expect(() => resolveOutputReferences("{outputs.nope}", {})).toThrow(
      ChainOutputValidationError,
    );
  });

  test("returns string unchanged when no references", () => {
    expect(resolveOutputReferences("no refs here", {})).toBe("no refs here");
  });
});

describe("outputEntryFromResult", () => {
  test("creates entry from text result", () => {
    const entry = outputEntryFromResult("scout", "found files", 0);
    expect(entry).toEqual({
      text: "found files",
      structured: undefined,
      agent: "scout",
      stepIndex: 0,
    });
  });

  test("creates entry with structured output", () => {
    const structured = { items: [1, 2, 3] };
    const entry = outputEntryFromResult("scout", "text", 0, structured);
    expect(entry.structured).toEqual(structured);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-outputs.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-outputs.ts`**

Create `src/core/chain-outputs.ts`:

```typescript
import type {
  ChainStep,
  ChainOutputMap,
  ChainOutputMapEntry,
  ParallelStep,
  DynamicParallelStep,
  SequentialStep,
} from "../shared/types.js";

const OUTPUT_REF_PATTERN = /\{outputs\.([^}]*)\}/g;
const SAFE_OUTPUT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ChainOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainOutputValidationError";
  }
}

function isParallelStep(step: ChainStep): step is ParallelStep {
  return "parallel" in step && Array.isArray((step as ParallelStep).parallel);
}

function isDynamicParallelStep(step: ChainStep): step is DynamicParallelStep {
  return (
    "expand" in step &&
    "collect" in step &&
    "parallel" in step &&
    !Array.isArray((step as { parallel?: unknown }).parallel)
  );
}

function getOutputNames(step: ChainStep): string[] {
  if (isParallelStep(step)) {
    return step.parallel.map((t) => t.as).filter((n): n is string => !!n);
  }
  if (isDynamicParallelStep(step)) {
    return step.collect?.as ? [step.collect.as] : [];
  }
  return (step as SequentialStep).as ? [(step as SequentialStep).as!] : [];
}

function getTemplateStrings(step: ChainStep): string[] {
  if (isParallelStep(step)) {
    return step.parallel.map((t) => t.task).filter((t): t is string => !!t);
  }
  if (isDynamicParallelStep(step)) {
    return step.parallel.task ? [step.parallel.task] : [];
  }
  return (step as SequentialStep).task ? [(step as SequentialStep).task!] : [];
}

export function validateChainOutputBindings(steps: ChainStep[]): void {
  const available = new Set<string>();
  const seen = new Set<string>();

  for (const step of steps) {
    // Validate references in task templates
    for (const template of getTemplateStrings(step)) {
      for (const match of template.matchAll(OUTPUT_REF_PATTERN)) {
        const name = match[1]!;
        if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
          throw new ChainOutputValidationError(
            `Invalid chain output reference '{outputs.${name}}': name must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
          );
        }
        if (!available.has(name)) {
          throw new ChainOutputValidationError(
            `Unknown chain output reference '{outputs.${name}}'. Available: ${[...available].join(", ") || "(none)"}`,
          );
        }
      }
    }

    // Validate and register output names from this step
    for (const name of getOutputNames(step)) {
      if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
        throw new ChainOutputValidationError(
          `Invalid chain output name '${name}': must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
        );
      }
      if (seen.has(name)) {
        throw new ChainOutputValidationError(
          `Duplicate chain output name '${name}'.`,
        );
      }
      seen.add(name);
      available.add(name);
    }
  }
}

export function resolveOutputReferences(
  template: string,
  outputs: ChainOutputMap,
): string {
  return template.replace(OUTPUT_REF_PATTERN, (raw, name: string) => {
    if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
      throw new ChainOutputValidationError(
        `Invalid chain output reference '${raw}'.`,
      );
    }
    const entry = outputs[name];
    if (!entry) {
      throw new ChainOutputValidationError(
        `Unknown chain output reference '${raw}'.`,
      );
    }
    return entry.text;
  });
}

export function outputEntryFromResult(
  agent: string,
  text: string,
  stepIndex: number,
  structured?: unknown,
): ChainOutputMapEntry {
  return { text, structured, agent, stepIndex };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-outputs.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-outputs.ts tests/chain-outputs.test.ts
git commit -m "feat(chain-outputs): add output binding validation and reference resolution"
```

---

## Phase 2: Chain Settings

Pure functions for type guards, template resolution, behavior resolution, and chain instruction building. No runtime deps.

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

---

## Phase 3: Chain Serializer

Parse and serialize `.chain.md` and `.chain.json` files.

### Task 4: Create `src/core/chain-serializer.ts`

**Files:**

- Create: `src/core/chain-serializer.ts`
- Test: `tests/chain-serializer.test.ts`

Port from: reference `src/agents/chain-serializer.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/chain-serializer.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  parseChain,
  parseJsonChain,
  serializeChain,
  serializeJsonChain,
} from "../src/core/chain-serializer.js";
import type { ChainConfig } from "../src/shared/types.js";

describe("parseChain (.chain.md)", () => {
  test("parses a simple 2-step chain", () => {
    const content = [
      "---",
      "name: scout-plan",
      "description: Scout then plan",
      "---",
      "",
      "## scout",
      "phase: Context",
      "label: Map codebase",
      "as: context",
      "",
      "Analyze {task}",
      "",
      "## planner",
      "phase: Planning",
      "reads: context.md",
      "",
      "Plan from {outputs.context}",
    ].join("\n");

    const config = parseChain("/tmp/scout-plan.chain.md", content);
    expect(config.name).toBe("scout-plan");
    expect(config.description).toBe("Scout then plan");
    expect(config.steps).toHaveLength(2);
    expect(config.steps[0]!.agent).toBe("scout");
    expect(config.steps[0]!.phase).toBe("Context");
    expect(config.steps[0]!.label).toBe("Map codebase");
    expect(config.steps[0]!.as).toBe("context");
    expect(config.steps[0]!.task).toBe("Analyze {task}");
    expect(config.steps[1]!.agent).toBe("planner");
    expect(config.steps[1]!.reads).toEqual(["context.md"]);
    expect(config.steps[1]!.task).toBe("Plan from {outputs.context}");
  });

  test("parses step with output and model", () => {
    const content = [
      "---",
      "name: test",
      "description: test chain",
      "---",
      "",
      "## worker",
      "output: result.md",
      "model: anthropic/claude-sonnet-4-5",
      "progress: true",
      "",
      "Do the work",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.output).toBe("result.md");
    expect(config.steps[0]!.model).toBe("anthropic/claude-sonnet-4-5");
    expect(config.steps[0]!.progress).toBe(true);
  });

  test("handles reads: false", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "reads: false",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.reads).toBe(false);
  });

  test("handles comma-separated reads", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "reads: file1.md, file2.md",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.reads).toEqual(["file1.md", "file2.md"]);
  });

  test("throws on missing frontmatter name", () => {
    const content = [
      "---",
      "description: no name",
      "---",
      "",
      "## a",
      "task text",
    ].join("\n");

    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow();
  });
});

describe("parseJsonChain (.chain.json)", () => {
  test("parses a simple sequential chain", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test chain",
      chain: [
        { agent: "scout", task: "scan", as: "ctx" },
        { agent: "worker", task: "build from {outputs.ctx}" },
      ],
    });

    const config = parseJsonChain("/tmp/test.chain.json", content);
    expect(config.name).toBe("test");
    expect(config.steps).toHaveLength(2);
    expect(config.steps[0]!.agent).toBe("scout");
    expect(config.steps[0]!.as).toBe("ctx");
  });

  test("parses chain with dynamic fanout", () => {
    const content = JSON.stringify({
      name: "dynamic",
      description: "dynamic chain",
      chain: [
        { agent: "scout", task: "find", as: "targets" },
        {
          expand: {
            from: { output: "targets", path: "/items" },
            item: "target",
            maxItems: 10,
          },
          parallel: { agent: "reviewer", task: "review {target.path}" },
          collect: { as: "reviews" },
          concurrency: 4,
        },
      ],
    });

    const config = parseJsonChain("/tmp/dynamic.chain.json", content);
    expect(config.steps).toHaveLength(2);
    expect(config.steps[1]!.expand).toBeDefined();
    expect(config.steps[1]!.collect).toEqual({ as: "reviews" });
  });

  test("throws on invalid JSON", () => {
    expect(() => parseJsonChain("/tmp/bad.chain.json", "not json")).toThrow();
  });

  test("throws on missing name", () => {
    expect(() =>
      parseJsonChain(
        "/tmp/bad.chain.json",
        JSON.stringify({ description: "no name", chain: [] }),
      ),
    ).toThrow();
  });
});

describe("serializeChain", () => {
  test("roundtrips a simple chain", () => {
    const original = parseChain(
      "/tmp/test.chain.md",
      [
        "---",
        "name: roundtrip",
        "description: test roundtrip",
        "---",
        "",
        "## scout",
        "as: ctx",
        "",
        "scan the code",
        "",
        "## worker",
        "",
        "do the work",
      ].join("\n"),
    );

    const serialized = serializeChain(original);
    const reparsed = parseChain("/tmp/test.chain.md", serialized);
    expect(reparsed.name).toBe(original.name);
    expect(reparsed.steps.length).toBe(original.steps.length);
    expect(reparsed.steps[0]!.agent).toBe(original.steps[0]!.agent);
    expect(reparsed.steps[0]!.as).toBe(original.steps[0]!.as);
  });
});

describe("serializeJsonChain", () => {
  test("roundtrips a JSON chain", () => {
    const original = parseJsonChain(
      "/tmp/test.chain.json",
      JSON.stringify({
        name: "roundtrip",
        description: "test",
        chain: [{ agent: "a", task: "t", as: "out" }],
      }),
    );

    const serialized = serializeJsonChain(original);
    const reparsed = parseJsonChain("/tmp/test.chain.json", serialized);
    expect(reparsed.name).toBe(original.name);
    expect(reparsed.steps[0]!.agent).toBe("a");
    expect(reparsed.steps[0]!.as).toBe("out");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-serializer.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-serializer.ts`**

Create `src/core/chain-serializer.ts`. Port the parsing logic from reference `src/agents/chain-serializer.ts`, adapting to our types. Key patterns:

- Frontmatter parsed by splitting on `---` delimiters
- Step sections split by `## agent-name` regex: `/^##\s+(.+)[^\S\n]*$/gm`
- Step config lines: `/^([\w-]+):\s*(.*)$/` until first blank line
- Remaining text is the task template
- JSON chain validates structure and calls `validateChainOutputBindings`

```typescript
import { validateChainOutputBindings } from "./chain-outputs.js";
import type {
  ChainConfig,
  ChainStepConfig,
  ToolBudgetConfig,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// .chain.md parsing
// ---------------------------------------------------------------------------

interface Frontmatter {
  name?: string;
  description?: string;
  package?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(raw: string): Frontmatter {
  const result: Frontmatter = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (match) result[match[1]!] = match[2]!.trim();
  }
  return result;
}

function parseStepConfig(lines: string[]): {
  config: Partial<ChainStepConfig>;
  taskStart: number;
} {
  const config: Partial<ChainStepConfig> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") break;
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) break;
    const key = match[1]!.toLowerCase();
    const val = match[2]!.trim();
    switch (key) {
      case "output":
        config.output = val === "false" ? false : val;
        break;
      case "outputmode":
        if (val === "inline" || val === "file-only") config.outputMode = val;
        break;
      case "phase":
        config.phase = val;
        break;
      case "label":
        config.label = val;
        break;
      case "as":
        config.as = val;
        break;
      case "reads":
        config.reads =
          val === "false"
            ? false
            : val
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        break;
      case "model":
        config.model = val || undefined;
        break;
      case "skills":
        config.skills =
          val === "false"
            ? false
            : val
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        break;
      case "progress":
        config.progress = val !== "false";
        break;
      case "toolbudget":
        try {
          config.toolBudget = JSON.parse(val) as ToolBudgetConfig;
        } catch {
          // ignore invalid JSON
        }
        break;
      case "outputschema":
        config.outputSchema = val;
        break;
    }
  }
  return { config, taskStart: i };
}

export function parseChain(filePath: string, content: string): ChainConfig {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error(`${filePath}: missing frontmatter`);

  const fm = parseFrontmatter(fmMatch[1]!);
  if (!fm.name) throw new Error(`${filePath}: frontmatter missing 'name'`);

  const body = content.slice(fmMatch[0].length);
  const stepMatches = [...body.matchAll(/^##\s+(.+)[^\S\n]*$/gm)];
  if (stepMatches.length === 0) {
    throw new Error(`${filePath}: no step headings (## agent-name) found`);
  }

  const steps: ChainStepConfig[] = [];
  for (let i = 0; i < stepMatches.length; i++) {
    const match = stepMatches[i]!;
    const agentName = match[1]!.trim();
    const start = match.index! + match[0].length;
    const end =
      i + 1 < stepMatches.length ? stepMatches[i + 1]!.index! : body.length;
    const sectionText = body.slice(start, end).replace(/^\n+/, "");
    const sectionLines = sectionText.split("\n");

    const { config, taskStart } = parseStepConfig(sectionLines);
    const task = sectionLines.slice(taskStart).join("\n").trim();

    steps.push({
      agent: agentName,
      ...(task ? { task } : {}),
      ...config,
    });
  }

  const { name, description, package: pkg, ...extra } = fm;
  const extraFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) extraFields[k] = v;
  }

  return {
    name: name!,
    description: description ?? "",
    packageName: pkg,
    filePath,
    steps,
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// .chain.json parsing
// ---------------------------------------------------------------------------

export function parseJsonChain(filePath: string, content: string): ChainConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(`${filePath}: invalid JSON — ${(e as Error).message}`);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${filePath}: root must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error(`${filePath}: missing required 'name' field`);
  }
  if (typeof obj.description !== "string") {
    throw new Error(`${filePath}: missing required 'description' field`);
  }
  if (!Array.isArray(obj.chain)) {
    throw new Error(`${filePath}: missing required 'chain' array`);
  }

  const steps = obj.chain as ChainStepConfig[];

  // Validate output bindings across the chain
  validateChainOutputBindings(steps as unknown[]);

  return {
    name: obj.name as string,
    description: obj.description as string,
    packageName: obj.package as string | undefined,
    filePath,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeChain(config: ChainConfig): string {
  const lines: string[] = ["---", `name: ${config.name}`];
  if (config.description) lines.push(`description: ${config.description}`);
  if (config.packageName) lines.push(`package: ${config.packageName}`);
  if (config.extraFields) {
    for (const [k, v] of Object.entries(config.extraFields)) {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");

  for (const step of config.steps) {
    lines.push(`## ${step.agent}`);
    if (step.phase) lines.push(`phase: ${step.phase}`);
    if (step.label) lines.push(`label: ${step.label}`);
    if (step.as) lines.push(`as: ${step.as}`);
    if (step.output !== undefined) {
      lines.push(`output: ${step.output === false ? "false" : step.output}`);
    }
    if (step.outputMode) lines.push(`outputMode: ${step.outputMode}`);
    if (step.reads !== undefined) {
      lines.push(
        `reads: ${step.reads === false ? "false" : (step.reads as string[]).join(", ")}`,
      );
    }
    if (step.model) lines.push(`model: ${step.model}`);
    if (step.skills !== undefined) {
      lines.push(
        `skills: ${step.skills === false ? "false" : (step.skills as string[]).join(", ")}`,
      );
    }
    if (step.progress !== undefined) lines.push(`progress: ${step.progress}`);
    if (step.toolBudget)
      lines.push(`toolBudget: ${JSON.stringify(step.toolBudget)}`);
    lines.push("");
    if (step.task) lines.push(step.task);
    lines.push("");
  }

  return lines.join("\n");
}

export function serializeJsonChain(config: ChainConfig): string {
  return JSON.stringify(
    {
      name: config.name,
      description: config.description,
      ...(config.packageName ? { package: config.packageName } : {}),
      chain: config.steps,
    },
    null,
    2,
  );
}
```

Note: `ChainStepConfig` and `ChainStep` are structurally compatible for the fields `validateChainOutputBindings` inspects (`as`, `task`, `parallel`, `expand`, `collect`). The cast `steps as unknown as ChainStep[]` is safe here. If TypeScript complains, adjust the validation function to accept `ReadonlyArray<{as?: string; task?: string; parallel?: unknown; expand?: unknown; collect?: unknown}>` instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-serializer.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-serializer.ts tests/chain-serializer.test.ts
git commit -m "feat(chain-serializer): parse and serialize .chain.md and .chain.json"
```

---

## Phase 4: Chain Append

In-memory queue for async chain step appending.

### Task 5: Create `src/core/chain-append.ts`

**Files:**

- Create: `src/core/chain-append.ts`
- Test: `tests/chain-append.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/chain-append.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "vitest";
import {
  enqueueChainAppendRequest,
  consumeChainAppendRequests,
  countPendingChainAppendRequests,
  resetAppendQueues,
} from "../src/core/chain-append.js";
import type { ChainStep } from "../src/shared/types.js";

afterEach(() => {
  resetAppendQueues();
});

describe("chain append queue", () => {
  test("enqueue and consume returns steps", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "t" }];
    enqueueChainAppendRequest("chain-1", steps);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(1);
    expect(consumed[0]!.agent).toBe("a");
  });

  test("consume clears the queue", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    consumeChainAppendRequests("chain-1");

    const second = consumeChainAppendRequests("chain-1");
    expect(second).toHaveLength(0);
  });

  test("multiple enqueues accumulate", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "1" }]);
    enqueueChainAppendRequest("chain-1", [{ agent: "b", task: "2" }]);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(2);
  });

  test("countPendingChainAppendRequests returns correct count", () => {
    expect(countPendingChainAppendRequests("chain-1")).toBe(0);
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    expect(countPendingChainAppendRequests("chain-1")).toBe(1);
    enqueueChainAppendRequest("chain-1", [{ agent: "b", task: "t" }]);
    expect(countPendingChainAppendRequests("chain-1")).toBe(2);
  });

  test("different chain IDs are independent", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    enqueueChainAppendRequest("chain-2", [{ agent: "b", task: "t" }]);

    expect(consumeChainAppendRequests("chain-1")).toHaveLength(1);
    expect(consumeChainAppendRequests("chain-2")).toHaveLength(1);
  });

  test("consume for unknown chain returns empty array", () => {
    expect(consumeChainAppendRequests("nonexistent")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-append.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-append.ts`**

Create `src/core/chain-append.ts`:

```typescript
import type { ChainStep } from "../shared/types.js";

const pendingQueues = new Map<string, ChainStep[][]>();

export function enqueueChainAppendRequest(
  chainId: string,
  steps: ChainStep[],
): void {
  let queue = pendingQueues.get(chainId);
  if (!queue) {
    queue = [];
    pendingQueues.set(chainId, queue);
  }
  queue.push(steps);
}

export function consumeChainAppendRequests(chainId: string): ChainStep[] {
  const queue = pendingQueues.get(chainId);
  if (!queue || queue.length === 0) return [];
  const all = queue.flat();
  queue.length = 0;
  return all;
}

export function countPendingChainAppendRequests(chainId: string): number {
  return pendingQueues.get(chainId)?.length ?? 0;
}

export function resetAppendQueues(): void {
  pendingQueues.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-append.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/chain-append.ts tests/chain-append.test.ts
git commit -m "feat(chain-append): add in-memory queue for async chain step appending"
```

---

## Phase 5: Chain Discovery

Extend paths and agent discovery to find chain files.

### Task 6: Extend paths and add `discoverChains()`

**Files:**

- Modify: `src/shared/types.ts` (add chain paths to `ResolvedPaths`)
- Modify: `src/core/paths.ts` (add chain directory resolution)
- Modify: `src/core/agents.ts` (add `discoverChains()`)
- Test: `tests/agents.test.ts` (add chain discovery tests, or create a new test file)

- [ ] **Step 1: Add chain directory fields to `ResolvedPaths`**

In `src/shared/types.ts`, add to the `ResolvedPaths` interface:

```typescript
export interface ResolvedPaths {
  agentDir: string;
  configPath: string;
  userAgentsDir: string;
  bundledAgentsDir: string;
  sessionsDir: string;
  // Chain directories
  userChainsDir: string;
  bundledChainsDir: string;
}
```

Note: Project chain directory (`.pi/chains/` from cwd) is NOT part of `ResolvedPaths` because it depends on the working directory at call time — just like `.pi/skills/` and `.pi/subagents.json`. It's resolved dynamically in `discoverChains()`.

- [ ] **Step 2: Update `src/core/paths.ts`**

Add chain directory resolution:

```typescript
export function getBundledChainsDir(): string {
  return resolve(currentDir, "../../chains");
}

export function resolvePaths(agentDir = getAgentDir()): ResolvedPaths {
  return {
    agentDir,
    configPath: join(agentDir, "extensions", "subagents.json"),
    userAgentsDir: join(agentDir, "agents"),
    bundledAgentsDir: getBundledAgentsDir(),
    sessionsDir: join(agentDir, "sessions"),
    userChainsDir: join(agentDir, "chains"),
    bundledChainsDir: getBundledChainsDir(),
  };
}
```

- [ ] **Step 3: Run typecheck to find any breakage from ResolvedPaths change**

Run: `pnpm typecheck`
Expected: PASS (or fix any callers that destructure ResolvedPaths — the new fields are additive so should be fine)

- [ ] **Step 4: Add `discoverChains()` to `src/core/agents.ts`**

Add at the end of the file:

```typescript
import { parseChain, parseJsonChain } from "./chain-serializer.js";
import type {
  ChainConfig,
  ChainDiscoveryDiagnostic,
  ChainDiscoveryResult,
} from "../shared/types.js";

function discoverChainsFromDirectory(directory: string): {
  chains: ChainConfig[];
  diagnostics: ChainDiscoveryDiagnostic[];
} {
  if (!existsSync(directory)) return { chains: [], diagnostics: [] };

  const chains: ChainConfig[] = [];
  const diagnostics: ChainDiscoveryDiagnostic[] = [];
  const fileNames = readdirSync(directory)
    .filter((f) => f.endsWith(".chain.md") || f.endsWith(".chain.json"))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of fileNames) {
    const filePath = resolve(directory, fileName);
    try {
      const content = readFileSync(filePath, "utf8");
      const config = fileName.endsWith(".chain.json")
        ? parseJsonChain(filePath, content)
        : parseChain(filePath, content);
      chains.push(config);
    } catch (e) {
      diagnostics.push({
        filePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { chains, diagnostics };
}

export function discoverChains(
  paths: ResolvedPaths,
  cwd?: string,
): ChainDiscoveryResult {
  // Priority: project > user > bundled (higher priority = inserted first, wins on conflict)
  const projectChainsDir = cwd ? join(cwd, ".pi", "chains") : undefined;
  const projectResult = projectChainsDir
    ? discoverChainsFromDirectory(projectChainsDir)
    : { chains: [], diagnostics: [] };
  const userResult = discoverChainsFromDirectory(paths.userChainsDir);
  const bundledResult = discoverChainsFromDirectory(paths.bundledChainsDir);
  const chainsByName = new Map<string, ChainConfig>();
  const diagnostics = [
    ...projectResult.diagnostics,
    ...userResult.diagnostics,
    ...bundledResult.diagnostics,
  ];

  // Insert in priority order: project first, then user, then bundled
  const allChains = [
    ...projectResult.chains,
    ...userResult.chains,
    ...bundledResult.chains,
  ];

  for (const chain of allChains) {
    const key = chain.name.toLowerCase();
    if (chainsByName.has(key)) {
      diagnostics.push({
        filePath: chain.filePath,
        error: `duplicate chain name "${chain.name}" skipped; higher-priority scope wins`,
      });
      continue;
    }
    chainsByName.set(key, chain);
  }

  return {
    chains: [...chainsByName.values()],
    diagnostics,
  };
}
```

- [ ] **Step 5: Write test for chain discovery**

Add to a new file `tests/chain-discovery.test.ts` (or append to `tests/agents.test.ts` — check existing test patterns):

```typescript
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverChains } from "../src/core/agents.js";
import type { ResolvedPaths } from "../src/shared/types.js";

function makeTmpPaths(): ResolvedPaths & { tmpDir: string } {
  const tmpDir = join(tmpdir(), `chain-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const userChainsDir = join(tmpDir, "user-chains");
  const bundledChainsDir = join(tmpDir, "bundled-chains");
  mkdirSync(userChainsDir, { recursive: true });
  mkdirSync(bundledChainsDir, { recursive: true });
  return {
    agentDir: tmpDir,
    configPath: join(tmpDir, "config.json"),
    userAgentsDir: join(tmpDir, "user-agents"),
    bundledAgentsDir: join(tmpDir, "bundled-agents"),
    sessionsDir: join(tmpDir, "sessions"),
    userChainsDir,
    bundledChainsDir,
    tmpDir,
  };
}

describe("discoverChains", () => {
  test("discovers .chain.md files from bundled dir", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "scout-plan.chain.md"),
      "---\nname: scout-plan\ndescription: test\n---\n\n## scout\n\nscan\n",
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.name).toBe("scout-plan");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("user chains shadow bundled chains", () => {
    const paths = makeTmpPaths();
    writeFileSync(
      join(paths.bundledChainsDir, "test.chain.md"),
      "---\nname: test\ndescription: bundled\n---\n\n## a\n\ntask\n",
    );
    writeFileSync(
      join(paths.userChainsDir, "test.chain.md"),
      "---\nname: test\ndescription: user\n---\n\n## b\n\ntask\n",
    );

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.description).toBe("user");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("project chains shadow user chains", () => {
    const paths = makeTmpPaths();
    // Create project .pi/chains/ dir
    const projectChainsDir = join(paths.tmpDir, ".pi", "chains");
    mkdirSync(projectChainsDir, { recursive: true });
    writeFileSync(
      join(paths.userChainsDir, "test.chain.md"),
      "---\nname: test\ndescription: user\n---\n\n## a\n\ntask\n",
    );
    writeFileSync(
      join(projectChainsDir, "test.chain.md"),
      "---\nname: test\ndescription: project\n---\n\n## b\n\ntask\n",
    );

    const result = discoverChains(paths, paths.tmpDir);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.description).toBe("project");

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });

  test("returns empty when directories don't exist", () => {
    const paths = makeTmpPaths();
    rmSync(paths.userChainsDir, { recursive: true });
    rmSync(paths.bundledChainsDir, { recursive: true });

    const result = discoverChains(paths);
    expect(result.chains).toHaveLength(0);

    rmSync(paths.tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/chain-discovery.test.ts`
Expected: PASS

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/core/paths.ts src/core/agents.ts tests/chain-discovery.test.ts
git commit -m "feat(chain-discovery): discover .chain.md and .chain.json from user/bundled dirs"
```

---

## Phase 6: Chain Execution Engine

The core orchestrator. This is the largest task — port the step loop from the reference `src/runs/foreground/chain-execution.ts`.

### Task 7: Create `src/core/chain-execution.ts`

**Files:**

- Create: `src/core/chain-execution.ts`
- Test: `tests/chain-execution.test.ts`

Port from: reference `src/runs/foreground/chain-execution.ts`

This task is large. The implementation should be ported methodically from the reference, adapting to our project's `AgentManager.spawnAndWait()` for step execution. Consult the reference file directly during implementation.

- [ ] **Step 1: Write the integration test file with sequential chain tests**

Create `tests/chain-execution.test.ts`. The tests mock `AgentManager.spawnAndWait()` to avoid needing real agent sessions:

```typescript
import { describe, expect, test, vi } from "vitest";
import { executeChain } from "../src/core/chain-execution.js";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  WorkflowGraphSnapshot,
} from "../src/shared/types.js";

// Minimal mock deps
function makeMockDeps(stepResults: Array<{ result: string; status?: string }>) {
  let callIndex = 0;
  const spawnAndWait = vi.fn(async () => {
    const r = stepResults[callIndex++] ?? { result: "(no output)" };
    const record: Partial<AgentRecord> = {
      id: `agent-${callIndex}`,
      type: "mock",
      status: (r.status as AgentRecord["status"]) ?? "completed",
      result: r.result,
      error: r.status === "error" ? r.result : undefined,
      toolUses: 0,
      turnCount: 1,
      startedAt: Date.now(),
      completedAt: Date.now(),
      durationMs: 100,
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    };
    return { id: record.id, record: record as AgentRecord };
  });

  const findAgent = vi.fn(
    (name: string): AgentDefinition => ({
      name,
      description: `mock ${name}`,
      tools: [],
      subagentAgents: [],
      systemPrompt: "You are a test agent.",
      sourcePath: "/mock",
    }),
  );

  return { spawnAndWait, findAgent };
}

describe("executeChain — sequential", () => {
  test("runs 2 sequential steps and passes {previous}", async () => {
    const mockDeps = makeMockDeps([
      { result: "step 1 output" },
      { result: "step 2 output" },
    ]);

    const steps: ChainStep[] = [
      { agent: "scout", task: "Analyze {task}" },
      { agent: "planner", task: "Plan from {previous}" },
    ];

    const result = await executeChain({
      steps,
      task: "build auth",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);

    // First step should have {task} replaced
    const firstCall = mockDeps.spawnAndWait.mock.calls[0]!;
    expect(firstCall[1]).toContain("build auth");

    // Second step should have {previous} replaced with step 1 output
    const secondCall = mockDeps.spawnAndWait.mock.calls[1]!;
    expect(secondCall[1]).toContain("step 1 output");
  });

  test("stores named output via 'as' and resolves {outputs.name}", async () => {
    const mockDeps = makeMockDeps([
      { result: "context data" },
      { result: "plan output" },
    ]);

    const steps: ChainStep[] = [
      { agent: "scout", task: "scan", as: "context" },
      { agent: "planner", task: "use {outputs.context}" },
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(false);
    const secondCall = mockDeps.spawnAndWait.mock.calls[1]!;
    expect(secondCall[1]).toContain("context data");
  });

  test("aborts chain on step failure", async () => {
    const mockDeps = makeMockDeps([
      { result: "error msg", status: "error" },
      { result: "should not run" },
    ]);

    const steps: ChainStep[] = [
      { agent: "a", task: "fail" },
      { agent: "b", task: "continue" },
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(true);
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-execution.ts` — the core orchestrator**

Create `src/core/chain-execution.ts`. This is the largest file. The implementation should be ported from the reference `src/runs/foreground/chain-execution.ts`, adapting the execution calls to use our project's pattern.

The core structure:

```typescript
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  ChainOutputMap,
  SequentialStep,
  ParallelStep,
  DynamicParallelStep,
  WorkflowGraphSnapshot,
  WorkflowGraphNode,
} from "../shared/types.js";
import {
  isParallelStep,
  isDynamicParallelStep,
  resolveChainTemplates,
  resolveStepBehavior,
  buildChainInstructions,
  createChainDir,
} from "./chain-settings.js";
import {
  validateChainOutputBindings,
  resolveOutputReferences,
  outputEntryFromResult,
} from "./chain-outputs.js";
import { consumeChainAppendRequests } from "./chain-append.js";

export interface ChainExecutionParams {
  steps: ChainStep[];
  task: string;
  spawnAndWait: (
    agentDef: AgentDefinition,
    prompt: string,
    cwd: string,
  ) => Promise<{ id: string; record: AgentRecord }>;
  findAgent: (name: string) => AgentDefinition;
  cwd: string;
  runId: string;
  chainDir?: string;
  signal?: AbortSignal;
  onGraphUpdate?: (snapshot: WorkflowGraphSnapshot) => void;
  isAsync?: boolean;
}

export interface ChainExecutionResult {
  content: string;
  isError: boolean;
  workflowGraph?: WorkflowGraphSnapshot;
}

export async function executeChain(
  params: ChainExecutionParams,
): Promise<ChainExecutionResult> {
  const { steps, task, spawnAndWait, findAgent, cwd, runId, signal } = params;

  // 1. Validate output bindings
  validateChainOutputBindings(steps);

  // 2. Resolve templates
  const templates = resolveChainTemplates(steps);

  // 3. Create chain directory
  const chainDir = params.chainDir ?? createChainDir(runId);

  // 4. Step loop
  const outputs: ChainOutputMap = {};
  let prev = "";
  const results: Array<{ agent: string; output: string; status: string }> = [];
  const chainSteps = [...steps];

  for (let stepIndex = 0; stepIndex < chainSteps.length; stepIndex++) {
    if (signal?.aborted) break;

    const step = chainSteps[stepIndex]!;
    const template = templates[stepIndex];

    if (isParallelStep(step)) {
      // --- Parallel step ---
      const taskTemplates = template as string[];
      const taskOutputs: string[] = [];

      // Execute parallel items concurrently
      const promises = step.parallel.map(async (item, i) => {
        const agentDef = findAgent(item.agent);
        let taskStr = taskTemplates[i] ?? "{previous}";
        taskStr = taskStr
          .replace(/\{task\}/g, task)
          .replace(/\{previous\}/g, prev)
          .replace(/\{chain_dir\}/g, chainDir);
        taskStr = resolveOutputReferences(taskStr, outputs);

        const { record } = await spawnAndWait(agentDef, taskStr, cwd);
        const output = record.result ?? "";
        if (item.as) {
          outputs[item.as] = outputEntryFromResult(
            item.agent,
            output,
            stepIndex,
          );
        }
        return { output, status: record.status, agent: item.agent };
      });

      const parallelResults = await Promise.all(promises);

      // Check for failures
      const failed = parallelResults.filter((r) => r.status === "error");
      if (step.failFast && failed.length > 0) {
        return {
          content: `Chain failed at parallel step ${stepIndex + 1}: ${failed[0]!.output}`,
          isError: true,
        };
      }

      prev = parallelResults.map((r) => r.output).join("\n---\n");
      for (const r of parallelResults) {
        results.push({ agent: r.agent, output: r.output, status: r.status });
      }
    } else if (isDynamicParallelStep(step)) {
      // --- Dynamic parallel step ---
      const sourceEntry = outputs[step.expand.from.output];
      if (!sourceEntry?.structured) {
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: no structured output from '${step.expand.from.output}'`,
          isError: true,
        };
      }

      // JSON pointer resolution
      const pathParts = step.expand.from.path.split("/").filter(Boolean);
      let items: unknown = sourceEntry.structured;
      for (const part of pathParts) {
        if (items && typeof items === "object") {
          items = (items as Record<string, unknown>)[part];
        }
      }
      if (!Array.isArray(items)) {
        if (step.expand.onEmpty === "skip") {
          prev = "";
          continue;
        }
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: expanded items is not an array`,
          isError: true,
        };
      }
      if (items.length === 0 && step.expand.onEmpty === "skip") {
        prev = "";
        continue;
      }
      if (step.expand.maxItems && items.length > step.expand.maxItems) {
        items = items.slice(0, step.expand.maxItems);
      }

      const dynamicResults = await Promise.all(
        (items as unknown[]).map(async (item) => {
          const agentDef = findAgent(step.parallel.agent);
          let taskStr = step.parallel.task ?? "{previous}";
          // Replace item template variables
          const itemName = step.expand.item ?? "item";
          if (item && typeof item === "object") {
            for (const [k, v] of Object.entries(
              item as Record<string, unknown>,
            )) {
              taskStr = taskStr.replace(
                new RegExp(`\\{${itemName}\\.${k}\\}`, "g"),
                String(v),
              );
            }
          }
          taskStr = taskStr
            .replace(/\{task\}/g, task)
            .replace(/\{previous\}/g, prev)
            .replace(/\{chain_dir\}/g, chainDir);
          taskStr = resolveOutputReferences(taskStr, outputs);

          const { record } = await spawnAndWait(agentDef, taskStr, cwd);
          return { output: record.result ?? "", status: record.status };
        }),
      );

      const collectedOutput = dynamicResults
        .map((r) => r.output)
        .join("\n---\n");
      outputs[step.collect.as] = outputEntryFromResult(
        step.parallel.agent,
        collectedOutput,
        stepIndex,
      );
      prev = collectedOutput;
    } else {
      // --- Sequential step ---
      const seqStep = step as SequentialStep;
      const agentDef = findAgent(seqStep.agent);

      let taskStr = (template as string) ?? "{task}";
      taskStr = taskStr
        .replace(/\{task\}/g, task)
        .replace(/\{previous\}/g, prev)
        .replace(/\{chain_dir\}/g, chainDir);
      taskStr = resolveOutputReferences(taskStr, outputs);

      const { record } = await spawnAndWait(agentDef, taskStr, cwd);
      const output = record.result ?? "";

      if (record.status === "error") {
        return {
          content: `Chain failed at step ${stepIndex + 1} (${seqStep.agent}): ${record.error ?? output}`,
          isError: true,
        };
      }

      if (seqStep.as) {
        outputs[seqStep.as] = outputEntryFromResult(
          seqStep.agent,
          output,
          stepIndex,
        );
      }
      prev = output;
      results.push({ agent: seqStep.agent, output, status: record.status });
    }

    // Check for appended steps (async chains)
    if (params.isAsync) {
      const appended = consumeChainAppendRequests(runId);
      if (appended.length > 0) {
        chainSteps.push(...appended);
        templates.push(...resolveChainTemplates(appended));
      }
    }
  }

  // 5. Build summary
  const summary = results
    .map((r) => `[${r.agent}] ${r.output.slice(0, 200)}`)
    .join("\n\n");

  return {
    content: prev || summary,
    isError: false,
  };
}
```

**What's included:** Sequential, parallel, and dynamic-parallel step dispatch; template variable resolution (`{task}`, `{previous}`, `{chain_dir}`, `{outputs.name}`); named outputs; error handling (sequential abort, parallel fail-fast); dynamic fanout item expansion; async chain append integration.

**Not included in this initial implementation** (can be added in follow-up tasks):

- `WorkflowGraphSnapshot` building (call `onGraphUpdate` callback after each step — add helper `buildWorkflowGraphSnapshot()` in this file, see reference `src/runs/shared/workflow-graph.ts`)
- Concurrency limiting for parallel steps (wrap in a semaphore respecting `step.concurrency`)
- Worktree support for parallel steps (call `createWorktree()` per item when `step.worktree` is true)
- `buildChainInstructions()` integration (inject read/write/progress prefix/suffix into task strings)

Each of these is a self-contained addition to the step loop. The core flow is complete and testable without them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-execution.ts tests/chain-execution.test.ts
git commit -m "feat(chain-execution): add core chain execution orchestrator"
```

---

## Phase 7: Tool Schema & Subagent Integration

Wire chain execution into the `subagent` tool.

### Task 8: Extend `subagent.ts` with chain mode

**Files:**

- Modify: `src/core/subagent.ts`
- Modify: `src/shared/runtime-deps.ts`

- [ ] **Step 1: Add `discoverChains` to RuntimeDeps**

In `src/shared/runtime-deps.ts`, add the import and field:

```typescript
import type { ChainDiscoveryResult } from "./types.js";

// Add to RuntimeDeps interface:
  discoverChains?: (paths: ResolvedPaths) => ChainDiscoveryResult;
```

- [ ] **Step 2: Add `chain` and `chain_append` to `SUBAGENT_TOOL_PARAMETERS`**

In `src/core/subagent.ts`, add to the TypeBox schema (after the existing `tool_budget` parameter):

```typescript
chain: Type.Optional(
  Type.Array(
    Type.Object({
      agent: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      phase: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      as: Type.Optional(Type.String()),
      output: Type.Optional(Type.Union([Type.String(), Type.Literal(false)])),
      outputMode: Type.Optional(Type.String()),
      reads: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
      model: Type.Optional(Type.String()),
      skills: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
      progress: Type.Optional(Type.Boolean()),
      cwd: Type.Optional(Type.String()),
      parallel: Type.Optional(Type.Array(Type.Any())),
      concurrency: Type.Optional(Type.Number()),
      failFast: Type.Optional(Type.Boolean()),
      worktree: Type.Optional(Type.Boolean()),
      expand: Type.Optional(Type.Any()),
      collect: Type.Optional(Type.Any()),
    }),
    { description: "Chain execution: sequential/parallel steps" },
  ),
),
chain_append: Type.Optional(
  Type.Object({
    chain_id: Type.String({ description: "ID of running async chain" }),
    steps: Type.Array(Type.Any(), { description: "Steps to append" }),
  }),
),
```

- [ ] **Step 3: Make `agent` optional in schema (required only when `chain` absent)**

Change `agent` from `Type.String(...)` to `Type.Optional(Type.String(...))`. Add runtime validation at the top of `execute()`:

```typescript
// At the top of execute(), before the existing code:
if (params.chain) {
  // Chain mode — dispatch to executeChain
  const { executeChain } = await import("./chain-execution.js");
  const chainResult = await executeChain({
    steps: params.chain as ChainStep[],
    task: params.task ?? "",
    spawnAndWait: async (agentDef, prompt, stepCwd) => {
      return deps.manager.spawnAndWait(ctx, agentDef, {
        prompt,
        cwd: stepCwd || effectiveCwd,
        maxTurns: loadedConfig.config.defaultMaxTurns,
      });
    },
    findAgent: (name) => {
      const agent = findAgentByName(discovery, name);
      if (!agent) throw new Error(`Unknown agent: "${name}"`);
      return agent;
    },
    cwd: effectiveCwd,
    runId: `chain-${Date.now().toString(36)}`,
    signal,
  });
  const chainDetails: SubagentExecutionDetails = {
    status: chainResult.isError ? "error" : "completed",
    agent: "(chain)",
    task: params.task ?? "",
    sourcePath: "",
    cwd: effectiveCwd,
    maxTurns: 0,
    durationMs: 0,
    childSessionDir: "",
    childSessionPath: "",
    stopReason: chainResult.isError ? "error" : "completed",
    exitCode: null,
    stderr: chainResult.isError ? chainResult.content : "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      contextTokens: 0,
      cost: 0,
      turns: 0,
    },
    recentToolActivity: [],
  };
  return {
    content: [{ type: "text", text: chainResult.content }],
    isError: chainResult.isError,
    details: chainDetails,
  };
}

if (params.chain_append) {
  const { enqueueChainAppendRequest } = await import("./chain-append.js");
  enqueueChainAppendRequest(
    params.chain_append.chain_id,
    params.chain_append.steps as ChainStep[],
  );
  return {
    content: [
      {
        type: "text",
        text: `Steps appended to chain ${params.chain_append.chain_id}.`,
      },
    ],
    isError: false,
    details: {
      status: "completed" as const,
      agent: "(chain-append)",
      task: `append to ${params.chain_append.chain_id}`,
      sourcePath: "",
      cwd: effectiveCwd,
      maxTurns: 0,
      durationMs: 0,
      childSessionDir: "",
      childSessionPath: "",
      stopReason: "completed",
      exitCode: null,
      stderr: "",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 0,
        cost: 0,
        turns: 0,
      },
      recentToolActivity: [],
    },
  };
}

if (!params.agent) {
  return {
    content: [
      {
        type: "text",
        text: "Missing 'agent'. Provide 'agent' for single mode or 'chain' for chain mode.",
      },
    ],
    isError: true,
    details: {
      status: "error" as const,
      agent: "",
      task: params.task ?? "",
      sourcePath: "",
      cwd: effectiveCwd,
      maxTurns: 0,
      durationMs: 0,
      childSessionDir: "",
      childSessionPath: "",
      stopReason: "error",
      exitCode: null,
      stderr: "Missing agent",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 0,
        cost: 0,
        turns: 0,
      },
      recentToolActivity: [],
    },
  };
}
```

- [ ] **Step 4: Update tool description**

Update the `description` field in `registerSubagentTool` to mention chain mode:

```typescript
description: "Delegate a task to a discovered agent. Supports single agent, chain (sequential/parallel pipeline), and chain_append modes.",
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (fix any type errors)

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/subagent.ts src/shared/runtime-deps.ts
git commit -m "feat(subagent): add chain and chain_append modes to subagent tool"
```

---

## Phase 8: Slash Commands

### Task 9: Add `/chain` and `/run-chain` commands

**Files:**

- Modify: `src/index.ts`
- Create: `src/core/slash-chain.ts` (chain expression parser)
- Test: `tests/slash-chain.test.ts`

- [ ] **Step 1: Write failing tests for chain expression parser**

Create `tests/slash-chain.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { parseChainExpression } from "../src/core/slash-chain.js";

describe("parseChainExpression", () => {
  test("parses simple sequential chain", () => {
    const result = parseChainExpression(
      'scout "scan code" -> planner "make plan"',
    );
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toEqual({ agent: "scout", task: "scan code" });
    expect(result.steps[1]).toEqual({ agent: "planner", task: "make plan" });
  });

  test("parses parallel group", () => {
    const result = parseChainExpression(
      'scout "scan" -> (reviewer "auth" | reviewer "db") -> worker "fix"',
    );
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1]).toHaveProperty("parallel");
    const parallel = (result.steps[1] as { parallel: unknown[] }).parallel;
    expect(parallel).toHaveLength(2);
  });

  test("parses agent without quoted task", () => {
    const result = parseChainExpression("scout scan -> planner");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toEqual({ agent: "scout", task: "scan" });
  });

  test("handles single step (no arrow)", () => {
    const result = parseChainExpression('scout "just one step"');
    expect(result.steps).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `slash-chain.ts`**

Create `src/core/slash-chain.ts`:

```typescript
import type {
  ChainStep,
  SequentialStep,
  ParallelStep,
} from "../shared/types.js";

interface ParsedTask {
  agent: string;
  task?: string;
}

function parseTask(raw: string): ParsedTask {
  const trimmed = raw.trim();
  // Match: agent "task" or agent 'task' or agent task
  const quotedMatch = trimmed.match(/^(\S+)\s+["'](.+?)["']$/);
  if (quotedMatch) {
    return { agent: quotedMatch[1]!, task: quotedMatch[2]! };
  }
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { agent: trimmed };
  return {
    agent: trimmed.slice(0, spaceIdx),
    task: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export function parseChainExpression(input: string): {
  steps: ChainStep[];
  task?: string;
} {
  const segments = input.split(" -> ").map((s) => s.trim());
  const steps: ChainStep[] = [];

  for (const segment of segments) {
    // Check for parallel group: (agent1 "task" | agent2 "task")
    if (segment.startsWith("(") && segment.endsWith(")")) {
      const inner = segment.slice(1, -1);
      const items = inner.split(" | ").map((s) => parseTask(s.trim()));
      const parallel: ParallelStep = {
        parallel: items.map((item) => ({
          agent: item.agent,
          ...(item.task ? { task: item.task } : {}),
        })),
      };
      steps.push(parallel);
    } else {
      const parsed = parseTask(segment);
      const step: SequentialStep = {
        agent: parsed.agent,
        ...(parsed.task ? { task: parsed.task } : {}),
      };
      steps.push(step);
    }
  }

  // Extract task from first step for the chain's {task} variable
  const firstStep = steps[0] as SequentialStep | undefined;
  return { steps, task: firstStep?.task };
}

export function extractExecutionFlags(args: string): {
  args: string;
  bg: boolean;
  fork: boolean;
} {
  let bg = false;
  let fork = false;
  let cleaned = args;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: PASS

- [ ] **Step 5: Register `/chain` and `/run-chain` commands in `src/index.ts`**

Add imports and command registrations in `registerSubagentsExtension()`:

```typescript
import {
  parseChainExpression,
  extractExecutionFlags,
} from "./core/slash-chain.js";
import { discoverChains } from "./core/agents.js";
import { executeChain } from "./core/chain-execution.js";

// Inside registerSubagentsExtension(), after the agents command registration:
pi.registerCommand("chain", {
  description:
    'Run agents in sequence: /chain scout "task" -> planner [--bg] [--fork]',
  handler: async (args, ctx) => {
    const { args: cleanedArgs, bg } = extractExecutionFlags(args);
    const parsed = parseChainExpression(cleanedArgs);
    if (parsed.steps.length === 0) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: "No steps parsed.",
        display: true,
      });
      return;
    }
    // Execute via the subagent tool's chain mode
    const paths = deps.resolvePaths();
    const discovery = deps.discoverAgents(paths);
    const result = await executeChain({
      steps: parsed.steps,
      task: parsed.task ?? "",
      spawnAndWait: async (agentDef, prompt, stepCwd) => {
        return deps.manager.spawnAndWait(ctx, agentDef, {
          prompt,
          cwd: stepCwd || ctx.cwd,
          maxTurns: deps.loadConfig(paths).config.defaultMaxTurns,
        });
      },
      findAgent: (name) => {
        const agent = discovery.agents.find(
          (a) => a.name.toLowerCase() === name.toLowerCase(),
        );
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
  },
});

pi.registerCommand("run-chain", {
  description:
    "Run a saved chain: /run-chain chainName -- task [--bg] [--fork]",
  handler: async (args, ctx) => {
    const { args: cleanedArgs, bg } = extractExecutionFlags(args);
    const delimiterIndex = cleanedArgs.indexOf(" -- ");
    if (delimiterIndex === -1) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: "Usage: /run-chain <chainName> -- <task>",
        display: true,
      });
      return;
    }
    const chainName = cleanedArgs.slice(0, delimiterIndex).trim();
    const task = cleanedArgs.slice(delimiterIndex + 4).trim();
    if (!chainName || !task) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: "Usage: /run-chain <chainName> -- <task>",
        display: true,
      });
      return;
    }
    const paths = deps.resolvePaths();
    const chainDiscovery = discoverChains(paths, ctx.cwd);
    const chain = chainDiscovery.chains.find((c) => c.name === chainName);
    if (!chain) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: `Unknown chain: "${chainName}". Available: ${chainDiscovery.chains.map((c) => c.name).join(", ") || "(none)"}`,
        display: true,
      });
      return;
    }
    const discovery = deps.discoverAgents(paths);
    const result = await executeChain({
      steps: chain.steps as ChainStep[],
      task,
      spawnAndWait: async (agentDef, prompt, stepCwd) => {
        return deps.manager.spawnAndWait(ctx, agentDef, {
          prompt,
          cwd: stepCwd || ctx.cwd,
          maxTurns: deps.loadConfig(paths).config.defaultMaxTurns,
        });
      },
      findAgent: (name) => {
        const agent = discovery.agents.find(
          (a) => a.name.toLowerCase() === name.toLowerCase(),
        );
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
  },
});
```

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/slash-chain.ts tests/slash-chain.test.ts src/index.ts
git commit -m "feat(slash): add /chain and /run-chain commands with expression parser"
```

---

## Phase 9: TUI Chain Widget

### Task 10: Create `src/tui/chain-widget.ts`

**Files:**

- Create: `src/tui/chain-widget.ts`
- Modify: `src/shared/runtime-deps.ts` (add chainWidget type)
- Modify: `src/index.ts` (create and wire widget)

- [ ] **Step 1: Create the chain widget**

Create `src/tui/chain-widget.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type {
  WorkflowGraphSnapshot,
  WorkflowGraphNode,
  WorkflowNodeStatus,
} from "../shared/types.js";

export interface ChainWidget {
  update(snapshot: WorkflowGraphSnapshot): void;
  clear(): void;
  dispose(): void;
}

function statusIcon(status: WorkflowNodeStatus): string {
  switch (status) {
    case "completed":
      return "done";
    case "running":
      return "run ";
    case "failed":
      return "FAIL";
    case "skipped":
      return "skip";
    case "paused":
      return "paus";
    case "stopped":
      return "stop";
    default:
      return "wait";
  }
}

function renderNode(
  node: WorkflowGraphNode,
  total: number,
  index: number,
): string {
  const idx = `[${index + 1}/${total}]`;
  const label = node.label || node.agent || "step";
  const phase = node.phase ? ` (${node.phase})` : "";
  const line = `  ${idx} ${statusIcon(node.status)}  ${label}${phase}`;

  if (node.children && node.children.length > 0) {
    const childLines = node.children.map((child, i) => {
      const prefix = i === node.children!.length - 1 ? "    +- " : "    +- ";
      return `${prefix}${statusIcon(child.status)}  ${child.agent ?? "agent"}${child.label ? ` "${child.label}"` : ""}`;
    });
    return [line, ...childLines].join("\n");
  }

  return line;
}

export function createChainWidget(_pi: ExtensionAPI): ChainWidget {
  let currentSnapshot: WorkflowGraphSnapshot | null = null;

  return {
    update(snapshot: WorkflowGraphSnapshot) {
      currentSnapshot = snapshot;
      // TUI rendering is done through pi widget API — implementation depends on
      // how the existing agent-widget registers. For now, store the snapshot.
      // Full TUI rendering will be wired once the widget API pattern is confirmed.
    },
    clear() {
      currentSnapshot = null;
    },
    dispose() {
      currentSnapshot = null;
    },
  };
}

// Exported for testing — renders snapshot to a string
export function renderChainProgress(snapshot: WorkflowGraphSnapshot): string {
  if (snapshot.nodes.length === 0) return "";
  const lines = [`Chain: ${snapshot.runId}`];
  snapshot.nodes.forEach((node, i) => {
    lines.push(renderNode(node, snapshot.nodes.length, i));
  });
  return lines.join("\n");
}
```

- [ ] **Step 2: Add `ChainWidget` to `RuntimeDeps`**

In `src/shared/runtime-deps.ts`, add:

```typescript
import type { ChainWidget } from "../tui/chain-widget.js";

// Add to RuntimeDeps interface:
  chainWidget?: ChainWidget;
```

- [ ] **Step 3: Create and wire chain widget in `src/index.ts`**

In `createRuntimeDeps()`, after the fleet list creation:

```typescript
import { createChainWidget } from "./tui/chain-widget.js";

// After fleet creation:
const chainWidget = createChainWidget(pi);

// Add to deps object:
const deps: RuntimeDeps = {
  // ...existing fields...
  chainWidget,
};
```

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/chain-widget.ts src/shared/runtime-deps.ts src/index.ts
git commit -m "feat(tui): add chain widget for workflow graph display"
```

---

## Phase 10: Final Integration & Verification

### Task 11: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Verify no existing tests are broken**

Run: `pnpm vitest run`
Expected: All existing tests still pass alongside new chain tests.

- [ ] **Step 3: Review the diff**

Run: `git diff master --stat`
Verify: Only expected files changed. No unintended modifications to existing modules.

- [ ] **Step 4: Final commit if any integration fixes were needed**

```bash
git add -A
git commit -m "chore: integration fixes for chain execution"
```
