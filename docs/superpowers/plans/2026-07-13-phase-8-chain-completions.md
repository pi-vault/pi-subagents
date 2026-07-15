# Phase 8: Chain Completions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add concurrency limiting for parallel chain steps and enhance the existing worktree support with setup hooks, synthetic paths, conflict detection, and node_modules linking.

**Architecture:** Task 1 creates a Semaphore utility and wires it into `executeChain`. Task 2 extends the existing `worktree.ts` (143 LOC) with advanced features from the reference implementation.

**Tech Stack:** TypeScript, Vitest, Node.js child_process (for git worktree), fs (for symlinks)

**Reference:** `nicobailon-pi-subagents` — `src/runs/shared/parallel-utils.ts` (Semaphore + mapConcurrent), `src/runs/shared/worktree.ts` (600 LOC with hooks, symlinking, conflict detection)

**Note:** Items 8.1, 8.3, 8.4 from the spec are already implemented. This plan covers only the remaining 2 items.

---

## File Map

| Task                     | Create                  | Modify                        | Test                                                       |
| ------------------------ | ----------------------- | ----------------------------- | ---------------------------------------------------------- |
| 1: Concurrency Limiting  | `src/core/semaphore.ts` | `src/core/chain-execution.ts` | `tests/semaphore.test.ts`, `tests/chain-execution.test.ts` |
| 2: Worktree Enhancements | —                       | `src/core/worktree.ts`        | `tests/worktree.test.ts`                                   |

---

### Task 1: Concurrency Limiting (Semaphore + Dual-Limit)

**Files:**

- Create: `src/core/semaphore.ts`
- Modify: `src/core/chain-execution.ts` (lines 36-53: params interface, lines 67-70: executeChain entry, lines 154-211: parallel Promise.all, lines 332-358: dynamic Promise.all)
- Test: `tests/semaphore.test.ts` (new)
- Test: `tests/chain-execution.test.ts` (extend)

- [ ] **Step 1: Write the failing test for Semaphore**

Create `tests/semaphore.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Semaphore, mapConcurrent } from "../src/core/semaphore.js";

describe("Semaphore", () => {
  it("allows up to limit concurrent acquires", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, () =>
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
    const waiting = sem.acquire().then(() => {
      acquired = true;
    });

    expect(acquired).toBe(false);
    sem.release();
    await waiting;
    expect(acquired).toBe(true);
    sem.release();
  });

  it("floors invalid limits to 1", () => {
    const sem = new Semaphore(0);
    // Should not throw — treated as limit=1
    expect(sem.acquire()).resolves.toBeUndefined();
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

    await mapConcurrent(
      [1, 2, 3],
      3,
      async (item) => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((r) => setTimeout(r, 10));
        current--;
        return item;
      },
      globalSem,
    );

    expect(maxConcurrent).toBe(1);
  });

  it("returns results in order", async () => {
    const results = await mapConcurrent([3, 1, 2], 2, async (item) => {
      await new Promise((r) => setTimeout(r, item * 5));
      return item * 10;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("handles empty input", async () => {
    const results = await mapConcurrent([], 4, async (item) => item);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/semaphore.test.ts --reporter=verbose`
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
  if (items.length === 0) return [];
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

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/semaphore.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Add globalConcurrencyLimit to ChainExecutionParams**

In `src/core/chain-execution.ts`, add to `ChainExecutionParams` interface (after line 52, before the closing `}`):

```typescript
globalConcurrencyLimit?: number;
```

- [ ] **Step 6: Wire concurrency limiting into parallel step execution**

In `src/core/chain-execution.ts`:

**6a. Add import** (after existing imports at top of file):

```typescript
import {
  Semaphore,
  mapConcurrent,
  DEFAULT_GLOBAL_CONCURRENCY_LIMIT,
} from "./semaphore.js";
```

**6b. Create global semaphore** at the top of `executeChain()` (after line 70 where params are destructured):

```typescript
const globalSemaphore = new Semaphore(
  params.globalConcurrencyLimit ?? DEFAULT_GLOBAL_CONCURRENCY_LIMIT,
);
```

**6c. Replace parallel step execution** (lines 154-211).

Replace:

```typescript
const promises = itemsToRun.map(async (item, i) => {
  // ... existing ~55 lines of item execution logic ...
});

const parallelResults = await Promise.all(promises);
```

With:

```typescript
const stepLimit = step.concurrency ?? itemsToRun.length;
const parallelResults = await mapConcurrent(
  itemsToRun,
  stepLimit,
  async (item, i) => {
    // ... same item execution logic preserved exactly ...
  },
  globalSemaphore,
);
```

