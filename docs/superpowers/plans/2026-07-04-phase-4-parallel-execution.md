# Phase 4: Parallel Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add coordinated parallel agent execution so the LLM can spawn groups of agents, wait for them, and manage them as a unit.

**Architecture:** Create `GroupTracker` for group lifecycle and promise management. Create `parallel-progress.ts` for multi-agent progress display. Register `parallel` and `wait_for_group` tools. Extend `steer_subagent` with group operations. Wire `GroupTracker` notifications into `AgentManager`.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, typebox, Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-3-parallel-execution-design.md`

**Prerequisite:** Phase 3 (Background/Async Execution) must be complete.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/core/group-tracker.ts` | Group lifecycle, status derivation, promise management |
| Create | `src/core/parallel-progress.ts` | Multi-agent progress display |
| Create | `tests/group-tracker.test.ts` | Group status/completion tests |
| Create | `tests/parallel-progress.test.ts` | Progress formatting tests |
| Modify | `src/core/agent-manager.ts` | Accept `groupId`, notify `GroupTracker` on completion |
| Modify | `src/shared/types.ts` | `GroupState`, extend `SpawnOptions`/`AgentRecord` with `groupId` |
| Modify | `src/index.ts` | Register `parallel`, `wait_for_group`, extend `steer_subagent` |
| Modify | `src/tui/render.ts` | Parallel tool call/result rendering |
| Modify | `src/tui/agents-menu.ts` | Show groups |

---

### Task 4.1: Create GroupTracker

**Files:**
- Create: `src/core/group-tracker.ts`
- Create: `tests/group-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { GroupTracker } from "../src/core/group-tracker.js";

describe("GroupTracker", () => {
  it("creates a group and returns an ID", () => {
    const mockManager = { abort: vi.fn(), steer: vi.fn(), getRecord: vi.fn() };
    const tracker = new GroupTracker(mockManager as never);
    const id = tracker.createGroup("test-group", ["a1", "a2", "a3"]);
    expect(id).toBeTruthy();
    const group = tracker.getGroup(id);
    expect(group).toBeTruthy();
    expect(group!.name).toBe("test-group");
    expect(group!.agentIds).toEqual(["a1", "a2", "a3"]);
    expect(group!.status).toBe("running");
  });

  it("resolves group promise when all agents complete", async () => {
    const mockManager = { abort: vi.fn(), steer: vi.fn(), getRecord: vi.fn() };
    const tracker = new GroupTracker(mockManager as never);
    const id = tracker.createGroup("test", ["a1", "a2"]);
    const group = tracker.getGroup(id)!;

    tracker.addCompletion("a1");
    expect(group.status).toBe("running");

    tracker.addCompletion("a2");
    await group.promise;
    expect(group.status).toBe("completed");
  });

  it("abortGroup aborts all running agents", () => {
    const mockManager = {
      abort: vi.fn().mockReturnValue(true),
      steer: vi.fn(),
      getRecord: vi.fn(),
    };
    const tracker = new GroupTracker(mockManager as never);
    const id = tracker.createGroup("test", ["a1", "a2"]);
    const count = tracker.abortGroup(id);
    expect(count).toBe(2);
    expect(mockManager.abort).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Implement GroupTracker**

```typescript
export interface GroupState {
  id: string;
  name: string;
  agentIds: string[];
  status: "running" | "completed" | "partial" | "aborted";
  createdAt: number;
  completedAt?: number;
  promise: Promise<void>;
  resolve: () => void;
  completedAgents: Set<string>;
}

let groupCounter = 0;

export class GroupTracker {
  private groups = new Map<string, GroupState>();
  private agentToGroup = new Map<string, string>();

  constructor(
    private manager: {
      abort: (id: string) => boolean;
      steer: (id: string, msg: string) => boolean;
    },
  ) {}

