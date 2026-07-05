# Phase 4: Smart Batch Detection for Parallel Agent Grouping

> **Implementation Status (2025-07):** NOT IMPLEMENTED. The explicit `parallel` tool and `wait_for_group` tool do not exist. A lightweight `smart-batch-tracker.ts` provides automatic notification grouping but not explicit parallel orchestration. This phase remains future work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect when the LLM spawns multiple background agents in the same turn and group their completion notifications into a single consolidated nudge.

**Architecture:** Add batch tracking state + debounce timer to `index.ts`. When 2+ background agents are spawned within a 100ms window, register them as a group with the existing `GroupJoinManager`. Defer individual notifications for batched agents until the batch finalizes.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, typebox, Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-3-parallel-execution-design.md`

**Prerequisite:** Phase 3 (Background/Async Execution) must be complete. (It is.)

**Reference:** `tintinweb-pi-subagents/src/index.ts` lines 574-615 — the proven pattern.

---

## Design Summary

The LLM already achieves parallel execution by sending multiple `subagent` tool calls with `run_in_background: true` in a single message. The pi framework executes these concurrently. What's missing is **grouping their completion notifications** so the LLM gets one consolidated nudge instead of N individual ones.

The mechanism:
1. Each background spawn registers the agent ID + joinMode in a batch list
2. A 100ms debounce timer resets on each new registration
3. When the timer fires (`finalizeBatch`):
   - If 2+ smart/group-mode agents are in the batch: register a group with `GroupJoinManager`
   - Otherwise: send individual nudges for any already-completed agents

The existing `GroupJoinManager` (from Phase 3) handles everything else — holding results until all agents complete, timeout-based partial delivery, straggler re-batching.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/index.ts` | Add batch tracking, finalizeBatch, wire into onComplete |
| Modify | `src/core/subagent.ts` | Register background agents with batch tracker via deps |
| Modify | `src/shared/runtime-deps.ts` | Add `registerBatchAgent` to RuntimeDeps |
| Create | `tests/batch-detection.test.ts` | Test smart grouping behavior |

---

### Task 4.1: Add batch tracking to RuntimeDeps and index.ts

**Files:**
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `registerBatchAgent` to RuntimeDeps interface**

```typescript
// In src/shared/runtime-deps.ts — add to RuntimeDeps interface:
registerBatchAgent?: (id: string) => void;
```

This gives the subagent tool a way to register background agents into the current batch without knowing the batch internals.

- [ ] **Step 2: Add batch tracking state to `createRuntimeDeps` in index.ts**

Add the following state after the `groupJoin` and `manager` creation:

```typescript
// ---- Batch tracking for smart join mode ----
// Collects background agent IDs spawned in the current turn for smart grouping.
// Uses a debounced timer: each new agent resets the 100ms window so that all
// parallel tool calls are captured in the same batch.
let currentBatchAgents: { id: string; joinMode: JoinMode }[] = [];
let batchFinalizeTimer: ReturnType<typeof setTimeout> | undefined;
let batchCounter = 0;
```

- [ ] **Step 3: Implement `finalizeBatch` function**

```typescript
function finalizeBatch() {
  batchFinalizeTimer = undefined;
  const batchAgents = [...currentBatchAgents];
  currentBatchAgents = [];

  const smartAgents = batchAgents.filter(
    (a) => a.joinMode === "smart" || a.joinMode === "group",
  );
  if (smartAgents.length >= 2) {
    const groupId = `batch-${++batchCounter}`;
    const ids = smartAgents.map((a) => a.id);
    groupJoin.registerGroup(groupId, ids);
    // Retroactively process agents that already completed during the debounce window.
    // Their onComplete fired but was deferred (agent was in currentBatchAgents),
    // so we feed them into the group now.
    for (const id of ids) {
      const record = manager.getRecord(id);
      if (!record) continue;
      record.groupId = groupId;
      if (record.completedAt != null && !record.resultConsumed) {
        groupJoin.onAgentComplete(record);
      }
    }
  } else {
    // No group formed — send individual nudges for any agents that completed
    // during the debounce window and had their notification deferred.
    for (const { id } of batchAgents) {
      const record = manager.getRecord(id);
      if (record?.completedAt != null && !record.resultConsumed) {
        const notification = formatTaskNotification(record);
        (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
          {
            customType: "subagent-notification",
            content: notification,
            display: true,
            details: buildNotificationDetails(record),
          } as unknown as Parameters<typeof pi.sendMessage>[0],
          { deliverAs: "followUp", triggerTurn: true },
        );
      }
    }
  }
}
```

- [ ] **Step 4: Modify the onComplete callback to defer notifications for batched agents**

In the `AgentManager` onComplete callback, before the existing `groupJoin.onAgentComplete(record)` call, check if the agent is in the current batch. If so, skip the nudge — `finalizeBatch` will handle it.

