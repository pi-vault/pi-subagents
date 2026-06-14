# Phase 1: Unify Execution State into `ExecutionStateStore`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `deferred-slash-state.ts` and `slash-live-state.ts` into a single `ExecutionStateStore` class, eliminating global mutable module state and enabling isolated testing.

**Architecture:** A single class encapsulates both the live execution snapshots (version-tracked Map) and the deferred slash request state (persisted + runtime Maps). The class is instantiated once in `index.ts` and threaded to consumers via a new `stateStore` field on `RuntimeDeps`. The `SlashSnapshot` type and pruning logic become private implementation details. External callers interact through typed methods instead of importing free functions from two separate modules.

**Tech Stack:** TypeScript, vitest. No new dependencies.

---

## File Map

| File                                | Action | Responsibility                                                     |
| ----------------------------------- | ------ | ------------------------------------------------------------------ |
| `src/core/execution-state.ts`       | Create | `ExecutionStateStore` class with all live + deferred state methods  |
| `src/shared/types.ts`               | Modify | Export `SlashSnapshot` type, add `stateStore` to `RuntimeDeps`     |
| `src/index.ts`                      | Modify | Instantiate store, pass to deps and registration functions         |
| `src/core/subagent.ts`              | Modify | Replace free-function imports with store method calls              |
| `src/tui/render.ts`                 | Modify | Accept store reference instead of importing from slash-live-state  |
| `src/core/deferred-slash-state.ts`  | Delete | Absorbed into ExecutionStateStore                                  |
| `src/core/slash-live-state.ts`      | Delete | Absorbed into ExecutionStateStore                                  |
| `tests/render.test.ts`              | Modify | Create fresh store per test instead of relying on module state     |
| `tests/subagent.test.ts`            | Modify | Create fresh store per test for deferred state assertions          |
| `tests/index.test.ts`               | Modify | Update hydration test to use store                                 |
| `tests/execution-state.test.ts`     | Create | Isolated tests for store lifecycle, pruning, hydration             |

---

### Task 1: Create `src/core/execution-state.ts`

**Files:**

- Create: `src/core/execution-state.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Export `SlashSnapshot` from types**

In `src/shared/types.ts`, add after the `SlashLiveDetails` interface (after line 182):

```typescript
export type SlashSnapshot = {
  live: SlashLiveDetails;
  final?: SubagentExecutionResult;
  version: number;
};
```

- [ ] **Step 2: Create the `ExecutionStateStore` class**

Create `src/core/execution-state.ts` with the full class implementation. The class absorbs:

From `slash-live-state.ts`:
- Private `liveRequests: Map<string, SlashSnapshot>`
- Private `versionCounter: number`
- Private `MAX_SNAPSHOTS = 100`
- Methods: `startLive`, `updateLive`, `tickLive`, `finalizeLive`, `isLiveRunning`, `clearLive`, `getSnapshot`, `getRenderableMessage`

From `deferred-slash-state.ts`:
- Private `persistedRequests: Map<string, PersistedDeferredSlashRequest>`
- Private `runtimeState: Map<string, DeferredSlashRuntimeState>`
- Methods: `rememberDeferred`, `markDeferredConsumed`, `setDeferredRuntimeState`, `takeDeferredRuntimeState`, `getDeferredRequest`, `hydrateFromSession`

The class constructor initializes all maps and the version counter. Private `nextVersion()` and `pruneSnapshots()` helpers remain internal.

```typescript
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  DeferredSlashRuntimeState,
  PersistedDeferredSlashRequest,
  SlashLiveDetails,
  SlashSnapshot,
  SubagentExecutionDetails,
  SubagentExecutionResult,
  SubagentToolActivity,
} from "../shared/types.js";
import {
  DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY,
  DEFERRED_SLASH_REQUEST_ENTRY,
} from "../shared/types.js";

const MAX_SNAPSHOTS = 100;

export class ExecutionStateStore {
  private liveRequests = new Map<string, SlashSnapshot>();
  private versionCounter = 1;
  private persistedRequests = new Map<string, PersistedDeferredSlashRequest>();
  private runtimeState = new Map<string, DeferredSlashRuntimeState>();

