# Spawn Limits & Tool Budgets

Two safety features that prevent runaway subagent behavior: a per-session spawn cap and a per-run tool call budget with soft/hard thresholds.

Reference implementation: [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) v0.34.0.

---

## 1. Spawn Limits Per Session

### Purpose

Cap the total number of subagent spawns within a single parent session. Prevents a misbehaving agent from spawning unlimited children, which would consume resources and potentially recurse out of control.

### Module: `src/core/spawn-guard.ts`

Pure-function module. No side effects, no imports from pi packages. Exports:

```typescript
export const DEFAULT_MAX_SPAWNS_PER_SESSION = 40;

/**
 * Resolve effective spawn limit.
 * Priority: env var PI_SUBAGENT_MAX_SPAWNS_PER_SESSION > config > default.
 */
export function resolveMaxSpawns(configValue?: number): number;

/**
 * Check whether `requested` spawns are within budget.
 * Returns an error message string if blocked, undefined if allowed.
 */
export function checkSpawnLimit(
  currentCount: number,
  requested: number,
  max: number,
): string | undefined;
```

### Configuration

| Source               | Priority | Field                                 |
| -------------------- | -------- | ------------------------------------- |
| Environment variable | Highest  | `PI_SUBAGENT_MAX_SPAWNS_PER_SESSION`  |
| Extension config     | Medium   | `SubagentsConfig.maxSpawnsPerSession` |
| Default              | Lowest   | `40`                                  |

The config field is added to `SubagentsConfig` with default `40`. Editable via the `/agents` settings menu.

Setting `0` blocks all subagent spawns for that session.

### Enforcement

In `AgentManager.spawn()`, before creating the `AgentRecord`:

1. Call `checkSpawnLimit(this.spawnCount, 1, resolvedMax)`
2. If it returns an error string, throw an Error with that message
3. Otherwise, increment `this.spawnCount`
4. The existing try/catch in `subagent.ts` tool handler catches and returns an error result

The `AgentManager` holds a private `spawnCount: number` field (initialized to 0) and the resolved max (from config). Both the `subagent` tool and `/agent` command go through `AgentManager.spawn()`, so both paths are protected.

### Error Message

```
Subagent spawn limit reached for this session (X/Y used, Z requested). Complete the work directly or start a new session.
```

### Counter Lifecycle

The `SpawnCounter` tracks total spawns since the `AgentManager` was instantiated. Since Pi creates a new extension instance (and thus a new `AgentManager`) for each session, the counter is effectively per-session.

The `AgentManager` exposes `resetSpawnCounter()` for explicit reset if needed (e.g., if future Pi versions reuse extension instances across sessions). The counter also resets on `dispose()`.

---

## 2. Tool Budgets

### Purpose

Limit the total number of tool calls a subagent makes in a single run. Two thresholds:

- **Soft limit**: Sends a steering message advising the agent to finalize. Advisory only -- does not block tools.
- **Hard limit**: Blocks configured tools so the agent is forced to produce output with context already gathered.

### Module: `src/core/tool-budget.ts`

Pure-function module. Exports:

```typescript
export interface ToolBudgetConfig {
  soft?: number;
  hard: number;
  block?: string[] | "*";
}

export interface ResolvedToolBudget {
  soft?: number;
  hard: number;
  block: string[] | "*";
}

export type ToolBudgetOutcome =
  | "within-budget"
  | "soft-reached"
  | "hard-blocked";

export const DEFAULT_TOOL_BUDGET_BLOCK: readonly string[] = [
  "read",
  "grep",
  "find",
  "ls",
];

/**
 * Validate raw tool budget config. Returns resolved budget or error string.
 * Validation rules:
 *   - hard must be integer >= 1
 *   - soft must be integer >= 1 when provided, and <= hard
 *   - block must be "*" or non-empty array of non-empty strings
 *   - block defaults to DEFAULT_TOOL_BUDGET_BLOCK when omitted
 */
export function validateToolBudget(raw: unknown): {
  budget?: ResolvedToolBudget;
  error?: string;
};

/**
 * Evaluate a tool call against the budget.
 * `toolCount` is the count AFTER incrementing (i.e., this is the Nth tool call).
 * Returns outcome and optional user-facing message.
 */
export function evaluateToolCall(
  budget: ResolvedToolBudget,
  toolCount: number,
  toolName: string,
): { outcome: ToolBudgetOutcome; message?: string };

/**
 * Format the soft-limit steering nudge.
 */
export function softNudgeMessage(
  budget: ResolvedToolBudget,
  toolCount: number,
): string;

/**
 * Format the hard-limit block message.
 */
export function hardBlockMessage(
  budget: ResolvedToolBudget,
  toolName: string,
  toolCount: number,
): string;
```

### Configuration (3-level priority)

