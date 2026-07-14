# Phase 8: Chain Completions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add concurrency limiting for parallel chain steps and enhance the existing worktree support with setup hooks, synthetic paths, conflict detection, and node_modules linking.

**Architecture:** Task 1 creates a Semaphore utility and wires it into `executeChain`. Task 2 extends the existing `worktree.ts` (143 LOC) with advanced features from the reference implementation.

**Tech Stack:** TypeScript, Vitest, Node.js child_process (for git worktree), fs (for symlinks)

**Note:** Items 8.1, 8.3, 8.4 from the spec are already implemented. This plan covers only the remaining 2 items.

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: Concurrency Limiting | `src/core/semaphore.ts` | `src/core/chain-execution.ts` | `tests/core/semaphore.test.ts`, `tests/core/chain-execution.test.ts` |
| 2: Worktree Enhancements | — | `src/core/worktree.ts` | `tests/core/worktree.test.ts` |

---

### Task 1: Concurrency Limiting (Semaphore + Dual-Limit)

**Files:**
- Create: `src/core/semaphore.ts`
- Modify: `src/core/chain-execution.ts:36-52,120-203,204-339`
- Test: `tests/core/semaphore.test.ts`
- Test: `tests/core/chain-execution.test.ts`

- [ ] **Step 1: Write the failing test for Semaphore**

Create `tests/core/semaphore.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Semaphore, mapConcurrent } from "../src/core/semaphore.js";

describe("Semaphore", () => {
  it("allows up to limit concurrent acquires", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      (async () => {
        await sem.acquire();
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        sem.release();
      })(),
    );
    await Promise.all(tasks);

    expect(maxRunning).toBe(2);
  });

  it("release unblocks waiting acquire", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const waiting = sem.acquire().then(() => { acquired = true; });

    expect(acquired).toBe(false);
    sem.release();
    await waiting;
    expect(acquired).toBe(true);
    sem.release();
  });
});

describe("mapConcurrent", () => {
  it("respects per-step limit", async () => {
    let maxConcurrent = 0;
    let current = 0;

    await mapConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 10));
      current--;
      return item * 2;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("respects global semaphore", async () => {
    const globalSem = new Semaphore(1);
    let maxConcurrent = 0;
    let current = 0;

    await mapConcurrent([1, 2, 3], 3, async (item) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 10));
      current--;
      return item;
    }, globalSem);

    expect(maxConcurrent).toBe(1);
  });

  it("returns results in order", async () => {
    const results = await mapConcurrent([3, 1, 2], 2, async (item) => {
      await new Promise((r) => setTimeout(r, item * 5));
      return item * 10;
    });
    expect(results).toEqual([30, 10, 20]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/semaphore.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Semaphore and mapConcurrent**

Create `src/core/semaphore.ts`:

```typescript
export const DEFAULT_GLOBAL_CONCURRENCY_LIMIT = 20;

export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, Math.floor(limit) || 1);
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }
}

