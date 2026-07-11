# Phase 2: Config Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `toolBudget` is persisted in config and flows through invocation-config resolution. Settings menu entry added for `maxSpawnsPerSession`.

**Prerequisite:** Phase 1 complete (types, pure modules, and `maxSpawnsPerSession` config wiring exist).

**Tech Stack:** TypeScript, Vitest, Biome

**Spec:** `docs/superpowers/specs/2026-07-08-spawn-limits-tool-budgets-design.md`

**Deliverable:** Config persists `toolBudget`. Invocation-config resolves `toolBudget` with inverted priority (tool params > frontmatter > config). Settings menu shows "Max Spawns Per Session".

**Already landed in Phase 1:**
- `SubagentsConfig.maxSpawnsPerSession` and `SubagentsConfig.toolBudget?` types in `types.ts`
- `DEFAULT_CONFIG.maxSpawnsPerSession: 40` in `config.ts`
- `saveConfig` writes `maxSpawnsPerSession`
- `loadConfig` reads `maxSpawnsPerSession`
- `AgentDefinition.toolBudget?`, `SubagentToolInput.tool_budget?`, `RunOptions.toolBudget?`, `SpawnOptions.toolBudget?` in `types.ts`
- All existing tests pass (`npm run check` clean)

---

### Task 2.1: Add `toolBudget` persistence to `src/core/config.ts`

**Files:**

- Modify: `src/core/config.ts`

- [ ] **Step 1: Add import for `ToolBudgetConfig`**

At the top of config.ts, add `ToolBudgetConfig` to the existing type import:

```typescript
import type {
  JoinMode,
  LoadedConfig,
  ResolvedPaths,
  SubagentsConfig,
  ToolBudgetConfig,
} from "../shared/types.js";
```

- [ ] **Step 2: Update `saveConfig` to conditionally write `toolBudget`**

Change the `saveConfig` body to build a `data` object and conditionally add `toolBudget`:

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

- [ ] **Step 3: Add `toolBudget` to `loadConfig` return object**

In the final `return` block of `loadConfig`, add after the existing `maxSpawnsPerSession` field:

```typescript
      toolBudget:
        raw.toolBudget &&
        typeof raw.toolBudget === "object" &&
        !Array.isArray(raw.toolBudget)
          ? (raw.toolBudget as ToolBudgetConfig)
          : undefined,
```

Note: Deep validation of `toolBudget` fields (soft/hard/block) happens at resolution time via `validateToolBudget()` in `tool-budget.ts`. Config loading only does structural checks, consistent with nicobailon's approach.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```
feat(config): persist toolBudget in saveConfig/loadConfig

- saveConfig conditionally writes toolBudget when defined
- loadConfig reads toolBudget with structural type check
```

---

### Task 2.2: Add `maxSpawnsPerSession` to settings menu

**Files:**

- Modify: `src/tui/agents-menu.ts`

- [ ] **Step 1: Add `maxSpawnsPerSession` to `SettingsKey` type**

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
  },
```

Note: No `apply` callback here. The runtime `setMaxSpawnsPerSession` method on `AgentManager` does not exist yet -- it will be added in Phase 3, and the `apply` callback will be wired at that time. This matches the pattern used by `maxRecursiveLevel` (config-only, no live `apply`). The value is persisted to config and takes effect on next config load.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat(settings): add Max Spawns Per Session menu entry

- agents-menu.ts: new SettingsKey + menu item with parse
- apply callback deferred to Phase 3 (setMaxSpawnsPerSession)
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

Add `toolBudget?: ToolBudgetConfig;` to each of the four interfaces:

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

This uses **inverted priority** compared to model/thinking/maxTurns (where frontmatter wins). For budgets, the calling parent should be able to restrict a child's budget per-call. This matches the spec and nicobailon's `resolveEffectiveToolBudget` pattern.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
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

Run: `npx vitest run tests/invocation-config.test.ts`
Expected: All tests PASS (14 existing + 4 new = 18 total)

- [ ] **Step 3: Commit**

```
test: add toolBudget invocation-config resolution tests

- 4 tests for 3-layer priority (tool params > frontmatter > config)
```

---

### Task 2.5: Update `tests/config.test.ts`

**Files:**

- Modify: `tests/config.test.ts`

The existing tests already cover `maxSpawnsPerSession` in DEFAULT_CONFIG, loadConfig, and saveConfig (landed in Phase 1). This task adds `toolBudget` persistence tests and explicit assertions for the new fields.

- [ ] **Step 1: Add explicit assertions to the "uses defaults" test**

Add after `expect(result.config.graceTurns).toBe(5);`:

```typescript
expect(result.config.maxSpawnsPerSession).toBe(40);
expect(result.config.toolBudget).toBeUndefined();
```

- [ ] **Step 2: Add test for `toolBudget` load**

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

- [ ] **Step 3: Add test for saveConfig round-trip with `toolBudget`**

```typescript
test("saveConfig persists toolBudget", () => {
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

- [ ] **Step 4: Add test for saveConfig omitting undefined `toolBudget`**

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

- [ ] **Step 5: Run config tests**

Run: `npx vitest run tests/config.test.ts`
Expected: All tests PASS (4 existing + 3 new = 7 total)

- [ ] **Step 6: Commit**

```
test(config): add toolBudget persistence tests

- 3 new tests: load toolBudget, saveConfig round-trip,
  saveConfig omits undefined toolBudget
- Add explicit maxSpawnsPerSession/toolBudget assertions to defaults test
```

---

### Task 2.6: Phase 2 verification

- [ ] **Step 1: Run full check suite**

Run: `npm run check`
Expected: All pass (lint, typecheck, tests).

---

**Next:** Phase 3 (`docs/superpowers/plans/2026-07-09-phase-3-spawn-limits.md`)
