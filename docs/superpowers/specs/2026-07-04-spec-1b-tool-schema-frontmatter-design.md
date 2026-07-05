# Spec 1b: Tool Schema, Frontmatter, and Execution Features

> **Implementation Status (2025-07):** Fully implemented. Key deviations from original design:
> - `timeout_ms` is no longer parsed at all (fully removed, not just deprecated).
> - `timeoutMs` removed from `RunOptions`, `SpawnOptions`, and `SubagentExecutionDetails` (replaced by `maxTurns`).

Extend the `subagent` tool schema, add new frontmatter fields, and wire their behavior: prompt modes, turn-based limits, context forking, and extension loading policies. Builds on Spec 1a (session model).

## Prerequisites

- Spec 1a completed (AgentManager + AgentRunner in place, `createAgentSession()` working)

## Scope

**In scope:**
- New tool parameters: `model`, `thinking`, `max_turns`, `isolated`, `inherit_context`, `run_in_background` (stub), `resume` (stub), `isolation` (stub)
- New frontmatter fields: `prompt_mode`, `max_turns`, `inherit_context`, `run_in_background`, `isolated`, `isolation`, `extensions`, `disallowed_tools`
- Config merge priority rules (tool param vs frontmatter vs default)
- Model resolution via `ctx.modelRegistry` with fuzzy matching
- `append` prompt mode (system prompt layering)
- Turn-based limits (`max_turns` + `grace_turns`) replacing timeout
- `inherit_context` / `buildParentContext()` for context forking
- `isolated` mode and extension loading via `DefaultResourceLoader`
- `disallowed_tools` enforcement
- Config updates: `defaultMaxTurns`, `graceTurns`, remove `defaultTimeoutMs`
- Bundled agents updated with explicit `prompt_mode: replace`

**Out of scope:**
- Background execution (`run_in_background`) — Spec 2
- Session resume (`resume`) — Spec 2
- Worktree isolation (`isolation: worktree`) — Spec 2
- Steering via `steer_subagent` tool — Spec 2

`run_in_background`, `resume`, and `isolation` are accepted in the schema but return a "not yet implemented" error until Spec 2.

## Tool Schema

The `subagent` tool schema expands from 3 to 12 parameters:

```typescript
parameters: Type.Object({
  // Existing (unchanged)
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "The task for the agent to perform" }),
  cwd: Type.Optional(Type.String({ description: "Working directory override" })),

  // New — functional in this spec
  model: Type.Optional(Type.String({
    description: "Model override (provider/modelId or fuzzy name like 'haiku', 'sonnet')"
  })),
  thinking: Type.Optional(Type.String({
    description: "Thinking level: off, low, medium, high"
  })),
  max_turns: Type.Optional(Type.Number({
    description: "Maximum agentic turns before stopping",
    minimum: 1,
  })),
  isolated: Type.Optional(Type.Boolean({
    description: "If true, agent gets no extension/MCP tools, only built-in tools"
  })),
  inherit_context: Type.Optional(Type.Boolean({
    description: "If true, fork parent conversation into the agent"
  })),

  // New — stubbed (not yet implemented)
  run_in_background: Type.Optional(Type.Boolean({
    description: "Run in background and return agent ID immediately"
  })),
  resume: Type.Optional(Type.String({
    description: "Agent ID to resume from previous context"
  })),
  isolation: Type.Optional(Type.Literal("worktree", {
    description: "Run agent in a temporary git worktree"
  })),
})
```

### Stub handling

When `run_in_background`, `resume`, or `isolation` are provided, the tool handler returns an error:

```
"run_in_background is not yet implemented. It will be available in a future update."
```

This keeps the schema stable so LLMs learn the parameters now. The stubs are removed when Spec 2 implements the behavior.

## Config Merge Priority

When the tool handler receives parameters, it merges them with the agent's frontmatter config. The principle: **if an agent author pins a value in frontmatter, the LLM cannot override it.** Tool params fill in what frontmatter doesn't specify.

