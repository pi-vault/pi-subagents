# Phase 1: Unify Execution State into `ExecutionStateStore`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `deferred-slash-state.ts` and `slash-live-state.ts` into a single `ExecutionStateStore` class, eliminating global mutable module state and enabling isolated testing.

**Architecture:** A single class encapsulates both the live execution snapshots (version-tracked Map) and the deferred slash request state (persisted + runtime Maps). The class is instantiated once in `index.ts` and threaded to consumers via a new `stateStore` field on `RuntimeDeps` (extracted to `src/shared/runtime-deps.ts` to avoid circular imports). The `SlashSnapshot` type is exported from `types.ts` for test/consumer use; pruning logic remains a private implementation detail. External callers interact through typed methods instead of importing free functions from two separate modules.

**Tech Stack:** TypeScript, vitest. No new dependencies.

---

## File Map

| File                               | Action | Responsibility                                                     |
| ---------------------------------- | ------ | ------------------------------------------------------------------ |
| `src/core/execution-state.ts`      | Create | `ExecutionStateStore` class with all live + deferred state methods |
| `src/shared/types.ts`              | Modify | Export `SlashSnapshot` type (after `SubagentExecutionResult`)      |
| `src/shared/runtime-deps.ts`       | Create | Export `RuntimeDeps` interface (imports from types + store)        |
| `src/index.ts`                     | Modify | Instantiate store, pass to deps and registration functions         |
| `src/core/subagent.ts`             | Modify | Replace free-function imports with store method calls              |
| `src/tui/render.ts`                | Modify | Accept store reference instead of importing from slash-live-state  |
| `src/core/deferred-slash-state.ts` | Delete | Absorbed into ExecutionStateStore                                  |
| `src/core/slash-live-state.ts`     | Delete | Absorbed into ExecutionStateStore                                  |
| `tests/render.test.ts`             | Modify | Create fresh store per test instead of relying on module state     |
| `tests/subagent.test.ts`           | Modify | Create fresh store per test for deferred state assertions          |
| `tests/index.test.ts`              | Modify | Update hydration test to use store                                 |
| `tests/execution-state.test.ts`    | Create | Isolated tests for store lifecycle, pruning, hydration             |

---

### Task 1: Create `src/core/execution-state.ts`

**Files:**

- Create: `src/core/execution-state.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Export `SlashSnapshot` from types**

In `src/shared/types.ts`, add after the `SubagentExecutionResult` interface (after line 192). `SlashSnapshot` depends on both `SlashLiveDetails` and `SubagentExecutionResult`, so it must follow both:

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

- Create: `src/shared/runtime-deps.ts`
- Modify: `src/shared/types.ts` (remove `RuntimeDeps` from here)
- Modify: `src/index.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Extract `RuntimeDeps` to `src/shared/runtime-deps.ts`**

To avoid a circular import (`types.ts` → `execution-state.ts` → `types.ts`), move the `RuntimeDeps` interface to a new file that can safely import from both:

Create `src/shared/runtime-deps.ts`:

```typescript
import type { ExecutionStateStore } from "../core/execution-state.js";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
  SubagentsConfig,
} from "./types.js";

export interface RuntimeDeps {
  resolvePaths: () => ResolvedPaths;
  loadConfig: (paths: ResolvedPaths) => LoadedConfig;
  discoverAgents: (paths: ResolvedPaths) => AgentDiscoveryResult;
  discoverToolNames: () => string[];
  createAgentFile: (
    paths: ResolvedPaths,
    input: AgentCreationInput,
    discovery: AgentDiscoveryResult,
    toolNames: string[],
  ) => AgentDefinition;
  exportAgentToUserScope: (
    paths: ResolvedPaths,
    discovery: AgentDiscoveryResult,
    agentName: string,
  ) => AgentDefinition;
  disableAgentInUserScope: (
    paths: ResolvedPaths,
    discovery: AgentDiscoveryResult,
    agentName: string,
  ) => AgentDefinition;
  deleteUserAgentOverride: (paths: ResolvedPaths, agentName: string) => void;
  saveConfig: (paths: ResolvedPaths, config: SubagentsConfig) => void;
  stateStore: ExecutionStateStore;
}
```

Then remove `RuntimeDeps` from `src/shared/types.ts` and update all imports of `RuntimeDeps` across the codebase to import from `../shared/runtime-deps.js` (or `./runtime-deps.js` for files already in `shared/`).

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
3. Update the `RuntimeDeps` import to point to `../shared/runtime-deps.js`
4. Access state through `deps.stateStore`

The functions that use state:

- `registerSlashAgentBridge` uses: `getDeferredSlashRequest`, `takeDeferredSlashRuntimeState`, `markDeferredSlashRequestConsumed`, `finalizeSlashLiveRequest`, `updateSlashLiveRequest`
- `registerAgentCommand` uses: `startSlashLiveRequest`, `rememberDeferredSlashRequest`, `setDeferredSlashRuntimeState`
- `executeSubagent` itself does NOT use state directly (state calls happen in the bridge/command)

Replace all free-function calls with `deps.stateStore.methodName(...)` equivalents.

Additionally, rename the underscore-prefixed parameters in `registerAgentCommand`:

- `_deps: RuntimeDeps` → `deps: RuntimeDeps` (now used for `deps.stateStore`)
- `_runtime: SubagentRuntimeDeps` → `runtime: SubagentRuntimeDeps` (clean up for future phases)

- [ ] **Step 4: Rewire `render.ts` imports**

In `src/tui/render.ts`:

1. Remove import from `../core/slash-live-state.js` (lines 3-6)
2. Add import of `ExecutionStateStore` from `../core/execution-state.js`

**Design decision:** `buildSubagentResultText` stays pure (no store parameter). Snapshot resolution moves to its callers. This keeps the text-building function easy to test without needing a store instance.

Changes to each function that currently calls `getSlashSnapshot`/`isSlashLiveRunning`/`getSlashRenderableMessage`:

- **`buildSubagentResultText`** (line 153): Remove the `getSlashSnapshot` call. When `details` is `SlashLiveDetails`, just render what was passed in — callers are responsible for resolving the latest snapshot before calling.

- **`createSlashLiveMessageComponent`**: Add a `store: ExecutionStateStore` parameter. Its `render()` closure calls `store.getSnapshot(...)`, `store.isLiveRunning(...)`, and `store.getRenderableMessage(...)` instead of the free functions.

- **`renderSubagentMessage`**: Add a `store: ExecutionStateStore` parameter. Passes it to `createSlashLiveMessageComponent`. For the non-live path it just calls `buildSubagentResultText` as before (no store needed there).

- **`renderSubagentResult`**: Add a `store: ExecutionStateStore` parameter. Before calling `buildSubagentResultText`, resolve the snapshot from the store when details is slash-live, then pass the resolved details.

**Wiring in `index.ts`:**

Update the message renderer registration to close over the store:

```typescript
pi.registerMessageRenderer("pi-subagent-result", (msg, opts, theme) =>
  renderSubagentMessage(msg, opts, theme, deps.stateStore),
);
```

**Wiring in `registerSubagentTool` (subagent.ts):**

Update the tool registration to close over the store for the result renderer:

```typescript
renderResult: (result, options, theme) =>
  renderSubagentResult(result, options, theme, deps.stateStore),
```

Note: `renderSubagentCall` does NOT need the store (it just formats tool input args).

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
2. Import `ExecutionStateStore` from `../src/core/execution-state.js`
3. Create a fresh `ExecutionStateStore` instance in `beforeEach` or per-test
4. Replace calls to `startSlashLiveRequest(...)` with `store.startLive(...)`
5. Replace calls to `updateSlashLiveRequest(...)` with `store.updateLive(...)`
6. Replace calls to `finalizeSlashLiveRequest(...)` with `store.finalizeLive(...)`
7. Replace calls to `clearSlashLiveRequest(...)` with `store.clearLive(...)`
8. Replace calls to `tickSlashLiveRequest(...)` with `store.tickLive(...)`
9. Pass the store to `renderSubagentMessage` and `renderSubagentResult` as the last argument
10. Tests for `buildSubagentResultText` remain unchanged (it no longer needs a store — just pass resolved details directly)

- [ ] **Step 3: Update `tests/subagent.test.ts`**

1. Remove imports from `../src/core/deferred-slash-state.js` and `../src/core/slash-live-state.js`
2. Import `ExecutionStateStore` from `../src/core/execution-state.js`
3. Update `RuntimeDeps` import to `../src/shared/runtime-deps.js`
4. Create a fresh `ExecutionStateStore` in test setup
5. Add `stateStore: store` to all `RuntimeDeps` mock objects (e.g., in `createDeps()` or equivalent helpers)
6. Replace `hydrateDeferredSlashRequestsFromSession(...)` with `store.hydrateFromSession(...)`
7. Replace `getDeferredSlashRequest(...)` with `store.getDeferredRequest(...)`
8. Replace `setDeferredSlashRuntimeState(...)` with `store.setDeferredRuntimeState(...)`
9. Replace `takeDeferredSlashRuntimeState(...)` with `store.takeDeferredRuntimeState(...)`
10. Replace `startSlashLiveRequest(...)` with `store.startLive(...)`
11. Pass the store through deps where needed

- [ ] **Step 4: Update `tests/index.test.ts`**

1. Remove `import * as deferredState from "../src/core/deferred-slash-state.js"`
2. Import `ExecutionStateStore` from `../src/core/execution-state.js`
3. Update `RuntimeDeps` import to `../src/shared/runtime-deps.js`
4. Add `stateStore: new ExecutionStateStore()` to the `createMenuDeps()` helper (use a real instance — it's lightweight, just in-memory Maps)
5. For the hydration test: instead of spying on the free function, verify observable state — after `session_start` fires, assert that `deps.stateStore.getDeferredRequest(...)` returns expected values based on the session entries provided

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

- [ ] **Step 3: Verify RuntimeDeps is no longer exported from types.ts**

Run: `grep "RuntimeDeps" src/shared/types.ts`
Expected: No matches (it now lives in `src/shared/runtime-deps.ts`).

- [ ] **Step 4: Verify public interface unchanged**

Check that `index.ts` still exports `createRuntimeDeps`, `registerSubagentsExtension`, and `default` — no new exports leaked.
