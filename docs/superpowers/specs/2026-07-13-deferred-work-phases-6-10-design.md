# Deferred Work Completion: Phases 6-10

All deferred tasks from phases 1-5 organized into 5 shippable phases, ordered simplest to most complex.

Cross-referenced against: nicobailon-pi-subagents (watchdog reference), tintinweb-pi-subagents (chains reference), Pi SDK (extension API).

## Inventory

21 deferred items across 4 themes. 2 are already done (resetSpawnCounter, bundled chain discovery). 19 remain.

## Phase 6: Quick Wins Sweep

Small additions that follow existing patterns. Single-session implementation.

### 6.1 `maxSpawnsPerSession` in Settings

Add persistent config support for the spawn limit (currently only set via `loadConfig` at startup).

**Changes:**
- `settings.ts`: Add `maxSpawnsPerSession?: number` to `SubagentsSettings`. Add `setMaxSpawnsPerSession?: (n: number) => void` to `SettingsAppliers`. Add apply line.
- `index.ts`: Wire the applier to `manager.setMaxSpawnsPerSession`.
- Validation: integer, 1-10000.

### 6.2 `.gitignore` Notification for Local Memory

When the memory module writes to `.pi/agent-memory-local/` for the first time in a session, check if this path is covered by `.gitignore`. If not, emit a follow-up message suggesting the user add it.

**Changes:**
- Memory module (locate the write path for local scope): After first write, run `git check-ignore -q .pi/agent-memory-local/`. If exit code is non-zero (not ignored), emit a one-time follow-up message.
- Gate: only check once per session (use a boolean flag).

### 6.3 Per-Agent `maxDepth` Frontmatter

Allow individual agent definitions to tighten the nesting limit below the global default.

**Changes:**
- `agent-format.ts`: Parse `max_depth` from frontmatter. Validate non-negative integer.
- Agent type (in `types.ts` or `agents.ts`): Add `maxDepth?: number` to `AgentDefinition`.
- `agent-manager.ts` or spawn path: When resolving the effective `maxDepth` for a spawn, use `agentDef.maxDepth ?? globalMaxDepth`.

### 6.4 Batch Spawns in `checkSpawnLimit`

Wire chain parallel steps to pass the actual item count to `checkSpawnLimit` instead of 1.

**Changes:**
- `chain-execution.ts` (or wherever parallel steps are spawned): Before spawning N parallel items, call `checkSpawnLimit(spawnCount, N, maxSpawns)` to verify budget. If insufficient, either reduce parallelism or block.
- Decision: reduce parallelism (spawn as many as budget allows) rather than hard-blocking.

---

## Phase 7: Watchdog Completions

Build on Phase 5 watchdog. Adds the features that were deliberately held back from MVP.

### 7.1 Watchdog TUI Renderer

Register a custom message renderer for `watchdog-warning` messages with severity icons, colors, and state labels.

**Changes:**
- `index.ts`: Add `pi.registerMessageRenderer("watchdog-warning", renderer)` following the `subagent-notification` pattern.
- Renderer receives `(message: CustomMessage<WatchdogWarningDetails>, options: { expanded: boolean }, theme: Theme)`.
- Render format: `[!] blocker: summary` (theme `error` color) or `[~] concern: summary` (theme `warning` color).
- When expanded: show evidence and action on subsequent lines.
- State labels: Track warning state (`displayed`, `stale`, `failed`, `stalemate`) and render as suffix tags. Include `auto-follow attempt N` when applicable.

### 7.2 Model Recommendation

Intelligent complementary model selection when `watchdog.model` is unset.

**Changes:**
- New: `watchdog-model-selection.ts` with `recommendStrongWatchdogModel(ctx)`.
- Logic: Analyze current session model's provider family. Suggest a complementary model from a different provider (e.g., if session uses GPT-5.5, suggest Opus 4.8; if Anthropic, suggest OpenAI).
- Expose via `/watchdog recommend-model` command that shows recommendation and allows applying it.
- On first review when model is unset: surface recommendation in status output (not just console.info).
- One-time suggestion per session (flag guard).

### 7.3 Child Watchdog

Per-child-agent watchdog instances that review child agent work independently.