| Field | Priority (highest first) |
|-------|-------------------------|
| `model` | agent frontmatter > tool param > parent model |
| `thinking` | agent frontmatter > tool param > parent default |
| `max_turns` | agent frontmatter > tool param > config `defaultMaxTurns` |
| `isolated` | agent frontmatter > tool param > `false` |
| `inherit_context` | agent frontmatter > tool param > `false` |
| `cwd` | tool param > parent cwd (frontmatter doesn't set cwd) |

Implementation: a `resolveInvocationConfig(agentDef, toolParams, parentDefaults)` function that returns the merged config. This is a pure function, easy to test.

## Model Resolution

When a `model` string needs to resolve to a `Model` object:

1. Use `ctx.modelRegistry` (available from pi-coding-agent context).
2. Try exact match first (`provider/modelId` format).
3. Fall back to fuzzy matching (e.g., `"sonnet"` matches `anthropic/claude-sonnet-4`, `"haiku"` matches `anthropic/claude-haiku-4-5`).
4. If no match found, return an error to the LLM listing available models.

This follows tintinweb's `resolveModel()` approach. We implement our own resolution function using the same algorithm:
- Exact id match: highest score
- id/name contains query: medium score
- All query parts present: lowest passing score

## Frontmatter Extensions

New fields parsed in `agent-format.ts`, added to `AgentDefinition`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt_mode` | `"replace" \| "append"` | `"replace"` | System prompt strategy |
| `max_turns` | `number` | `0` (unlimited) | Turn limit for this agent |
| `inherit_context` | `boolean` | `false` | Fork parent conversation |
| `run_in_background` | `boolean` | `false` | Default to background (Spec 2) |
| `isolated` | `boolean` | `false` | No extension/MCP tools |
| `isolation` | `"worktree"` | undefined | Git worktree mode (Spec 2) |
| `extensions` | `true \| string[] \| false` | `true` | Extension loading policy |
| `disallowed_tools` | `string[]` | `[]` | Tools to exclude from allowlist |

Existing fields remain unchanged. `timeout_ms` is deprecated but still parsed (ignored at runtime since this spec replaces timeout with turn limits).

### Parsing rules

- `prompt_mode`: string, must be `"replace"` or `"append"`. Invalid values default to `"replace"`.
- `max_turns`: non-negative integer. `0` means unlimited. Invalid values ignored.
- `inherit_context`, `run_in_background`, `isolated`: boolean. Invalid values ignored.
- `isolation`: string, must be `"worktree"`. Invalid values ignored.
- `extensions`: `true` (or omitted) = all, `false` or `"none"` = none, CSV string = specific list.
- `disallowed_tools`: CSV string parsed to array. Empty or omitted = `[]`.

## Prompt Modes

### Replace mode (existing)

The agent owns its entire system prompt. Current behavior, made explicit by `prompt_mode: replace` in frontmatter.

```
<active_agent name="{agentName}"/>
You are a pi coding agent sub-agent...
Environment: cwd={cwd}, git branch={branch}, platform={platform}
{agentDef.systemPrompt}
{skillBlocks}
```

### Append mode (new)

The agent inherits the parent's identity and layers its specialization on top. Useful for agents that should behave like the parent but with additional instructions.

```
{parentSystemPrompt OR genericFallback}

<sub_agent_context>
You are operating as a specialized sub-agent. Your parent session has
delegated a specific task to you. Focus on completing the delegated
task efficiently.
</sub_agent_context>

<active_agent name="{agentName}"/>
Environment: cwd={cwd}, git branch={branch}, platform={platform}

<agent_instructions>
{agentDef.systemPrompt}
</agent_instructions>

{skillBlocks}
```

If the parent system prompt is unavailable, use a generic fallback: "You are a general-purpose coding agent..."

### Implementation

`buildAgentPrompt()` function in `agent-runner.ts`:

```typescript
function buildAgentPrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  extras?: PromptExtras,
): string
```

- `agentDef.promptMode === "replace"`: ignore `parentSystemPrompt`, build standalone prompt
- `agentDef.promptMode === "append"`: layer on top of `parentSystemPrompt`

Supporting types:

```typescript
interface EnvInfo {
  isGitRepo: boolean
  branch: string
  platform: string
}

