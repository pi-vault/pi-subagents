# Spawn Limits & Tool Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-session spawn caps and per-run tool budgets (soft/hard limits) to prevent runaway subagent behavior.

**Architecture:** Two independent pure-function modules (`spawn-guard.ts`, `tool-budget.ts`) encapsulate all decision logic. Integration wires them into `AgentManager.spawn()` (spawn limits) and `runAgent()` event subscription (tool budgets). Configuration flows through the existing `SubagentsConfig` system.

**Tech Stack:** TypeScript, Vitest, Biome, TypeBox (schema)

**Spec:** `docs/superpowers/specs/2026-07-08-spawn-limits-tool-budgets-design.md`

---

## File Map

| File                              | Action | Responsibility                                                                                                                                          |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`             | Modify | Add `ToolBudgetConfig`, `ResolvedToolBudget` interfaces; extend `SubagentsConfig`, `AgentDefinition`, `SubagentToolInput`, `RunOptions`, `SpawnOptions` |
| `src/core/spawn-guard.ts`         | Create | Pure functions: `resolveMaxSpawns`, `checkSpawnLimit`                                                                                                   |
| `src/core/tool-budget.ts`         | Create | Pure functions: `validateToolBudget`, `evaluateToolCall`, message formatters                                                                            |
| `src/core/config.ts`              | Modify | Add `maxSpawnsPerSession` + `toolBudget` to defaults, save, load                                                                                        |
| `src/core/agent-manager.ts`       | Modify | Add spawn counter, call `checkSpawnLimit` in `spawn()`                                                                                                  |
| `src/core/agent-runner.ts`        | Modify | Add tool budget tracking in event subscription                                                                                                          |
| `src/core/agent-format.ts`        | Modify | Parse `tool_budget` from agent frontmatter                                                                                                              |
| `src/core/subagent.ts`            | Modify | Add `tool_budget` to tool schema, resolve budget, pass through spawn options                                                                            |
| `src/index.ts`                    | Modify | Apply `maxSpawnsPerSession` from config to manager at startup                                                                                           |
| `src/core/invocation-config.ts`   | Modify | Add `toolBudget` to all config interfaces + 3-layer resolution (inverted priority)                                                                      |
| `src/tui/agents-menu.ts`          | Modify | Add `maxSpawnsPerSession` settings menu entry                                                                                                           |
| `tests/spawn-guard.test.ts`       | Create | Unit tests for spawn guard                                                                                                                              |
| `tests/tool-budget.test.ts`       | Create | Unit tests for tool budget                                                                                                                              |
| `tests/config.test.ts`            | Modify | Tests for new config fields                                                                                                                             |
| `tests/invocation-config.test.ts` | Modify | `toolBudget` 3-layer resolution tests                                                                                                                   |
| `tests/agent-manager.test.ts`     | Modify | Spawn limit integration tests + toolBudget passthrough                                                                                                  |
| `tests/agent-format.test.ts`      | Modify | `tool_budget` frontmatter parsing tests                                                                                                                 |

---

## Phase 1: Pure Modules

Deliverable: Two tested, dependency-free modules exist. No integration yet.

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

## Phase 2: Config Wiring

Deliverable: `maxSpawnsPerSession` and `toolBudget` are persisted in config, editable via settings menu.

### Task 2.1: Update `src/core/config.ts`

**Files:**

- Modify: `src/core/config.ts`

- [ ] **Step 1: Add import for `ToolBudgetConfig`**

At the top of config.ts, add `ToolBudgetConfig` to the type import:

```typescript
import type {
  JoinMode,
  LoadedConfig,
  ResolvedPaths,
  SubagentsConfig,
  ToolBudgetConfig,
} from "../shared/types.js";
```

- [ ] **Step 2: Update `DEFAULT_CONFIG`**

```typescript
export const DEFAULT_CONFIG: SubagentsConfig = {
  maxConcurrency: 3,
  maxRecursiveLevel: 3,
  defaultMaxTurns: 0,
  graceTurns: 5,
  defaultJoinMode: "smart",
  maxSpawnsPerSession: 40,
};
```

- [ ] **Step 3: Update `saveConfig`**

In the `JSON.stringify` object, add the new fields after `defaultJoinMode`:

```typescript
export function saveConfig(
  paths: ResolvedPaths,
  config: SubagentsConfig,
): void {
  mkdirSync(dirname(paths.configPath), { recursive: true });

  const data: Record<string, unknown> = {
    maxConcurrency: config.maxConcurrency,
    maxRecursiveLevel: config.maxRecursiveLevel,
    defaultMaxTurns: config.defaultMaxTurns,
    graceTurns: config.graceTurns,
    defaultJoinMode: config.defaultJoinMode,
    maxSpawnsPerSession: config.maxSpawnsPerSession,
  };
  if (config.toolBudget) {
    data.toolBudget = config.toolBudget;
  }

  writeFileSync(paths.configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 4: Update `loadConfig` return object**

In the final `return` block of `loadConfig`, add the new fields after `defaultJoinMode`:

```typescript
      maxSpawnsPerSession:
        isFiniteNumber(raw.maxSpawnsPerSession) &&
        Number.isInteger(raw.maxSpawnsPerSession) &&
        (raw.maxSpawnsPerSession as number) >= 0
          ? (raw.maxSpawnsPerSession as number)
          : DEFAULT_CONFIG.maxSpawnsPerSession,
      toolBudget:
        raw.toolBudget &&
        typeof raw.toolBudget === "object" &&
        !Array.isArray(raw.toolBudget)
          ? (raw.toolBudget as ToolBudgetConfig)
          : undefined,
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```
feat(config): persist maxSpawnsPerSession and toolBudget

- DEFAULT_CONFIG adds maxSpawnsPerSession: 40
- loadConfig validates and loads both new fields
- saveConfig conditionally writes toolBudget
```

---

### Task 2.2: Add `maxSpawnsPerSession` to settings menu

**Files:**

- Modify: `src/tui/agents-menu.ts`

- [ ] **Step 1: Add to `SettingsKey` type**

```typescript
type SettingsKey =
  | "maxConcurrency"
  | "maxRecursiveLevel"
  | "defaultMaxTurns"
  | "graceTurns"
  | "defaultJoinMode"
  | "maxSpawnsPerSession"
  | "widgetMode"
  | "fleetView";
```

- [ ] **Step 2: Add menu entry to `SETTINGS_MENU_ITEMS`**

Insert after the `defaultJoinMode` entry (before `widgetMode`):

```typescript
  {
    key: "maxSpawnsPerSession",
    label: "Max Spawns Per Session",
    promptTitle: "Max Spawns Per Session (0 = block all)",
    formatValue: (config) => String(config.maxSpawnsPerSession),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    },
    apply: (value, deps) => {
      deps.manager.setMaxSpawnsPerSession(value as number);
    },
  },
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: Error -- `setMaxSpawnsPerSession` does not exist on `AgentManager`. This is expected and will be resolved in Phase 3. If you are running phases sequentially, note this error and proceed.

- [ ] **Step 4: Commit**

```
feat(settings): add Max Spawns Per Session menu entry

- agents-menu.ts: new SettingsKey + menu item with parse/apply
- Note: typecheck error on setMaxSpawnsPerSession expected until Phase 3
```

---

### Task 2.3: Update `src/core/invocation-config.ts`

**Files:**

- Modify: `src/core/invocation-config.ts`

- [ ] **Step 1: Add `ToolBudgetConfig` to all config interfaces**

Add the import at the top:

```typescript
import type { ToolBudgetConfig } from "../shared/types.js";
```

Add `toolBudget?: ToolBudgetConfig;` to each of the three input interfaces:

```typescript
export interface AgentFrontmatterConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  toolBudget?: ToolBudgetConfig;
}

export interface ToolParamConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  toolBudget?: ToolBudgetConfig;
}

export interface ParentDefaults {
  model?: string;
  thinking?: string;
  defaultMaxTurns?: number;
  toolBudget?: ToolBudgetConfig;
}

export interface ResolvedInvocationConfig {
  model?: string;
  thinking?: string;
  maxTurns: number;
  isolated: boolean;
  inheritContext: boolean;
  toolBudget?: ToolBudgetConfig;
}
```

- [ ] **Step 2: Add `toolBudget` resolution to `resolveInvocationConfig`**

Add to the return object, after `inheritContext`:

```typescript
    // Tool budgets: inverted priority (tool params > frontmatter > config).
    // The parent orchestrator can restrict a child's budget per-call.
    toolBudget: toolParams.toolBudget ?? frontmatter.toolBudget ?? defaults.toolBudget,
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat(invocation-config): add toolBudget 3-layer resolution

- Add toolBudget to AgentFrontmatterConfig, ToolParamConfig,
  ParentDefaults, ResolvedInvocationConfig
- Resolution: tool params > frontmatter > config (inverted priority)
```

---

### Task 2.4: Update `tests/invocation-config.test.ts`

**Files:**

- Modify: `tests/invocation-config.test.ts`

- [ ] **Step 1: Add toolBudget resolution tests**

Add a new `describe` block at the end of the file:

```typescript
describe("toolBudget resolution (inverted priority)", () => {
  it("tool param toolBudget takes priority over frontmatter", () => {
    const result = resolveInvocationConfig(
      { toolBudget: { hard: 20 } },
      { toolBudget: { soft: 5, hard: 10 } },
      {},
    );
    expect(result.toolBudget).toEqual({ soft: 5, hard: 10 });
  });

  it("frontmatter toolBudget used when tool param omits it", () => {
    const result = resolveInvocationConfig(
      { toolBudget: { hard: 20 } },
      {},
      {},
    );
    expect(result.toolBudget).toEqual({ hard: 20 });
  });

  it("config toolBudget used as fallback", () => {
    const result = resolveInvocationConfig(
      {},
      {},
      { toolBudget: { hard: 30 } },
    );
    expect(result.toolBudget).toEqual({ hard: 30 });
  });

  it("returns undefined when all sources omit toolBudget", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.toolBudget).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run invocation-config tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/invocation-config.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```
test: add toolBudget invocation-config resolution tests

- 4 tests for 3-layer priority (tool params > frontmatter > config)
```

---

### Task 2.5: Update `tests/config.test.ts`

**Files:**

- Modify: `tests/config.test.ts`

- [ ] **Step 1: Update the "uses defaults" test**

The existing test asserts `toEqual(DEFAULT_CONFIG)` which will now include `maxSpawnsPerSession: 40`. This should already pass since we updated `DEFAULT_CONFIG`. Verify by also checking the new field explicitly. Add after `expect(result.config.graceTurns).toBe(5);`:

```typescript
expect(result.config.maxSpawnsPerSession).toBe(40);
expect(result.config.toolBudget).toBeUndefined();
```

- [ ] **Step 2: Update the "merges configured values" test**

The `toEqual` assertion needs updating to include the new default field. Change the expected object:

```typescript
expect(result.config).toEqual({
  maxConcurrency: 7,
  maxRecursiveLevel: DEFAULT_CONFIG.maxRecursiveLevel,
  defaultMaxTurns: 20,
  graceTurns: DEFAULT_CONFIG.graceTurns,
  defaultJoinMode: DEFAULT_CONFIG.defaultJoinMode,
  maxSpawnsPerSession: DEFAULT_CONFIG.maxSpawnsPerSession,
});
```

- [ ] **Step 3: Add test for `maxSpawnsPerSession` persistence**

```typescript
test("loads maxSpawnsPerSession from config file", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
  const configDir = join(agentDir, "extensions");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "subagents.json"),
    JSON.stringify({ maxSpawnsPerSession: 10 }),
  );

  const result = loadConfig(resolvePaths(agentDir));

  expect(result.config.maxSpawnsPerSession).toBe(10);
});
```

- [ ] **Step 4: Add test for `toolBudget` persistence**

```typescript
test("loads toolBudget from config file", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
  const configDir = join(agentDir, "extensions");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "subagents.json"),
    JSON.stringify({ toolBudget: { soft: 5, hard: 10 } }),
  );

  const result = loadConfig(resolvePaths(agentDir));

  expect(result.config.toolBudget).toEqual({ soft: 5, hard: 10 });
});
```

- [ ] **Step 5: Add test for saveConfig with new fields**

```typescript
test("saveConfig persists maxSpawnsPerSession and toolBudget", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
  const paths = resolvePaths(agentDir);

  saveConfig(paths, {
    maxConcurrency: 3,
    maxRecursiveLevel: 3,
    defaultMaxTurns: 0,
    graceTurns: 5,
    defaultJoinMode: "smart",
    maxSpawnsPerSession: 15,
    toolBudget: { soft: 5, hard: 10 },
  });

  const saved = JSON.parse(readFileSync(paths.configPath, "utf8"));
  expect(saved.maxSpawnsPerSession).toBe(15);
  expect(saved.toolBudget).toEqual({ soft: 5, hard: 10 });
});
```

- [ ] **Step 6: Add test for saveConfig omitting undefined toolBudget**

```typescript
test("saveConfig omits toolBudget when undefined", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
  const paths = resolvePaths(agentDir);

  saveConfig(paths, {
    maxConcurrency: 3,
    maxRecursiveLevel: 3,
    defaultMaxTurns: 0,
    graceTurns: 5,
    defaultJoinMode: "smart",
    maxSpawnsPerSession: 40,
  });

  const saved = JSON.parse(readFileSync(paths.configPath, "utf8"));
  expect(saved.toolBudget).toBeUndefined();
});
```

- [ ] **Step 7: Update existing `saveConfig` test assertion**

The existing test `"saveConfig writes only supported config keys"` needs the new field. Update the expected object:

```typescript
expect(JSON.parse(readFileSync(paths.configPath, "utf8"))).toEqual({
  maxConcurrency: 7,
  maxRecursiveLevel: 5,
  defaultMaxTurns: 15,
  graceTurns: 3,
  defaultJoinMode: "smart",
  maxSpawnsPerSession: 40,
});
```

And update the input to include `maxSpawnsPerSession: 40`:

```typescript
saveConfig(paths, {
  maxConcurrency: 7,
  maxRecursiveLevel: 5,
  defaultMaxTurns: 15,
  graceTurns: 3,
  defaultJoinMode: "smart",
  maxSpawnsPerSession: 40,
});
```

- [ ] **Step 8: Run config tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/config.test.ts`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```
test(config): add persistence tests for maxSpawnsPerSession and toolBudget

- 4 new tests: load maxSpawnsPerSession, load toolBudget,
  saveConfig round-trip, saveConfig omits undefined toolBudget
- Update existing default and merge tests for new fields
```