  // ... methods follow the same logic as the free functions
}
```

- [ ] **Step 3: Implement all live-state methods**

Port the logic from `slash-live-state.ts` into class methods. Each method uses `this.liveRequests` and `this.versionCounter` instead of module-level variables. Method signatures match the design spec.

- [ ] **Step 4: Implement all deferred-state methods**

Port the logic from `deferred-slash-state.ts` into class methods. Each method uses `this.persistedRequests` and `this.runtimeState` instead of module-level variables.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — new file compiles, old files still reference old modules (not yet wired).

---

### Task 2: Add `stateStore` to `RuntimeDeps` and rewire consumers

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/index.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Add `stateStore` to RuntimeDeps**

In `src/shared/types.ts`, add import of `ExecutionStateStore` and add to `RuntimeDeps` interface:

```typescript
import type { ExecutionStateStore } from "../core/execution-state.js";

export interface RuntimeDeps {
  // ... existing fields ...
  stateStore: ExecutionStateStore;
}
```

Note: This creates a circular-ish import path. If this causes issues, the store type can be referenced via a separate interface in types.ts instead. Evaluate during implementation.

- [ ] **Step 2: Instantiate store in `index.ts`**

In `src/index.ts`:

1. Add import: `import { ExecutionStateStore } from "./core/execution-state.js";`
2. Remove import: `import { hydrateDeferredSlashRequestsFromSession } from "./core/deferred-slash-state.js";`
3. In `createRuntimeDeps`, instantiate: `const stateStore = new ExecutionStateStore();`
4. Add `stateStore` to the returned object
5. Update `registerSubagentsExtension` to pass store to registration functions
6. Change session_start handler: `deps.stateStore.hydrateFromSession(ctx.sessionManager);`

- [ ] **Step 3: Rewire `subagent.ts` imports**

In `src/core/subagent.ts`:

1. Remove the import block for `./slash-live-state.js` (lines 20-24)
2. Remove the import block for `./deferred-slash-state.js` (lines 25-31)
3. Add the store as a parameter to functions that need it, OR access it through `deps.stateStore`

The functions that use state:
- `registerSlashAgentBridge` uses: `getDeferredSlashRequest`, `takeDeferredSlashRuntimeState`, `markDeferredSlashRequestConsumed`, `finalizeSlashLiveRequest`, `updateSlashLiveRequest`
- `registerAgentCommand` uses: `startSlashLiveRequest`, `rememberDeferredSlashRequest`, `setDeferredSlashRuntimeState`
- `executeSubagent` itself does NOT use state directly (state calls happen in the bridge/command)

Replace all free-function calls with `deps.stateStore.methodName(...)` equivalents.

- [ ] **Step 4: Rewire `render.ts` imports**

In `src/tui/render.ts`:

1. Remove import from `../core/slash-live-state.js` (lines 3-6)
2. The render functions need access to snapshot state. Two options:
   - Pass the store as parameter to `renderSubagentMessage` and `buildSubagentResultText`
   - Or: have `createSlashLiveMessageComponent` accept a store reference

Recommended: Add a `store` parameter to `renderSubagentMessage` since it's called from `index.ts` which has access to the store. Thread it through to `createSlashLiveMessageComponent` and `buildSubagentResultText`.

Update the `pi.registerMessageRenderer` call in `index.ts` to close over the store.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — all consumers now use the store. Old modules may still exist but are no longer imported.

---

### Task 3: Delete old modules, migrate tests, expand coverage

**Files:**

- Delete: `src/core/deferred-slash-state.ts`
- Delete: `src/core/slash-live-state.ts`
- Modify: `tests/render.test.ts`
- Modify: `tests/subagent.test.ts`
- Modify: `tests/index.test.ts`
- Create: `tests/execution-state.test.ts`

- [ ] **Step 1: Delete old state modules**

```bash
rm src/core/deferred-slash-state.ts src/core/slash-live-state.ts
```

- [ ] **Step 2: Update `tests/render.test.ts`**

1. Remove import from `../src/core/slash-live-state.js`
2. Create a fresh `ExecutionStateStore` instance in `beforeEach` or per-test
3. Replace calls to `startSlashLiveRequest(...)` with `store.startLive(...)`
4. Replace calls to `updateSlashLiveRequest(...)` with `store.updateLive(...)`
5. Replace calls to `finalizeSlashLiveRequest(...)` with `store.finalizeLive(...)`
6. Pass the store to render functions as needed

- [ ] **Step 3: Update `tests/subagent.test.ts`**

1. Remove imports from `../src/core/deferred-slash-state.js` and `../src/core/slash-live-state.js`
2. Create a fresh `ExecutionStateStore` in test setup
3. Replace `hydrateDeferredSlashRequestsFromSession(...)` with `store.hydrateFromSession(...)`
4. Replace `getDeferredSlashRequest(...)` with `store.getDeferredRequest(...)`
5. Replace `setDeferredSlashRuntimeState(...)` with `store.setDeferredRuntimeState(...)`
6. Replace `takeDeferredSlashRuntimeState(...)` with `store.takeDeferredRuntimeState(...)`
7. Replace `startSlashLiveRequest(...)` with `store.startLive(...)`
8. Pass the store through deps where needed

- [ ] **Step 4: Update `tests/index.test.ts`**

1. Remove spy on `deferredState.hydrateDeferredSlashRequestsFromSession`
2. Instead, verify that the store's `hydrateFromSession` is called (via spy on the store instance)

- [ ] **Step 5: Create `tests/execution-state.test.ts`**

Write isolated tests for `ExecutionStateStore`:

```typescript
import { ExecutionStateStore } from "../src/core/execution-state.js";

