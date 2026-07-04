# Spec 3: Parallel Execution

Coordinated parallel agent execution. Spawn multiple agents as a named group, track them as a unit, wait for all to complete, and aggregate results. Builds on Spec 2's individual background execution.

## Prerequisites

- Spec 2 completed (background spawning, concurrency queue, steer, resume, worktree isolation)

## Context

After Spec 2, the LLM can spawn background agents one at a time by calling the `subagent` tool repeatedly with `run_in_background: true`. This works but has limitations:

- No way to express "run these 5 tasks in parallel" as a single intent
- No group-level status tracking (must poll each agent individually)
- No way to wait for a batch to complete
- No way to abort or steer all agents in a group at once
- Results come back as individual notifications, not as an aggregated report

Spec 3 adds a coordination layer for parallel execution patterns.

## Scope

**In scope:**
- `parallel` tool — spawn multiple agents in one call as a named group
- `GroupTracker` — track groups of agents with group-level status
- `wait_for_group` tool — block until all agents in a group complete
- Group-level abort via `abort_group` parameter on `steer_subagent`
- Group-level steer via `steer_group` parameter on `steer_subagent`
- Aggregate result formatting
- Parallel progress rendering (multi-agent progress display during foreground wait)

**Out of scope:**
- UI features (fleet view, widget, conversation viewer) — Spec 4
- Scheduled execution — future
- Agent-to-agent communication — future
- DAG-based execution (dependencies between parallel agents) — future

## New Tool: parallel

Spawn multiple agents as a coordinated group.

```typescript
name: "parallel"

parameters: Type.Object({
  group_name: Type.String({
    description: "Name for this group of parallel agents (for tracking and display)"
  }),
  agents: Type.Array(Type.Object({
    agent: Type.String({ description: "Agent type to invoke" }),
    task: Type.String({ description: "Task for this agent" }),
    cwd: Type.Optional(Type.String({ description: "Working directory override" })),
    model: Type.Optional(Type.String({ description: "Model override" })),
    thinking: Type.Optional(Type.String({ description: "Thinking level" })),
    max_turns: Type.Optional(Type.Number({ description: "Turn limit", minimum: 1 })),
    isolated: Type.Optional(Type.Boolean({ description: "No extensions" })),
    isolation: Type.Optional(Type.Literal("worktree", { description: "Git worktree" })),
  }), {
    description: "Array of agents to run in parallel",
    minItems: 1,
    maxItems: 20,
  }),
  wait: Type.Optional(Type.Boolean({
    description: "If true, wait for all agents to complete and return aggregate results. Default: false (return group ID immediately)."
  })),
})
```

### Handler flow

1. **Validate** — check all agent names resolve, all cwds valid.
2. **Create group** — generate group ID, register with `GroupTracker`.
3. **Spawn agents** — for each entry in `agents[]`, call `manager.spawn()` with `groupId` set. Each gets its own agent ID.
4. **If `wait: false`** (default):
   - Return immediately with group ID and list of agent IDs.
   - Agents run in background. Completion notification sent when all finish (group join mode).
5. **If `wait: true`**:
   - Block until all agents in the group complete.
   - Stream parallel progress (multi-agent display) while waiting.
   - Return aggregate results.

### Return format (wait: false)

```
Spawned group "code-review" with 3 agents:
  - agent-1a2b3c: scout → "Find all TODO comments"
  - agent-4d5e6f: scout → "Check test coverage"
  - agent-7g8h9i: reviewer → "Review error handling"

Use get_subagent_result or wait_for_group to check results.
```

### Return format (wait: true)

```
Group "code-review" completed (3/3):

[1] scout — "Find all TODO comments" ✓
   12 turns · 5 tool uses · 8.2k tokens · 23s
   Result: Found 14 TODO comments across 8 files...

[2] scout — "Check test coverage" ✓
   8 turns · 3 tool uses · 5.1k tokens · 15s
   Result: Coverage is 78%. Missing tests for...

[3] reviewer — "Review error handling" ✗ error
   4 turns · 2 tool uses · 3.0k tokens · 8s
   Error: Context window exceeded
```

## New Tool: wait_for_group

Block until all agents in a group complete and return aggregate results.

```typescript
name: "wait_for_group"

parameters: Type.Object({
  group_id: Type.String({
    description: "The group ID to wait for (returned by parallel tool)."
  }),
  verbose: Type.Optional(Type.Boolean({
    description: "If true, include full conversations from all agents. Default: false."
  })),
})
```

### Handler flow

1. Look up group via `GroupTracker.getGroup(id)`.
2. If not found, return error.
3. If all agents already completed, return aggregate results immediately.
4. Otherwise, await `group.promise` (resolves when all agents finish).
5. Mark all agent results as consumed (suppress individual notifications).
6. Return aggregate results in the same format as `parallel` with `wait: true`.

## Extending steer_subagent

Add group-level operations to the existing `steer_subagent` tool:

```typescript
parameters: Type.Object({
  // Existing
  agent_id: Type.Optional(Type.String({ description: "Agent ID to steer." })),
  message: Type.Optional(Type.String({ description: "Message to send." })),

  // New — group operations
  group_id: Type.Optional(Type.String({ description: "Group ID to operate on." })),
  action: Type.Optional(Type.Literal("abort", {
    description: "Action to perform on group. Currently only 'abort' supported."
  })),
})
```

