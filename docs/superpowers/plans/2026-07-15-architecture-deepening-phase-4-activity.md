# Agent Live Activity Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Pi to 0.80.6 and make each `AgentRecord` the single source of live activity for initial and resumed runs.

**Architecture:** Pi runners translate session events into internal callbacks, including the single `agent_settled` boundary. `AgentManager` owns and mutates one required `live` object on each record, then adapters render that record directly; the parallel TUI activity map and tracker are deleted.

**Tech Stack:** TypeScript, Vitest, Biome, pnpm, `@earendil-works/pi-*` 0.80.6.

**Design reference:** `docs/superpowers/specs/2026-07-16-agent-live-activity-design.md`

---

## Constraints and invariants

- Keep the implementation to the three independently green commits below.
- Do not change commands, notifications, tool wire shapes, persistence, scheduling, turn-limit policy, or TUI wording/timing.
- Keep `toolUses`, `turnCount`, and `lifetimeUsage` at the top level of `AgentRecord`; do not duplicate them in `live` or replace them with session stats.
- Preserve duplicate simultaneous tool names. A tool end removes the first matching name when present and increments `toolUses` even when no start remains.
- Clear active tools on `agent_settled`, not `agent_end`. Repeat that clear idempotently on terminal failure, abort, and stop paths.
- Require `session.isIdle` before resume. Do not add `waitForIdle()` because Pi resolves `prompt()` after settlement.
- Update the record before calling `onActivity(record)`, and swallow observer errors so rendering cannot interrupt an Agent run.
- Preserve display-only behavior such as showing turn one for a newly running Agent while `record.turnCount` still means zero completed turns.
- Do not add retained live fields to the finished-line output.

## Commit sequence

1. `chore: upgrade pi packages to 0.80.6`
2. `refactor: add agent live record`
3. `refactor: migrate tui activity state`

### Task 1: Upgrade the Pi packages in lockstep

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Confirm the starting versions**

```bash
node -e 'for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) console.log(name, JSON.parse(require("node:fs").readFileSync(`node_modules/${name}/package.json`, "utf8")).version)'
```

Expected: all three installed packages report `0.80.3` before the upgrade.

- [ ] **Step 2: Change all three dependency ranges together**

In `package.json`, replace only these ranges:

```json
"@earendil-works/pi-ai": "^0.80.6",
"@earendil-works/pi-coding-agent": "^0.80.6",
"@earendil-works/pi-tui": "^0.80.6"
```

- [ ] **Step 3: Refresh the lockfile and installed dependencies**

```bash
pnpm install --ignore-scripts
```

Expected: installation succeeds and `pnpm-lock.yaml` resolves the three Pi packages to `0.80.6`.

- [ ] **Step 4: Verify the installed versions**

```bash
node -e 'for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) console.log(name, JSON.parse(require("node:fs").readFileSync(`node_modules/${name}/package.json`, "utf8")).version)'
```

Expected: all three lines report `0.80.6`.

