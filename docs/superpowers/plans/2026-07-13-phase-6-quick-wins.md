# Phase 6: Quick Wins Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 4 small deferred items that follow existing codebase patterns (maxSpawnsPerSession in settings, .gitignore notification, per-agent maxDepth frontmatter, batch spawns in chains).

**Architecture:** Each task is independent (no ordering dependency). All follow existing patterns in the codebase: settings applier pattern, frontmatter parsing pattern, spawn-guard pattern, and the chain execution callback pattern.

**Tech Stack:** TypeScript, Vitest, Node.js child_process (for git check-ignore)

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: maxSpawnsPerSession settings | — | `src/core/settings.ts`, `src/index.ts` | `tests/settings.test.ts` |
| 2: .gitignore notification | — | `src/core/memory.ts`, `src/index.ts` | `tests/memory.test.ts` |
| 3: per-agent maxDepth | — | `src/shared/types.ts`, `src/core/agent-format.ts`, `src/core/agent-manager.ts` | `tests/agent-format.test.ts`, `tests/agent-manager.test.ts` |
| 4: batch spawns | — | `src/core/chain-execution.ts`, `src/core/subagent.ts`, `src/core/slash-chain.ts` | `tests/chain-execution.test.ts` |

---

### Task 1: `maxSpawnsPerSession` in Settings

**Context:** `manager.setMaxSpawnsPerSession()` already exists and is wired at startup via `loadConfig` in `src/index.ts:226`. This task adds it to the _persisted settings_ path (`applySettings`) so live settings changes (e.g. from the agents menu) take effect.

**Files:**
- Modify: `src/core/settings.ts:9-96`
- Modify: `src/index.ts:293-300`
- Test: `tests/settings.test.ts`

- [ ] **Step 1: Write failing tests for sanitize via loadSettings**

The `sanitize()` function is private — test it through `loadSettings()`, matching the existing pattern in `tests/settings.test.ts`. Add these tests inside the existing `describe("settings")` block:

```typescript
  it("sanitize preserves valid maxSpawnsPerSession", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 50 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBe(50);
  });

  it("sanitize strips non-integer maxSpawnsPerSession", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 3.5 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBeUndefined();
  });

  it("sanitize strips maxSpawnsPerSession below 1", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 0 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBeUndefined();
  });

  it("sanitize strips maxSpawnsPerSession above 10000", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 99999 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/settings.test.ts --reporter=verbose`
Expected: FAIL — `maxSpawnsPerSession` is not preserved by sanitize

- [ ] **Step 3: Add `maxSpawnsPerSession` to SubagentsSettings interface and sanitize()**

In `src/core/settings.ts`, add the field to the interface (after `fleetView`, line 13):

```typescript
export interface SubagentsSettings {
  maxConcurrent?: number;
  defaultJoinMode?: JoinMode;
  widgetMode?: WidgetMode;
  fleetView?: boolean;
  maxSpawnsPerSession?: number;
  modelScope?: ModelScopeConfig;
  watchdog?: WatchdogConfig;
}
```

In `sanitize()`, add validation after the `fleetView` block (after line 48):

```typescript
  if (
    Number.isInteger(r.maxSpawnsPerSession) &&
    (r.maxSpawnsPerSession as number) >= 1 &&
    (r.maxSpawnsPerSession as number) <= 10_000
  ) {
    out.maxSpawnsPerSession = r.maxSpawnsPerSession as number;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Write failing tests for applySettings**

Add these tests inside the existing `describe("settings")` block in `tests/settings.test.ts`:

```typescript
  it("applySettings calls setMaxSpawnsPerSession when value present", () => {
    let spawns: number | undefined;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => {},
      setDefaultJoinMode: () => {},
      setMaxSpawnsPerSession: (n) => { spawns = n; },
    };
    applySettings({ maxSpawnsPerSession: 25 }, appliers);
    expect(spawns).toBe(25);
  });

  it("applySettings does not call setMaxSpawnsPerSession when absent", () => {
    let called = false;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => {},
      setDefaultJoinMode: () => {},
      setMaxSpawnsPerSession: () => { called = true; },
    };
    applySettings({ maxConcurrent: 4 }, appliers);
    expect(called).toBe(false);
  });