---

### Task 2.6: Phase 2 verification

- [ ] **Step 1: Run full check suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npm run check`
Expected: All pass. Note: if Phase 3 is not yet implemented, typecheck may error on the `setMaxSpawnsPerSession` call in agents-menu.ts. If so, comment out the `apply` body temporarily and add a `// TODO: uncomment in Phase 3` marker.

---

## Phase 3: Spawn Limits Integration

Deliverable: `AgentManager.spawn()` enforces per-session spawn limits. Config value applied at startup.

### Task 3.1: Update `src/core/agent-manager.ts`

**Files:**

- Modify: `src/core/agent-manager.ts`

- [ ] **Step 1: Add imports**

Add after the existing imports:

```typescript
import {
  DEFAULT_MAX_SPAWNS_PER_SESSION,
  checkSpawnLimit,
  resolveMaxSpawns,
} from "./spawn-guard.js";
```

- [ ] **Step 2: Add private fields to the class**

Add after `private onStart?: OnAgentStart;`:

```typescript
  private spawnCount = 0;
  private maxSpawnsPerSession = DEFAULT_MAX_SPAWNS_PER_SESSION;
```

- [ ] **Step 3: Add spawn limit check in `spawn()` method**

At the top of the `spawn()` method, after the `allowedAgents` check (after the closing `}` of the `if (options.allowedAgents ...)` block), add:

