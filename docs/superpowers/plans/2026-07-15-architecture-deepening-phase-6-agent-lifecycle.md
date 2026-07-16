# Agent Lifecycle Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentManager own Agent terminal transitions and custom-tool setup without hidden dependency bags.

**Architecture:** Replace `_deps` with a narrow factory first. Then centralize terminal mutation behind one private AgentManager helper while retaining existing notification eligibility.

**Tech Stack:** TypeScript, Vitest, Pi coding-agent.

---

## Commit sequence

1. `refactor: replace spawn dependency bag`
2. `refactor: centralize agent lifecycle transitions`

### Task 1: Replace the spawn dependency bag

**Files:**
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/child-subagent-tool.ts`
- Modify: `src/core/rpc.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/agent-manager.test.ts`
- Modify: `tests/child-subagent-tool.test.ts`

- [ ] **Step 1: Write failing factory tests**

Assert a factory receives the generated Agent ID and effective worktree path, creates child/supervisor tools where needed, and does not receive a RuntimeDeps bag.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/child-subagent-tool.test.ts
```

- [ ] **Step 3: Replace `_deps` with the factory**

```ts
export interface SpawnOptions {
  // existing fields
  createCustomTools?: (context: {
    id: string;
    cwd: string;
    parentAgentId?: string;
  }) => unknown[];
}
```

Build child/subagent and supervisor tools in the caller factory. Invoke it after worktree selection, then remove `_deps` and its casts.

- [ ] **Step 4: Verify and commit the green factory task**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/child-subagent-tool.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/agent-manager.ts src/core/subagent.ts src/core/child-subagent-tool.ts src/core/rpc.ts src/shared/types.ts
git add src/core/agent-manager.ts src/core/subagent.ts src/core/child-subagent-tool.ts src/core/rpc.ts src/shared/types.ts tests/agent-manager.test.ts tests/child-subagent-tool.test.ts
git commit -m "refactor: replace spawn dependency bag"
```

### Task 2: Centralize Agent lifecycle transitions

**Files:**
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `tests/agent-manager.test.ts`
- Modify: `tests/subagent.test.ts`

- [ ] **Step 1: Write failing transition tests**

Cover normal success/error, queued start failure, background Chain completion, resume, running/queued abort, and worktree cleanup. Assert status, timestamp, duration, cleanup, and completion behavior are finalised once without duplicate notification.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/subagent.test.ts
```

- [ ] **Step 3: Centralize the implementation**

Add one private helper that applies terminal status/result/error, timestamps/duration, best-effort cleanup, background counters, existing completion eligibility, and queue draining. Route runner, Chain, queue, resume, and abort paths through it. Remove public `registerExternalRecord` and `notifyComplete`; retain `fireAndForgetChain` as the Chain entry point.

- [ ] **Step 4: Verify and commit the green lifecycle task**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/subagent.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/agent-manager.ts src/core/subagent.ts tests/agent-manager.test.ts tests/subagent.test.ts
git add src/core/agent-manager.ts src/core/subagent.ts tests/agent-manager.test.ts tests/subagent.test.ts
git commit -m "refactor: centralize agent lifecycle transitions"