The item execution logic inside the callback is unchanged — it's the same body from the old `.map()` (lines 155-208). Only the outer structure changes from `Promise.all(items.map(...))` to `mapConcurrent(items, limit, ..., globalSem)`.

**6d. Replace dynamic parallel step execution** (lines 332-358).

Replace:

```typescript
const dynamicResults = await Promise.all(
  dynamicItemsToRun.map(async (item) => {
    // ... existing dynamic item logic ...
  }),
);
```

With:

```typescript
const dynStepLimit = step.concurrency ?? dynamicItemsToRun.length;
const dynamicResults = await mapConcurrent(
  dynamicItemsToRun,
  dynStepLimit,
  async (item) => {
    let taskStr = step.parallel.task ?? "{previous}";
    const itemName = step.expand.item ?? "item";
    if (item && typeof item === "object") {
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
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

    const fullPrompt = [dynPrefix, taskStr, dynSuffix]
      .filter(Boolean)
      .join("\n\n");

    const { record } = await spawnAndWait(
      dynAgentDef,
      fullPrompt,
      cwd,
      dynOptions,
    );
    return { output: record.result ?? "", status: record.status };
  },
  globalSemaphore,
);
```

- [ ] **Step 7: Write integration test for concurrency in chain execution**

In `tests/chain-execution.test.ts`, add a new `describe` block at the end of the file (after the "spawn budget" tests):

```typescript
// ---------------------------------------------------------------------------
// Concurrency limiting (Phase 8)
// ---------------------------------------------------------------------------

describe("executeChain — concurrency limiting", () => {
  test("respects step.concurrency limit for parallel steps", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const spawnAndWait = vi.fn(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
      return { id: "a", record: makeRecord("completed", "done") };
    });

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "worker", task: "t1" },
          { agent: "worker", task: "t2" },
          { agent: "worker", task: "t3" },
          { agent: "worker", task: "t4" },
        ],
        concurrency: 2,
      },
    ];

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

  test("globalConcurrencyLimit caps across all parallel items", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const spawnAndWait = vi.fn(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
      return { id: "a", record: makeRecord("completed", "done") };
    });

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "worker", task: "t1" },
          { agent: "worker", task: "t2" },
          { agent: "worker", task: "t3" },
        ],
        // No per-step limit, so defaults to items.length (3)
      },
    ];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait,
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-run",
      globalConcurrencyLimit: 1,
    });

    // Global limit of 1 means at most 1 concurrent spawn
    expect(maxConcurrent).toBe(1);
    expect(spawnAndWait).toHaveBeenCalledTimes(3);
  });

  test("without concurrency field, all parallel items run at once", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const spawnAndWait = vi.fn(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
      return { id: "a", record: makeRecord("completed", "done") };
    });

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "worker", task: "t1" },
          { agent: "worker", task: "t2" },
          { agent: "worker", task: "t3" },
        ],
      },
    ];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait,
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-run",
    });

    // Default: step limit = items.length, global limit = 20 => all 3 run at once
    expect(maxConcurrent).toBe(3);
    expect(spawnAndWait).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/chain-execution.test.ts tests/semaphore.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 9: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/core/semaphore.ts src/core/chain-execution.ts tests/semaphore.test.ts tests/chain-execution.test.ts
git commit -m "feat(chains): add concurrency limiting with Semaphore (per-step + global)"
```

---

### Task 2: Worktree Enhancements

**Files:**

- Modify: `src/core/worktree.ts` (143 LOC)
- Test: `tests/worktree.test.ts` (extend existing 61-line file)

**Reference:** `nicobailon-pi-subagents/src/runs/shared/worktree.ts` — `linkNodeModulesIfPresent()`, setup hook via stdin/stdout, `findWorktreeTaskCwdConflict()`, synthetic paths tracking.

- [ ] **Step 1: Write failing tests for new worktree features**

Extend existing `tests/worktree.test.ts` by adding a new `describe` block:

```typescript
import {
  createWorktree,
  cleanupWorktree,
  findWorktreeTaskCwdConflict,
} from "../src/core/worktree.js";

// ... (keep existing tests above) ...

describe("worktree — node_modules linking", () => {
  const testDir = join(tmpdir(), `pi-wt-link-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: testDir,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], {
      cwd: testDir,
      stdio: "pipe",
    });
    writeFileSync(join(testDir, "file.txt"), "hello");
    execFileSync("git", ["add", "-A"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: testDir,
      stdio: "pipe",
    });
  });

  afterEach(() => {
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: testDir,
        stdio: "pipe",
      });
    } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  it("symlinks node_modules into worktree when present in repo root", () => {
    mkdirSync(join(testDir, "node_modules", "foo"), { recursive: true });
    const wt = createWorktree(testDir, "link-test");
    if (!wt) throw new Error("Expected wt");
    expect(existsSync(join(wt.path, "node_modules"))).toBe(true);
    // syntheticPaths should include node_modules
    expect(wt.syntheticPaths).toContain("node_modules");
    cleanupWorktree(testDir, wt, "test");
  });

  it("does not create symlink when no node_modules in repo", () => {
    const wt = createWorktree(testDir, "no-nm-test");
    if (!wt) throw new Error("Expected wt");
    expect(existsSync(join(wt.path, "node_modules"))).toBe(false);
    expect(wt.syntheticPaths ?? []).not.toContain("node_modules");
    cleanupWorktree(testDir, wt, "test");
  });
});