- [ ] **Step 5: Run the unchanged suite against Pi 0.80.6**

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm vitest run
pnpm tsc --noEmit
```

Expected: the existing suite passes and typecheck exits zero. The Git configuration override is required because tests create temporary repositories and commits.

- [ ] **Step 6: Review and commit**

```bash
git diff -- package.json pnpm-lock.yaml
git diff --check
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade pi packages to 0.80.6"
```

### Task 2: Make `AgentRecord` own live activity and Pi lifecycle state

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-runner.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `tests/agent-runner.test.ts`
- Modify: `tests/agent-manager.test.ts`
- Modify: `tests/types-smoke.test.ts`
- Modify: `tests/_test-helpers.ts`
- Modify: `tests/core/chain-status.test.ts`
- Modify: `tests/batch-detection.test.ts`
- Modify: `tests/chain-execution.test.ts`
- Modify: `tests/conversation-viewer.test.ts`
- Modify: `tests/fleet-list.test.ts`
- Modify: `tests/agent-widget.test.ts`
- Modify: `tests/group-join-manager.test.ts`
- Modify: `tests/subagent.test.ts`

Keep the old `SpawnOptions` per-field callbacks during this commit so existing TUI adapters remain green. They are removed only in Task 3 after all callers use `onActivity`.

- [ ] **Step 1: Add failing runner lifecycle tests**

In `tests/agent-runner.test.ts`, use the existing mocked `createAgentSession` for `runAgent` and a direct mock session for `resumeAgent`. Capture the subscribed Pi event listener, emit events from `prompt()`, and prove:

```ts
it("reports settlement only for agent_settled", async () => {
  const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
  const onSettled = vi.fn();
  let emit!: (event: never) => void;
  const session = {
    subscribe: vi.fn((handler: (event: never) => void) => {
      emit = handler;
      return () => {};
    }),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn(async () => {
      emit({ type: "agent_end", messages: [] } as never);
      expect(onSettled).not.toHaveBeenCalled();
      emit({ type: "agent_settled" } as never);
    }),
    abort: vi.fn(),
    steer: vi.fn(),
    messages: [],
  };
  vi.mocked(createAgentSession).mockResolvedValue({
    session: session as never,
    extensionsResult: { extensions: [] } as never,
  });

  await runAgent(makeAgentDef(), makeRunOptions({ onSettled }), {});

  expect(onSettled).toHaveBeenCalledTimes(1);
});

it("reports resume text, turns, and settlement", async () => {
  const onTextDelta = vi.fn();
  const onTurnEnd = vi.fn();
  const onSettled = vi.fn();
  let emit!: (event: never) => void;
  const session = {
    subscribe: vi.fn((handler: (event: never) => void) => {
      emit = handler;
      return () => {};
    }),
    prompt: vi.fn(async () => {
      emit({ type: "message_start", message: { role: "assistant" } } as never);
      emit({
        type: "message_update",
        message: { role: "assistant" },
        assistantMessageEvent: { type: "text_delta", delta: "hi" },
      } as never);
      emit({ type: "turn_end" } as never);
      emit({ type: "agent_settled" } as never);
    }),
    steer: vi.fn(),
    abort: vi.fn(),
    messages: [],
  };

  await resumeAgent(session as never, "continue", {
    onTextDelta,
    onTurnEnd,
    onSettled,
  });

  expect(onTextDelta).toHaveBeenLastCalledWith("hi", "hi");
  expect(onTurnEnd).toHaveBeenCalledTimes(1);
  expect(onSettled).toHaveBeenCalledTimes(1);
});
```

Keep any extracted event-session helper local to this test file.

- [ ] **Step 2: Verify the runner tests fail for the missing callbacks**

```bash
pnpm vitest run tests/agent-runner.test.ts
```

Expected: failure because `RunOptions` has no settled callback and resume does not yet publish text, turns, or settlement.

- [ ] **Step 3: Add failing manager ownership tests**

Update the runner mock in `tests/agent-manager.test.ts` to export both functions and make the default session idle:

```ts
vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: { isIdle: true },
    aborted: false,
    steered: false,
  }),
  resumeAgent: vi.fn().mockResolvedValue("resumed"),
}));
```

Add tests for these record transitions:

- a new spawn has `live: { activeTools: [], responseText: "", maxTurns }` before it runs;
- two starts of the same tool produce `['read', 'read']`, one end removes only the first match, and the end increments `toolUses`;
- a missing start does not make an end throw and still increments `toolUses`;
- text deltas, completed turns, and usage update the record before each `onActivity` snapshot;
- `agent_end` alone retains active tools, while the later settled callback clears them once;
- a runner rejection before settlement clears active tools through terminal cleanup;
- an `onActivity` observer that throws does not fail the run;
- external Chain records start with empty live state;
- resume returns `undefined` and does not call the runner when `session.isIdle` is false;
- idle resume clears `activeTools`, `responseText`, `turnCount`, and `maxTurns`, then callbacks repopulate them while lifetime usage/tool-use totals stay cumulative.

Snapshot primitive values in the observer because the manager intentionally passes the same mutable record:

```ts
const snapshots: Array<{
  activeTools: string[];
  responseText: string;
  turnCount: number;
}> = [];

const onActivity = (record: AgentRecord) => {
  snapshots.push({
    activeTools: [...record.live.activeTools],
    responseText: record.live.responseText,
    turnCount: record.turnCount,
  });
};
```

- [ ] **Step 4: Verify the manager tests fail for missing record state**

```bash
pnpm vitest run tests/agent-manager.test.ts
```

Expected: failure because records do not have `live`, resume ignores `isIdle`, and the manager has no record observer.

- [ ] **Step 5: Add the required live state and callback types**

In `src/shared/types.ts`, add:

```ts
export interface AgentLiveState {
  activeTools: string[];
  responseText: string;
  maxTurns?: number;
}

export interface AgentRecord {
  // existing fields stay unchanged
  live: AgentLiveState;
}
```

Extend the internal `RunOptions` with:

```ts
onSettled?: () => void;
```

For this transition commit, add this to `SpawnOptions` without removing its existing callbacks yet:

```ts
onActivity?: (record: AgentRecord) => void;
```

Extend the resume runner's options with the callbacks needed to project the same state as an initial run:

```ts
onTextDelta?: (delta: string, fullText: string) => void;
onTurnEnd?: () => void;
onSettled?: () => void;
```

- [ ] **Step 6: Publish the Pi settled event from both runner paths**

In `src/core/agent-runner.ts`, keep all existing event handling and add this independent branch to both `runAgent` and `resumeAgent` listeners:

```ts
if (event.type === "agent_settled") {
  options.onSettled?.();
}
```

Do not call it for `agent_end`.

In `resumeAgent`, restore the same response accumulator used by `runAgent` and publish text and turns:

```ts
if (event.type === "message_start" && event.message.role === "assistant") {
  responseText = "";
}

if (
  event.type === "message_update" &&
  event.message.role === "assistant" &&
  event.assistantMessageEvent.type === "text_delta"
) {
  const delta = event.assistantMessageEvent.delta;
  responseText += delta;
  options.onTextDelta?.(delta, responseText);
}

