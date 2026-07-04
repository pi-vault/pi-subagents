# Spec 1a: Session Execution Model — Core Plumbing

Replace child-process spawning with in-process `AgentSession` for single-agent foreground execution. This is the foundational change. Tool schema, frontmatter, and execution features are unchanged — those come in Specs 1b and 1c.

## Context

The current execution model spawns a separate `pi` process per subagent via `spawnAndCollect()`. The parent communicates with the child through JSON events on stdout and environment variables (`PI_SUBAGENT_*`) for nested context (depth limits, agent allowlists, parent identity).

This model cannot support background execution, steering, conversation viewing, or session resume because the parent LLM blocks while the child process runs, and there is no shared session object to subscribe to.

The new model uses `createAgentSession()` from `@earendil-works/pi-coding-agent` to create an in-process `AgentSession`. This gives us typed event subscription, direct session access, and a natural async boundary for background execution in later specs.

Reference implementation: `@tintinweb/pi-subagents` (v0.13.0), which uses the same session-based approach.

## Scope

**In scope (this spec):**

- Replace `spawnAndCollect()` with `createAgentSession()`
- Retire `nested-context.ts`, `execution-state.ts`, `subagent-spawner.ts`
- Create `AgentManager` (lifecycle, depth limits, agent allowlists) and `AgentRunner` (stateless session execution)
- Keep current tool schema unchanged (`agent`, `task`, `cwd`)
- Keep current frontmatter fields unchanged
- Keep `replace` prompt mode only (current implicit behavior)
- Keep timeout-based limits via `setTimeout` + `session.abort()` (adapted from process kill)
- Add `@earendil-works/pi-ai` as peer dependency

**Out of scope (Spec 1b — Tool schema + frontmatter extensions):**

- New tool params (`model`, `thinking`, `max_turns`, `isolated`, `inherit_context`, `run_in_background`, `resume`, `isolation`)
- New frontmatter fields (`prompt_mode`, `max_turns`, `inherit_context`, `run_in_background`, `isolated`, `isolation`, `extensions`, `disallowed_tools`)
- Config merge priority rules (tool param vs frontmatter vs default)
- Model resolution via `ctx.modelRegistry` with fuzzy matching

**Out of scope (Spec 1c — Prompt modes, turn limits, context forking):**

- `append` prompt mode
- Turn-based limits replacing timeout (`max_turns` + `grace_turns` with soft steer + hard abort)
- `inherit_context` / `buildParentContext()` for context forking
- Extension loading policies (`isolated` mode, extension allowlist/denylist)
- `DefaultResourceLoader` configuration beyond basic `noExtensions`

## Decisions

| Decision                | Choice                                               | Rationale                                                                                                                                   |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution model         | In-process `AgentSession` via `createAgentSession()` | Enables background execution, steering, conversation viewer, session resume in future specs                                                 |
| Nested context protocol | Retire `nested-context.ts`                           | Depth limits and agent allowlists enforced in-process by AgentManager. Env-var protocol was an implementation detail of child-process model |
| Tool name               | Keep `subagent`                                      | Existing tool name, no reason to change                                                                                                     |
| Tool schema             | Unchanged for now                                    | Same `agent`, `task`, `cwd` params. Extended in Spec 1b                                                                                     |
| Prompt mode             | `replace` only                                       | Current implicit behavior. `append` mode added in Spec 1c                                                                                   |
| Execution limits        | Keep timeout (adapted)                               | `setTimeout` + `session.abort()` instead of `SIGTERM`/`SIGKILL`. Turn-based limits replace this in Spec 1c                                  |
| `/agent` slash command  | Keep                                                 | Useful for manual testing without going through the LLM                                                                                     |
| `pi-ai` dependency      | Add as peer dependency                               | Required for `Model` and `ThinkingLevel` types when creating sessions                                                                       |
| Architecture            | AgentManager + AgentRunner split                     | Manager owns lifecycle and policy. Runner is stateless execution. Clean separation for Spec 2 (background)                                  |

