# Phase 2: Config Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `maxSpawnsPerSession` and `toolBudget` are persisted in config, `toolBudget` flows through invocation-config resolution, settings menu entry added.

**Prerequisite:** Phase 1 complete (types and pure modules exist).

**Tech Stack:** TypeScript, Vitest, Biome

**Spec:** `docs/superpowers/specs/2026-07-08-spawn-limits-tool-budgets-design.md`

**Deliverable:** Config persists new fields. Invocation-config resolves `toolBudget` with inverted priority (tool params > frontmatter > config). Settings menu shows "Max Spawns Per Session".

---

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

---

**Next:** Phase 3 (`docs/superpowers/plans/2026-07-09-phase-3-spawn-limits.md`)