**Validation**: Either `agent_id` + `message` (individual steer) or `group_id` + `action` (group operation), not both.

**Group abort**: Abort all running agents in the group. Queued agents get status `"stopped"`.

**Group steer**: `group_id` + `message` (no `action`) sends the same steer message to all running agents in the group.

## GroupTracker

Tracks agent groups for coordinated lifecycle management.

```typescript
class GroupTracker {
  constructor(manager: AgentManager)      // Needs manager ref for abort/steer delegation
  createGroup(name: string, agentIds: string[]): string  // Returns group ID
  getGroup(id: string): GroupState | undefined
  addCompletion(agentId: string): void    // Called when an agent finishes
  abortGroup(id: string): number          // Calls manager.abort() per agent; returns count
  steerGroup(id: string, message: string): number  // Calls manager.steer() per agent; returns count
  listGroups(): GroupState[]
  clearCompleted(): void
}

interface GroupState {
  id: string
  name: string
  agentIds: string[]
  status: "running" | "completed" | "partial" | "aborted"
  createdAt: number
  completedAt?: number
  promise: Promise<void>              // Resolves when all agents complete
  resolve: () => void                 // Internal resolver
  results: Map<string, AgentRecord>   // Collected results
}
```

### Group status derivation

- `"running"` — at least one agent is running or queued
- `"completed"` — all agents finished (any combination of completed/steered/error)
- `"partial"` — some agents completed, some were aborted
- `"aborted"` — group was explicitly aborted via `abort_group`

### Integration with AgentManager

- `manager.spawn()` accepts optional `groupId` parameter.
- When an agent with a `groupId` completes, manager calls `GroupTracker.addCompletion(agentId)`.
- `GroupTracker` checks if all agents in the group are done. If so, resolves the group's promise.

### Integration with GroupJoinManager (from Spec 2)

When a group completes, the notification is sent via the `GroupJoinManager` with `joinMode: "group"` (always batched, regardless of the default join mode). Group notifications list all agents in the batch.

## Parallel Progress Rendering

When `parallel` is called with `wait: true`, show multi-agent progress while waiting.

### Display format

```
⠋ Group "code-review" (1/3 completed)
  ✓ scout: "Find all TODO comments" — completed (23s)
  ⠋ scout: "Check test coverage" — running (read: src/utils.ts)
  ⠋ reviewer: "Review error handling" — running (bash: npm test)
```

### Implementation

Use the same `onUpdate` streaming mechanism from Spec 1a's foreground execution, but tracking multiple records:

1. Create a progress tracker that polls all agent records in the group.
2. Use an 80ms interval timer (same as tintinweb's widget).
3. On each tick: read status, activity, duration from each record.
4. Format multi-line progress string.
5. Call `onUpdate()` to stream to the parent.
6. On group completion: clear progress, show final aggregate.

## SpawnOptions Extension

```typescript
interface SpawnOptions {
  // ... existing from Spec 2
  groupId?: string    // New — associates agent with a group
}
```

## AgentRecord Extension

```typescript
interface AgentRecord {
  // ... existing from Spec 2
  groupId?: string    // New — group this agent belongs to
}
```

## Module Changes

### New modules

| Module | Est. lines | Responsibility |
|--------|-----------|----------------|
| `core/group-tracker.ts` | 150-200 | Group lifecycle, status derivation, promise management |
| `core/parallel-progress.ts` | 80-120 | Multi-agent progress display for foreground wait |

### Modified modules

| Module | Change |
|--------|--------|
| `core/agent-manager.ts` | Accept `groupId` on spawn. Notify `GroupTracker` on completion. |
| `core/subagent.ts` | No change — `parallel` is a separate tool. |
| `shared/types.ts` | Add `GroupState`. Extend `SpawnOptions` and `AgentRecord` with `groupId`. |
| `index.ts` | Register `parallel` and `wait_for_group` tools. Extend `steer_subagent` schema. Create `GroupTracker`. Wire group notifications. |
| `tui/render.ts` | Add rendering for parallel tool call/result (group display). |
| `tui/agents-menu.ts` | Show groups in agents menu. |

### Unchanged

Agent runner, agent format, skill loader, artifacts, settings, worktree, output file, group join manager — all unchanged.

## Testing

### New tests

- **`group-tracker.test.ts`**: Test group creation. Test status derivation (running/completed/partial/aborted). Test promise resolution on all-complete. Test `abortGroup()`. Test `steerGroup()`. Test `clearCompleted()`.
- **`parallel-progress.test.ts`**: Test multi-agent progress formatting. Test status display per agent. Test completion transition.

### Updated tests

- **`agent-manager.test.ts`**: Test `groupId` flows through spawn. Test GroupTracker notification on completion.
- **`index.test.ts`**: Test `parallel` tool registration and handler. Test `wait_for_group` tool. Test `steer_subagent` group extensions. Test group notification wiring.
- **`render.test.ts`**: Test parallel tool rendering (group display).
- **`agents-menu.test.ts`**: Test group display in menu.

## Future Specs

- **Spec 4: UI features.** Agent widget (above editor, 80ms poll), fleet list (below editor, navigable), conversation viewer (overlay with steer/stop), enhanced notification renderer. Built on AgentRecord + GroupState from Specs 1-3.