## Architecture

```
index.ts
  creates AgentManager
  wires session events (shutdown, switch)
  passes manager to deps

subagent.ts (thin orchestration)
  parses tool input (same schema: agent, task, cwd)
  calls manager.spawnAndWait()
  calls writeExecutionArtifacts()
  returns result with rendering details

AgentManager (lifecycle + policy)
  tracks AgentRecord per execution
  enforces depth limits, agent allowlists
  creates AbortController, wires parent signal
  delegates to AgentRunner
  updates record on completion/error/abort

AgentRunner (stateless execution)
  resolves tools from agentDef.tools
  resolves skills from agentDef.skills
  builds system prompt (replace mode)
  resolves model from agentDef.model or parent model
  creates AgentSession via createAgentSession()
  subscribes to session events
  enforces timeout via setTimeout + session.abort()
  returns RunResult
```

### Preserved features

These features carry over unchanged from the current implementation:

- **`subagent` tool** with `agent`/`task`/`cwd` parameters (same schema)
- **`subagent_agents` allowlisting** for nested delegation (enforced by AgentManager instead of env vars)
- **`subagent-artifacts`** input/output markdown + JSON metadata (unchanged module)
- **Skills allowlist/blocklist** via frontmatter `skills: all|none|skill1,skill2` (preloaded into prompt instead of passed as `--skill` CLI flags)
- **Tools allowlist/blocklist** via frontmatter `tools: read, bash, write` (passed as `allowedTools` to session instead of `--tools` CLI flag)
- **Agent discovery** from bundled + user directories (unchanged module)
- **Frontmatter parsing** and agent definition format (unchanged for now)
- **Interactive `/agents` menu** for agent management (unchanged module)
- **Timeout** via `defaultTimeoutMs` config (mechanism changes from SIGTERM to session.abort())

## Types

### AgentRecord

Central state object for a running or completed agent. The manager creates one per spawn and updates it throughout the lifecycle.

```typescript
interface AgentRecord {
  id: string;
  type: string; // Agent name
  status: "running" | "completed" | "aborted" | "error";
  result?: string; // Response text on completion
  error?: string; // Error message if failed
  toolUses: number; // Count of tool executions
  startedAt: number; // Date.now() at spawn
  completedAt?: number; // Date.now() at completion
  durationMs?: number; // completedAt - startedAt
  session?: AgentSession; // In-process session reference
  abortController?: AbortController; // For cancellation
  lifetimeUsage: LifetimeUsage; // Token usage (survives compaction)
  invocation?: AgentInvocation; // Snapshot of spawn params for UI display
}
```

Note: `"queued"`, `"steered"`, `"stopped"` statuses are added in later specs when background execution and turn-based limits are introduced.

### AgentInvocation

Snapshot of spawn parameters captured at invocation time for UI display.

```typescript
interface AgentInvocation {
  agent: string;
  task: string;
  cwd?: string;
}
```

Extended with `model`, `thinking`, `maxTurns`, etc. in Spec 1b.

### LifetimeUsage

Token usage accumulator that survives session compaction.

```typescript
interface LifetimeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
}
```

### ToolActivity

```typescript
interface ToolActivity {
  type: "start" | "end";
  toolName: string;
}
```

### RunOptions

Passed from AgentManager to AgentRunner.

```typescript
interface RunOptions {
  prompt: string;
  cwd: string;
  agentId: string;
  model?: Model; // From pi-ai
  thinking?: ThinkingLevel; // From pi-ai
  timeoutMs?: number; // Timeout (replaced by turn limits in Spec 1c)
  allowRecursion?: boolean; // true if child may spawn subagents (manager decides)
  signal?: AbortSignal; // From parent AbortController
  onToolActivity?: (activity: ToolActivity) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsage?: (usage: {
    input: number;
    output: number;
    cacheWrite: number;
  }) => void;
  onSessionCreated?: (session: AgentSession) => void;
}
```