**Changes:**
- Re-add `children: { enabled: boolean; model?: string; thinking?: boolean; overrides: Record<string, Partial<WatchdogConfig>> }` to `WatchdogConfig`.
- Config resolution: `resolveChildWatchdogConfig({ config, agent, runId, childIndex })` — merges parent defaults with per-agent overrides. Returns `undefined` if child watchdog disabled for that agent.
- Config passing: Serialize child config as env var `PI_SUBAGENT_WATCHDOG_CHILD_CONFIG` (JSON) passed to child process.
- Status protocol: Child watchdog emits JSON status events via stdout for parent tracking. States: `idle`, `reviewing`, `autofollow`, `settling`, `stale`, `failed`.
- Lifecycle: Child watchdog is a single-use `WatchdogRuntime` instance. Runs `handleAgentEnd(childId, childCwd)` in child's onComplete callback. Disposed after review completes.
- Parent integration: Parse child status events and surface results in parent session's watchdog status.

### 7.4 Turn-Delta Mode

Alternative review mode: instead of reviewing git diffs, review the last N tool calls + responses from the agent's conversation.

**Changes:**
- Add `reviewChangesOnly?: boolean` to `WatchdogConfig` (default: `true`). When `true`: git-diff + LSP review. When `false`: turn-delta review.
- `watchdog.ts` `handleAgentEnd`: When `!reviewChangesOnly`, skip git diff/LSP. Instead, extract the last N (e.g., 10) tool calls from the agent's session via `session.messages` (SDK getter).
- New: `watchdog-turn-delta.ts` with `formatWatchdogTurnDelta(messages)`:
  - Extracts tool calls, results, and user prompts from the message array.
  - Redacts large tool inputs: for `edit`/`write` tools, replace `oldText`/`newText`/`content` fields with `[omitted N chars; use tool result diff]` to save tokens.
- Build the review prompt from formatted turn delta content instead of diff content.
- Runtime tracks `reviewTrigger: "repo-edits" | "turn-delta"` in its snapshot for status display.
- Useful for non-code agents (research, planning) where git diff is meaningless.

### 7.5 Auto-Follow Steering

When watchdog finds blockers, automatically resume the reviewed agent to fix them.

**Note:** The nicobailon reference marks this "not implemented" despite having the config/state structure. This suggests complexity or unintended consequences were encountered. Implement cautiously with conservative defaults (disabled by default, low maxAttempts).

**Changes:**
- Re-add `autoFollow: { blockers: boolean; concerns: boolean; maxAttempts: number; stalemateRepeats: number }` to `WatchdogConfig`. Default: `{ blockers: false, concerns: false, maxAttempts: 2, stalemateRepeats: 2 }`.
- `watchdog.ts`: After `handleAgentEnd` collects warnings, if `autoFollow.blockers` and warnings include blockers:
  1. Format a steering message: "Watchdog found blockers: [list]. Please fix these issues."
  2. Call `manager.resume(agentId, steeringMessage)` to restart the completed agent with the fix instruction. (SDK note: `steer()` only works on running/queued agents; `resume()` is correct for completed agents.)
  3. After the agent completes again, re-run watchdog review.
  4. Repeat up to `maxAttempts`.
- Stalemate detection: If the same warning summary appears `stalemateRepeats` times, mark warning state as `"stalemate"`, stop steering, and surface to parent.
- `WatchdogRuntime` interface: Integrate into `handleAgentEnd` by accepting a `resumeFn: (agentId: string, message: string) => Promise<void>` callback in options.

---

## Phase 8: Chain Completions

Improvements to the chain execution engine.

### 8.1 `buildChainInstructions` Integration

Inject read/write/progress annotations into task strings sent to child agents based on chain step behavior.

**Changes:**
- `chain-execution.ts`: Before spawning a step's agent, call `buildChainInstructions(step)` to prefix/suffix the task string with behavior instructions (e.g., "Write output to: {path}", "Read context from: {path}").
- `buildChainInstructions` function: Already partially defined in chain specs. Implement it based on step's `reads`, `output`, `progress` frontmatter fields.

### 8.2 Concurrency Limiting for Parallel Steps

Dual-limit concurrency: per-step limit AND global chain limit to prevent runaway parallelism.