describe("ExecutionStateStore", () => {
  describe("live execution", () => {
    test("startLive creates a running snapshot");
    test("updateLive patches duration and activity");
    test("tickLive advances duration from startedAt");
    test("tickLive returns undefined for finalized requests");
    test("finalizeLive attaches result to snapshot");
    test("isLiveRunning returns false after finalize");
    test("clearLive removes snapshot entirely");
    test("getSnapshot returns undefined for unknown requestId");
    test("pruning removes oldest snapshots beyond MAX_SNAPSHOTS");
    test("getRenderableMessage returns live details when running");
    test("getRenderableMessage returns final result after finalize");
    test("getRenderableMessage returns passthrough for unknown requestId");
  });

  describe("deferred requests", () => {
    test("rememberDeferred stores request and appends entry");
    test("markDeferredConsumed removes request and runtime state");
    test("setDeferredRuntimeState stores state by requestId");
    test("takeDeferredRuntimeState returns and clears state");
    test("takeDeferredRuntimeState returns undefined on second call");
    test("getDeferredRequest returns stored request");
    test("hydrateFromSession replays persisted entries");
    test("hydrateFromSession respects consumed entries");
    test("hydrateFromSession clears previous state");
  });

  describe("isolation", () => {
    test("separate instances do not share state");
  });
});
```

- [ ] **Step 6: Run full check suite**

Run: `pnpm check`
Expected: lint, typecheck, and all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: unify execution state into ExecutionStateStore class

Merge deferred-slash-state.ts and slash-live-state.ts into a single
ExecutionStateStore class in execution-state.ts. The class is instantiated
once and injected via RuntimeDeps, eliminating global module-level Maps.

Tests now create fresh store instances, preventing cross-test pollution.
New tests cover pruning, hydration round-trips, and concurrent requests."
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full check suite**

Run: `pnpm check`
Expected: All PASS.

- [ ] **Step 2: Verify no remaining references to old modules**

Run: `grep -r "deferred-slash-state\|slash-live-state" src/ tests/`
Expected: No matches.

- [ ] **Step 3: Verify public interface unchanged**

Check that `index.ts` still exports `createRuntimeDeps`, `registerSubagentsExtension`, and `default` — no new exports leaked.
