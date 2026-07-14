# Phase 6: Quick Wins Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 4 small deferred items that follow existing codebase patterns (maxSpawnsPerSession in settings, .gitignore notification, per-agent maxDepth frontmatter, batch spawns in chains).

**Architecture:** Each task is independent (no ordering dependency). All follow existing patterns in the codebase — settings applier pattern, frontmatter parsing pattern, spawn-guard pattern, and memory module pattern.

**Tech Stack:** TypeScript, Vitest, Node.js child_process (for git check-ignore)

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: maxSpawnsPerSession settings | — | `src/core/settings.ts`, `src/index.ts` | `tests/core/settings.test.ts` |
| 2: .gitignore notification | — | `src/core/memory.ts` | `tests/core/memory.test.ts` |
| 3: per-agent maxDepth | — | `src/shared/types.ts`, `src/core/agent-format.ts`, `src/core/agent-manager.ts` | `tests/core/agent-format.test.ts`, `tests/core/agent-manager.test.ts` |
| 4: batch spawns | — | `src/core/chain-execution.ts` | `tests/core/chain-execution.test.ts` |

---

### Task 1: `maxSpawnsPerSession` in Settings

**Files:**
- Modify: `src/core/settings.ts:9-96`
- Modify: `src/index.ts:293-300`
- Test: `tests/core/settings.test.ts`

- [ ] **Step 1: Write the failing test for sanitize()**

In `tests/core/settings.test.ts`, add:

```typescript
describe("sanitize maxSpawnsPerSession", () => {
  it("accepts valid integer within range", () => {
    const result = sanitize({ maxSpawnsPerSession: 50 });
    expect(result.maxSpawnsPerSession).toBe(50);
  });

  it("rejects non-integer", () => {
    const result = sanitize({ maxSpawnsPerSession: 3.5 });
    expect(result.maxSpawnsPerSession).toBeUndefined();
  });

  it("rejects values below 1", () => {
    const result = sanitize({ maxSpawnsPerSession: 0 });
    expect(result.maxSpawnsPerSession).toBeUndefined();
  });

  it("rejects values above 10000", () => {
    const result = sanitize({ maxSpawnsPerSession: 99999 });
    expect(result.maxSpawnsPerSession).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/settings.test.ts --reporter=verbose`
Expected: FAIL — `sanitize` does not return `maxSpawnsPerSession`

- [ ] **Step 3: Add `maxSpawnsPerSession` to SubagentsSettings interface**

In `src/core/settings.ts`, line 15 (after `fleetView`):

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

- [ ] **Step 4: Add validation in sanitize()**

In `src/core/settings.ts`, inside `sanitize()` function (after the `maxConcurrent` validation block around line 38):

```typescript
if (
  Number.isInteger(r.maxSpawnsPerSession) &&
  (r.maxSpawnsPerSession as number) >= 1 &&
  (r.maxSpawnsPerSession as number) <= 10000
) {
  out.maxSpawnsPerSession = r.maxSpawnsPerSession as number;
}
```

- [ ] **Step 5: Add `setMaxSpawnsPerSession` to SettingsAppliers and applySettings()**

In `src/core/settings.ts`:

Add to `SettingsAppliers` interface (after line 21):
```typescript
export interface SettingsAppliers {
  setMaxConcurrent: (n: number) => void;
  setDefaultJoinMode: (mode: JoinMode) => void;
  setWidgetMode?: (mode: WidgetMode) => void;
  setFleetView?: (enabled: boolean) => void;
  setMaxSpawnsPerSession?: (n: number) => void;
}
```

Add to `applySettings()` function body (after the `fleetView` line):
```typescript
if (typeof s.maxSpawnsPerSession === "number") appliers.setMaxSpawnsPerSession?.(s.maxSpawnsPerSession);
```

- [ ] **Step 6: Write the failing test for applySettings()**

In `tests/core/settings.test.ts`:

```typescript
describe("applySettings maxSpawnsPerSession", () => {
  it("calls setMaxSpawnsPerSession when value present", () => {
    const appliers = {
      setMaxConcurrent: vi.fn(),
      setDefaultJoinMode: vi.fn(),
      setMaxSpawnsPerSession: vi.fn(),
    };
    applySettings({ maxSpawnsPerSession: 25 }, appliers);
    expect(appliers.setMaxSpawnsPerSession).toHaveBeenCalledWith(25);
  });

  it("does not call setMaxSpawnsPerSession when undefined", () => {
    const appliers = {
      setMaxConcurrent: vi.fn(),
      setDefaultJoinMode: vi.fn(),
      setMaxSpawnsPerSession: vi.fn(),
    };
    applySettings({}, appliers);
    expect(appliers.setMaxSpawnsPerSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/core/settings.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 8: Wire applier in index.ts**

In `src/index.ts`, inside the `applySettings()` call (around line 293-300), add:

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
git add src/core/settings.ts src/index.ts tests/core/settings.test.ts
git commit -m "feat: add maxSpawnsPerSession to settings appliers"
```

---

### Task 2: `.gitignore` Notification for Local Memory

**Files:**
- Modify: `src/core/memory.ts:52-88`
- Test: `tests/core/memory.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/core/memory.test.ts`, add:

```typescript
import { execSync } from "node:child_process";

describe("gitignore notification for local memory", () => {
  it("calls onGitignoreWarning when local dir is not ignored", async () => {
    // Setup: create a temp git repo without .gitignore
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-test-"));
    execSync("git init", { cwd: tmpDir });
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });

    const onWarning = vi.fn();
    const result = resolveMemoryDir("local", "test-agent", tmpDir, { onGitignoreWarning: onWarning });

    expect(result).toHaveProperty("dir");
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining(".pi/agent-memory-local"));

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not call onGitignoreWarning when local dir is ignored", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-test-"));
    execSync("git init", { cwd: tmpDir });
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });
    writeFileSync(join(tmpDir, ".gitignore"), ".pi/agent-memory-local/\n");

    const onWarning = vi.fn();
    resolveMemoryDir("local", "test-agent", tmpDir, { onGitignoreWarning: onWarning });

    expect(onWarning).not.toHaveBeenCalled();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("only warns once per session", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-test-"));
    execSync("git init", { cwd: tmpDir });
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });

    const onWarning = vi.fn();
    resolveMemoryDir("local", "agent-a", tmpDir, { onGitignoreWarning: onWarning });
    resolveMemoryDir("local", "agent-b", tmpDir, { onGitignoreWarning: onWarning });

    expect(onWarning).toHaveBeenCalledTimes(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/memory.test.ts --reporter=verbose`
Expected: FAIL — `resolveMemoryDir` does not accept options parameter / `onGitignoreWarning` not called

- [ ] **Step 3: Implement the gitignore check**

In `src/core/memory.ts`, add at the top of the file:

```typescript
import { execSync } from "node:child_process";

let gitignoreWarningEmitted = false;
```

Add an options parameter to `resolveMemoryDir`:

```typescript
export interface ResolveMemoryOptions {
  onGitignoreWarning?: (message: string) => void;
}
```

After the `local` scope directory is resolved (after line 71), before the security checks:

```typescript
// Gitignore notification for local scope
if (scope === "local" && !gitignoreWarningEmitted && options?.onGitignoreWarning) {
  const localDir = join(cwd, ".pi", "agent-memory-local");
  if (existsSync(localDir)) {
    try {
      execSync(`git check-ignore -q "${localDir}"`, { cwd, stdio: "ignore" });
    } catch {
      // exit code non-zero means not ignored
      gitignoreWarningEmitted = true;
      options.onGitignoreWarning(
        `Local memory directory .pi/agent-memory-local/ is not in .gitignore. ` +
        `Consider adding it to prevent committing agent memory files.`
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/memory.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Add resetGitignoreWarning for test isolation**

```typescript
export function resetGitignoreWarning(): void {
  gitignoreWarningEmitted = false;
}
```

Call this in the test `beforeEach`:
```typescript
beforeEach(() => {
  resetGitignoreWarning();
});
```

- [ ] **Step 6: Run tests again**

Run: `npx vitest run tests/core/memory.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/core/memory.ts tests/core/memory.test.ts
git commit -m "feat: emit gitignore warning for local memory scope"
```

---

### Task 3: Per-Agent `maxDepth` Frontmatter

**Files:**
- Modify: `src/shared/types.ts:74-99`
- Modify: `src/core/agent-format.ts:323-330,447-472`
- Modify: `src/core/agent-manager.ts:81-85`
- Test: `tests/core/agent-format.test.ts`
- Test: `tests/core/agent-manager.test.ts`

- [ ] **Step 1: Write the failing test for parsing max_depth**

In `tests/core/agent-format.test.ts`, add:

```typescript
describe("max_depth frontmatter", () => {
  it("parses valid max_depth", () => {
    const content = `---
name: test-agent
description: A test agent
max_depth: 2
---

System prompt here.`;
    const result = parseAgentContent(content, "/test/agent.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBe(2);
    }
  });

  it("allows max_depth of 0", () => {
    const content = `---
name: test-agent
description: A test agent
max_depth: 0
---

System prompt here.`;
    const result = parseAgentContent(content, "/test/agent.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBe(0);
    }
  });

  it("ignores non-integer max_depth", () => {
    const content = `---
name: test-agent
description: A test agent
max_depth: abc
---

System prompt here.`;
    const result = parseAgentContent(content, "/test/agent.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBeUndefined();
    }
  });

  it("ignores negative max_depth", () => {
    const content = `---
name: test-agent
description: A test agent
max_depth: -1
---

System prompt here.`;
    const result = parseAgentContent(content, "/test/agent.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.maxDepth).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/agent-format.test.ts --reporter=verbose`
Expected: FAIL — `maxDepth` property does not exist on `AgentDefinition`

- [ ] **Step 3: Add `maxDepth` to AgentDefinition type**

In `src/shared/types.ts`, inside the `AgentDefinition` interface (after the `maxTurns` field):

```typescript
maxDepth?: number;
```

- [ ] **Step 4: Parse `max_depth` in agent-format.ts**

In `src/core/agent-format.ts`, after the `max_turns` parsing block (around line 330), add:

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

In the return object of `parseAgentContent()` (around line 459, after `maxTurns`), add:

```typescript
maxDepth,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/agent-format.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Write the failing test for spawn depth check**

In `tests/core/agent-manager.test.ts`, add:

```typescript
describe("per-agent maxDepth", () => {
  it("uses agent maxDepth when lower than global", () => {
    // Setup: manager with global maxDepth=3
    // Spawn at depth 2 with agent.maxDepth=2 should fail
    const manager = createTestManager({ maxDepth: 3 });
    const agentDef = createTestAgentDef({ maxDepth: 2 });
    
    // Mock or set current depth to 2
    // Attempt spawn should throw because 2 >= agent.maxDepth(2)
    expect(() => manager.spawn(mockCtx, agentDef, { depth: 2 })).toThrow(/depth/i);
  });

  it("uses global maxDepth when agent has no override", () => {
    const manager = createTestManager({ maxDepth: 3 });
    const agentDef = createTestAgentDef({}); // no maxDepth
    
    // Depth 2 should succeed (2 < 3)
    expect(() => manager.spawn(mockCtx, agentDef, { depth: 2 })).not.toThrow();
  });

  it("allows spawn when depth is below agent maxDepth", () => {
    const manager = createTestManager({ maxDepth: 5 });
    const agentDef = createTestAgentDef({ maxDepth: 3 });
    
    // Depth 1 should succeed (1 < 3)
    expect(() => manager.spawn(mockCtx, agentDef, { depth: 1 })).not.toThrow();
  });
});
```

Note: Adapt to the actual test patterns in `tests/core/agent-manager.test.ts`. Use existing helper functions (`createTestManager`, `createTestAgentDef`, etc.) if they exist.

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/core/agent-manager.test.ts --reporter=verbose`
Expected: FAIL — spawn does not check per-agent maxDepth

- [ ] **Step 8: Implement per-agent maxDepth check in spawn()**

In `src/core/agent-manager.ts`, modify the depth check (around line 81):

```typescript
// Before (line 81):
// if (currentDepth >= this.maxDepth) {

// After:
const effectiveMaxDepth = agentDef.maxDepth !== undefined
  ? Math.min(agentDef.maxDepth, this.maxDepth)
  : this.maxDepth;
if (currentDepth >= effectiveMaxDepth) {
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/core/agent-manager.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 10: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: No errors, all tests pass

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/core/agent-format.ts src/core/agent-manager.ts tests/core/agent-format.test.ts tests/core/agent-manager.test.ts
git commit -m "feat: add per-agent max_depth frontmatter field"
```

---

### Task 4: Batch Spawns in `checkSpawnLimit`

**Files:**
- Modify: `src/core/chain-execution.ts:120-203`
- Test: `tests/core/chain-execution.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/core/chain-execution.test.ts`, add:

```typescript
describe("batch spawn limit check for parallel steps", () => {
  it("reduces parallelism when spawn budget is insufficient", async () => {
    // Setup: chain execution with maxSpawnsPerSession=5, spawnCount=3
    // A parallel step with 4 items should only spawn 2 (budget = 5-3 = 2)
    const params = createTestChainParams({
      getSpawnCount: () => 3,
      maxSpawnsPerSession: 5,
    });
    const step = createParallelStep(4); // 4 items

    const result = await executeChainStep(step, params);
    
    // Only 2 items should have been spawned
    expect(params.spawnAndWait).toHaveBeenCalledTimes(2);
  });

  it("spawns all items when budget is sufficient", async () => {
    const params = createTestChainParams({
      getSpawnCount: () => 0,
      maxSpawnsPerSession: 40,
    });
    const step = createParallelStep(3);

    await executeChainStep(step, params);
    
    expect(params.spawnAndWait).toHaveBeenCalledTimes(3);
  });

  it("blocks entirely when budget is zero", async () => {
    const params = createTestChainParams({
      getSpawnCount: () => 40,
      maxSpawnsPerSession: 40,
    });
    const step = createParallelStep(3);

    await expect(executeChainStep(step, params)).rejects.toThrow(/spawn limit/i);
  });
});
```

Note: Adapt test helpers to match existing patterns in `tests/core/chain-execution.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/chain-execution.test.ts --reporter=verbose`
Expected: FAIL — no batch limit check exists

- [ ] **Step 3: Add getSpawnCount and maxSpawnsPerSession to ChainExecutionParams**

In `src/core/chain-execution.ts`, add to the `ChainExecutionParams` interface (around line 51):

```typescript
getSpawnCount?: () => number;
maxSpawnsPerSession?: number;
```

- [ ] **Step 4: Implement batch spawn check before parallel execution**

In `src/core/chain-execution.ts`, before the parallel step `Promise.all` (around line 130, after marking items as running):

```typescript
// Check spawn limit for batch
let itemsToSpawn = step.parallel;
if (params.getSpawnCount && params.maxSpawnsPerSession) {
  const currentCount = params.getSpawnCount();
  const budget = Math.max(0, params.maxSpawnsPerSession - currentCount);
  if (budget === 0) {
    throw new Error(
      `Subagent spawn limit reached for this session (${currentCount}/${params.maxSpawnsPerSession} used, ` +
      `${step.parallel.length} requested for parallel step). Complete the work directly or start a new session.`
    );
  }
  if (budget < step.parallel.length) {
    itemsToSpawn = step.parallel.slice(0, budget);
  }
}
```

Then use `itemsToSpawn` instead of `step.parallel` in the `.map()` call.

- [ ] **Step 5: Apply same logic for dynamic parallel steps**

Apply the same budget check before the dynamic parallel `Promise.all` (around line 285). Use `items.length` instead of `step.parallel.length`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/core/chain-execution.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Wire getSpawnCount from caller**

Find where `ChainExecutionParams` is constructed (in `src/core/slash-chain.ts` or the chain command handler). Add:

```typescript
getSpawnCount: () => manager.spawnCount,
maxSpawnsPerSession: resolveMaxSpawns(manager.maxSpawnsPerSession),
```

If `spawnCount` is private, add a getter:
```typescript
// In agent-manager.ts
get currentSpawnCount(): number {
  return this.spawnCount;
}
```

- [ ] **Step 8: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: No errors, all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/core/chain-execution.ts src/core/agent-manager.ts tests/core/chain-execution.test.ts
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

Run: `npx eslint src/ tests/ --ext .ts`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 4: Verify no regressions in existing behavior**

Run: `npx vitest run tests/core/agent-manager.test.ts tests/core/settings.test.ts tests/core/memory.test.ts tests/core/chain-execution.test.ts --reporter=verbose`
Expected: All pass