### RunResult

Returned from AgentRunner to AgentManager.

```typescript
interface RunResult {
  responseText: string;
  session: AgentSession;
  aborted: boolean;
}
```

`steered` field added in Spec 1c when turn-based limits introduce steering.

### SpawnOptions

Passed from subagent.ts to AgentManager.

```typescript
interface SpawnOptions {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  parentSignal?: AbortSignal;
  currentDepth?: number; // For nested delegation depth tracking
  allowedAgents?: string[]; // From parent agent's subagent_agents
  onToolActivity?: (activity: ToolActivity) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsage?: (usage: {
    input: number;
    output: number;
    cacheWrite: number;
  }) => void;
  onSessionCreated?: (session: AgentSession) => void;
}
```

Extended with `model`, `thinking`, `maxTurns`, `isolated`, `inheritContext` in Spec 1b.

## AgentRunner

Stateless module. Core export: `runAgent()`.

### Execution flow

1. **Resolve tools.** Read `agentDef.tools` array. Build the `allowedTools` string array. The `subagent` tool is excluded from child sessions by default. If `options.allowRecursion` is true (set by the manager when the agent has `subagent_agents` and depth permits), include the `subagent` tool in the child's allowlist.

2. **Resolve skills.** If `agentDef.skills` is a string array, call `resolveSkillPaths()` + `preloadSkills()` from our existing skill-loader to load content into prompt extras. If `"all"`, discover all. If `"none"` or empty, skip.

3. **Build system prompt.** Replace mode only (current behavior): environment block (cwd, git info, platform, date) + `agentDef.systemPrompt` + skill blocks. Append mode added in Spec 1c.

4. **Resolve model.** Use `agentDef.model` if set, otherwise use parent model from `ctx`. Convert string model ID to `Model` object via the model registry.

5. **Create session.** Call `createAgentSession()` with: `cwd`, `model`, `tools: allowedTools`, `systemPromptOverride`, `thinkingLevel`. Extensions disabled (`noExtensions: true`) — matches current behavior where child processes run with `--no-extensions`. Set session name to `${agentDef.name}#${agentId.slice(0,8)}`. Call `session.bindExtensions()`.

6. **Subscribe to events.** Wire session event stream to callbacks:
   - `tool_execution_start` / `tool_execution_end` → `onToolActivity`
   - `message_update` with `text_delta` → `onTextDelta`
   - `turn_end` → increment counter, call `onTurnEnd`
   - `message_end` → extract usage from event, call `onUsage`

7. **Set up timeout.** If `options.timeoutMs` is set, start a `setTimeout` that calls `session.abort()` on expiry. Clear the timer on completion. This replaces the current `SIGTERM` + `SIGKILL` process termination.

8. **Execute prompt.** Call `session.prompt(options.prompt)`. Collect response text from `onTextDelta` accumulation.

9. **Return.** `{ responseText, session, aborted }`.

## AgentManager

Stateful class owning agent lifecycle. For this spec, only foreground execution via `spawnAndWait()`.

### Public API

```typescript
class AgentManager {
  constructor(maxDepth?: number);
  spawnAndWait(
    ctx,
    agentDef,
    options: SpawnOptions,
  ): Promise<{ id: string; record: AgentRecord }>;
  getRecord(id: string): AgentRecord | undefined;
  listAgents(): AgentRecord[];
  abort(id: string): boolean;
  clearCompleted(): void;
  dispose(): void;
  setMaxDepth(n: number): void;
}
```

### spawnAndWait flow

1. **Validate depth.** If `options.currentDepth >= maxDepth`, throw error with message explaining the nesting limit.

2. **Validate allowlist.** If `options.allowedAgents` is set and `agentDef.name` is not in the list (case-insensitive), throw error listing allowed agents.

3. **Validate cwd.** Confirm `options.cwd` is an absolute path to an existing directory.