interface PromptExtras {
  skillBlocks?: Array<{ name: string; content: string }>
}
```

`EnvInfo` detected via a `detectEnv(cwd)` call that checks git status and `process.platform`.

## Turn-Based Limits

Replace `defaultTimeoutMs` with `max_turns` + `grace_turns`. This gives agents a chance to wrap up before being killed.

### Behavior

1. **No limit** (`maxTurns === 0` or undefined): Agent runs until it finishes naturally.

2. **Soft limit** (turn count reaches `maxTurns`): Agent receives a steer message:
   > "You have reached the turn limit. Wrap up your work immediately and return your final result."
   
   Uses `session.steer()` which injects a user message into the conversation.

3. **Hard limit** (turn count reaches `maxTurns + graceTurns`): Agent is aborted via `session.abort()`. Record status set to `"steered"` (not `"aborted"`, because the agent was given a chance to finish).

### New status: "steered"

`AgentRecord.status` gains `"steered"`:

```typescript
status: "running" | "completed" | "steered" | "aborted" | "error"
```

`RunResult` gains `steered: boolean`:

```typescript
interface RunResult {
  responseText: string
  session: AgentSession
  aborted: boolean
  steered: boolean
}
```

### Turn limit resolution

Priority: tool param (from merge) > `agentDef.maxTurns` (frontmatter) > `config.defaultMaxTurns`. Grace turns from `config.graceTurns`.

The manager resolves this and passes the final `maxTurns` + `graceTurns` to the runner.

### Implementation in AgentRunner

```typescript
session.on("turn_end", () => {
  turnCount++
  options.onTurnEnd?.(turnCount)
  
  if (maxTurns > 0 && turnCount === maxTurns) {
    session.steer("You have reached the turn limit. Wrap up your work immediately and return your final result.")
    softLimitHit = true
  }
  
  if (maxTurns > 0 && turnCount >= maxTurns + graceTurns) {
    session.abort()
  }
})
```

Remove the `setTimeout` / `clearTimeout` timeout mechanism from Spec 1a.

## Context Forking

When `inherit_context: true`, the parent's conversation history is prepended to the agent's prompt.

### buildParentContext()

```typescript
function buildParentContext(ctx: ExtensionContext): string
```

1. Get conversation branch from `ctx.sessionManager.getBranch()`.
2. Format entries:
   - `message` with `role: "user"` -> `[User]: {text}`
   - `message` with `role: "assistant"` -> `[Assistant]: {text}`
   - `compaction` -> `[Summary]: {summary}`
   - Skip `toolResult` entries (too verbose)
3. Return formatted string:

```
<parent_conversation>
The following is the conversation history from the parent session that
delegated this task to you. Use it for context but focus on your
assigned task.

[User]: ...
[Assistant]: ...
[Summary]: ...
</parent_conversation>
```

The parent context is prepended to the prompt as text, not injected as conversation history. This keeps the agent's conversation clean.

## Extension Loading Policies

Control which extensions are loaded into child sessions. Uses `DefaultResourceLoader` from pi-coding-agent.

### Isolated mode

When `isolated: true` (from frontmatter or tool param):
- No extensions loaded (`noExtensions: true`)
- Agent gets only built-in tools from its `tools` allowlist
- Overrides `extensions` frontmatter field

### Extensions field

When `isolated` is false:

| Value | Behavior |
|-------|----------|
| `true` (default, or omitted) | Standard extension discovery |
| `false` or `"none"` | No extensions loaded |
| `["ext1", "ext2"]` | Only load named extensions (allowlist) |

### disallowed_tools

After tool resolution (built-in + extension tools), remove any tools in `disallowed_tools`:

```typescript
const finalTools = allowedTools.filter(t => !agentDef.disallowedTools.includes(t))
```

### Implementation in AgentRunner

Replace the `noExtensions: true` default from Spec 1a with policy-driven loading:

```typescript
function createResourceLoader(agentDef: AgentDefinition, cwd: string, systemPrompt: string) {
  if (agentDef.isolated) {
    return new DefaultResourceLoader({
      cwd,
      noExtensions: true,
      systemPromptOverride: systemPrompt,
      noPromptTemplates: true,
      noContextFiles: true,
    })
  }

  const extConfig = agentDef.extensions
  return new DefaultResourceLoader({
    cwd,
    noExtensions: extConfig === false,
    extensionsOverride: Array.isArray(extConfig) ? extConfig : undefined,
    systemPromptOverride: systemPrompt,
    noPromptTemplates: true,
    noContextFiles: true,
  })
}
```

## Types Summary

### AgentInvocation (extended)

```typescript
interface AgentInvocation {
  agent: string
  task: string
  cwd?: string
  model?: string
  thinking?: string
  maxTurns?: number
  isolated?: boolean
  inheritContext?: boolean
}
```

### Config update

```typescript
interface SubagentsConfig {
  maxConcurrency: number       // Unchanged, default 3
  maxRecursiveLevel: number    // Unchanged, default 3
  defaultMaxTurns: number      // New, default 0 (unlimited)
  graceTurns: number           // New, default 5
}
```

`defaultTimeoutMs` is removed.

### SpawnOptions (extended)

```typescript
interface SpawnOptions {
  // From Spec 1a
  prompt: string
  cwd: string
  parentSignal?: AbortSignal
  currentDepth?: number
  allowedAgents?: string[]
  onToolActivity?: (activity: ToolActivity) => void
  onTextDelta?: (delta: string, fullText: string) => void
  onTurnEnd?: (turnCount: number) => void
  onUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void
  onSessionCreated?: (session: AgentSession) => void