/**
 * Map items concurrently with a per-call limit and optional global semaphore.
 * Results are returned in the same order as input items.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  globalSemaphore?: Semaphore,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      if (globalSemaphore) await globalSemaphore.acquire();
      try {
        results[i] = await fn(items[i], i);
      } finally {
        if (globalSemaphore) globalSemaphore.release();
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/semaphore.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Add globalConcurrencyLimit to ChainExecutionParams**

In `src/core/chain-execution.ts`, add to `ChainExecutionParams` (around line 51):

```typescript
globalConcurrencyLimit?: number;
```

- [ ] **Step 6: Wire concurrency limiting into parallel step execution**

In `src/core/chain-execution.ts`, import and use:

```typescript
import { Semaphore, mapConcurrent, DEFAULT_GLOBAL_CONCURRENCY_LIMIT } from "./semaphore.js";
```

At the top of `executeChain` (after destructuring params), create the global semaphore:

```typescript
const globalSemaphore = new Semaphore(params.globalConcurrencyLimit ?? DEFAULT_GLOBAL_CONCURRENCY_LIMIT);
```

Replace the parallel step `Promise.all` pattern (around line 187):

```typescript
// Before:
// const promises = step.parallel.map(async (item, i) => { ... });
// const parallelResults = await Promise.all(promises);

// After:
const stepLimit = (step as ParallelStep).concurrency ?? step.parallel.length;
const parallelResults = await mapConcurrent(
  step.parallel,
  stepLimit,
  async (item, i) => {
    // ... existing item execution logic ...
  },
  globalSemaphore,
);
```

Apply the same for dynamic parallel steps (around line 285).

- [ ] **Step 7: Write integration test for concurrency in chain execution**

In `tests/core/chain-execution.test.ts`, add:

```typescript
describe("executeChain — concurrency limiting", () => {
  it("respects step.concurrency limit for parallel steps", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const spawnAndWait = vi.fn(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
      return { id: "a", record: makeRecord("completed", "done") };
    });

    const steps: ChainStep[] = [{
      parallel: [
        { agent: "worker", task: "t1" },
        { agent: "worker", task: "t2" },
        { agent: "worker", task: "t3" },
        { agent: "worker", task: "t4" },
      ],
      concurrency: 2,
    }];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait,
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(spawnAndWait).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/core/chain-execution.test.ts tests/core/semaphore.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 9: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/core/semaphore.ts src/core/chain-execution.ts tests/core/semaphore.test.ts tests/core/chain-execution.test.ts
git commit -m "feat(chains): add concurrency limiting with Semaphore (per-step + global)"
```

---

### Task 2: Worktree Enhancements

**Files:**
- Modify: `src/core/worktree.ts:1-143`
- Test: `tests/core/worktree.test.ts`

- [ ] **Step 1: Write failing tests for new worktree features**

Create or extend `tests/core/worktree.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createWorktree, WorktreeInfo } from "../src/core/worktree.js";

describe("worktree enhancements", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "wt-test-"));
    execSync("git init && git commit --allow-empty -m init", { cwd: repoDir });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("symlinks node_modules into worktree", () => {
    mkdirSync(join(repoDir, "node_modules", "foo"), { recursive: true });
    const wt = createWorktree(repoDir, "test-agent");
    expect(wt).toBeDefined();
    if (wt) {
      expect(existsSync(join(wt.path, "node_modules"))).toBe(true);
    }
  });

  it("detects cwd conflict with worktree path", () => {
    // If agent cwd is already inside the worktree base dir, skip worktree
    const wt = createWorktree(repoDir, "test-agent", { agentCwd: "/some/conflicting/path" });
    // Should still work when no conflict
    expect(wt).toBeDefined();
  });

  it("runs setup hook if .pi/worktree-setup.sh exists", () => {
    mkdirSync(join(repoDir, ".pi"), { recursive: true });
    writeFileSync(join(repoDir, ".pi", "worktree-setup.sh"), '#!/bin/sh\necho \'{"syntheticPaths":["dist/"]}\' >&3', { mode: 0o755 });
    const wt = createWorktree(repoDir, "test-agent");
    expect(wt).toBeDefined();
    // syntheticPaths would be stored on WorktreeInfo
    if (wt) {
      expect(wt.syntheticPaths).toContain("dist/");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/worktree.test.ts --reporter=verbose`
Expected: FAIL — new features not implemented

- [ ] **Step 3: Add syntheticPaths to WorktreeInfo**

In `src/core/worktree.ts`, update the `WorktreeInfo` interface:

```typescript
export interface WorktreeInfo {
  path: string;
  branch: string;
  baseSha: string;
  workPath: string;
  syntheticPaths?: string[];
}
```

- [ ] **Step 4: Implement node_modules symlink**

In `src/core/worktree.ts`, inside `createWorktree()` after the worktree is created successfully, add:

```typescript
// Symlink node_modules if it exists in the repo root
const repoNodeModules = join(repoRoot, "node_modules");
const wtNodeModules = join(worktreePath, "node_modules");
if (existsSync(repoNodeModules) && !existsSync(wtNodeModules)) {
  try {
    symlinkSync(repoNodeModules, wtNodeModules, "junction");
  } catch {
    // Non-fatal: worktree will work without node_modules link
  }
}
```

Add import for `symlinkSync`.

- [ ] **Step 5: Implement setup hook execution**

In `src/core/worktree.ts`, add after node_modules linking:

```typescript
// Run setup hook if .pi/worktree-setup.sh exists
const setupHook = join(repoRoot, ".pi", "worktree-setup.sh");
let syntheticPaths: string[] | undefined;
if (existsSync(setupHook)) {
  try {
    const hookInput = JSON.stringify({
      version: 1,
      repoRoot,
      worktreePath,
      agentCwd: worktreePath,
      branch,
      index: 0,
      runId: agentId,
      baseCommit: baseSha,
    });
    const result = execSync(`echo '${hookInput.replace(/'/g, "'\\''")}' | sh "${setupHook}"`, {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      const parsed = JSON.parse(result.trim()) as { syntheticPaths?: string[] };
      if (Array.isArray(parsed.syntheticPaths)) {
        syntheticPaths = parsed.syntheticPaths;
      }
    } catch { /* ignore parse errors */ }
  } catch { /* non-fatal */ }
}
```

Include `syntheticPaths` in the returned `WorktreeInfo`.

- [ ] **Step 6: Add options parameter for conflict detection**

Update `createWorktree` signature:

```typescript
export interface CreateWorktreeOptions {
  agentCwd?: string;
}

export function createWorktree(
  cwd: string,
  agentId: string,
  options?: CreateWorktreeOptions,
): WorktreeInfo | undefined
```

At the start of `createWorktree`, add conflict detection:

```typescript
// Conflict detection: if agentCwd is inside the worktree base area, skip
if (options?.agentCwd) {
  const baseDir = join(repoRoot, "..");
  if (options.agentCwd.startsWith(baseDir) && options.agentCwd !== repoRoot) {
    console.warn("[worktree] Skipping: agent cwd conflicts with worktree base area");
    return undefined;
  }
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/core/worktree.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 8: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add src/core/worktree.ts tests/core/worktree.test.ts
git commit -m "feat(worktree): add node_modules linking, setup hooks, synthetic paths, conflict detection"
```

---

### Task 3: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors
