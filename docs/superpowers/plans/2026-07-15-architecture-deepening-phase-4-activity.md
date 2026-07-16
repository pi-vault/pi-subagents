# Agent Live Activity Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Agent record the single source of live activity for every TUI adapter.

**Architecture:** Add live state to AgentRecord and update it in AgentManager first. Then migrate all TUI adapters and delete the mirrored activity module.

**Tech Stack:** TypeScript, Vitest, Pi TUI.

---

## Commit sequence

1. `refactor: add agent live record`
2. `refactor: migrate tui activity state`

### Task 1: Add the live Agent record

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `tests/agent-manager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Drive runner callbacks and assert one record holds active tools, response text, max turns, turns, tool uses, and usage. Include overlapping same-name tools and one end event removing one entry.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/agent-manager.test.ts
```

- [ ] **Step 3: Implement record-owned live state**

```ts
export interface AgentLiveState {
  activeTools: string[];
  responseText: string;
  maxTurns?: number;
}

export interface AgentRecord {
  // existing fields
  live: AgentLiveState;
}
```

Initialize/update it in AgentManager and add `onActivity?: (record: AgentRecord) => void` to `SpawnOptions`.

- [ ] **Step 4: Verify and commit the green core task**

```bash
pnpm vitest run tests/agent-manager.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/types.ts src/core/agent-manager.ts tests/agent-manager.test.ts
git add src/shared/types.ts src/core/agent-manager.ts tests/agent-manager.test.ts
git commit -m "refactor: add agent live record"
```

### Task 2: Migrate TUI activity state

**Files:**
- Modify: `src/core/subagent.ts`
- Modify: `src/tui/agent-widget.ts`
- Modify: `src/tui/fleet-list.ts`
- Modify: `src/tui/conversation-viewer.ts`
- Delete: `src/tui/activity.ts`
- Modify: `tests/subagent.test.ts`
- Modify: `tests/agent-widget.test.ts`
- Modify: `tests/fleet-list.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Construct Agent records only and assert widget, fleet, and viewer render `record.live`; assert terminal cleanup clears active tools.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/subagent.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts
```

- [ ] **Step 3: Migrate adapters and delete the mirror**

Use `record.live` for foreground, widget, fleet, and viewer updates; delete `createActivityTracker`, `agentActivity`, RuntimeDeps activity fields, and their fallback calculations.

- [ ] **Step 4: Verify and commit the green migration task**

```bash
pnpm vitest run tests/subagent.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/subagent.ts src/tui/agent-widget.ts src/tui/fleet-list.ts src/tui/conversation-viewer.ts
git add src/core/subagent.ts src/tui/agent-widget.ts src/tui/fleet-list.ts src/tui/conversation-viewer.ts tests/subagent.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts
git rm src/tui/activity.ts
git commit -m "refactor: migrate tui activity state"
