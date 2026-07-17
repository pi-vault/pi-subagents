# Agent Live Activity Consolidation Design

## Goal

Make each `AgentRecord` the single source of live Agent activity for initial runs and resumed runs, while preserving existing commands, notifications, TUI wording, and timing behavior.

## Current Problem

`AgentManager` already owns lifecycle status, tool-use counts, turn counts, and token usage. The TUI separately owns `AgentActivity` objects in a shared map for active tools, response text, maximum turns, and duplicate copies of the same counters and usage.

This split creates three problems:

- foreground and background runs expose different activity detail;
- adapters contain fallbacks between the map and `AgentRecord`;
- resumed Agents bypass the activity map and can display stale or incomplete live state.

## Scope

This phase consolidates live state for normal spawns, queued Agents when they start, resumed Agents, and externally registered Chain records. It removes the TUI activity map and tracker.

This phase does not change command names, tool wire shapes, notification payloads, persistence formats, Agent scheduling, turn-limit policy, or TUI copy.

## State Model

Add only the activity fields that do not already exist on `AgentRecord`:

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

`toolUses`, `turnCount`, and `lifetimeUsage` remain on `AgentRecord`. They are not copied into `live`.

`activeTools` is an array because duplicate simultaneous tools must remain distinct. A tool start appends its name. A tool end removes the first matching name if present and increments `toolUses` even when no matching start remains.

## Ownership and Data Flow

`AgentManager` initializes and mutates all record activity:

1. Spawn creates `live` before the record is queued or started.
2. Runner callbacks update the record before notifying an optional `onActivity(record)` observer.
3. Terminal success, error, abort, and stop paths clear `live.activeTools`.
4. Resume clears per-run fields (`activeTools`, `responseText`, `turnCount`, and `maxTurns`) before prompting the existing session.
5. Resume callbacks repopulate active tools, response text, turns, and cumulative usage. Lifetime tool-use and token counters are not reset.
6. External Chain records receive an empty `live` state so every `AgentRecord` satisfies the same invariant.

`RunOptions` keeps its event callbacks as the internal runner-to-manager interface. `SpawnOptions` replaces its per-field activity callbacks with `onActivity?: (record: AgentRecord) => void`; `onSessionCreated` remains for output-file streaming.

The resume runner gains text-delta and turn-end callbacks so `AgentManager.resume()` can maintain the same record invariant as initial execution.

## Adapter Migration

- Foreground execution uses `onActivity(record)` to update the working message from `record.live`.
- Background execution uses `onActivity` to request an immediate widget refresh; existing timers continue to provide elapsed-time updates.
- `AgentWidget` receives the manager and mode only. It reads live activity plus existing counters and usage from each record.
- `FleetList` receives the manager only and passes the selected record directly to `ConversationViewer`.
- `ConversationViewer` removes its `AgentActivity` argument and reads the record on every render.
- `describeActivity` accepts `readonly string[]`, retaining grouping and duplicate-tool wording.
- `RuntimeDeps`, `src/index.ts`, and shutdown cleanup remove all `agentActivity` fields and map handling.
- `src/tui/activity.ts` and its dedicated test file are deleted.

Presentation remains responsible for display-only transforms. In particular, a newly running Agent may display turn one even while `record.turnCount` still represents zero completed turns. Finished-line content must not gain fields solely because the record now retains them.

## Error Handling

Activity reporting must never determine Agent success or failure. The render observer is isolated from lifecycle errors, missing tool starts do not throw, and terminal cleanup is idempotent. Runner and worktree errors keep their existing lifecycle behavior while clearing active tools before completion observers render the record.

Queued Agents start with empty activity. Stopping a queued Agent leaves that state empty.

## Testing

Manager tests cover:

- initial live-state values and maximum turns;
- overlapping same-name tools and first-match removal;
- streamed response text, turns, tool uses, and cumulative usage;
- terminal cleanup on success and error;
- reset and repopulation during resume;
- empty live state on external Chain records.

Adapter tests construct records only and prove foreground working messages, widget rows, fleet rows, and viewer activity read the record without a map. Format tests retain the current activity wording using arrays.

All direct `AgentRecord` fixtures receive the required `live` field. Typecheck is the backstop for missed constructors. The focused tests run first, followed by typecheck, touched-file lint, and the full suite. In environments with signed Git commits configured, the full suite disables `commit.gpgsign` for its temporary repositories.

## Implementation Shape

Keep the existing two-commit phase boundary:

1. `refactor: add agent live record` — add the required state, manager ownership, resume callbacks, core tests, and the mechanical `live` field in every direct record fixture. Keep the old activity callbacks working during this commit so the existing adapters remain green.
2. `refactor: migrate tui activity state` — migrate adapters and runtime wiring, remove the old callbacks, update adapter expectations, and delete the mirror.

The existing phase-4 implementation plan must be rewritten before implementation because its file list omits current runtime wiring, formatter changes, resume support, deleted tests, and required record fixtures.

## Success Criteria

- No `AgentActivity`, `createActivityTracker`, or `agentActivity` map remains.
- Every `AgentRecord` has required `live` state.
- Initial and resumed runs update the same record-owned fields.
- All TUI adapters render from `AgentRecord` without compatibility fallbacks.
- Existing output wording and timing behavior remain covered by tests.
- Focused checks, typecheck, touched-file lint, and the full test suite pass.