if (event.type === "turn_end") {
  options.onTurnEnd?.();
}
```

- [ ] **Step 7: Initialize and mutate live state in `AgentManager`**

Initialize normal records with:

```ts
live: {
  activeTools: [],
  responseText: "",
  maxTurns: options.maxTurns,
},
```

Initialize external Chain records without a run limit:

```ts
live: {
  activeTools: [],
  responseText: "",
},
```

Use one small observer guard:

```ts
function notifyActivity(
  record: AgentRecord,
  observer: SpawnOptions["onActivity"],
): void {
  try {
    observer?.(record);
  } catch {
    // Presentation observers must not affect Agent execution.
  }
}
```

Update the record first in every runner callback, keep invoking the old per-field callbacks for compatibility in this commit, then notify the observer:

```ts
onToolActivity: (activity) => {
  if (activity.type === "start") {
    record.live.activeTools.push(activity.toolName);
  } else {
    const index = record.live.activeTools.indexOf(activity.toolName);
    if (index !== -1) record.live.activeTools.splice(index, 1);
    record.toolUses++;
  }
  options.onToolActivity?.(activity);
  notifyActivity(record, options.onActivity);
},
onTextDelta: (delta, fullText) => {
  record.live.responseText = fullText;
  options.onTextDelta?.(delta, fullText);
  notifyActivity(record, options.onActivity);
},
onTurnEnd: (turnCount) => {
  record.turnCount = turnCount;
  options.onTurnEnd?.(turnCount);
  notifyActivity(record, options.onActivity);
},
onUsage: (usage) => {
  record.lifetimeUsage.inputTokens += usage.input;
  record.lifetimeUsage.outputTokens += usage.output;
  record.lifetimeUsage.cacheWriteTokens += usage.cacheWrite;
  options.onUsage?.(usage);
  notifyActivity(record, options.onActivity);
},
onSettled: () => {
  record.live.activeTools.length = 0;
  notifyActivity(record, options.onActivity);
},
```

In the `startAgent` rejection/terminal closure, repeat the idempotent clear and notification before completion observers render the record:

```ts
record.live.activeTools.length = 0;
notifyActivity(record, options.onActivity);
```

In public abort/stop paths where the spawn observer is no longer in scope, clear `record.live.activeTools` without adding observer storage. Queued records are already empty.

- [ ] **Step 8: Make resume require idle and project into the same record**

Before changing status or resetting run fields:

```ts
if (!session.isIdle) return undefined;
```

Then reset only per-run state:

```ts
record.live.activeTools.length = 0;
record.live.responseText = "";
record.live.maxTurns = undefined;
record.turnCount = 0;
```

Wire `resumeAgent` callbacks to the same mutation rules as spawn: starts append, ends remove the first match and increment cumulative `toolUses`, text replaces `live.responseText`, turns increment/update `turnCount`, assistant usage accumulates into `lifetimeUsage`, and settlement clears active tools. Do not reset lifetime usage or tool uses.

- [ ] **Step 9: Add `live` to every direct record fixture**

In every listed test fixture, add exactly this required field unless that test needs non-empty live data:

```ts
live: {
  activeTools: [],
  responseText: "",
},
```

Update `tests/types-smoke.test.ts` to assert `AgentLiveState` and `SpawnOptions.onActivity` typecheck. Do not remove the old `SpawnOptions` callbacks until Task 3.

- [ ] **Step 10: Run the focused core checks**

```bash
pnpm vitest run tests/agent-runner.test.ts tests/agent-manager.test.ts tests/core/chain-status.test.ts tests/types-smoke.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/types.ts src/core/agent-runner.ts src/core/agent-manager.ts tests/agent-runner.test.ts tests/agent-manager.test.ts tests/types-smoke.test.ts
```

Expected: focused tests pass, every direct record constructor satisfies the required `live` invariant, and touched-file lint exits zero.

- [ ] **Step 11: Run the full suite with the compatibility adapters still present**

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm vitest run
git diff --check
```

Expected: all tests pass. If typecheck exposes another direct `AgentRecord` literal, add the same empty `live` object there rather than making the field optional.

- [ ] **Step 12: Review and commit**

```bash
git diff --stat
git diff -- src/shared/types.ts src/core/agent-runner.ts src/core/agent-manager.ts tests/agent-runner.test.ts tests/agent-manager.test.ts tests/types-smoke.test.ts
git add src/shared/types.ts src/core/agent-runner.ts src/core/agent-manager.ts tests
git commit -m "refactor: add agent live record"
```