```typescript
const effectiveMax = resolveMaxSpawns(this.maxSpawnsPerSession);
const spawnError = checkSpawnLimit(this.spawnCount, 1, effectiveMax);
if (spawnError) {
  throw new Error(spawnError);
}
this.spawnCount++;
```

- [ ] **Step 4: Add setter, getter, and reset methods**

Add after the `getMaxConcurrent()` method:

```typescript
  setMaxSpawnsPerSession(n: number): void {
    this.maxSpawnsPerSession = n;
  }

  getSpawnCount(): number {
    return this.spawnCount;
  }

  resetSpawnCounter(): void {
    this.spawnCount = 0;
  }
```

- [ ] **Step 5: Reset counter in `dispose()`**

Add `this.spawnCount = 0;` in the `dispose()` method, before or after `this.agents.clear();`:

```typescript
this.spawnCount = 0;
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors (the `setMaxSpawnsPerSession` call in agents-menu.ts should now resolve)

- [ ] **Step 7: Commit**

```
feat(agent-manager): add spawn counter and limit enforcement

- Private spawnCount + maxSpawnsPerSession fields
- checkSpawnLimit guard at top of spawn()
- setMaxSpawnsPerSession, getSpawnCount, resetSpawnCounter methods
- dispose() resets counter
```

---

### Task 3.2: Apply config at startup in `src/index.ts`

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Apply maxSpawnsPerSession from config after manager creation**

In `createRuntimeDeps()`, after the `manager` is created (after the `new AgentManager(3, ...)` block, around line 164), add:

```typescript
// Apply spawn limit from config
{
  const initPaths = resolvePaths();
  const { config: initConfig } = loadConfig(initPaths);
  manager.setMaxSpawnsPerSession(initConfig.maxSpawnsPerSession);
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: apply spawn limit from config at startup

- index.ts: load config and call setMaxSpawnsPerSession in createRuntimeDeps
```

---

### Task 3.3: Update `tests/agent-manager.test.ts`

**Files:**

- Modify: `tests/agent-manager.test.ts`

- [ ] **Step 1: Add spawn limit tests**

Add a new `describe` block at the end of the file:

```typescript
describe("spawn limits", () => {
  it("blocks spawn when limit reached", () => {
    const manager = new AgentManager(3);
    manager.setMaxSpawnsPerSession(2);
    // First two succeed
    manager.spawn({}, makeAgentDef(), {
      prompt: "task 1",
      cwd: "/tmp",
      isBackground: true,
    });
    manager.spawn({}, makeAgentDef(), {
      prompt: "task 2",
      cwd: "/tmp",
      isBackground: true,
    });
    // Third should fail
    expect(() =>
      manager.spawn({}, makeAgentDef(), {
        prompt: "task 3",
        cwd: "/tmp",
        isBackground: true,
      }),
    ).toThrow(/spawn limit/i);
    manager.dispose();
  });

  it("increments spawn counter on each spawn", () => {
    const manager = new AgentManager(3);
    expect(manager.getSpawnCount()).toBe(0);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(2);
    manager.dispose();
  });

  it("resetSpawnCounter resets to zero", () => {
    const manager = new AgentManager(3);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.resetSpawnCounter();
    expect(manager.getSpawnCount()).toBe(0);
    manager.dispose();
  });

  it("setMaxSpawnsPerSession updates the limit", () => {
    const manager = new AgentManager(3);
    manager.setMaxSpawnsPerSession(1);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(() =>
      manager.spawn({}, makeAgentDef(), {
        prompt: "task 2",
        cwd: "/tmp",
        isBackground: true,
      }),
    ).toThrow(/spawn limit/i);
    manager.dispose();
  });

  it("dispose resets spawn counter", () => {
    const manager = new AgentManager(3);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.dispose();
    expect(manager.getSpawnCount()).toBe(0);
  });

  it("spawnAndWait also increments counter", async () => {
    const manager = new AgentManager(3);
    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.dispose();
  });
});
```

- [ ] **Step 2: Run agent-manager tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/agent-manager.test.ts`
Expected: All tests PASS (existing + 6 new)

- [ ] **Step 3: Commit**

```
test: add spawn limit integration tests

- 6 new tests: block at limit, counter increment, reset,
  setMaxSpawnsPerSession, dispose reset, spawnAndWait counter
```

---

### Task 3.4: Phase 3 verification

- [ ] **Step 1: Run full check suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npm run check`
Expected: All pass

---

## Phase 4: Tool Budgets Integration

Deliverable: Tool budgets work end-to-end: frontmatter parsing, tool parameter, resolution, enforcement in runner.

### Task 4.1: Parse `tool_budget` from agent frontmatter

**Files:**

- Modify: `src/core/agent-format.ts`
- Modify: `tests/agent-format.test.ts`

- [ ] **Step 1: Add import in agent-format.ts**

Add at the top of `agent-format.ts`, after the existing import:

```typescript
import type { ToolBudgetConfig } from "../shared/types.js";
```

Update the existing import to include `ToolBudgetConfig`:

```typescript
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryDiagnostic,
  ToolBudgetConfig,
} from "../shared/types.js";
```

- [ ] **Step 2: Add `tool_budget` parsing in `parseAgentContent`**

After the `disallowedTools` parsing block (around line 398, before the `return { ok: true, agent: { ... } }`), add:

```typescript
// tool_budget (JSON object string)
let toolBudget: ToolBudgetConfig | undefined;
if (frontmatter.tool_budget !== undefined) {
  if (typeof frontmatter.tool_budget === "string") {
    const trimmed = frontmatter.tool_budget.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          toolBudget = parsed as ToolBudgetConfig;
        }
      } catch {
        return {
          ok: false,
          diagnostic: {
            path: filePath,
            reason: "tool_budget must be a valid JSON object",
          },
        };
      }
    }
  } else if (
    typeof frontmatter.tool_budget === "object" &&
    !Array.isArray(frontmatter.tool_budget)
  ) {
    toolBudget = frontmatter.tool_budget as ToolBudgetConfig;
  }
}
```

- [ ] **Step 3: Add `toolBudget` to the returned agent object**

In the `return { ok: true, agent: { ... } }` block, add after `disallowedTools,`:

```typescript
      toolBudget,
