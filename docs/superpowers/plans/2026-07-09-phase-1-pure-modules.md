# Phase 1: Pure Modules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create two tested, dependency-free modules (`spawn-guard.ts`, `tool-budget.ts`) and add type foundations.

**Prerequisite:** None (first phase).

**Tech Stack:** TypeScript, Vitest, Biome

**Spec:** `docs/superpowers/specs/2026-07-08-spawn-limits-tool-budgets-design.md`

**Deliverable:** `npm run check` passes. Two new modules exist with ~35 unit tests. No integration yet.

---

### Task 1.1: Add types to `src/shared/types.ts`

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `ToolBudgetConfig` and `ResolvedToolBudget` interfaces**

After the `JoinMode` type at the top of the file, add:

```typescript
export interface ToolBudgetConfig {
  soft?: number;
  hard: number;
  block?: string[] | "*";
}

export interface ResolvedToolBudget {
  soft?: number;
  hard: number;
  block: string[] | "*";
}
```

- [ ] **Step 2: Add `maxSpawnsPerSession` to `SubagentsConfig`**

```typescript
export interface SubagentsConfig {
  maxConcurrency: number;
  maxRecursiveLevel: number;
  defaultMaxTurns: number;
  graceTurns: number;
  defaultJoinMode: JoinMode;
  maxSpawnsPerSession: number;
  toolBudget?: ToolBudgetConfig;
}
```

- [ ] **Step 3: Add `toolBudget` to `AgentDefinition`**

After `disallowedTools?: string[];`:

```typescript
  toolBudget?: ToolBudgetConfig;
```

- [ ] **Step 4: Add `tool_budget` to `SubagentToolInput`**

After `isolation?: string;`:

```typescript
  tool_budget?: ToolBudgetConfig;
```

- [ ] **Step 5: Add `toolBudget` to `RunOptions`**

After `onSessionCreated?`:

```typescript
  toolBudget?: ResolvedToolBudget;
```

- [ ] **Step 6: Add `toolBudget` to `SpawnOptions`**

After `onSessionCreated?`:

```typescript
  toolBudget?: ResolvedToolBudget;
```

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors (new fields are all optional, existing code doesn't reference them yet)

- [ ] **Step 8: Commit**

```
feat(types): add ToolBudgetConfig, ResolvedToolBudget, and spawn limit fields

- New interfaces: ToolBudgetConfig, ResolvedToolBudget
- New optional fields on SubagentsConfig, AgentDefinition,
  SubagentToolInput, RunOptions, SpawnOptions
```

---

### Task 1.2: Create `src/core/spawn-guard.ts` + tests

**Files:**

- Create: `src/core/spawn-guard.ts`
- Create: `tests/spawn-guard.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/spawn-guard.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_MAX_SPAWNS_PER_SESSION,
  checkSpawnLimit,
  resolveMaxSpawns,
} from "../src/core/spawn-guard.js";

describe("resolveMaxSpawns", () => {
  afterEach(() => {
    delete process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION;
  });

  test("returns default when no config and no env var", () => {
    expect(resolveMaxSpawns()).toBe(DEFAULT_MAX_SPAWNS_PER_SESSION);
  });

  test("returns config value when set and no env var", () => {
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("env var takes priority over config", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "5";
    expect(resolveMaxSpawns(20)).toBe(5);
  });

  test("falls back to config when env var is non-integer", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "3.5";
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("falls back to config when env var is negative", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "-1";
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("falls back to config when env var is empty", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "";
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("env var 0 is valid (blocks all spawns)", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "0";
    expect(resolveMaxSpawns(20)).toBe(0);
  });
});

describe("checkSpawnLimit", () => {
  test("allows spawn within limit", () => {
    expect(checkSpawnLimit(5, 1, 40)).toBeUndefined();
  });

  test("allows spawn at exactly max - 1", () => {
    expect(checkSpawnLimit(39, 1, 40)).toBeUndefined();
  });

  test("blocks spawn at max", () => {
    const error = checkSpawnLimit(40, 1, 40);
    expect(error).toBeTypeOf("string");
    expect(error).toContain("40/40");
  });

  test("blocks spawn over max", () => {
    const error = checkSpawnLimit(41, 1, 40);
    expect(error).toBeTypeOf("string");
  });

  test("handles batch requested > 1", () => {
    expect(checkSpawnLimit(38, 3, 40)).toBeTypeOf("string");
    expect(checkSpawnLimit(37, 3, 40)).toBeUndefined();
  });

  test("max 0 blocks all spawns", () => {
    const error = checkSpawnLimit(0, 1, 0);
    expect(error).toBeTypeOf("string");
    expect(error).toContain("0/0");
  });

  test("requested 0 always passes", () => {
    expect(checkSpawnLimit(100, 0, 40)).toBeUndefined();
  });

  test("error message includes counts", () => {
    const error = checkSpawnLimit(35, 2, 40);
    expect(error).toContain("35/40");
    expect(error).toContain("2 requested");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/spawn-guard.test.ts`
Expected: FAIL -- cannot resolve `../src/core/spawn-guard.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/spawn-guard.ts`:

```typescript
export const DEFAULT_MAX_SPAWNS_PER_SESSION = 40;

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
    return n;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0)
      return undefined;
    return value;
  }
  return undefined;
}

/**
 * Resolve effective spawn limit.
 * Priority: env var PI_SUBAGENT_MAX_SPAWNS_PER_SESSION > config > default.
 */
export function resolveMaxSpawns(configValue?: number): number {
  return (
    normalizeNonNegativeInteger(
      process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION,
    ) ??
    normalizeNonNegativeInteger(configValue) ??
    DEFAULT_MAX_SPAWNS_PER_SESSION
  );
}

/**
 * Check whether `requested` spawns are within budget.
 * Returns an error message string if blocked, undefined if allowed.
 */
export function checkSpawnLimit(
  currentCount: number,
  requested: number,
  max: number,
): string | undefined {
  if (requested <= 0) return undefined;
  if (currentCount + requested > max) {
    return (
      `Subagent spawn limit reached for this session (${currentCount}/${max} used, ` +
      `${requested} requested). Complete the work directly or start a new session.`
    );
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/spawn-guard.test.ts`
Expected: All 15 tests PASS

- [ ] **Step 5: Run lint**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx biome lint src/core/spawn-guard.ts tests/spawn-guard.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```
feat: add spawn-guard pure module with tests

- src/core/spawn-guard.ts: resolveMaxSpawns, checkSpawnLimit
- tests/spawn-guard.test.ts: 15 unit tests
```

---

### Task 1.3: Create `src/core/tool-budget.ts` + tests

**Files:**

- Create: `src/core/tool-budget.ts`
- Create: `tests/tool-budget.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/tool-budget.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  DEFAULT_TOOL_BUDGET_BLOCK,
  evaluateToolCall,
  hardBlockMessage,
  softNudgeMessage,
  validateToolBudget,
} from "../src/core/tool-budget.js";

describe("validateToolBudget", () => {
  test("returns undefined budget for undefined input", () => {
    const result = validateToolBudget(undefined);
    expect(result.budget).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("accepts valid config with all fields", () => {
    const result = validateToolBudget({
      soft: 5,
      hard: 10,
      block: ["read", "grep"],
    });
    expect(result.error).toBeUndefined();
    expect(result.budget).toEqual({
      soft: 5,
      hard: 10,
      block: ["read", "grep"],
    });
  });

  test("accepts valid config with only hard", () => {
    const result = validateToolBudget({ hard: 10 });
    expect(result.error).toBeUndefined();
    expect(result.budget).toEqual({
      hard: 10,
      block: [...DEFAULT_TOOL_BUDGET_BLOCK],
    });
  });

  test('accepts block: "*"', () => {
    const result = validateToolBudget({ hard: 10, block: "*" });
    expect(result.error).toBeUndefined();
    expect(result.budget?.block).toBe("*");
  });

  test("applies default block list when block omitted", () => {
    const result = validateToolBudget({ hard: 10 });
    expect(result.budget?.block).toEqual([...DEFAULT_TOOL_BUDGET_BLOCK]);
  });

  test("rejects hard < 1", () => {
    expect(validateToolBudget({ hard: 0 }).error).toContain("hard");
  });

  test("rejects non-integer hard", () => {
    expect(validateToolBudget({ hard: 1.5 }).error).toContain("hard");
  });

  test("rejects soft > hard", () => {
    expect(validateToolBudget({ soft: 15, hard: 10 }).error).toContain("soft");
  });

  test("rejects soft < 1", () => {
    expect(validateToolBudget({ soft: 0, hard: 10 }).error).toContain("soft");
  });

  test("rejects empty block array", () => {
    expect(validateToolBudget({ hard: 10, block: [] }).error).toContain(
      "block",
    );
  });

  test("rejects non-string items in block array", () => {
    expect(validateToolBudget({ hard: 10, block: [123] }).error).toContain(
      "block",
    );
  });

  test("rejects non-object input", () => {
    expect(validateToolBudget("bad").error).toBeDefined();
    expect(validateToolBudget(42).error).toBeDefined();
    expect(validateToolBudget([]).error).toBeDefined();
  });

  test("deduplicates block entries", () => {
    const result = validateToolBudget({
      hard: 10,
      block: ["read", "read", "grep"],
    });
    expect(result.budget?.block).toEqual(["read", "grep"]);
  });
});

describe("evaluateToolCall", () => {
  const budget = { soft: 5, hard: 10, block: ["read", "grep"] as string[] };

  test("returns within-budget when under both limits", () => {
    const result = evaluateToolCall(budget, 3, "read");
    expect(result.outcome).toBe("within-budget");
    expect(result.message).toBeUndefined();
  });

  test("returns soft-reached at soft threshold", () => {
    const result = evaluateToolCall(budget, 5, "read");
    expect(result.outcome).toBe("soft-reached");
    expect(result.message).toBeDefined();
  });

  test("returns soft-reached between soft and hard", () => {
    const result = evaluateToolCall(budget, 8, "read");
    expect(result.outcome).toBe("soft-reached");
  });

  test("returns hard-blocked for listed tool over hard", () => {
    const result = evaluateToolCall(budget, 11, "read");
    expect(result.outcome).toBe("hard-blocked");
    expect(result.message).toContain("read");
  });

  test("returns soft-reached for non-listed tool over hard (not blocked)", () => {
    const result = evaluateToolCall(budget, 11, "edit");
    expect(result.outcome).toBe("soft-reached");
  });

  test('block: "*" blocks all tools over hard', () => {
    const wildBudget = { soft: 5, hard: 10, block: "*" as const };
    const result = evaluateToolCall(wildBudget, 11, "edit");
    expect(result.outcome).toBe("hard-blocked");
  });

  test("returns within-budget when no soft defined and under hard", () => {
    const noSoftBudget = { hard: 10, block: ["read"] as string[] };
    const result = evaluateToolCall(noSoftBudget, 8, "read");
    expect(result.outcome).toBe("within-budget");
  });

  test("returns within-budget for non-listed tool over hard with no soft", () => {
    const noSoftBudget = { hard: 10, block: ["read"] as string[] };
    const result = evaluateToolCall(noSoftBudget, 11, "edit");
    expect(result.outcome).toBe("within-budget");
  });
});

describe("message formatters", () => {
  test("softNudgeMessage includes counts", () => {
    const msg = softNudgeMessage({ soft: 5, hard: 10, block: ["read"] }, 5);
    expect(msg).toContain("5");
    expect(msg).toContain("soft");
  });

  test("hardBlockMessage includes tool name and counts", () => {
    const msg = hardBlockMessage({ hard: 10, block: ["read"] }, "read", 11);
    expect(msg).toContain("read");
    expect(msg).toContain("11");
    expect(msg).toContain("hard");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/tool-budget.test.ts`
Expected: FAIL -- cannot resolve `../src/core/tool-budget.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/tool-budget.ts`:

```typescript
import type { ResolvedToolBudget, ToolBudgetConfig } from "../shared/types.js";

export type ToolBudgetOutcome =
  | "within-budget"
  | "soft-reached"
  | "hard-blocked";

export const DEFAULT_TOOL_BUDGET_BLOCK: readonly string[] = [
  "read",
  "grep",
  "find",
  "ls",
];

/**
 * Validate raw tool budget config. Returns resolved budget or error string.
 */
export function validateToolBudget(
  raw: unknown,
  label = "toolBudget",
): { budget?: ResolvedToolBudget; error?: string } {
  if (raw === undefined) return {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      error: `${label} must be an object with a required 'hard' field.`,
    };
  }

  const value = raw as ToolBudgetConfig;

  if (
    typeof value.hard !== "number" ||
    !Number.isInteger(value.hard) ||
    value.hard < 1
  ) {
    return { error: `${label}.hard must be an integer >= 1.` };
  }
  if (
    value.soft !== undefined &&
    (typeof value.soft !== "number" ||
      !Number.isInteger(value.soft) ||
      value.soft < 1)
  ) {
    return { error: `${label}.soft must be an integer >= 1 when provided.` };
  }
  if (value.soft !== undefined && value.soft > value.hard) {
    return { error: `${label}.soft must be <= ${label}.hard.` };
  }

  if (value.block !== undefined && value.block !== "*") {
    if (!Array.isArray(value.block)) {
      return { error: `${label}.block must be "*" or an array of tool names.` };
    }
    if (value.block.length === 0) {
      return { error: `${label}.block must contain at least one tool name.` };
    }
    for (const item of value.block) {
      if (typeof item !== "string" || !item.trim()) {
        return {
          error: `${label}.block must contain non-empty string tool names.`,
        };
      }
    }
  }

  const block =
    value.block === "*"
      ? "*"
      : value.block
        ? [...new Set(value.block.map((t) => t.trim()).filter(Boolean))]
        : [...DEFAULT_TOOL_BUDGET_BLOCK];

  return {
    budget: {
      hard: value.hard,
      ...(value.soft !== undefined ? { soft: value.soft } : {}),
      block,
    },
  };
}

/**
 * Format the soft-limit steering nudge.
 */
export function softNudgeMessage(
  budget: ResolvedToolBudget,
  toolCount: number,
): string {
  return (
    `Tool budget soft limit reached after ${toolCount} tool call${toolCount === 1 ? "" : "s"} ` +
    `(soft ${budget.soft}, hard ${budget.hard}). ` +
    "Stop starting new browsing/search work and finalize from the context you already have."
  );
}

/**
 * Format the hard-limit block message.
 */
export function hardBlockMessage(
  budget: ResolvedToolBudget,
  toolName: string,
  toolCount: number,
): string {
  return (
    `Tool budget hard limit reached after ${toolCount} tool call${toolCount === 1 ? "" : "s"} ` +
    `(hard ${budget.hard}). The '${toolName}' tool is blocked so you can finalize ` +
    "from the context you already have."
  );
}

/**
 * Evaluate a tool call against the budget.
 * `toolCount` is the count AFTER incrementing (i.e., this is the Nth tool call).
 * Returns outcome and optional user-facing message.
 */
export function evaluateToolCall(
  budget: ResolvedToolBudget,
  toolCount: number,
  toolName: string,
): { outcome: ToolBudgetOutcome; message?: string } {
  const pastHard = toolCount > budget.hard;

  if (pastHard) {
    const blocked = budget.block === "*" || budget.block.includes(toolName);
    if (blocked) {
      return {
        outcome: "hard-blocked",
        message: hardBlockMessage(budget, toolName, toolCount),
      };
    }
  }

  if (budget.soft !== undefined && toolCount >= budget.soft) {
    return {
      outcome: "soft-reached",
      message: softNudgeMessage(budget, toolCount),
    };
  }

  return { outcome: "within-budget" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/tool-budget.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run lint on new files**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx biome lint src/core/spawn-guard.ts src/core/tool-budget.ts tests/spawn-guard.test.ts tests/tool-budget.test.ts`
Expected: No errors (fix any auto-fixable issues with `npx biome lint --write`)

- [ ] **Step 6: Commit**

```
feat: add tool-budget pure module with tests

- src/core/tool-budget.ts: validateToolBudget, evaluateToolCall,
  softNudgeMessage, hardBlockMessage
- tests/tool-budget.test.ts: 20 unit tests
```

---

### Task 1.4: Phase 1 verification

- [ ] **Step 1: Run full check suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npm run check`
Expected: Lint, typecheck, and all tests pass (including the ~35 new tests from Tasks 1.2-1.3)

---

---

**Next:** Phase 2 (`docs/superpowers/plans/2026-07-09-phase-2-config-wiring.md`)
