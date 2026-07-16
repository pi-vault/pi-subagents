# Settings Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated configuration readers with one settings module and make Max Recursive Level effective.

**Architecture:** Add a backward-compatible settings resolver first, then migrate callers and the settings menu to it. The legacy file remains read-only compatibility input.

**Tech Stack:** TypeScript, Vitest, Node.js filesystem APIs.

---

## Commit sequence

1. `refactor: add unified settings resolver`
2. `refactor: migrate settings callers`

### Task 1: Add the unified settings resolver

**Files:**
- Modify: `src/core/settings.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/settings.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Cover `defaults -> legacy global -> canonical global -> project`, legacy `maxConcurrency` to canonical `maxConcurrent`, malformed-file fallback, and preservation of unknown/sibling keys after saving one value.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/settings.test.ts
```

Expected: failure because the current settings reader has no legacy compatibility or scoped single-setting write.

- [ ] **Step 3: Implement the resolver seam**

```ts
export type SettingsScope = "project" | "global";

export function loadSettings(
  cwd: string = process.cwd(),
  scope?: SettingsScope,
): SubagentsSettings;

export function saveSetting(
  cwd: string,
  scope: SettingsScope,
  key: keyof SubagentsSettings,
  value: unknown,
): boolean;
```

Read `resolvePaths(cwd).configPath` only as legacy input. Write canonical global values to `getAgentDir()/subagents.json` and project values to `.pi/subagents.json`.

- [ ] **Step 4: Verify and commit the green resolver task**

```bash
pnpm vitest run tests/settings.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/settings.ts src/shared/types.ts tests/settings.test.ts
git add src/core/settings.ts src/shared/types.ts tests/settings.test.ts
git commit -m "refactor: add unified settings resolver"
```

### Task 2: Migrate settings callers and apply recursion limits

**Files:**
- Delete: `src/core/config.ts`
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/index.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Write failing caller tests**

Assert startup calls `manager.setMaxDepth(settings.maxRecursiveLevel)`, menu edits immediately apply it, and one project/global selection is reused for a complete settings-menu visit.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/config.test.ts tests/index.test.ts
```

Expected: failure because callers still use `config.ts` and recursion is not applied.

- [ ] **Step 3: Migrate callers and delete the duplicate module**

Replace `loadConfig`/`saveConfig` dependencies with the resolver. Select scope once on entering Settings and use `saveSetting` for every edit. Call `manager.setMaxDepth` at startup and after menu edits. Remove `config.ts` after all imports disappear.

- [ ] **Step 4: Verify and commit the green migration task**

```bash
pnpm vitest run tests/config.test.ts tests/index.test.ts
pnpm tsc --noEmit
pnpm biome lint src/index.ts src/core/subagent.ts src/core/slash-chain.ts src/tui/agents-menu.ts src/shared/runtime-deps.ts
git add src/shared/runtime-deps.ts src/index.ts src/core/subagent.ts src/core/slash-chain.ts src/tui/agents-menu.ts tests/config.test.ts tests/index.test.ts
git rm src/core/config.ts
git commit -m "refactor: migrate settings callers"
```