```

- [ ] **Step 4: Add `toolBudget` serialization in `serializeAgent`**

In the `serializeAgent` function, before `frontmatter.push("---", systemPrompt);`, add:

```typescript
if (input.toolBudget) {
  frontmatter.push(`tool_budget: ${JSON.stringify(input.toolBudget)}`);
}
```

- [ ] **Step 5: Write failing tests**

Add to `tests/agent-format.test.ts`, in the `"new frontmatter fields"` describe block:

```typescript
test("parses tool_budget as JSON object", () => {
  const content =
    '---\nname: test\ndescription: A test\ntools: read\ntool_budget: {"soft": 5, "hard": 10}\n---\nPrompt\n';
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.agent.toolBudget).toEqual({ soft: 5, hard: 10 });
  }
});

test("parses tool_budget with block list", () => {
  const content =
    '---\nname: test\ndescription: A test\ntools: read\ntool_budget: {"hard": 15, "block": ["read", "grep"]}\n---\nPrompt\n';
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.agent.toolBudget).toEqual({
      hard: 15,
      block: ["read", "grep"],
    });
  }
});

test("tool_budget is undefined when omitted", () => {
  const content =
    "---\nname: test\ndescription: A test\ntools: read\n---\nPrompt\n";
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.agent.toolBudget).toBeUndefined();
});

