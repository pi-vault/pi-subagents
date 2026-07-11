# Chain Execution — Phase 1: Types & Chain Outputs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all chain execution type definitions and the chain-outputs module (validation, resolution, entry creation).

**Architecture:** Pure types added to `src/shared/types.ts`, pure functions in `src/core/chain-outputs.ts`. No runtime dependencies. Fully testable in isolation.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** None — this is the first phase.

---

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
