# Cross-Extension RPC, Wait Tool, and Nested Subagents

Three features ordered from simplest to most complex, closing the biggest gaps identified in the pi-subagents comparison report.

---

## Feature 1: Cross-Extension RPC

### Purpose

Allow other pi extensions to spawn, query, steer, and stop subagents programmatically via the event bus. Both nicobailon and tintinweb have this; we don't.

### New file

`src/core/rpc.ts`

### Protocol

Communication uses `pi.events` with channel-based request/reply:

- **Request channels:** `subagents:rpc:ping`, `subagents:rpc:spawn`, `subagents:rpc:stop`, `subagents:rpc:status`, `subagents:rpc:steer`
- **Reply pattern:** Each request includes a `requestId` string. The reply is emitted to `{channel}:reply:{requestId}`.
- **Reply envelope:**
  ```typescript
  type RpcReply<T = void> =
    | { success: true; data?: T }
    | { success: false; error: string };
  ```

### Operations

| Method   | Request params                                                      | Response data                                                         |
| -------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `ping`   | `{ requestId }`                                                     | `{ version: 1, methods: ["ping","spawn","stop","status","steer"] }`   |
| `spawn`  | `{ requestId, agent, task, model?, thinking?, run_in_background? }` | `{ id: string }`                                                      |
| `stop`   | `{ requestId, id }`                                                 | `{}`                                                                  |
| `status` | `{ requestId, id }`                                                 | `{ status, type, description, toolUses, turnCount, result?, error? }` |
| `steer`  | `{ requestId, id, message }`                                        | `{}`                                                                  |

### Constraints

- `spawn` via RPC always forces `run_in_background: true`. Extensions cannot block the parent session.
- `spawn` uses the same model resolution as the main subagent tool (fuzzy matching via existing `resolveModel` helper). If `model` is omitted, the agent's default model applies.
- `steer` and `stop` operate on any agent in the current session (no session-scoping needed since execution is in-process).
- Invalid `id` returns `{ success: false, error: "Agent not found: <id>" }`.
- Invalid `agent` name returns `{ success: false, error: "Unknown agent: <name>" }`.
- Missing `requestId` or non-string `requestId`: silently ignored (no reply possible).

### Registration

```typescript
export function registerRpcHandlers(
  pi: ExtensionAPI,
  manager: AgentManager,
  deps: RuntimeDeps,
): { dispose: () => void };
```

Called in `index.ts` during extension init. Subscribes to event channels via `pi.events.on()` (which returns unsubscribe functions). The returned `dispose()` calls all unsubscribe functions for cleanup on `session_shutdown`.

### Testing

- Unit test with `pi.events` mocked as an EventEmitter.
- Test each operation in isolation: success path and error cases (invalid ID, missing agent, malformed request).
- Test that `spawn` always forces background mode.
- Test `dispose()` unsubscribes all listeners.

---

## Feature 2: Wait Tool

### Purpose

A dedicated tool for blocking until background agents complete. Completes the background workflow story: spawn agents, then wait for results without polling.

### New file

`src/core/wait.ts`

### Tool definition

Registered as a new tool named `wait` alongside `get_subagent_result` and `steer_subagent`.

**Parameters:**

```typescript
{
  id?: string         // Wait for a specific agent (exact ID or unambiguous prefix)
  all?: boolean       // Wait for ALL active agents (default: false = first-of-any)
  timeout_ms?: number // Give up after N ms (default: 60000)
}
```

### Behavior matrix

| Params                     | Behavior                                            |
| -------------------------- | --------------------------------------------------- |
| `{}`                       | Block until the next agent completes (first-of-any) |
| `{ all: true }`            | Block until every running/queued agent finishes     |
| `{ id: "abc123" }`         | Block until that specific agent finishes            |
| `{ id: "abc", all: true }` | `id` takes precedence; waits for the matched agent  |
| `{ timeout_ms: 5000 }`     | Wait for first completion, give up after 5s         |

### Resolution mechanics

- Uses existing `record.promise` field on background AgentRecords.
- For first-of-any: `Promise.race()` over all active agent promises. Returns the single agent that won the race (not all agents that may have resolved in the same tick).
- For all: `Promise.all()` over all active agent promises, capturing IDs at invocation time. Agents spawned after the wait starts are not included.
- For specific ID: prefix-match against `manager.listAgents()`. If ambiguous (matches multiple), return error with the matching IDs.
- Timeout: `Promise.race([target, sleep(timeout_ms)])`.
- Respects `AbortSignal` from the tool's execution context (parent turn abort cancels the wait).