**Changes:**
- New: `src/core/semaphore.ts` — simple counting semaphore with `acquire()`/`release()`.
- Global concurrency limit: `DEFAULT_GLOBAL_CONCURRENCY_LIMIT = 20`. Created once per chain execution run. Prevents total active agents from exceeding cap even across multiple parallel steps.
- Per-step limit: When `step.concurrency` is set, create a per-step semaphore that further caps that step.
- `chain-execution.ts`: New `mapConcurrent(items, stepLimit, fn, globalSemaphore)` that respects both limits. Workers acquire global semaphore before executing, release in finally block.
- Default per-step: unlimited. Default global: 20.

### 8.3 `WorkflowGraphSnapshot` Building

After each chain step completes, emit a rich snapshot of the execution state for TUI rendering.

**Changes:**
- Define `WorkflowGraphSnapshot` type with node kinds: `step`, `parallel-group`, `dynamic-parallel-group`, `agent`.
- Each node: `{ id, kind, label, status: "pending"|"running"|"done"|"failed", flatIndex, stepIndex, duration?, children? }`.
- Phase grouping: Nodes are grouped by `phase` label for visual separation in the TUI.
- Support dynamic fanout: parallel groups track child agents with per-child status.
- `chain-execution.ts`: After each step completes, build snapshot from step state and call `onGraphUpdate(snapshot)`.
- The chain widget (`ChainWidget`) already accepts updates — wire the snapshot into it.

### 8.4 Model Override Per Step

Allow chain steps to specify a model for their child agent.

**Changes:**
- Chain step frontmatter: Parse `model: "provider/model-name"` field.
- Model resolution: Before calling spawn, resolve the model string to a Model object using `capturedModelRegistry.find(provider, modelId)`. Fall back to agent config model, then session model (chain: task.model → agent.model → session.model).
- `spawnAndWait`: Accept optional `model` parameter. Pass it through to `AgentManager.spawn()` options.
- `agent-manager.ts` `spawn()`: `options.model` already flows through to `createAgentSession` via `agent-runner.ts` (line 260: `const model = (options.model ?? ctx.model) as never`).

### 8.5 Worktree Support for Parallel Steps

Create git worktrees per parallel item to prevent filesystem conflicts. Production-proven pattern from reference.

**Changes:**
- New: `src/core/worktree.ts` (~200 LOC) with:
  - `createWorktree(repoRoot, runId, index, options)` — creates `pi-worktree-{runId}-{index}` in base dir. Branch: `pi-parallel-{runId}-{index}`.
  - Clean working tree validation before creating worktrees.
  - **Node_modules linking:** Automatically symlink `node_modules` from repo root to worktree (avoids duplicate installs).
  - **Setup hooks:** If `.pi/worktree-setup.sh` exists, run it with `WorktreeSetupHookInput` JSON on stdin. Hook returns `{ syntheticPaths?: string[] }`.
  - **Synthetic paths:** Paths returned by setup hook are excluded from diff capture (e.g., generated files).
  - **Conflict detection:** If a task-level `cwd` would conflict with worktree isolation, warn and skip worktree for that item.
  - **Diff capture:** After item completes, capture `git diff` in worktree as a patch file for merging.
  - **Cleanup:** `git worktree remove` in a finally block. Rollback on failure.
- `chain-execution.ts`: When `step.worktree: true` and step has parallel items, create worktrees and set each item's `cwd` to its worktree path.
- Fallback: If `git worktree add` fails (not a git repo), log warning and run without isolation.
- Base directory: Configurable via `PI_WORKTREE_BASE_DIR` env var (default: adjacent to repo root).

---

## Phase 9: Chain Advanced

New chain capabilities.

### 9.1 Async/Background Chain Execution

Allow `/chain run foo --bg` to execute chains in the background, with runtime step-append support.

**Changes:**
- `/chain run` command: Parse `--bg` flag.
- When `--bg`: Call `manager.fireAndForgetChain(...)` (already exists) to register the chain as a background task. Return immediately with the chain run ID.
- Add `/chain status <id>` subcommand: Show current step, progress, elapsed time.
- Add `/chain cancel <id>`: Abort a running background chain (use existing `agent-manager.ts:abort()`).
- Chain record: Add `chainSteps?: ChainStepStatus[]` metadata to `AgentRecord` type for status display.
- **Runtime step-append:** Allow adding steps to a running background chain via `enqueueChainAppendRequest(chainId, newSteps)`. Useful for dynamic workflow extension (e.g., user decides to add more work to an in-progress chain).
- Background launch also available from clarification TUI (9.2) as a "Run in background" option.

### 9.2 Chain Clarification TUI