```

- [ ] **Step 6: Add `setMaxSpawnsPerSession` to SettingsAppliers and applySettings()**

In `src/core/settings.ts`, add to the `SettingsAppliers` interface (after `setFleetView`, line 22):

```typescript
export interface SettingsAppliers {
  setMaxConcurrent: (n: number) => void;
  setDefaultJoinMode: (mode: JoinMode) => void;
  setWidgetMode?: (mode: WidgetMode) => void;
  setFleetView?: (enabled: boolean) => void;
  setMaxSpawnsPerSession?: (n: number) => void;
}
```

Add to `applySettings()` (after the `fleetView` line, line 95):

```typescript
  if (typeof s.maxSpawnsPerSession === "number") appliers.setMaxSpawnsPerSession?.(s.maxSpawnsPerSession);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 8: Wire applier in index.ts**

In `src/index.ts`, inside the `applySettings()` call (around line 293-300), add `setMaxSpawnsPerSession`:

```typescript
  applySettings(settings, {
    setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
    setDefaultJoinMode: (mode) => {
      deps.defaultJoinMode = mode;
    },
    setWidgetMode: applyWidgetMode,
    setFleetView: applyFleetView,
    setMaxSpawnsPerSession: (n) => manager.setMaxSpawnsPerSession(n),
  });
```