  createGroup(name: string, agentIds: string[]): string {
    const id = `group-${Date.now().toString(36)}-${(groupCounter++).toString(36)}`;
    let resolve: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });

    const state: GroupState = {
      id,
      name,
      agentIds,
      status: "running",
      createdAt: Date.now(),
      promise,
      resolve: resolve!,
      completedAgents: new Set(),
    };
    this.groups.set(id, state);
    for (const agentId of agentIds) {
      this.agentToGroup.set(agentId, id);
    }
    return id;
  }

  getGroup(id: string): GroupState | undefined {
    return this.groups.get(id);
  }

  getGroupForAgent(agentId: string): string | undefined {
    return this.agentToGroup.get(agentId);
  }

  addCompletion(agentId: string): void {
    const groupId = this.agentToGroup.get(agentId);
    if (!groupId) return;
    const group = this.groups.get(groupId);
    if (!group) return;
    group.completedAgents.add(agentId);
    if (group.completedAgents.size >= group.agentIds.length) {
      group.status = "completed";
      group.completedAt = Date.now();
      group.resolve();
    }
  }

  abortGroup(id: string): number {
    const group = this.groups.get(id);
    if (!group) return 0;
    let count = 0;
    for (const agentId of group.agentIds) {
      if (this.manager.abort(agentId)) count++;
    }
    group.status = "aborted";
    return count;
  }

  steerGroup(id: string, message: string): number {
    const group = this.groups.get(id);
    if (!group) return 0;
    let count = 0;
    for (const agentId of group.agentIds) {
      if (this.manager.steer(agentId, message)) count++;
    }
    return count;
  }

  listGroups(): GroupState[] {
    return [...this.groups.values()];
  }

  clearCompleted(): void {
    for (const [id, group] of this.groups) {
      if (group.status !== "running") {
        for (const agentId of group.agentIds) {
          this.agentToGroup.delete(agentId);
        }
        this.groups.delete(id);
      }
    }
  }
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/group-tracker.ts tests/group-tracker.test.ts
git commit -m "feat: add GroupTracker for parallel agent group lifecycle"
```

### Task 4.2: Create parallel progress renderer

**Files:**
- Create: `src/core/parallel-progress.ts`
- Create: `tests/parallel-progress.test.ts`

- [ ] **Step 1: Write tests for progress formatting**

- [ ] **Step 2: Implement multi-agent progress display**

Format multi-line progress string showing status of each agent in a group.

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/parallel-progress.ts tests/parallel-progress.test.ts
git commit -m "feat: add parallel progress renderer for group execution"
```

### Task 4.3: Register parallel and wait_for_group tools

**Files:**
- Modify: `src/index.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Extend `SpawnOptions` and `AgentRecord` with `groupId`**

- [ ] **Step 2: Wire GroupTracker notifications in AgentManager**

When an agent with a `groupId` completes, call `groupTracker.addCompletion(agentId)`.

- [ ] **Step 3: Register `parallel` tool**

```typescript
pi.registerTool({
  name: "parallel",
  label: "Parallel",
  description: "Spawn multiple agents as a coordinated group.",
  parameters: Type.Object({
    group_name: Type.String({ description: "Name for this group" }),
    agents: Type.Array(
      Type.Object({
        agent: Type.String({ description: "Agent type to invoke" }),
        task: Type.String({ description: "Task for this agent" }),
        cwd: Type.Optional(Type.String()),
        model: Type.Optional(Type.String()),
        thinking: Type.Optional(Type.String()),
        max_turns: Type.Optional(Type.Number({ minimum: 1 })),
        isolated: Type.Optional(Type.Boolean()),
        isolation: Type.Optional(Type.String()),
      }),
      { minItems: 1, maxItems: 20 },
    ),
    wait: Type.Optional(
      Type.Boolean({
        description: "Wait for all agents to complete. Default: false.",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    // Validate all agents
    // Create group via GroupTracker
    // Spawn each agent via manager.spawn() with groupId
    // If wait: true, await group.promise and return aggregate results
    // If wait: false, return group ID and agent IDs
  },
});
```

- [ ] **Step 4: Register `wait_for_group` tool**

- [ ] **Step 5: Extend `steer_subagent` with group operations**

Add `group_id` and `action` parameters to the existing `steer_subagent` schema.

- [ ] **Step 6: Add parallel result rendering to `tui/render.ts`**

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: register parallel, wait_for_group tools; extend steer_subagent with group operations"
```