test("returns error for invalid tool_budget JSON", () => {
  const content =
    "---\nname: test\ndescription: A test\ntools: read\ntool_budget: {bad json}\n---\nPrompt\n";
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostic.reason).toContain("tool_budget");
});
```

- [ ] **Step 6: Run agent-format tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/agent-format.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```
feat(agent-format): parse tool_budget from frontmatter

- Parse tool_budget as JSON object string or YAML object
- Add toolBudget to returned agent definition
- Serialize toolBudget in serializeAgent
- 4 new tests: parse, parse with block, omitted, invalid JSON
```

---

### Task 4.2: Add `tool_budget` to subagent tool schema + resolve budget

**Files:**

- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `subagent.ts`:

```typescript
import type { ResolvedToolBudget } from "../shared/types.js";
import { validateToolBudget } from "./tool-budget.js";
```

The `ResolvedToolBudget` import is added to the existing type import block from `"../shared/types.js"`.

- [ ] **Step 2: Add `tool_budget` to `SUBAGENT_TOOL_PARAMETERS`**

After the `isolation` parameter in the schema, add:

```typescript
  tool_budget: Type.Optional(
    Type.Object(
      {
        soft: Type.Optional(
          Type.Number({ minimum: 1, description: "Advisory nudge threshold" }),
        ),
        hard: Type.Number({ minimum: 1, description: "Hard block threshold" }),
        block: Type.Optional(
          Type.Union([Type.Array(Type.String()), Type.Literal("*")], {
            description: "Tools to block at hard limit. Default: read, grep, find, ls",
          }),
        ),
      },
      { description: "Tool call budget with soft/hard limits" },
    ),
  ),