4. **Create record.** Generate unique ID. Create `AgentRecord` with status `"running"`, `startedAt: Date.now()`, zero usage. Store in internal `agents: Map<string, AgentRecord>`. Capture invocation snapshot.

5. **Create AbortController.** If `options.parentSignal` provided, wire it to child abort.

6. **Compute allowRecursion.** `true` if `agentDef.subagentAgents` is a non-empty array AND `(options.currentDepth ?? 0) + 1 < maxDepth`. Otherwise `false`.

7. **Call runAgent.** Pass `ctx`, `agentDef`, and `RunOptions` with callbacks that update the record:
   - `onToolActivity` → increment `record.toolUses` on `type: "end"`
   - `onTurnEnd` → update `record.turnCount` (if we add this field)
   - `onUsage` → accumulate into `record.lifetimeUsage`
   - `onSessionCreated` → store `record.session`
   - Forward all callbacks to `options.*` for UI rendering

8. **Handle result.** On success: set `record.status` to `"completed"`, store `record.result`. On error: set `"error"`, store `record.error`. On abort (timeout or signal): set `"aborted"`. Set `record.completedAt` and `record.durationMs`.

9. **Return** `{ id, record }`.

### Depth enforcement

Replaces the env-var protocol from `nested-context.ts`. When `subagent.ts` handles a tool call:

- Root-level call: `currentDepth = 0`
- If the child agent has `subagent_agents` in frontmatter and recursion is within depth limit, the child's session includes the `subagent` tool. When that tool fires, the handler passes `currentDepth + 1` and the child's `allowedAgents`.
- The manager rejects spawns exceeding `maxDepth`.

This is more secure than the env-var approach: the parent controls the child's tool access directly rather than relying on the child to self-validate.

## subagent.ts Changes

Becomes a thin orchestration layer.

### registerSubagentTool(pi, deps)

Registers the `subagent` tool with the **same schema** as today (`agent`, `task`, `cwd`). Handler:

1. Parse and validate input.
2. Resolve agent via `findAgentByName()` (unchanged).
3. Read `timeoutMs` from agent config or extension config default.
4. Call `manager.spawnAndWait(ctx, agentDef, options)` with progress callbacks.
5. Call `writeExecutionArtifacts()` (unchanged).
6. Return result with `SubagentExecutionDetails` for rendering.

### registerAgentCommand(pi, deps)

Registers `/agent <name> <task>`. Handler calls `manager.spawnAndWait()` directly. No more deferred request bridge or ticket encoding.

### Removed code

- `createNestedChildLaunch()` — replaced by manager.spawnAndWait()
- `resolveChildSessionTarget()` — session managed by runner
- `encodeDeferredTicket()` / `decodeDeferredTicket()` — deferred request pattern no longer needed
- `SubagentRuntimeDeps` / `createSubagentRuntimeDeps()` — replaced by manager
- `resolvePiInvocation()` — no child process to invoke
- `buildExecutionResult()` — simplified inline
- `buildSlashBridgeErrorResult()` — deferred pattern removed
- `registerSlashAgentBridge()` — deferred pattern removed

## Module Changes Summary

### Deleted

| Module                          | Lines | Reason                                            |
| ------------------------------- | ----- | ------------------------------------------------- |
| `core/subagent-spawner.ts`      | 452   | Replaced by agent-runner                          |
| `core/nested-context.ts`        | 277   | Replaced by in-process parameters on AgentManager |
| `core/execution-state.ts`       | 216   | Replaced by AgentManager record tracking          |
| `tests/nested-context.test.ts`  | —     | Module deleted                                    |
| `tests/execution-state.test.ts` | —     | Module deleted                                    |

### New

| Module                  | Est. lines | Responsibility                     |
| ----------------------- | ---------- | ---------------------------------- |
| `core/agent-runner.ts`  | 200-300    | Stateless session execution        |
| `core/agent-manager.ts` | 150-200    | Lifecycle, policy, record tracking |

### Modified