- [ ] **Step 9: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/core/settings.ts src/index.ts tests/settings.test.ts
git commit -m "feat: add maxSpawnsPerSession to settings appliers"
```

---

### Task 2: `.gitignore` Notification for Local Memory

**Context:** Neither reference package implements automatic gitignore notification. This is a new, simple feature: when local-scope memory is resolved, check once per session whether `.pi/agent-memory-local/` is covered by `.gitignore` and return a warning string if not. The caller (index.ts) can surface the warning via a follow-up message.

**Design decision:** Rather than modifying `resolveMemoryDir`'s signature (which is a public API used throughout), add a standalone exported function `checkLocalMemoryGitignore(cwd: string): string | undefined`. This keeps the concern separate and testable.

**Files:**
- Modify: `src/core/memory.ts:1-10,86-88`
- Modify: `src/index.ts` (one-time check at init)
- Test: `tests/memory.test.ts`

- [ ] **Step 1: Write failing tests**

Add at the top of `tests/memory.test.ts` imports (the file already imports `mkdirSync`, `mkdtempSync`, `writeFileSync` from `node:fs`):

```typescript
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
```

Add `execSync` import and `beforeEach` for the new describe block:

```typescript
import { execSync } from "node:child_process";
```

Add the import of the new function alongside the existing imports from `../src/core/memory.js`:

```typescript
import {
  buildMemoryInjection,
  checkLocalMemoryGitignore,
  parseMemoryConfig,
  readMemoryFile,
  resolveMemoryDir,
} from "../src/core/memory.js";
```

Add a new `describe` block at the end of the file:

```typescript
describe("checkLocalMemoryGitignore", () => {
  it("returns warning when local dir exists and is not gitignored", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toContain(".pi/agent-memory-local");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when local dir is gitignored", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });
    writeFileSync(join(tmpDir, ".gitignore"), ".pi/agent-memory-local/\n");

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when local dir does not exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when not in a git repo", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/memory.test.ts --reporter=verbose`
Expected: FAIL — `checkLocalMemoryGitignore` is not exported from memory.ts

- [ ] **Step 3: Implement checkLocalMemoryGitignore**

In `src/core/memory.ts`, add the import at the top (after the existing `node:fs` import):

```typescript
import { execSync } from "node:child_process";
```

Add the function after `resolveMemoryDir` (after line 88, before `readMemoryFile`):

```typescript
/**
 * Check whether `.pi/agent-memory-local/` is covered by `.gitignore`.
 * Returns a warning message string if not ignored, undefined otherwise.
 * Silently returns undefined if the directory doesn't exist, or if not in a git repo.
 */
export function checkLocalMemoryGitignore(cwd: string): string | undefined {
  const localDir = join(cwd, ".pi", "agent-memory-local");
  if (!existsSync(localDir)) return undefined;

  try {
    execSync(`git check-ignore -q "${localDir}"`, { cwd, stdio: "ignore" });
    // Exit code 0 means the path IS ignored — no warning needed
    return undefined;
  } catch {
    // Exit code non-zero: not ignored, or not a git repo.
    // Distinguish: check if we're in a git repo at all.
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    } catch {
      // Not a git repo — no warning
      return undefined;
    }
    return (
      "Local memory directory .pi/agent-memory-local/ is not in .gitignore. " +
      "Consider adding it to prevent committing agent memory files."
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/memory.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Wire one-time check in index.ts**

In `src/index.ts`, add the import near the other memory/core imports:

```typescript
import { checkLocalMemoryGitignore } from "./core/memory.js";
```

After the `applySettings()` call (around line 300, after `return deps;` is too late — add it just before `return deps;`), add the one-time check:

```typescript
  // One-time gitignore check for local memory
  const gitignoreWarning = checkLocalMemoryGitignore(process.cwd());
  if (gitignoreWarning) {
    (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
      {
        customType: "subagent-notification",
        content: gitignoreWarning,
        display: true,
      } as unknown as Parameters<typeof pi.sendMessage>[0],
      { deliverAs: "followUp" },
    );
  }
```

Note: This follows the existing `sendNudge` pattern in `index.ts:230` for casting `pi.sendMessage`. The check runs once at extension init — no session-level flag needed because `createRuntimeDeps` is called once per session.

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/core/memory.ts src/index.ts tests/memory.test.ts
git commit -m "feat: add checkLocalMemoryGitignore for local memory scope"
```

---

### Task 3: Per-Agent `maxDepth` Frontmatter

**Context:** The nicobailon reference uses `resolveChildMaxSubagentDepth(parentMaxDepth, agentMaxDepth)` which takes the `Math.min` of both. Our codebase checks depth in `AgentManager.spawn()` at line 81: `if (currentDepth >= this.maxDepth)`. We add `maxDepth` to the agent definition, parse it from frontmatter, and use `Math.min(agentDef.maxDepth, this.maxDepth)` in the depth check.

**Files:**
- Modify: `src/shared/types.ts:74-99`
- Modify: `src/core/agent-format.ts:323-330,447-472`
- Modify: `src/core/agent-manager.ts:81-85`
- Test: `tests/agent-format.test.ts`
- Test: `tests/agent-manager.test.ts`

- [ ] **Step 1: Write failing tests for parsing max_depth**

In `tests/agent-format.test.ts`, add a new `describe` block at the end (inside the existing outer `describe` if nested, or at the top level following the existing pattern — tests in this file use `test()` not `it()`):

```typescript
describe("max_depth frontmatter", () => {
  test("parses valid max_depth", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nmax_depth: 2\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBe(2);
    }
  });

  test("parses max_depth of 0", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nmax_depth: 0\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBe(0);
    }
  });

  test("ignores non-integer max_depth", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nmax_depth: abc\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBeUndefined();
    }
  });

  test("ignores negative max_depth", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nmax_depth: -1\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBeUndefined();
    }
  });

  test("max_depth is undefined when omitted", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent-format.test.ts --reporter=verbose`
Expected: FAIL — `maxDepth` property does not exist on the returned agent object

- [ ] **Step 3: Add `maxDepth` to AgentDefinition type**

In `src/shared/types.ts`, add `maxDepth` to `AgentDefinition` (after `maxTurns`, line 87):

```typescript
export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: string;
  subagentAgents: string[];
  enabled?: boolean;
  skills?: string[] | boolean;
  systemPrompt: string;
  sourcePath: string;
  // Phase 2: new frontmatter fields
  promptMode?: "replace" | "append";
  maxTurns?: number;
  maxDepth?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
  isolated?: boolean;
  isolation?: "worktree";
  extensions?: true | string[] | false;
  disallowedTools?: string[];
  toolBudget?: ToolBudgetConfig;
  // Phase 3: memory
  memory?: AgentMemoryConfig;
  // Phase 4: intercom
  intercom?: boolean;
}
```

- [ ] **Step 4: Parse `max_depth` in agent-format.ts**

In `src/core/agent-format.ts`, add parsing after the `max_turns` block (after line 330, before the `inherit_context` block):

```typescript
  // max_depth
  let maxDepth: number | undefined;
  if (frontmatter.max_depth !== undefined) {
    const parsed = Number(frontmatter.max_depth);
    if (Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed)) {
      maxDepth = parsed;
    }
  }
```

Add `maxDepth` to the return object (after `maxTurns` on line 459):

```typescript
      maxTurns,
      maxDepth,
      inheritContext,
```

- [ ] **Step 5: Run agent-format tests to verify they pass**

Run: `npx vitest run tests/agent-format.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 6: Write failing tests for per-agent maxDepth in spawn**

In `tests/agent-manager.test.ts`, add a new `describe` block (the file uses `it()` and `makeAgentDef()`):

```typescript
describe("per-agent maxDepth", () => {
  it("uses agent maxDepth when lower than global", () => {
    const manager = new AgentManager(5);
    const agentDef = makeAgentDef({ maxDepth: 2 });
    // Depth 2 should fail because 2 >= agent.maxDepth (2)
    expect(() =>
      manager.spawn({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 2,
        isBackground: true,
      }),
    ).toThrow(/nesting limit/i);
    manager.dispose();
  });

  it("allows spawn when depth is below agent maxDepth", () => {
    const manager = new AgentManager(5);
    const agentDef = makeAgentDef({ maxDepth: 3 });
    // Depth 1 should succeed (1 < 3)
    const id = manager.spawn({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 1,
      isBackground: true,
    });
    expect(id).toBeTruthy();
    manager.dispose();
  });

  it("uses global maxDepth when agent has no override", () => {
    const manager = new AgentManager(3);
    const agentDef = makeAgentDef(); // no maxDepth
    // Depth 2 should succeed (2 < 3)
    const id = manager.spawn({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 2,
      isBackground: true,
    });
    expect(id).toBeTruthy();
    manager.dispose();
  });

  it("uses global maxDepth when agent maxDepth is higher", () => {
    const manager = new AgentManager(2);
    const agentDef = makeAgentDef({ maxDepth: 5 });
    // Depth 2 should fail because 2 >= global maxDepth (2), even though agent allows 5
    expect(() =>
      manager.spawn({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 2,
        isBackground: true,
      }),
    ).toThrow(/nesting limit/i);
    manager.dispose();
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/agent-manager.test.ts --reporter=verbose`
Expected: FAIL — the first test should pass (depth 2 >= global 5 is false, so it doesn't throw); the agent maxDepth is not consulted yet.

- [ ] **Step 8: Implement per-agent maxDepth check in spawn()**

In `src/core/agent-manager.ts`, modify the depth check at line 81. Replace:

```typescript
    if (currentDepth >= this.maxDepth) {
```

With:

```typescript
    const effectiveMaxDepth = agentDef.maxDepth !== undefined
      ? Math.min(agentDef.maxDepth, this.maxDepth)
      : this.maxDepth;
    if (currentDepth >= effectiveMaxDepth) {
```

Also update the error message to use `effectiveMaxDepth`:

```typescript
      throw new Error(
        `Nested delegation blocked: current depth ${currentDepth} reached the nesting limit of ${effectiveMaxDepth}.`,
      );
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/agent-manager.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 10: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: No errors, all tests pass

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/core/agent-format.ts src/core/agent-manager.ts tests/agent-format.test.ts tests/agent-manager.test.ts
git commit -m "feat: add per-agent max_depth frontmatter field"
```

---

### Task 4: Batch Spawns in Chain Parallel Steps

**Context:** Currently, each parallel item in a chain individually calls `spawnAndWait` which calls `manager.spawn` → `checkSpawnLimit(this.spawnCount, 1, effectiveMax)`. If a parallel step has 4 items but only 2 budget remain, items 1-2 succeed, item 3 throws inside `Promise.all`, and the whole step fails messily.

The fix: add `getSpawnBudget?: () => number` to `ChainExecutionParams`. Before launching parallel items, check the budget and either reduce parallelism or throw a clear error. Wire it from both callers (`subagent.ts` and `slash-chain.ts`).

Reference: nicobailon's `reserveSubagentSpawns()` pre-checks budget before spawning. Our approach is structurally similar but uses a callback to keep the chain engine decoupled from the manager.

**Files:**
- Modify: `src/core/chain-execution.ts:36-52,120-203`
- Modify: `src/core/subagent.ts` (spawnAndWait closure)
- Modify: `src/core/slash-chain.ts` (spawnAndWait closure)
- Test: `tests/chain-execution.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/chain-execution.test.ts`, add a new `describe` block (the file uses `test()` and `makeMockDeps()`):

```typescript
describe("executeChain — spawn budget for parallel steps", () => {
  test("reduces parallelism when spawn budget is insufficient", async () => {
    const mockDeps = makeMockDeps([
      { result: "alpha result" },
      { result: "beta result" },
    ]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "alpha", task: "do alpha" },
          { agent: "beta", task: "do beta" },
          { agent: "gamma", task: "do gamma" },
          { agent: "delta", task: "do delta" },
        ],
      } satisfies ParallelStep,
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
      getSpawnBudget: () => 2,
    });

    // Only 2 items should have been spawned (budget = 2)
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);
  });

  test("spawns all items when budget is sufficient", async () => {
    const mockDeps = makeMockDeps([
      { result: "alpha result" },
      { result: "beta result" },
      { result: "gamma result" },
    ]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "alpha", task: "do alpha" },
          { agent: "beta", task: "do beta" },
          { agent: "gamma", task: "do gamma" },
        ],
      } satisfies ParallelStep,
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
      getSpawnBudget: () => 100,
    });

    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(3);
    expect(result.isError).toBe(false);
  });

  test("returns error when budget is zero", async () => {
    const mockDeps = makeMockDeps([]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "alpha", task: "do alpha" },
          { agent: "beta", task: "do beta" },
        ],
      } satisfies ParallelStep,
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
      getSpawnBudget: () => 0,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/spawn/i);
    expect(mockDeps.spawnAndWait).not.toHaveBeenCalled();
  });

  test("spawns all items when getSpawnBudget is not provided", async () => {
    const mockDeps = makeMockDeps([
      { result: "alpha result" },
      { result: "beta result" },
    ]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "alpha", task: "do alpha" },
          { agent: "beta", task: "do beta" },
        ],
      } satisfies ParallelStep,
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    // No budget function = no limit
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/chain-execution.test.ts --reporter=verbose`
Expected: FAIL — `getSpawnBudget` does not exist on `ChainExecutionParams`

- [ ] **Step 3: Add `getSpawnBudget` to ChainExecutionParams**

In `src/core/chain-execution.ts`, add to the `ChainExecutionParams` interface (after `isAsync`, around line 51):

```typescript
export interface ChainExecutionParams {
  steps: ChainStep[];
  task: string;
  spawnAndWait: (
    agentDef: AgentDefinition,
    prompt: string,
    cwd: string,
    options?: StepSpawnOptions,
  ) => Promise<{ id: string; record: AgentRecord }>;
  findAgent: (name: string) => AgentDefinition;
  cwd: string;
  runId: string;
  chainDir?: string;
  signal?: AbortSignal;
  onGraphUpdate?: (snapshot: WorkflowGraphSnapshot) => void;
  isAsync?: boolean;
  getSpawnBudget?: () => number;
}
```

- [ ] **Step 4: Implement budget check before parallel execution**

In `src/core/chain-execution.ts`, destructure `getSpawnBudget` from params at the top of `executeChain()` (line 69):

```typescript
  const { steps, task, spawnAndWait, findAgent, cwd, runId, signal, onGraphUpdate, getSpawnBudget } = params;