describe("worktree — setup hook", () => {
  const testDir = join(tmpdir(), `pi-wt-hook-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: testDir,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], {
      cwd: testDir,
      stdio: "pipe",
    });
    writeFileSync(join(testDir, "file.txt"), "hello");
    execFileSync("git", ["add", "-A"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: testDir,
      stdio: "pipe",
    });
  });

  afterEach(() => {
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: testDir,
        stdio: "pipe",
      });
    } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  it("runs .pi/worktree-setup.sh and captures syntheticPaths from stdout", () => {
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    // Hook reads JSON from stdin, outputs JSON with syntheticPaths to stdout
    writeFileSync(
      join(testDir, ".pi", "worktree-setup.sh"),
      '#!/bin/sh\ncat > /dev/null\necho \'{"syntheticPaths":["dist/","build/"]}\'',
      { mode: 0o755 },
    );
    const wt = createWorktree(testDir, "hook-test");
    if (!wt) throw new Error("Expected wt");
    expect(wt.syntheticPaths).toContain("dist/");
    expect(wt.syntheticPaths).toContain("build/");
    cleanupWorktree(testDir, wt, "test");
  });

  it("ignores hook errors gracefully", () => {
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    writeFileSync(
      join(testDir, ".pi", "worktree-setup.sh"),
      "#!/bin/sh\nexit 1",
      { mode: 0o755 },
    );
    const wt = createWorktree(testDir, "hook-fail-test");
    // Should still succeed — hook failure is non-fatal
    expect(wt).toBeDefined();
    if (wt) cleanupWorktree(testDir, wt, "test");
  });

  it("skips hook when .pi/worktree-setup.sh does not exist", () => {
    const wt = createWorktree(testDir, "no-hook-test");
    expect(wt).toBeDefined();
    if (wt) {
      expect(wt.syntheticPaths ?? []).toEqual([]);
      cleanupWorktree(testDir, wt, "test");
    }
  });
});

describe("findWorktreeTaskCwdConflict", () => {
  it("returns undefined when no task has a cwd override", () => {
    const result = findWorktreeTaskCwdConflict(
      [{ agent: "a" }, { agent: "b" }],
      "/project",
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when task cwd matches shared cwd", () => {
    const result = findWorktreeTaskCwdConflict(
      [{ agent: "a", cwd: "/project" }, { agent: "b" }],
      "/project",
    );
    expect(result).toBeUndefined();
  });

  it("returns the first conflicting task", () => {
    const result = findWorktreeTaskCwdConflict(
      [
        { agent: "a" },
        { agent: "b", cwd: "/other/dir" },
        { agent: "c", cwd: "/another" },
      ],
      "/project",
    );
    expect(result).toEqual({ index: 1, agent: "b", cwd: "/other/dir" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worktree.test.ts --reporter=verbose`
Expected: FAIL — new exports not found, new features not implemented

- [ ] **Step 3: Add syntheticPaths to WorktreeInfo and export conflict detection type**

In `src/core/worktree.ts`, update the `WorktreeInfo` interface and add new types:

```typescript
export interface WorktreeInfo {
  path: string;
  branch: string;
  baseSha: string;
  workPath: string;
  syntheticPaths?: string[];
}

export interface WorktreeTaskCwdConflict {
  index: number;
  agent: string;
  cwd: string;
}
```

- [ ] **Step 4: Implement findWorktreeTaskCwdConflict**

Add to `src/core/worktree.ts` (pure function, no dependencies):

```typescript
/**
 * Detect per-task cwd overrides that conflict with worktree isolation.
 * Worktree agents share a single working directory (the worktree root or subdirectory).
 * Per-task cwd overrides break this isolation — return the first conflict found.
 */
export function findWorktreeTaskCwdConflict(
  tasks: ReadonlyArray<{ agent: string; cwd?: string }>,
  sharedCwd: string,
): WorktreeTaskCwdConflict | undefined {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    if (task.cwd && task.cwd !== sharedCwd) {
      return { index: i, agent: task.agent, cwd: task.cwd };
    }
  }
  return undefined;
}
```

- [ ] **Step 5: Implement node_modules symlinking**

In `src/core/worktree.ts`, add import for `symlinkSync` to the existing `fs` import:

```typescript
import { existsSync, realpathSync, symlinkSync } from "node:fs";
```

Inside `createWorktree()`, after the successful `git worktree add` (before the `return`), add node_modules linking:

```typescript
// Symlink node_modules if present in repo root
const syntheticPaths: string[] = [];
const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: worktreePath,
  stdio: "pipe",
  timeout: 5000,
})
  .toString()
  .trim();
const repoNodeModules = join(topLevel, "node_modules");
const wtNodeModules = join(worktreePath, "node_modules");
if (existsSync(repoNodeModules) && !existsSync(wtNodeModules)) {
  try {
    symlinkSync(repoNodeModules, wtNodeModules);
    syntheticPaths.push("node_modules");
  } catch {
    // Non-fatal: worktree works without node_modules link
  }
}
```

Note: We already have `topLevel` from earlier in the function (line 27-33 in current code). Reuse that variable rather than calling git again. The `topLevel` obtained earlier is for the _source_ repo; in the new worktree, the toplevel is `worktreePath` itself (since we create detached at the root). So the source for `node_modules` should come from the original `topLevel` captured before the worktree creation:

```typescript
// Symlink node_modules if present in repo root
const syntheticPaths: string[] = [];
const repoNodeModules = join(realpathSync(topLevel), "node_modules");
const wtNodeModules = join(worktreePath, "node_modules");
if (existsSync(repoNodeModules) && !existsSync(wtNodeModules)) {
  try {
    symlinkSync(repoNodeModules, wtNodeModules);
    syntheticPaths.push("node_modules");
  } catch {
    // Non-fatal: worktree works without node_modules link
  }
}
```

This requires hoisting `topLevel` out of the try block where it's currently scoped. Refactor the function so `topLevel` is available in the post-creation section.

- [ ] **Step 6: Implement setup hook execution (stdin/stdout)**

After node_modules linking, add setup hook execution:

```typescript
// Run setup hook if .pi/worktree-setup.sh exists
const setupHook = join(realpathSync(topLevel), ".pi", "worktree-setup.sh");
if (existsSync(setupHook)) {
  try {
    const hookInput = JSON.stringify({
      version: 1,
      repoRoot: realpathSync(topLevel),
      worktreePath,
      agentCwd: subdir ? join(worktreePath, subdir) : worktreePath,
      branch,
      index: 0,
      runId: agentId,
      baseCommit: baseSha,
    });
    const hookOutput = execFileSync(setupHook, [], {
      cwd: worktreePath,
      input: hookInput,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      const parsed = JSON.parse(hookOutput.trim()) as {
        syntheticPaths?: string[];
      };
      if (Array.isArray(parsed.syntheticPaths)) {
        for (const p of parsed.syntheticPaths) {
          if (
            typeof p === "string" &&
            p &&
            !p.startsWith("/") &&
            !p.includes("..")
          ) {
            syntheticPaths.push(p);
          }
        }
      }
    } catch {
      /* ignore JSON parse errors from hook */
    }
  } catch {
    /* hook failure is non-fatal */
  }
}
```

Key design decisions matching the reference:

- Hook receives JSON via **stdin** (not fd 3)
- Hook outputs JSON to **stdout**
- Timeout: 30s
- Non-fatal on failure
- Synthetic paths validated: must be relative, no `..` escaping

Include `syntheticPaths` in the returned `WorktreeInfo`:

```typescript
return {
  path: worktreePath,
  branch,
  baseSha,
  workPath: subdir ? join(worktreePath, subdir) : worktreePath,
  syntheticPaths: syntheticPaths.length > 0 ? syntheticPaths : undefined,
};
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/worktree.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 8: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add src/core/worktree.ts tests/worktree.test.ts
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

- [ ] **Step 3: Run lint**

Run: `npx biome lint .`
Expected: No errors