### Task 3: Migrate every adapter and delete the activity mirror

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/index.ts`
- Modify: `src/tui/format.ts`
- Modify: `src/tui/agent-widget.ts`
- Modify: `src/tui/fleet-list.ts`
- Modify: `src/tui/conversation-viewer.ts`
- Delete: `src/tui/activity.ts`
- Modify: `tests/subagent.test.ts`
- Modify: `tests/format.test.ts`
- Modify: `tests/agent-widget.test.ts`
- Modify: `tests/fleet-list.test.ts`
- Modify: `tests/conversation-viewer.test.ts`
- Modify: `tests/types-smoke.test.ts`
- Delete: `tests/activity.test.ts`

- [ ] **Step 1: Rewrite adapter tests to consume records only**

Make these test changes before production code:

- `tests/format.test.ts`: replace active-tool `Map` inputs with arrays, including duplicate names.
- `tests/agent-widget.test.ts`: construct `AgentWidget(manager, () => mode)`, put activity in each record's `live`, verify running rows use it, and verify finished rows do not gain a retained turn field.
- `tests/fleet-list.test.ts`: construct `FleetList(manager)` and verify tokens/activity come from the selected record.
- `tests/conversation-viewer.test.ts`: remove the activity constructor argument and put streamed response/tools in `record.live`.
- `tests/subagent.test.ts`: replace the map-storage assertion with a captured `spawn` option test that invokes `onActivity(record)` and expects `widget.update()`; retain the timer test.
- `tests/types-smoke.test.ts`: make the final `SpawnOptions` shape accept `onActivity` and reject/remove the old per-field activity callbacks.

Representative construction after the rewrite:

```ts
const record = makeRecord({
  status: "running",
  live: {
    activeTools: ["read", "read"],
    responseText: "Inspecting files",
    maxTurns: 4,
  },
});

const widget = new AgentWidget(manager, () => "all");
const fleet = new FleetList(manager);
const viewer = new ConversationViewer(tui, session, record, theme, done);
```

- [ ] **Step 2: Verify the adapter tests fail against map-based constructors**

```bash
pnpm vitest run tests/subagent.test.ts tests/format.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts tests/conversation-viewer.test.ts tests/types-smoke.test.ts
```

Expected: constructor/signature and behavior failures because production adapters still require `AgentActivity` and the runtime map.

- [ ] **Step 3: Change formatting to accept the record's tool array**

In `src/tui/format.ts`, change only the input type and grouping implementation:

```ts
export function describeActivity(
  activeTools: readonly string[],
  responseText?: string,
): string {
  const groups = new Map<string, number>();
  for (const toolName of activeTools) {
    const action = TOOL_DISPLAY[toolName] ?? toolName;
    groups.set(action, (groups.get(action) ?? 0) + 1);
  }

  if (groups.size > 0) {
    const parts: string[] = [];
    for (const [action, count] of groups) {
      parts.push(
        count > 1
          ? `${action} ${count} ${action === "searching" ? "patterns" : "files"}`
          : action,
      );
    }
    return `${parts.join(", ")}…`;
  }

  if (responseText && responseText.trim().length > 0) {
    return truncateLine(responseText);
  }

  return "thinking…";
}
```

Do not move display formatting into `AgentManager`.

- [ ] **Step 4: Migrate foreground and background spawn adapters**

In `src/core/subagent.ts`, remove `createActivityTracker` and pass one record observer:

```ts
onActivity: () => {
  deps.widget?.update();
},
```

Keep the existing background timers for elapsed-time refreshes. For foreground execution, derive the working message from `record.live`:

```ts
onActivity: (record) => {
  ctx.ui?.setWorkingMessage?.(
    `${agentDef.name}: ${describeActivity(
      record.live.activeTools,
      record.live.responseText,
    )}`,
  );
},
```

Preserve `onSessionCreated` because output-file streaming still needs the session. Do not recreate counters or usage in adapter-local state.

- [ ] **Step 5: Make TUI components read records directly**

Change constructors to their final shapes:

```ts
new AgentWidget(manager, () => mode)
new FleetList(manager)
new ConversationViewer(tui, session, record, theme, done, onStop, keybindings, onSteer)
```

`AgentWidget` reads:

```ts
const tokens =
  record.lifetimeUsage.inputTokens +
  record.lifetimeUsage.outputTokens +
  record.lifetimeUsage.cacheWriteTokens;