| Source              | Priority | Location                               |
| ------------------- | -------- | -------------------------------------- |
| Tool call parameter | Highest  | `subagent({ tool_budget: {...} })`     |
| Agent frontmatter   | Medium   | `tool_budget: {"soft": 5, "hard": 10}` |
| Global config       | Lowest   | `SubagentsConfig.toolBudget`           |

Resolution happens in `resolveInvocationConfig()` alongside model, thinking, maxTurns, etc.

**Priority note**: This differs from model/thinking/maxTurns where frontmatter has highest priority (agent author decides). For budgets, the parent orchestrator should be able to _restrict_ a child's budget on a per-call basis (it's paying the cost). The agent frontmatter sets the default budget; the parent can tighten it.

### Enforcement

In `runAgent()` (agent-runner.ts), inside the existing event subscription:

```
on tool_execution_start:
  toolCount++
  if budget defined:
    result = evaluateToolCall(budget, toolCount, toolName)
    if result.outcome === "soft-reached" AND not yet nudged:
      session.steer(result.message)
      softNudged = true
    if result.outcome === "hard-blocked":
      session.steer(result.message)
      session.abort()
```

**Soft limit**: Uses `session.steer()` -- the same mechanism used for turn limit warnings. Advisory only.

**Hard limit**: Steers with the block message then aborts the session. This matches our existing turn-limit hard-abort pattern (`session.abort()` at `maxTurns + graceTurns`). The agent's partial output is captured as the result.

This approach is simpler than nicobailon's per-tool blocking (which requires a runtime hook to intercept individual tool calls). If the Pi SDK later exposes a tool-call interception API, we can refine to selective blocking without abort. For now, abort-on-hard-limit achieves the safety goal.

### Hard Limit Behavior

When `toolCount` exceeds `hard` AND the tool being called is in the `block` list:

- The session is steered with an explanation message, then aborted.
- The `block` list determines which tools trigger the abort. Non-listed tools are allowed to complete even past the hard limit.
- **Default block list**: `["read", "grep", "find", "ls"]` -- read-only tools that inflate context. If the agent calls `edit` or `write` past the hard limit, it proceeds (allowing finalization).
- **`block: "*"`**: Any tool call past hard limit triggers abort.
- The agent's `AgentRecord.status` is set to `"aborted"` (same as turn limit hard abort).

### Soft Limit Behavior

- **Fires once**: The first time `toolCount >= soft`, a steer is sent. Not repeated.
- **Advisory only**: Does not block or abort. The agent can ignore it (but well-prompted agents will wrap up).

### Tool Schema Addition

New optional parameter on the `subagent` tool:

```typescript
tool_budget: Type.Optional(
  Type.Object({
    soft: Type.Optional(
      Type.Number({ minimum: 1, description: "Advisory nudge threshold" }),
    ),
    hard: Type.Number({ minimum: 1, description: "Hard block threshold" }),
    block: Type.Optional(
      Type.Union([Type.Array(Type.String()), Type.Literal("*")], {
        description:
          "Tools to block at hard limit. Default: read, grep, find, ls",
      }),
    ),
  }),
);
```

### Agent Frontmatter

Parsed as a JSON object string in the YAML frontmatter:

```yaml
---
name: scout
description: Fast workspace mapper
tools: read, grep, find, ls, bash
tool_budget: { "soft": 8, "hard": 15 }
---
```

Validated via `validateToolBudget()` during agent discovery. Invalid budget produces a diagnostic (same pattern as other frontmatter validation).

### Interaction with Turn Limits

Independent. Both can fire in the same run. An agent might hit tool budget (too many tool calls in a single turn) before reaching turn limit, or vice versa. They address different failure modes:

- Turn limits: agent loops without converging
- Tool budgets: agent makes too many tool calls (even within few turns)

---

## 3. Type Changes

### `SubagentsConfig` (config.ts)

```typescript
export interface SubagentsConfig {
  maxConcurrency: number;
  maxRecursiveLevel: number;
  defaultMaxTurns: number;
  graceTurns: number;
  defaultJoinMode: JoinMode;
  maxSpawnsPerSession: number; // NEW - default: 40
  toolBudget?: ToolBudgetConfig; // NEW - default: undefined (no global budget)
}
```

### `AgentDefinition` (types.ts)

Add field:

```typescript
toolBudget?: ToolBudgetConfig;
```

### `SubagentToolInput` (types.ts)

Add field:

```typescript
tool_budget?: ToolBudgetConfig;
```

### `RunOptions` (types.ts)

Add field:

```typescript
toolBudget?: ResolvedToolBudget;
```

### `SpawnOptions` (types.ts)

Add field:

```typescript
toolBudget?: ResolvedToolBudget;
```