  // New in this spec
  model?: Model
  thinking?: ThinkingLevel
  maxTurns?: number
  isolated?: boolean
  inheritContext?: boolean
}
```

`timeoutMs` removed (replaced by `maxTurns`).

### RunOptions (extended)

```typescript
interface RunOptions {
  // From Spec 1a
  prompt: string
  cwd: string
  agentId: string
  allowRecursion?: boolean
  signal?: AbortSignal
  onToolActivity?: (activity: ToolActivity) => void
  onTextDelta?: (delta: string, fullText: string) => void
  onTurnEnd?: (turnCount: number) => void
  onUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void
  onSessionCreated?: (session: AgentSession) => void

  // New in this spec
  model?: Model
  thinking?: ThinkingLevel
  maxTurns?: number
  graceTurns?: number
  isolated?: boolean
  inheritContext?: boolean
}
```

`timeoutMs` removed.

## Bundled Agents Migration

Each agent `.md` file in `agents/` gets `prompt_mode: replace` added to frontmatter. No other changes.

## Module Changes

### Modified

| Module | Change |
|--------|--------|
| `core/subagent.ts` | Expand tool schema. Add stub checks. Add `resolveInvocationConfig()`. Pass new fields to manager. Remove timeout resolution. |
| `core/agent-format.ts` | Parse new frontmatter fields. |
| `core/agent-runner.ts` | Add `buildAgentPrompt()` (both modes). Add `detectEnv()`. Add `buildParentContext()`. Add `createResourceLoader()`. Replace timeout with turn counting + steer/abort. Apply `disallowed_tools`. Accept and use `model`/`thinking`/`maxTurns`/`isolated`/`inheritContext`. |
| `core/agent-manager.ts` | Accept new SpawnOptions fields. Resolve `maxTurns` priority chain. Pass `maxTurns`/`graceTurns` to runner. Remove timeout handling. Add `setDefaultMaxTurns()`, `setGraceTurns()`. Map `steered` result to record status. |
| `shared/types.ts` | Extend `AgentDefinition` with new fields. Extend `AgentInvocation`. Add `"steered"` to record status. Add `steered` to `RunResult`. Add `EnvInfo`, `PromptExtras`. Update `SubagentsConfig`, `SpawnOptions`, `RunOptions`. Remove `timeoutMs`. |
| `core/config.ts` | Add `defaultMaxTurns: 0`, `graceTurns: 5`. Remove `defaultTimeoutMs`. |
| `tui/render.ts` | Show model/thinking in details. Render `"steered"` status. Show turn count vs max turns. |
| `agents/*.md` | Add `prompt_mode: replace` to frontmatter. |

### Unchanged

All modules not listed above remain unchanged from Spec 1a.

## Testing

### New tests

- **`invocation-config.test.ts`**: Test `resolveInvocationConfig()` merge rules. Test every priority chain. Test edge cases (both undefined, both set, one set).
- **`model-resolver.test.ts`**: Test exact match, fuzzy match, no match. Test `provider/modelId` format. Test shorthand names.

### Updated tests

- **`subagent.test.ts`**: Add cases for new tool params. Test stub error responses. Test model resolution. Test invocation snapshot.
- **`agent-format.test.ts`**: Add cases for all new frontmatter fields. Test defaults, invalid values, CSV parsing.
- **`agent-runner.test.ts`**: Test `buildAgentPrompt()` in both modes (replace standalone, append layered, fallback). Test turn limit enforcement (soft steer, hard abort, no limit). Test extension loading policies (isolated, extensions: false/array). Test `disallowed_tools` filtering. Test `inheritContext` prepends parent context. Test `detectEnv()`. Test model/thinking passed to session.
- **`agent-manager.test.ts`**: Test new SpawnOptions pass through. Test `maxTurns` resolution priority. Test `graceTurns`. Test `"steered"` record status. Test `setDefaultMaxTurns()`, `setGraceTurns()`.
- **`config.test.ts`**: Test new defaults. Test `defaultTimeoutMs` removed.
- **`render.test.ts`**: Test model/thinking display. Test `"steered"` status. Test turn count display.

## Future Specs

- **Spec 2: Background/async execution.** `AgentManager.spawn()` (non-blocking), concurrency queue, `get_subagent_result` tool, `steer_subagent` tool, completion notifications. Removes stubs for `run_in_background`, `resume`, `isolation`.
- **Spec 3: Parallel execution.** `parallel` tool (batch spawn), `GroupTracker`, `wait_for_group`, group-level abort/steer, parallel progress rendering.
- **Spec 4: UI features.** Agent widget, fleet list, conversation viewer, enhanced live progress.