```

In the parallel step handler (after line 122, `const taskTemplates = template as string[];`), add the budget check before the existing `for` loop that marks items as running:

```typescript
      // Check spawn budget for batch
      let itemsToRun = step.parallel;
      if (getSpawnBudget) {
        const budget = getSpawnBudget();
        if (budget <= 0) {
          for (let i = 0; i < step.parallel.length; i++) {
            stepStatuses[flatIndex + i] = { status: "failed", error: "spawn limit reached" };
          }
          emitSnapshot(stepIndex, flatIndex);
          return {
            content: `Chain failed at parallel step ${stepIndex + 1}: subagent spawn limit reached for this session (0 budget remaining, ${step.parallel.length} items requested).`,
            isError: true,
            workflowGraph: finalSnapshot(),
          };
        }
        if (budget < step.parallel.length) {
          itemsToRun = step.parallel.slice(0, budget);
        }
      }
```

Then replace `step.parallel` with `itemsToRun` in the rest of the parallel handler. Change the "Mark all parallel items as running" loop:

```typescript
      for (let i = 0; i < itemsToRun.length; i++) {
        stepStatuses[flatIndex + i] = { status: "running" };
      }
```

And change the `.map()` call:

```typescript
      const promises = itemsToRun.map(async (item, i) => {
```

And update the `flatIndex` increment at the end of the parallel handler:

```typescript
      flatIndex += step.parallel.length; // always advance by full step size for graph indexing
```

(Keep this as `step.parallel.length`, not `itemsToRun.length`, because `flatIndex` tracks the position in `stepStatuses` which was allocated for the full step.)

- [ ] **Step 5: Apply same budget check for dynamic parallel steps**

In the dynamic parallel handler (around line 204+), apply the same budget logic. After items are resolved from the structured output and before the `.map()` call, add:

```typescript
      let dynamicItemsToRun = items;
      if (getSpawnBudget) {
        const budget = getSpawnBudget();
        if (budget <= 0) {
          stepStatuses[flatIndex] = { status: "failed", error: "spawn limit reached" };
          emitSnapshot(stepIndex, flatIndex);
          return {
            content: `Chain failed at dynamic step ${stepIndex + 1}: subagent spawn limit reached.`,
            isError: true,
            workflowGraph: finalSnapshot(),
          };
        }
        if (budget < items.length) {
          dynamicItemsToRun = items.slice(0, budget);
        }
      }
```

Then use `dynamicItemsToRun` instead of `items` in the subsequent `.map()` call.

- [ ] **Step 6: Run chain-execution tests to verify they pass**

Run: `npx vitest run tests/chain-execution.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 7: Add getMaxSpawnsPerSession getter and wire getSpawnBudget in subagent.ts**

First, add a public getter to `AgentManager`. In `src/core/agent-manager.ts`, add after `setMaxSpawnsPerSession` (line 558):

```typescript
  getMaxSpawnsPerSession(): number {
    return this.maxSpawnsPerSession;
  }
```

Then in `src/core/subagent.ts`, add the import of `resolveMaxSpawns` at the top:

```typescript
import { resolveMaxSpawns } from "./spawn-guard.js";
```

Find where `executeChain()` is called (two call sites: line 330 for background, line 347 for foreground). Add `getSpawnBudget` to both calls:

```typescript
getSpawnBudget: () => {
  const max = resolveMaxSpawns(deps.manager.getMaxSpawnsPerSession());
  return Math.max(0, max - deps.manager.getSpawnCount());
},
```

- [ ] **Step 8: Wire getSpawnBudget from slash-chain.ts**

In `src/core/slash-chain.ts`, find the `executeSlashChain()` function. It has two `executeChain()` call sites (line 549 background, line 563 foreground). Add the same `getSpawnBudget` callback.

Add the import at the top:

```typescript
import { resolveMaxSpawns } from "./spawn-guard.js";
```

Add to both `executeChain()` calls:

```typescript
getSpawnBudget: () => {
  const max = resolveMaxSpawns(deps.manager.getMaxSpawnsPerSession());
  return Math.max(0, max - deps.manager.getSpawnCount());
},
```

- [ ] **Step 9: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: No errors, all tests pass

- [ ] **Step 10: Commit**

```bash
git add src/core/chain-execution.ts src/core/agent-manager.ts src/core/subagent.ts src/core/slash-chain.ts tests/chain-execution.test.ts
git commit -m "feat: check spawn budget before parallel chain steps"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npx biome check src/ tests/`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 4: Verify no regressions in modified test files**

Run: `npx vitest run tests/settings.test.ts tests/memory.test.ts tests/agent-format.test.ts tests/agent-manager.test.ts tests/chain-execution.test.ts --reporter=verbose`
Expected: All pass