```typescript
const manager = new AgentManager(3, (record) => {
  // ... existing lifecycle event emission and persistence ...

  if (record.resultConsumed) return;

  // If agent is in the current batch, defer notification to finalizeBatch
  if (currentBatchAgents.some((a) => a.id === record.id)) {
    return;
  }

  const joinResult = groupJoin.onAgentComplete(record);
  if (joinResult === "pass") {
    // ... existing delayed nudge logic ...
  }
});
```

- [ ] **Step 5: Implement the `registerBatchAgent` function**

```typescript
function registerBatchAgent(id: string): void {
  const joinMode = deps.defaultJoinMode ?? "smart";
  if (joinMode === "async") return; // async mode = no batching

  currentBatchAgents.push({ id, joinMode });
  // Debounce: reset timer on each new agent so parallel tool calls
  // dispatched across multiple event loop ticks are captured together
  if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
  batchFinalizeTimer = setTimeout(finalizeBatch, 100);
}
```

Add it to the deps object:
```typescript
const deps: RuntimeDeps = {
  // ... existing fields ...
  registerBatchAgent,
};
```

- [ ] **Step 6: Clean up batch timer on session shutdown**

In the existing `session_shutdown` handler:
```typescript
pi.on("session_shutdown", () => {
  if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
  deps.manager.abortAll();
  deps.manager.dispose();
  deps.groupJoin?.dispose();
});
```

- [ ] **Step 7: Run `pnpm check`, verify pass**

---

### Task 4.2: Wire subagent tool to register background agents in batch

**Files:**
- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Call `deps.registerBatchAgent` in the background spawn path**

In `subagent.ts`, after the background `manager.spawn()` call returns the `id`:

```typescript
// Background spawn path
if (params.run_in_background) {
  const id = deps.manager.spawn(ctx, agentDef, {
    ...spawnOptions,
    isBackground: true,
    isolation: params.isolation as "worktree" | undefined,
    onSessionCreated: (session) => { /* ... existing ... */ },
  });

  // Register in batch tracker for smart group detection
  deps.registerBatchAgent?.(id);

  const bgRecord = deps.manager.getRecord(id);
  // ... existing return ...
}
```

- [ ] **Step 2: Run `pnpm check`, verify pass, commit**

```bash
git add src/index.ts src/core/subagent.ts src/shared/runtime-deps.ts
git commit -m "feat: add smart batch detection for parallel agent grouping"
```

---

### Task 4.3: Write tests for batch detection

**Files:**
- Create: `tests/batch-detection.test.ts`

- [ ] **Step 1: Write unit tests**

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("smart batch detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups 2+ background agents spawned within 100ms into a single group notification", async () => {
    // Mock GroupJoinManager, AgentManager
    // Call registerBatchAgent("a1"), registerBatchAgent("a2")
    // Advance timer 100ms
    // Verify groupJoin.registerGroup was called with both IDs
  });

  it("does not group a single background agent", async () => {
    // Call registerBatchAgent("a1")
    // Advance timer 100ms
    // Verify groupJoin.registerGroup was NOT called
    // Verify individual nudge sent for completed agent
  });

  it("handles agents that complete before finalizeBatch fires", async () => {
    // Call registerBatchAgent("a1"), registerBatchAgent("a2")
    // Simulate a1 completing (onComplete fires, but agent is in currentBatch so deferred)
    // Advance timer 100ms
    // Verify a1 is retroactively processed through groupJoin.onAgentComplete
  });

  it("does not batch when defaultJoinMode is async", async () => {
    // Set defaultJoinMode to "async"
    // Call registerBatchAgent("a1"), registerBatchAgent("a2")
    // Advance timer 100ms
    // Verify no group formed
  });

  it("debounce resets on each new agent", async () => {
    // Call registerBatchAgent("a1")
    // Advance 80ms
    // Call registerBatchAgent("a2")
    // Advance 80ms (total 160ms from first agent, 80ms from second)
    // Verify finalizeBatch has NOT fired yet
    // Advance 20ms more (100ms from second agent)
    // Verify finalizeBatch fired and grouped both agents
  });
});
```

- [ ] **Step 2: Run tests, iterate until green**

- [ ] **Step 3: Run `pnpm check`, verify full pass, commit**

```bash
git add tests/batch-detection.test.ts
git commit -m "test: add batch detection tests for smart parallel grouping"
```

---

## Notes

- The existing `NUDGE_HOLD_MS` (200ms) in `index.ts` is > the batch debounce (100ms), so there's a natural safety margin. But the explicit `currentBatchAgents` check in `onComplete` is cleaner and more reliable than timing assumptions.
- The `GroupJoinManager` already handles: holding results until all agents complete, 30s timeout for partial delivery, 15s straggler re-batching, and the delivery callback.
- No new tools are needed. The LLM achieves parallelism by sending multiple `subagent` calls with `run_in_background: true` in one message — a pattern already documented in the tool description.
- The `groupId` field on `AgentRecord` is already defined in `src/shared/types.ts` from Phase 3.
