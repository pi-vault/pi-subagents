# Spec 2: Background/Async Execution

Add non-blocking agent execution. The parent LLM spawns background agents, continues working, and collects results later. Includes concurrency queue, steering, session resume, worktree isolation, completion notifications, and JSONL transcripts.

## Prerequisites

- Spec 1a completed (AgentManager + AgentRunner)
- Spec 1b completed (tool schema, frontmatter, turn-based limits, extension loading policies)

## Scope

**In scope:**
- `AgentManager.spawn()` — non-blocking, returns agent ID immediately
- Concurrency queue with `maxConcurrency` slots and FIFO drain
- `get_subagent_result` tool — check status, wait for completion, get result
- `steer_subagent` tool — send message to running agent
- Completion notifications via `pi.notify()` with custom renderer
- Join modes: `async`, `group`, `smart`
- `GroupJoinManager` for batching notifications
- Worktree isolation (`isolation: "worktree"`)
- Session resume (`resume` param)
- JSONL output file streaming for transcripts
- Remove stubs for `run_in_background`, `resume`, `isolation`
- `AgentRecord` extended with background-specific fields
- Settings for concurrency, join mode, etc.

**Out of scope:**
- Scheduled/cron execution — future
- Batch spawning (multiple agents in one call) — Spec 3
- Group coordination — Spec 3
- UI features (widget, fleet view, conversation viewer) — Spec 4

## New Tools

### get_subagent_result

Query the status and result of a background agent.

```typescript
parameters: Type.Object({
  agent_id: Type.String({ description: "The agent ID to check." }),
  wait: Type.Optional(Type.Boolean({
    description: "If true, wait for the agent to complete before returning. Default: false."
  })),
  verbose: Type.Optional(Type.Boolean({
    description: "If true, include the agent's full conversation. Default: false."
  })),
})
```

**Handler behavior:**

1. Look up record via `manager.getRecord(id)`.
2. If not found, return error "Agent not found."
3. If `wait: true` and agent is still running, await `record.promise`.
4. Mark `record.resultConsumed = true` (suppresses duplicate completion notification).
5. Return status, result text, usage stats, duration.
6. If `verbose: true`, include conversation via `getAgentConversation(record.session)`.

**Return format:**

```
Agent [id]: completed
Result: <response text>
Duration: 45s | Turns: 12 | Tool uses: 8 | Tokens: 15.2k
```

### steer_subagent

Send a message to a running background agent, injecting it as a user message in the agent's conversation.

```typescript
parameters: Type.Object({
  agent_id: Type.String({ description: "The agent ID to steer (must be currently running)." }),
  message: Type.String({ description: "Message to send. Appears as a user message in the agent's conversation." }),
})
```

**Handler behavior:**

1. Look up record via `manager.getRecord(id)`.
2. If not found or not running, return error.
3. Call `manager.steer(id, message)`.
4. If session is ready, call `session.steer(message)` immediately.
5. If session not yet created (agent is queued or starting), queue in `record.pendingSteers`. Flush when `onSessionCreated` fires.
6. Return confirmation.

## AgentManager Changes

### New methods

```typescript
class AgentManager {
  // Existing from Spec 1a
  spawnAndWait(ctx, agentDef, options): Promise<{ id: string; record: AgentRecord }>

  // New in Spec 2
  spawn(ctx, agentDef, options: SpawnOptions): string  // Returns agent ID immediately
  resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined>
  steer(id: string, message: string): boolean
  hasRunning(): boolean
  abortAll(): number
  waitForAll(): Promise<void>

  // Config
  setMaxConcurrent(n: number): void
  getMaxConcurrent(): number
}
```

### spawn() flow

Non-blocking. Returns agent ID immediately while execution continues in background.

1. **Validate** — same depth/allowlist/cwd checks as `spawnAndWait()`.
2. **Create record** — status `"queued"` if at concurrency limit, `"running"` otherwise. Set `isBackground: true`.
3. **Queue or start** — if `runningBackground >= maxConcurrent` and not bypassing queue, push `{id, args}` to queue. Otherwise call `startAgent()`.
4. **Return** agent ID.

### startAgent() (private)

Shared between `spawn()` and queue drain. Runs agent asynchronously.

1. Re-validate cwd (TOCTOU protection for queued spawns).
2. If `isolation: "worktree"`: create temporary git worktree via `createWorktree()`, set agent cwd to worktree path, store worktree metadata on record.
3. Update status to `"running"`, increment `runningBackground`.
4. Wire parent `AbortSignal` to child abort.
5. Call `runAgent()` as a fire-and-forget promise.
6. Set up callbacks that update the record (toolUses, turnCount, lifetimeUsage, session).
7. Handle steering messages queued before session was ready.
8. Set up JSONL output file streaming via `streamToOutputFile()`.
9. On completion:
   - Update status (`"completed"`, `"steered"`, `"aborted"`, or `"error"`).
   - If worktree: clean up worktree, merge changes to branch if any, store `worktreeResult`.
   - Flush and close output file.
   - Decrement `runningBackground`, call `drainQueue()`.
   - Fire `onComplete` callback (for notifications).