const toolUses = record.toolUses;
const turns = formatTurns(Math.max(1, record.turnCount), record.live.maxTurns);
const activity = describeActivity(
  record.live.activeTools,
  record.live.responseText,
);
```

Use the inline calculation; do not preserve `getLifetimeTotal` solely to keep the deleted module alive. Remove the `activity` parameter from `renderFinishedLine` and do not add a turn field there, preserving its current effective finished output.

`FleetList` reads usage from each record and passes the selected record directly to `ConversationViewer`. `ConversationViewer` reads `record.live`, `record.toolUses`, and `record.lifetimeUsage` on every render so resumed activity is visible without replacing the viewer.

- [ ] **Step 6: Remove runtime map wiring**

In `src/shared/runtime-deps.ts`, remove the `AgentActivity` import and `agentActivity` field.

In `src/index.ts`:

- remove the `AgentActivity` import;
- remove map construction, completion deletion, shutdown clearing, and the `RuntimeDeps` assignment;
- update `AgentWidget` and `FleetList` construction to their new signatures.

There must be no replacement cache.

- [ ] **Step 7: Finalize the public spawn option shape**

In `src/shared/types.ts`, remove these presentation callbacks from `SpawnOptions`:

```ts
onToolActivity
onTextDelta
onTurnEnd
onUsage
```

Keep:

```ts
onActivity?: (record: AgentRecord) => void;
onSessionCreated?: (session: unknown) => void;
```

Keep the per-event callbacks on internal `RunOptions`. In `src/core/agent-manager.ts`, remove compatibility calls to the deleted `SpawnOptions` callbacks; record mutation and `notifyActivity` remain unchanged.

- [ ] **Step 8: Delete the obsolete mirror and its tests**

```bash
git rm src/tui/activity.ts tests/activity.test.ts
```

All meaningful behavior formerly tested there must now be covered by manager tests (mutation/duplicate tools) or formatter tests (display grouping).

- [ ] **Step 9: Prove no mirror references remain**

Use the FFF `multi_grep` tool with these literal patterns and the `*.ts` constraint:

```text
AgentActivity
createActivityTracker
agentActivity
getLifetimeTotal
```

Expected: no matches under `src/` or `tests/`.

- [ ] **Step 10: Run focused adapter and runtime checks**

```bash
pnpm vitest run tests/subagent.test.ts tests/format.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts tests/conversation-viewer.test.ts tests/index.test.ts tests/types-smoke.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/types.ts src/shared/runtime-deps.ts src/core/agent-manager.ts src/core/subagent.ts src/index.ts src/tui/format.ts src/tui/agent-widget.ts src/tui/fleet-list.ts src/tui/conversation-viewer.ts tests/subagent.test.ts tests/format.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts tests/conversation-viewer.test.ts tests/types-smoke.test.ts
```

Expected: focused tests, typecheck, and touched-file lint pass.

- [ ] **Step 11: Run final regression verification**

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm vitest run
git diff --check
git status --short
```

Expected: the full suite passes, no whitespace errors exist, only the planned migration files are modified, and both obsolete files are deleted.

- [ ] **Step 12: Review and commit**

```bash
git diff --stat
git diff -- src/shared/types.ts src/shared/runtime-deps.ts src/core/agent-manager.ts src/core/subagent.ts src/index.ts src/tui/format.ts src/tui/agent-widget.ts src/tui/fleet-list.ts src/tui/conversation-viewer.ts
git add src tests
git commit -m "refactor: migrate tui activity state"
```

## Final acceptance check

- [ ] All three Pi packages are declared and resolved at 0.80.6.
- [ ] Both runner paths use `agent_settled`; neither treats `agent_end` as terminal.
- [ ] Resume checks `session.isIdle` and does not add `waitForIdle()`.
- [ ] Every `AgentRecord` has required `live` state, including queued and external Chain records.
- [ ] Initial and resumed runs mutate the same record-owned activity fields.
- [ ] Observer exceptions cannot fail Agent execution.
- [ ] No `AgentActivity`, tracker, shared map, or fallback counter remains.
- [ ] Foreground, widget, fleet, and viewer output is rendered from records and retains current wording/timing.
- [ ] Focused tests, typecheck, touched-file lint, and the full suite pass after the final commit.