### `ResolvedInvocationConfig` (invocation-config.ts)

Add field:

```typescript
toolBudget?: ResolvedToolBudget;
```

---

## 4. Data Flow

```
subagent tool called with { agent, task, tool_budget? }
  |
  v
resolveInvocationConfig() merges tool_budget:
  tool params > agent frontmatter > global config
  validates via validateToolBudget()
  |
  v
AgentManager.spawn():
  checkSpawnLimit(this.spawnCount, 1, max) -- throws if over limit
  this.spawnCount++
  creates AgentRecord, starts agent
  |
  v
runAgent() receives toolBudget in RunOptions:
  subscribes to session events
  on tool_execution_start:
    toolCount++
    evaluateToolCall(budget, toolCount, toolName)
    -> "soft-reached": session.steer(nudge) (once)
    -> "hard-blocked": session.steer(message) + session.abort()
  |
  v
Agent completes normally, or is aborted at hard limit
```

---

## 5. Files Touched

| File                              | Change                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| `src/core/spawn-guard.ts`         | **New** -- pure functions for spawn limit logic                 |
| `src/core/tool-budget.ts`         | **New** -- pure functions for tool budget logic                 |
| `src/core/agent-manager.ts`       | Add `SpawnCounter` field, call `reserveSpawn()` in `spawn()`    |
| `src/core/agent-runner.ts`        | Add tool budget tracking in event subscriber                    |
| `src/core/subagent.ts`            | Add `tool_budget` to tool schema and pass through               |
| `src/core/config.ts`              | Add `maxSpawnsPerSession` and `toolBudget` to config/defaults   |
| `src/core/invocation-config.ts`   | Add `toolBudget` to 3-layer resolution                          |
| `src/core/agent-format.ts`        | Parse `tool_budget` from agent frontmatter                      |
| `src/shared/types.ts`             | Add `ToolBudgetConfig`, `ResolvedToolBudget`, extend interfaces |
| `src/tui/agents-menu.ts`          | Add `maxSpawnsPerSession` to settings section                   |
| `tests/spawn-guard.test.ts`       | **New** -- ~8 unit tests                                        |
| `tests/tool-budget.test.ts`       | **New** -- ~10 unit tests                                       |
| `tests/agent-manager.test.ts`     | Add spawn limit integration tests                               |
| `tests/agent-runner.test.ts`      | Add tool budget integration tests                               |
| `tests/subagent.test.ts`          | Add tool_budget parameter tests                                 |
| `tests/invocation-config.test.ts` | Add toolBudget resolution tests                                 |
| `tests/agent-format.test.ts`      | Add tool_budget frontmatter parsing tests                       |
| `tests/config.test.ts`            | Add maxSpawnsPerSession loading/saving tests                    |

---

## 6. Test Plan

### spawn-guard.test.ts (~8 tests)

- `resolveMaxSpawns`: returns env var when set, falls back to config, falls back to default
- `resolveMaxSpawns`: rejects non-integer and negative env values (falls to next layer)
- `checkSpawnLimit`: allows spawn within limit, returns undefined
- `checkSpawnLimit`: blocks spawn at limit, returns error string with counts
- `checkSpawnLimit`: handles requested > 1 (batch spawns for future chain support)
- `checkSpawnLimit`: 0 max blocks all spawns
- `checkSpawnLimit`: error message includes used/max/requested counts
- `checkSpawnLimit`: allows exactly up to max (boundary condition)

### tool-budget.test.ts (~10 tests)

- `validateToolBudget`: accepts valid config with all fields
- `validateToolBudget`: applies default block list when block omitted
- `validateToolBudget`: accepts `block: "*"`
- `validateToolBudget`: rejects hard < 1, soft > hard, empty block array, non-string block items
- `validateToolBudget`: returns undefined for undefined input (no budget)
- `evaluateToolCall`: returns "within-budget" when under both limits
- `evaluateToolCall`: returns "soft-reached" with nudge message at soft threshold
- `evaluateToolCall`: returns "hard-blocked" with block message for listed tool over hard
- `evaluateToolCall`: returns "within-budget" for non-listed tool even over hard limit
- `evaluateToolCall`: `block: "*"` blocks all tools over hard limit

### Integration additions to existing test files

- `agent-manager.test.ts`: spawn blocked after quota, counter increments, `resetSpawnCounter()` works
- `agent-runner.test.ts`: soft steer fired at threshold, hard limit aborts session
- `subagent.test.ts`: tool_budget parameter plumbed through to spawn options
- `invocation-config.test.ts`: toolBudget resolution from 3 layers (tool params > frontmatter > config)
- `agent-format.test.ts`: tool_budget parsed from frontmatter, invalid budget produces diagnostic
- `config.test.ts`: maxSpawnsPerSession saved/loaded correctly