### Return format

On completion:

```typescript
{
  completed: Array<{
    id: string;
    type: string;
    status: string;
    result_preview?: string;
  }>;
  still_running: number;
}
```

On timeout:

```typescript
{
  timed_out: true;
  still_running: number;
  completed_during_wait: Array<{ id: string; type: string; status: string }>;
}
```

### Edge cases

- **No active agents:** Return immediately with `{ completed: [], still_running: 0 }`.
- **Agent already completed:** Return immediately with its result.
- **Ambiguous prefix:** Error with `"Ambiguous prefix 'abc' matches: abc123, abc456"`.
- **All agents complete before timeout:** Return immediately (don't wait for the timer).

### Interaction with notifications

- Agents whose completion satisfies a `wait` get `resultConsumed = true`, suppressing the individual nudge notification.
- GroupJoinManager is bypassed for waited agents. The `wait` tool is the consumer.

### Testing

- Unit tests with mock manager and fake promise resolution.
- Test timeout expiry, prefix matching (exact, unambiguous prefix, ambiguous prefix).
- Test all-mode vs first-of-any mode.
- Test interaction with `resultConsumed` flag.
- Test abort signal cancellation.
- Test empty fleet (no agents running).

---

## Feature 3: Nested Subagents (Tool Injection)

### Purpose

Enable child agents to spawn their own sub-agents using the `subagent_agents` allowlist already declared in agent frontmatter. Currently the plumbing exists (depth tracking, allowlists, tool filtering) but children never get a working `subagent` tool handler.

### New file

`src/core/child-subagent-tool.ts`

### Factory function

```typescript
export function createChildSubagentTool(opts: {
  manager: AgentManager;
  discovery: AgentDiscoveryResult;
  allowedAgents: string[]; // from agentDef.subagentAgents
  currentDepth: number; // parent's depth + 1
  parentCwd: string;
  deps: RuntimeDeps;
}): ToolDefinition;
```

Returns a tool definition with:

- Name: `subagent`
- Parameters: subset of the top-level subagent tool params (agent, task, model, thinking, max_turns, isolated, inherit_context, isolation, tool_budget)
- Execute: validates agent against `allowedAgents`, delegates to `manager.spawn()` with incremented depth

### Injection point

In `agent-runner.ts` `runAgent()`, when constructing the session via `createAgentSession()`. The pi platform's `CreateAgentSessionOptions` accepts a `customTools: ToolDefinition[]` array for tools not registered via extensions.

**Important platform constraint:** `AgentSession` has no `registerTool()` method. Tools must be passed at creation time via the `customTools` option, or registered through extension event handlers. We use `customTools` since it's explicit and avoids timing issues.

In `agent-runner.ts`:

```typescript
// Build custom tools for child session
const customTools: ToolDefinition[] = [];
if (options.allowRecursion) {
  customTools.push(
    createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: options.allowedAgents ?? [],
      currentDepth: (options.currentDepth ?? 0) + 1,
      parentCwd: options.cwd,
      parentAgentId: options.agentId,
      deps,
    }),
    createChildGetResultTool(manager, options.agentId),
  );
}

const { session } = await createAgentSession({
  ...sessionOpts,
  customTools,
});
```

This requires `runAgent()` to receive the manager, discovery, and deps references. These are threaded through `RunOptions` (new fields: `manager`, `discovery`, `deps`).

Alternatively, `agent-manager.ts` `startAgent()` already has access to these — it can construct the `customTools` array and pass it to `runAgent()` via `RunOptions`:

```typescript
// In agent-manager.ts startAgent():
const customTools = allowRecursion
  ? [
      createChildSubagentTool({ ... }),
      createChildGetResultTool(this, id),
    ]
  : [];

const promise = runAgent(agentDef, {
  ...runOptions,
  customTools,  // new field on RunOptions
});
```

**Preferred approach:** Pass `customTools` through `RunOptions`. This keeps `runAgent()` generic and avoids injecting DI concerns into it. The manager constructs the tools (it has all needed context) and passes them as data.

### Child capability restrictions

| Capability              | Parent                        | Child                        |
| ----------------------- | ----------------------------- | ---------------------------- |
| Single agent spawn      | Yes                           | Yes (always background)      |
| Chain execution         | Yes                           | No                           |
| Chain append            | Yes                           | No                           |
| Agent management (CRUD) | Yes (via /agents menu)        | No                           |
| Steer sibling           | Yes                           | No                           |
| get_subagent_result     | Yes (all agents)              | Yes (only agents it spawned) |
| wait tool               | Yes                           | No                           |
| Clarify TUI             | Yes                           | No                           |
| Deeper recursion        | Controlled by subagent_agents | Same rules apply recursively |

### Child-spawned agent visibility

New field on `AgentRecord`:

```typescript
spawnedBy?: string  // ID of the agent that spawned this one
```

Set during `manager.spawn()` when `currentDepth > 0`. The child's scoped `get_subagent_result` filters by `spawnedBy === childAgentId`.

### Scoped get_subagent_result

```typescript
export function createChildGetResultTool(
  manager: AgentManager,
  parentAgentId: string,
): ToolDefinition;
```

Same interface as the top-level `get_subagent_result` but only returns records where `record.spawnedBy === parentAgentId`.

### Depth enforcement

- Default `maxDepth` = 3 (existing configuration).
- Depth 0: parent (user) session.
- Depth 1: first-level child (e.g., worker).
- Depth 2: second-level child (e.g., worker's scout).
- At `currentDepth >= maxDepth`: `allowRecursion = false`, no tool injected.
- Per-agent `maxDepth` can be added later as a frontmatter field to tighten limits.

### Concurrency

Child-spawned agents share the parent's concurrency pool and spawn limits. A child spawning 3 agents consumes 3 slots from the same queue. This prevents runaway resource consumption.

### Spawn limit interaction

The session-wide `maxSpawnsPerSession` counter (default 40) applies globally. Child spawns count against the same counter.

### Testing

- Unit test `createChildSubagentTool`:
  - Allowed agent passes through to manager.spawn()
  - Disallowed agent returns error
  - Chain params stripped/rejected
  - Depth passed correctly
  - Always forces background
- Unit test `createChildGetResultTool`:
  - Only returns records with matching `spawnedBy`
  - Ignores other agents
- Integration test:
  - Worker with `subagent_agents: [scout]` spawns scout
  - Scout completes
  - Worker reads result via scoped `get_subagent_result`
  - Depth 2 agent cannot recurse further (maxDepth=3 blocks depth 3)

---

## Implementation Order

1. **RPC** (simplest, no dependencies on other features)
2. **Wait** (depends on existing manager/record infrastructure, no dependency on RPC)
3. **Nested subagents** (most complex, benefits from wait tool being available for child result retrieval patterns)

## Files modified

| File                                | Changes                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `src/core/rpc.ts`                   | New file: RPC handler registration                                                    |
| `src/core/wait.ts`                  | New file: wait tool implementation                                                    |
| `src/core/child-subagent-tool.ts`   | New file: child tool factory + scoped get_subagent_result                             |
| `src/core/agent-manager.ts`         | Add `spawnedBy` tracking, construct `customTools` in `startAgent()`, pass to runAgent |
| `src/core/agent-runner.ts`          | Accept `customTools` in RunOptions, pass to `createAgentSession()`                    |
| `src/shared/types.ts`               | Add `spawnedBy?: string` to AgentRecord, add `customTools` to RunOptions              |
| `src/shared/runtime-deps.ts`        | Expose `discovery` accessor for child tool construction                               |
| `src/index.ts`                      | Register RPC handlers, register wait tool, pass dispose to shutdown                   |
| `tests/rpc.test.ts`                 | New file                                                                              |
| `tests/wait.test.ts`                | New file                                                                              |
| `tests/child-subagent-tool.test.ts` | New file                                                                              |
| `tests/agent-manager.test.ts`       | Additional cases for spawnedBy, nested spawn                                          |

## Platform API notes

Verified against `/Users/lanh/Developer/pi-packages/pi` (packages/coding-agent):

- **EventBus** (`core/event-bus.ts`): `{ emit(channel, data): void; on(channel, handler): () => void }`. The `on()` return value is the unsubscribe function (no separate `off`).
- **AgentSession**: Has NO `registerTool()`. Tools are passed via `customTools` at `createAgentSession()` time or registered through extension event handlers before session creation.
- **createAgentSession** (`core/sdk.ts`): Accepts `{ customTools?: ToolDefinition[], tools?: string[], excludeTools?: string[], ... }`.
- **ToolDefinition** (`core/extensions/types.ts`): `{ name, label, description, parameters, execute(toolCallId, params, signal, onUpdate, ctx) }`. Required fields for our child tools.
