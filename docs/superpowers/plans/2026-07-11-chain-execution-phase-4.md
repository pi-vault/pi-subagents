# Chain Execution — Phase 4: Chain Append

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/core/chain-append.ts` — an in-memory queue for appending steps to running async chains.

**Architecture:** Simple Map-based queue keyed by chain ID. Steps are enqueued by `chain_append` tool calls and consumed by the chain execution loop between steps.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 complete (chain types in `src/shared/types.ts`).

---

### Task 5: Create `src/core/chain-append.ts`

**Files:**

- Create: `src/core/chain-append.ts`
- Test: `tests/chain-append.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/chain-append.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "vitest";
import {
  enqueueChainAppendRequest,
  consumeChainAppendRequests,
  countPendingChainAppendRequests,
  resetAppendQueues,
} from "../src/core/chain-append.js";
import type { ChainStep } from "../src/shared/types.js";

afterEach(() => {
  resetAppendQueues();
});

describe("chain append queue", () => {
  test("enqueue and consume returns steps", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "t" }];
    enqueueChainAppendRequest("chain-1", steps);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(1);
    expect(consumed[0]!.agent).toBe("a");
  });

  test("consume clears the queue", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    consumeChainAppendRequests("chain-1");

    const second = consumeChainAppendRequests("chain-1");
    expect(second).toHaveLength(0);
  });

  test("multiple enqueues accumulate", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "1" }]);
    enqueueChainAppendRequest("chain-1", [{ agent: "b", task: "2" }]);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(2);
  });

  test("countPendingChainAppendRequests returns correct count", () => {
    expect(countPendingChainAppendRequests("chain-1")).toBe(0);
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    expect(countPendingChainAppendRequests("chain-1")).toBe(1);
    enqueueChainAppendRequest("chain-1", [{ agent: "b", task: "t" }]);
    expect(countPendingChainAppendRequests("chain-1")).toBe(2);
  });

  test("different chain IDs are independent", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    enqueueChainAppendRequest("chain-2", [{ agent: "b", task: "t" }]);

    expect(consumeChainAppendRequests("chain-1")).toHaveLength(1);
    expect(consumeChainAppendRequests("chain-2")).toHaveLength(1);
  });

  test("consume for unknown chain returns empty array", () => {
    expect(consumeChainAppendRequests("nonexistent")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-append.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-append.ts`**

Create `src/core/chain-append.ts`:

```typescript
import type { ChainStep } from "../shared/types.js";

const pendingQueues = new Map<string, ChainStep[][]>();

export function enqueueChainAppendRequest(
  chainId: string,
  steps: ChainStep[],
): void {
  let queue = pendingQueues.get(chainId);
  if (!queue) {
    queue = [];
    pendingQueues.set(chainId, queue);
  }
  queue.push(steps);
}

export function consumeChainAppendRequests(chainId: string): ChainStep[] {
  const queue = pendingQueues.get(chainId);
  if (!queue || queue.length === 0) return [];
  const all = queue.flat();
  queue.length = 0;
  return all;
}

export function countPendingChainAppendRequests(chainId: string): number {
  return pendingQueues.get(chainId)?.length ?? 0;
}

export function resetAppendQueues(): void {
  pendingQueues.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-append.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/chain-append.ts tests/chain-append.test.ts
git commit -m "feat(chain-append): add in-memory queue for async chain step appending"
```