| Module                   | Change                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/subagent.ts`       | Shrinks. Thin orchestration: tool registration (same schema), input parsing, manager calls, artifact writing. Remove process spawning, deferred request bridge, nested child launch. |
| `shared/types.ts`        | Add AgentRecord, AgentInvocation, LifetimeUsage, ToolActivity, RunOptions, RunResult, SpawnOptions. Update SubagentExecutionDetails.                                                 |
| `shared/runtime-deps.ts` | RuntimeDeps gets `manager: AgentManager` instead of `stateStore: ExecutionStateStore`                                                                                                |
| `index.ts`               | Create AgentManager, wire session events (shutdown, switch), pass manager to deps                                                                                                    |
| `tui/render.ts`          | Adapt rendering to AgentRecord-shaped details (same visual output, different data source)                                                                                            |
| `package.json`           | Add `@earendil-works/pi-ai` as peer dependency                                                                                                                                       |

### Unchanged

| Module                       | Reason                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| `core/agents.ts`             | Agent discovery logic unchanged                               |
| `core/agent-format.ts`       | Frontmatter parsing unchanged (new fields in Spec 1b)         |
| `core/config.ts`             | Config unchanged (new fields in Spec 1b)                      |
| `core/paths.ts`              | Path resolution unchanged                                     |
| `core/skill-loader.ts`       | Skill discovery unchanged; preloadSkills used by runner       |
| `core/subagent-artifacts.ts` | Artifact writing unchanged                                    |
| `tui/agents-menu.ts`         | Management menu unchanged                                     |
| `agents/*.md`                | Bundled agents unchanged (prompt_mode field added in Spec 1b) |

## New Dependency

`@earendil-works/pi-ai` added as a peer dependency in `package.json`:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "@earendil-works/pi-ai": "*"
  }
}
```

Provides `Model`, `ThinkingLevel` types and model registry access for `createAgentSession()`.

## Testing

### New tests

- **`agent-runner.test.ts`**: Mock `createAgentSession` to return a controllable session. Test tool allowlist construction, skill preloading, prompt building (replace mode), model resolution, event subscription wiring, timeout enforcement (abort on expiry), error handling.
- **`agent-manager.test.ts`**: Test depth validation (reject at maxDepth), allowlist enforcement (reject disallowed agent names), record lifecycle (running -> completed/error/aborted), abort cancellation, cleanup of old records, allowRecursion computation.

### Updated tests

- **`subagent.test.ts`**: Rewrite to test thin orchestration. Mock AgentManager. Test input parsing, artifact writing, rendering detail construction.
- **`render.test.ts`**: Adapt to new detail shape from AgentRecord.
- **`index.test.ts`**: Test AgentManager creation and wiring.

### Unchanged tests

- `agents.test.ts` (agent discovery)
- `agent-format.test.ts` (frontmatter parsing — new fields in Spec 1b)
- `config.test.ts` (config — new fields in Spec 1b)
- `skill-loader.test.ts` (skill discovery)
- `artifacts.test.ts` (artifact path resolution)
- `subagent-artifacts.test.ts` (artifact writing)
- `agents-menu.test.ts` (management menu)
- `manifest.test.ts` (manifest)

## Future Specs

This spec is Spec 1a of a series:

- **Spec 1b: Tool schema, frontmatter, and execution features.** New tool params, new frontmatter fields, config merge priority, model resolution, prompt modes, turn-based limits, context forking, extension loading policies.
- **Spec 2: Background/async execution.** `AgentManager.spawn()` (non-blocking), concurrency queue, `get_subagent_result` tool, `steer_subagent` tool, completion notifications, worktree isolation, session resume, JSONL transcripts.
- **Spec 3: Parallel execution.** `parallel` tool (batch spawn), `GroupTracker`, `wait_for_group`, group-level abort/steer, parallel progress rendering.
- **Spec 4: UI features.** Agent widget, fleet list, conversation viewer, enhanced live progress.