```

- [ ] **Step 3: Pass `toolBudget` through `resolveInvocationConfig`**

In the `execute` method, update the `resolveInvocationConfig()` call to include `toolBudget` in all three config objects:

```typescript
const resolved = resolveInvocationConfig(
  {
    model: agentDef.model,
    thinking: agentDef.thinking,
    maxTurns: agentDef.maxTurns,
    isolated: agentDef.isolated,
    inheritContext: agentDef.inheritContext,
    toolBudget: agentDef.toolBudget,
  },
  {
    model: params.model,
    thinking: params.thinking,
    maxTurns: params.max_turns,
    isolated: params.isolated,
    inheritContext: params.inherit_context,
    toolBudget: params.tool_budget,
  },
  {
    model: undefined,
    defaultMaxTurns: loadedConfig.config.defaultMaxTurns,
    toolBudget: loadedConfig.config.toolBudget,
  },
);
```

- [ ] **Step 4: Validate and resolve the merged budget**

After `detailBase` is defined (around line 260), add:

```typescript
// Validate the merged tool budget (from resolveInvocationConfig)
let resolvedBudget: ResolvedToolBudget | undefined;
if (resolved.toolBudget) {
  const validated = validateToolBudget(resolved.toolBudget);
  if (validated.error) {
    return {
      content: [{ type: "text", text: validated.error }],
      isError: true,
      details: {
        ...detailBase,
        status: "error" as const,
        stopReason: "error",
        stderr: validated.error,
      },
    };
  }
  resolvedBudget = validated.budget;
}
```

- [ ] **Step 5: Pass `toolBudget` through spawn options**

Update the `spawnOptions` object to include `toolBudget`:

```typescript
const spawnOptions = {
  prompt: params.task.trim(),
  cwd: effectiveCwd,
  maxTurns: resolved.maxTurns,
  graceTurns: loadedConfig.config.graceTurns,
  inheritContext: resolved.inheritContext,
  parentSystemPrompt,
  parentSignal: signal,
  currentDepth: 0,
  toolBudget: resolvedBudget,
};
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```
feat(subagent): add tool_budget to tool schema and resolve budget

- TypeBox schema for tool_budget parameter (soft/hard/block)
- Pass toolBudget through resolveInvocationConfig (3-layer)
- Validate merged budget, return error on invalid config
- Pass resolvedBudget through spawn options
```