### drainQueue() (private)

Called after each background agent completes.

```typescript
private drainQueue(): void {
  while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
    const next = this.queue.shift()!
    this.startAgent(next.id, next.record, next.args)
  }
}
```

### resume() flow

Continue a completed agent's conversation with a new prompt.

1. Look up record by ID. Validate status is `"completed"` or `"steered"` (reject running/queued/error). Validate it has a session.
2. Call `resumeAgent(record.session, prompt, options)` in the runner.
3. `resumeAgent()` calls `session.prompt(prompt)` on the existing session — the agent picks up where it left off with full conversation history.
4. Update record status back to `"running"`, then handle completion as normal.
5. Return updated record.

### steer() flow

1. Look up record. If not running, return false.
2. If `record.session` exists: call `session.steer(message)`.
3. If session not yet created: push to `record.pendingSteers` array.
4. When `onSessionCreated` fires: flush all pending steers.
5. Return true.

## Concurrency Queue

- **Data structure**: FIFO array of `{ id: string, record: AgentRecord, args: StartArgs }`.
- **Slots**: `maxConcurrent` configurable (default 4, matches tintinweb). Updated via `setMaxConcurrent()` or `/agents` settings menu.
- **Counter**: `runningBackground` tracks active background agents. Foreground agents don't count against the limit.
- **Drain**: Automatic after each background completion. Starts queued agents up to limit.
- **Bypass**: Foreground agents (`spawnAndWait`) always bypass the queue since they block the parent anyway.

## Worktree Isolation

When `isolation: "worktree"` is set (via tool param or frontmatter):

### createWorktree()

1. Validate cwd is inside a git repo.
2. Generate branch name: `subagent/{agentId}`.
3. Create worktree: `git worktree add --detach <tmpDir> HEAD`.
4. Create and checkout branch: `git checkout -b subagent/{agentId}` inside worktree.
5. Return `{ path: tmpDir, branch: branchName, baseSha: HEAD }`.

### Cleanup on completion

1. If agent made changes (dirty worktree):
   - Commit changes in worktree with auto-generated message.
   - Record `worktreeResult: { hasChanges: true, branch: branchName }`.
2. If no changes: `worktreeResult: { hasChanges: false }`.
3. Remove worktree: `git worktree remove <tmpDir>`.
4. Do NOT auto-merge to main branch — the user decides what to do with the branch.

### AgentRecord worktree fields

```typescript
interface AgentRecord {
  // ... existing fields
  worktree?: {
    path: string       // Worktree directory path
    branch: string     // Branch name
    baseSha: string    // SHA the worktree was created from
  }
  worktreeResult?: {
    hasChanges: boolean
    branch?: string    // Branch with changes (if any)
  }
}
```

## JSONL Output File Streaming

Stream agent conversation to a JSONL file during execution. Powers the conversation viewer (Spec 4) and useful for debugging.

### File path

```
/tmp/pi-subagents-{uid}/{encoded-cwd}/{sessionId}/tasks/{agentId}.output
```

Directory created with mode `0o700`.

### streamToOutputFile()

```typescript
function streamToOutputFile(
  session: AgentSession,
  filePath: string,
  agentId: string,
  cwd: string,
): () => void  // Returns cleanup function
```

1. Write initial entry with user prompt.
2. Subscribe to session `turn_end` events.
3. On each `turn_end`: flush new messages since last write.
4. Each JSONL entry:
   ```json
   {"isSidechain": true, "agentId": "abc123", "type": "assistant", "message": {...}, "timestamp": 1720100000, "cwd": "/path"}
   ```
5. Return cleanup function that does final flush + unsubscribe.

### writeInitialEntry()

Writes the initial user prompt as the first JSONL entry:

```json
{"isSidechain": true, "agentId": "abc123", "type": "user", "message": "...", "timestamp": 1720100000, "cwd": "/path"}
```

### AgentRecord output fields

```typescript
interface AgentRecord {
  // ... existing fields
  outputFile?: string        // Path to JSONL output file
  outputCleanup?: () => void // Cleanup function (final flush + unsub)
}
```

## Completion Notifications

When a background agent completes, notify the parent LLM so it can process the result.

### Notification mechanism

Use `pi.notify()` to send a notification message that appears in the parent's conversation:

```typescript
pi.notify("subagent-notification", {
  content: [{ type: "text", text: notificationText }],
  details: notificationDetails,
})
```

### Custom notification renderer

Register via `pi.registerMessageRenderer()`:

```typescript
pi.registerMessageRenderer<NotificationDetails>(
  "subagent-notification",
  (message, { expanded }, theme) => {
    // Render notification with status icon, stats, result preview
  }
)
```

Rendering:
- Completed: `checkmark + agent description + "completed" + stats + result preview`
- Error/Stopped: `X + agent description + status + stats + error message`
- Steered: `checkmark + agent description + "completed (steered)" + stats`
- Stats line: `turns · tool uses · tokens · duration`
- Result preview: first 80 chars of result (collapsed), up to 30 lines (expanded)
- Output file link if present

### NotificationDetails

```typescript
interface NotificationDetails {
  id: string
  description: string        // Derived from agent name + truncated task
  status: string
  toolUses: number
  turnCount: number
  maxTurns?: number
  totalTokens: number
  durationMs: number
  outputFile?: string
  error?: string
  resultPreview: string
  others?: NotificationDetails[]  // For group join batching
}
```

## Join Modes

Control how completion notifications are delivered to the parent.

### async (default)

Each agent sends its own notification immediately when done. Simple and predictable.

### group

All agents spawned during the same tool turn are grouped. Notification is held until all agents in the group complete. A single batched notification is sent with all results.

Implementation:
- When spawning with `joinMode: "group"`, assign a `groupId` (based on the current tool call ID or turn).
- `GroupJoinManager` tracks groups: `Map<string, { expected: number, completed: NotificationDetails[] }>`.
- On each completion: add to group. If all expected agents are done, fire batched notification.
- The batched notification uses `NotificationDetails.others[]` to include all results.

### smart

Auto-decides based on timing. If multiple agents complete within a short window (e.g., 500ms), batch them together. Otherwise send individually.

Implementation:
- On completion, start a timer (500ms).
- If another agent completes before the timer fires, reset the timer and add to batch.
- When timer fires, send batch (or individual if only one).
- `GroupJoinManager` handles the debouncing logic.

### Join mode resolution

Priority: tool param override (future) > config `defaultJoinMode` > `"smart"` default.

Configured via `/agents` settings menu and stored in settings.

## AgentRecord Extensions

Full `AgentRecord` after Spec 2:

```typescript
interface AgentRecord {
  // From Spec 1a
  id: string
  type: string
  status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error"
  result?: string
  error?: string
  toolUses: number
  startedAt: number
  completedAt?: number
  durationMs?: number
  session?: AgentSession
  abortController?: AbortController
  lifetimeUsage: LifetimeUsage
  invocation?: AgentInvocation

  // New in Spec 2
  isBackground?: boolean
  promise?: Promise<string>           // Resolves when agent completes (for wait)
  groupId?: string                    // Join mode group tracking
  joinMode?: JoinMode                 // async | group | smart
  resultConsumed?: boolean            // true if get_subagent_result already read this
  pendingSteers?: string[]            // Queued steers before session ready
  worktree?: { path: string; branch: string; baseSha: string }
  worktreeResult?: { hasChanges: boolean; branch?: string }
  toolCallId?: string                 // Parent tool call ID (for group join)
  outputFile?: string
  outputCleanup?: () => void
  turnCount: number                   // Promoted from optional tracking to required
  compactionCount: number             // Track compaction events
}
```

New statuses:
- `"queued"` — waiting in concurrency queue
- `"stopped"` — manually aborted while queued (never started)

## AgentRunner Extensions

### New exports

```typescript
function resumeAgent(session: AgentSession, prompt: string, options?: ResumeOptions): Promise<string>
function steerAgent(session: AgentSession, message: string): Promise<void>
function getAgentConversation(session: AgentSession): string
```

### resumeAgent()

1. Call `session.prompt(prompt)` on existing session.
2. Collect response text via event subscription.
3. Return response text.

### steerAgent()

Thin wrapper: `session.steer(message)`.

### getAgentConversation()

Extract conversation from session for `verbose` output in `get_subagent_result`:

1. Get conversation branch from `session.sessionManager.getBranch()`.
2. Format entries as readable text.
3. Return formatted string.

## Cleanup

### Time-based cleanup

Run every 60 seconds via `setInterval`:
- Remove records completed more than 10 minutes ago.
- Dispose sessions before removal.
- Clear output cleanup functions.

### Session lifecycle cleanup

- `session_shutdown`: abort all running agents, clear all state, stop cleanup timer.
- `session_before_switch`: clear completed agents, keep running ones.

## Settings

New settings managed via `/agents` menu:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `maxConcurrent` | number | 4 | Max parallel background agents |
| `defaultJoinMode` | `"async" \| "group" \| "smart"` | `"smart"` | Default notification batching mode |