Interactive editor for reviewing and modifying chains before execution (not just confirmation).

**Changes:**
- After parsing a chain but before executing, display an interactive TUI with:
  - Step list with labels, agents, and behavior annotations.
  - **Editable fields per step:** template text, output path, reads list, progress toggle, model selection, skills.
  - "Run in background" toggle (integrates with 9.1).
  - Confirm / Cancel actions.
- `BehaviorOverride` type: `{ output?: string | false; reads?: string[] | false; progress?: boolean; model?: string; skills?: string[] | false }`.
- `ChainClarifyResult`: `{ confirmed: boolean; templates: string[]; behaviorOverrides: (BehaviorOverride | undefined)[]; runInBackground?: boolean }`.
- Use the existing TUI interactive pattern (similar to `showAgentsMenu`).
- Skip clarification when `--yes` flag is passed.
- Skip for parallel-only steps (no templates to edit).
- Timeout: If no response in 30s, abort (don't silently start expensive chains).

### 9.3 Prompt Workflow Chains

Discover and run chains from prompt workflow templates.

**Changes:**
- Prompt workflows (`prompt-workflows.ts`) already discover `.md` workflow files.
- Add support for a workflow to reference a chain: `chain: implement` in workflow frontmatter.
- When a prompt workflow references a chain, `/workflow run <name>` delegates to chain execution instead of direct prompting.
- Add `/chain-prompts` alias command that lists only workflow-backed chains.

---

## Phase 10: Platform Upgrades

High-complexity items with external dependencies.

### 10.1 Full LSP Client

Replace `tsc --noEmit` with a JSON-RPC LSP client for richer per-file diagnostics.

**Changes:**
- New file: `src/core/lsp-client.ts` (~200 LOC).
- Implements JSON-RPC framing over stdio: `Content-Length` header, JSON message parsing.
- LSP lifecycle: `initialize` → `initialized` → `textDocument/didOpen` → `textDocument/diagnostic` (or `textDocument/publishDiagnostics` notification).
- Server discovery: Try `typescript-language-server --stdio` first, then `tsserver`.
- `watchdog-lsp.ts`: When LSP client is available, use it instead of `tsc --noEmit`. Fall back to `tsc --noEmit` if LSP fails to start.
- Per-file diagnostics: Only request diagnostics for `changedPaths` (not whole project).
- Timeout: Kill the LSP server after `config.lsp.timeoutMs`.
- Cache: Keep the LSP server alive across reviews within a session (reuse for subsequent `handleAgentEnd` calls). Dispose on `watchdog.dispose()`.

### 10.2 Per-Tool Blocking

Selective tool blocking when budget limits are hit, instead of aborting the entire agent.

**SDK capability confirmed:** The Pi SDK exposes a `tool_call` event with a `block` capability:
```typescript
pi.on("tool_call", (event, ctx) => {
  return { block: true, reason: "..." };  // blocks tool execution
});
```
The `ToolCallEventResult` interface: `{ block?: boolean; reason?: string }`.

**Phase 10 delivers:**
- Budget tracking per tool category (read/write/execute counts per agent).
- `tool_call` event handler: Before each tool execution, check tool budget. If exceeded, return `{ block: true, reason: "Tool budget exhausted for ${toolName}. Used ${used}/${limit}." }`.
- Advisory warning: When a tool reaches 80% of budget, emit a warning message to the agent before blocking occurs.
- Per-tool budget config: `tool_budget: { file_write: 50, shell_execute: 20, ... }` in agent frontmatter or settings.
- Graceful degradation: When a tool is blocked, the agent can still use other tools (unlike current abort-all behavior).

---

## Dependencies Between Phases

```
Phase 6 (quick wins) ── independent
Phase 7 (watchdog)   ── depends on Phase 5 (done)
Phase 8 (chains)     ── depends on chain engine (done)
Phase 9 (chain adv)  ── depends on Phase 8
Phase 10 (platform)  ── depends on Phase 5 (watchdog) and spawn-limits (done)
```

Phases 6, 7, and 8 can be implemented in parallel if desired. Phase 9 requires Phase 8. Phase 10 is independent of 7-9.

## Success Criteria

- All 19 remaining items implemented (or explicitly stubbed with documented blockers for SDK-dependent items).
- All existing tests continue to pass.
- New functionality has test coverage.
- Each phase is independently shippable (passes typecheck + tests after each phase).