---

### Task 4.3: Pass `toolBudget` through `AgentManager` to `runAgent`

**Files:**

- Modify: `src/core/agent-manager.ts`

- [ ] **Step 1: Pass `toolBudget` in `startAgent` runOptions**

In the `startAgent` method, in the call to `runAgent(agentDef, { ... }, ...)`, add `toolBudget` to the options object, after `onTextDelta`:

```typescript
        toolBudget: options.toolBudget,
```

This passes the resolved budget from spawn options through to the runner.

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat(agent-manager): pass toolBudget through to runAgent

- Add toolBudget to startAgent runOptions
```

---

### Task 4.4: Enforce tool budget in `src/core/agent-runner.ts`

**Files:**

- Modify: `src/core/agent-runner.ts`

- [ ] **Step 1: Add import**

Add at the top, after the existing imports:

```typescript
import { evaluateToolCall } from "./tool-budget.js";
```

- [ ] **Step 2: Add tracking variables**

In the `runAgent` function, after `let steered = false;` (line 271), add:

```typescript
let budgetToolCount = 0;
let budgetSoftNudged = false;
```

- [ ] **Step 3: Add budget enforcement in `tool_execution_start` handler**

Replace the existing `tool_execution_start` block:

```typescript
if (event.type === "tool_execution_start") {
  options.onToolActivity?.({ type: "start", toolName: event.toolName });
}
```

With:

```typescript
if (event.type === "tool_execution_start") {
  options.onToolActivity?.({ type: "start", toolName: event.toolName });
  if (options.toolBudget) {
    budgetToolCount++;
    const budgetResult = evaluateToolCall(
      options.toolBudget,
      budgetToolCount,
      event.toolName,
    );
    if (budgetResult.outcome === "soft-reached" && !budgetSoftNudged) {
      budgetSoftNudged = true;
      session.steer(budgetResult.message!);
      steered = true;
    } else if (budgetResult.outcome === "hard-blocked") {
      session.steer(budgetResult.message!);
      aborted = true;
      session.abort();
    }
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run lint**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx biome lint src/core/agent-runner.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```
feat(agent-runner): enforce tool budget soft/hard limits

- Track budgetToolCount + budgetSoftNudged in runAgent
- Soft limit: steer once at threshold
- Hard limit: steer + abort for blocked tools
```

---

### Task 4.5: Update tests

**Files:**

- Modify: `tests/agent-manager.test.ts` (verify passthrough)

Since `agent-runner.ts` is mocked in `agent-manager.test.ts`, we can verify that `toolBudget` is passed through to `runAgent`.

- [ ] **Step 1: Add toolBudget passthrough test to `tests/agent-manager.test.ts`**

Add to the `"maxTurns and graceTurns passthrough"` describe block:

```typescript
it("passes toolBudget to runAgent", async () => {
  const manager = new AgentManager(3);
  const spy = vi
    .spyOn(await import("../src/core/agent-runner.js"), "runAgent")
    .mockResolvedValue({
      responseText: "done",
      session: {},
      aborted: false,
      steered: false,
    });

  const budget = { soft: 5, hard: 10, block: ["read"] as string[] };
  await manager.spawnAndWait({}, makeAgentDef(), {
    prompt: "test",
    cwd: tmpDir,
    toolBudget: budget,
  });

  expect(spy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toolBudget: budget }),
    expect.anything(),
  );
  spy.mockRestore();
  manager.dispose();
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/agent-manager.test.ts tests/agent-format.test.ts tests/spawn-guard.test.ts tests/tool-budget.test.ts tests/config.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```
test: add toolBudget passthrough test

- Verify toolBudget flows from spawnAndWait through to runAgent
```

---

### Task 4.6: Phase 4 verification

- [ ] **Step 1: Run full check suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npm run check`
Expected: All pass

---

## Verification Checklist

After all 4 phases are complete:

- [ ] `npm run check` passes (lint + typecheck + all tests)
- [ ] `tests/spawn-guard.test.ts` -- ~15 unit tests for pure spawn guard logic
- [ ] `tests/tool-budget.test.ts` -- ~20 unit tests for pure tool budget logic
- [ ] `tests/config.test.ts` -- existing tests updated + 4 new for new config fields
- [ ] `tests/invocation-config.test.ts` -- 4 new toolBudget resolution tests (inverted priority)
- [ ] `tests/agent-manager.test.ts` -- 6 new spawn limit tests + 1 toolBudget passthrough test
- [ ] `tests/agent-format.test.ts` -- 4 new tool_budget frontmatter parsing tests
- [ ] Settings menu shows "Max Spawns Per Session" entry
- [ ] No changes to files outside the File Map