Persisted to `.pi/subagents.json` (project) or `~/.pi/agent/subagents.json` (global).

Settings applied via `SettingsAppliers` pattern:
```typescript
interface SettingsAppliers {
  setMaxConcurrent: (n: number) => void
  setDefaultJoinMode: (mode: JoinMode) => void
  // ... existing setters from earlier specs
}
```

## Events

Lifecycle events emitted via `pi.events.emit()` for other extensions to observe:

| Event | Payload | When |
|-------|---------|------|
| `subagents:created` | `{ id, type, description, isBackground }` | Agent spawned |
| `subagents:started` | `{ id, type, description }` | Agent starts running (after queue) |
| `subagents:completed` | `{ id, type, description, result, ... }` | Agent completed successfully |
| `subagents:failed` | `{ id, type, description, error, ... }` | Agent errored/stopped/aborted |
| `subagents:steered` | `{ id, message }` | Agent received steer message |
| `subagents:ready` | `{}` | Extension ready, manager initialized |

## Module Changes

### New modules

| Module | Est. lines | Responsibility |
|--------|-----------|----------------|
| `core/group-join-manager.ts` | 150-200 | Notification batching (async/group/smart modes) |
| `core/output-file.ts` | 100-150 | JSONL transcript streaming |
| `core/worktree.ts` | 100-150 | Git worktree create/cleanup |
| `core/settings.ts` | 100-150 | Settings load/save/apply |

### Modified modules

| Module | Change |
|--------|--------|
| `core/agent-manager.ts` | Add `spawn()`, `resume()`, `steer()`, `hasRunning()`, `abortAll()`, `waitForAll()`. Add concurrency queue + drain. Add worktree lifecycle. Add output file wiring. Add cleanup timer. Significant expansion (~400-500 lines). |
| `core/agent-runner.ts` | Add `resumeAgent()`, `steerAgent()`, `getAgentConversation()`. |
| `core/subagent.ts` | Remove stubs for `run_in_background`/`resume`/`isolation`. Wire background path in tool handler: call `spawn()` instead of `spawnAndWait()`, return agent ID. Wire resume path. |
| `shared/types.ts` | Extend `AgentRecord` with background fields. Add `JoinMode`, `NotificationDetails`, `GroupJoinState`. Add `"queued"`, `"stopped"` statuses. |
| `index.ts` | Register `get_subagent_result` and `steer_subagent` tools. Register notification renderer. Wire lifecycle events. Create `GroupJoinManager`. Wire settings. |
| `tui/render.ts` | Add rendering for background result (dimmed "Running in background" with ID). |
| `tui/agents-menu.ts` | Add settings options for `maxConcurrent` and `defaultJoinMode`. Show running/queued counts. |
| `core/config.ts` | Add `maxConcurrent: 4` and `defaultJoinMode: "smart"` to config. |

### Unchanged

Agent discovery, agent format parsing, skill loader, artifacts, paths — all unchanged.

## Testing

### New tests

- **`group-join-manager.test.ts`**: Test async mode (immediate notification). Test group mode (batch until all complete). Test smart mode (debounce timing). Test mixed modes. Test edge cases (single agent in group, all agents error).
- **`output-file.test.ts`**: Test JSONL writing. Test streaming subscription. Test cleanup. Test path encoding.
- **`worktree.test.ts`**: Test worktree creation. Test cleanup with changes. Test cleanup without changes. Test error handling (not a git repo, worktree already exists).
- **`settings.test.ts`**: Test load/save. Test project overrides global. Test malformed files.

### Updated tests

- **`agent-manager.test.ts`**: Test `spawn()` returns ID immediately. Test concurrency queue (spawn at limit queues, drain on complete). Test `resume()` on completed agent. Test `steer()` with session ready and with pending steers. Test `hasRunning()`, `abortAll()`, `waitForAll()`. Test worktree lifecycle. Test cleanup timer. Test `"queued"` and `"stopped"` statuses.
- **`agent-runner.test.ts`**: Test `resumeAgent()`. Test `steerAgent()`. Test `getAgentConversation()`.
- **`subagent.test.ts`**: Test background path (spawn, return ID). Test resume path. Test worktree param. Remove stub tests.
- **`index.test.ts`**: Test `get_subagent_result` and `steer_subagent` tool registration. Test notification renderer registration. Test lifecycle event wiring.
- **`agents-menu.test.ts`**: Test new settings options.

## Future Specs

- **Spec 3: Parallel execution.** Batch spawning, group coordination, group-level wait/abort/steer, parallel progress rendering, aggregate result formatting.
- **Spec 4: UI features.** Agent widget, fleet list, conversation viewer, enhanced live progress.
