# Agent Lifecycle Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AgentManager` own custom-tool invocation and exact-once Agent lifecycle settlement without hidden dependency bags or orphaned background slots.

**Architecture:** Callers supply one narrow custom-tool factory; `AgentManager` invokes it only after selecting the Agent ID, effective cwd, and recursion permission. A private finalizer owns terminal record mutation, cleanup, notification, and background-slot release. It uses `Set`s for finalized runs and occupied background slots instead of a new state-machine module.

**Tech Stack:** TypeScript, Vitest, Biome, Pi coding-agent.

---

## File map

| File                                         | Responsibility after this phase                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                        | Defines the narrow `SpawnOptions.createCustomTools` contract; removes `_deps`.         |
| `src/core/child-subagent-tool.ts`            | Builds the reusable child/result/intercom tool factory, including nested recursion.    |
| `src/core/agent-manager.ts`                  | Selects cwd, invokes the factory, starts Agents, and finalizes all terminal runs once. |
| `src/core/subagent.ts` and `src/core/rpc.ts` | Pass the reusable factory at every top-level, Chain, command, and RPC spawn boundary.  |
| `tests/*.test.ts`                            | Prove tool propagation and terminal lifecycle contracts from each relevant adapter.    |

## Commit sequence

1. `refactor: replace spawn dependency bag`
2. `refactor: centralize agent lifecycle transitions`

### Task 1: Replace the spawn dependency bag

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/child-subagent-tool.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/rpc.ts`
- Modify: `tests/agent-manager.test.ts`
- Modify: `tests/child-subagent-tool.test.ts`
- Modify: `tests/subagent.test.ts`
- Modify: `tests/subagent-chain.test.ts`
- Modify: `tests/rpc.test.ts`

- [ ] **Step 1: Write failing factory and adapter tests**

Add tests that capture the `RunOptions.customTools` argument passed to `runAgent` and assert these facts:

```ts
expect(factory).toHaveBeenCalledWith({
  id: expect.any(String),
  cwd: expectedEffectiveCwd,
  allowRecursion: true,
});
expect(runAgent).toHaveBeenCalledWith(
  agentDef,
  expect.objectContaining({ customTools: factoryResult }),
  expect.anything(),
);
```

Cover a worktree cwd, recursion disabled at its depth limit, intercom-only Agents, and no-factory spawns. Assert that the following paths pass `createCustomTools`: foreground and background `subagent`, `/agent`, Chain step spawning, RPC spawning, and a child Agent spawning its own child. For the nested case, assert the selected child receives both `subagent` and `get_subagent_result` tools with the child Agent ID as their parent scope.

- [ ] **Step 2: Verify the tests fail against `_deps`**

Run:

```bash
pnpm vitest run tests/agent-manager.test.ts tests/child-subagent-tool.test.ts tests/subagent.test.ts tests/subagent-chain.test.ts tests/rpc.test.ts
```

Expected: factory assertions fail because `SpawnOptions` still accepts `_deps`, and adapter paths do not provide a common factory.

- [ ] **Step 3: Define the factory contract**

Replace `_deps?: unknown` in `SpawnOptions` with this exact property:

```ts
createCustomTools?: (context: {
  id: string;
  cwd: string;
  allowRecursion: boolean;
}) => unknown[];
```

Do not add `parentAgentId`: `id` is the Agent whose tools are being created, while the child-tool factory derives each spawned child's parent ID from that value.

- [ ] **Step 4: Build one reusable caller-side factory**

Export `createAgentCustomToolsFactory` from `src/core/child-subagent-tool.ts` with this shape:

```ts
export function createAgentCustomToolsFactory(
  manager: AgentManager,
  deps: RuntimeDeps,
  agentDef: AgentDefinition,
  currentDepth: number,
): NonNullable<SpawnOptions["createCustomTools"]>;
```

Its returned function resolves `deps.discoverAgents(deps.resolvePaths())` when invoked. When `context.allowRecursion` is true, return `createChildSubagentTool` and `createChildGetResultTool`, using `context.cwd`, `context.id`, and `currentDepth + 1`. When `agentDef.intercom` is true and `deps.intercom` exists, append `createContactSupervisorTool`. Return an empty array when neither condition applies.

Inside `createChildSubagentTool`, pass a new factory for the selected child Agent:

```ts
createCustomTools: createAgentCustomToolsFactory(manager, deps, agentDef, currentDepth),
```

This preserves the current child depth: `currentDepth` already denotes the selected child Agent's depth.

- [ ] **Step 5: Move invocation into `AgentManager`**

After worktree selection, calculate the existing `allowRecursion` value and invoke the supplied factory once:

```ts
const customTools =
  options.createCustomTools?.({
    id,
    cwd: effectiveCwd,
    allowRecursion,
  }) ?? [];
```

Pass `customTools` unchanged to `runAgent`. Delete `RuntimeDeps`, `createChildSubagentTool`, `createChildGetResultTool`, and `createContactSupervisorTool` imports from `agent-manager.ts`, along with all `_deps` casts.

- [ ] **Step 6: Wire every non-child caller**

Use `createAgentCustomToolsFactory(deps.manager, deps, agentDef, 0)` for the top-level tool, `/agent`, and RPC paths. Use it in the Chain `spawnAndWait` closure with the Chain step's effective Agent definition and depth `0`. Keep all existing command parameters, RPC payloads, and Pi tool schemas unchanged.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm vitest run tests/agent-manager.test.ts tests/child-subagent-tool.test.ts tests/subagent.test.ts tests/subagent-chain.test.ts tests/rpc.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/types.ts src/core/agent-manager.ts src/core/child-subagent-tool.ts src/core/subagent.ts src/core/rpc.ts tests/agent-manager.test.ts tests/child-subagent-tool.test.ts tests/subagent.test.ts tests/subagent-chain.test.ts tests/rpc.test.ts
git add src/shared/types.ts src/core/agent-manager.ts src/core/child-subagent-tool.ts src/core/subagent.ts src/core/rpc.ts tests/agent-manager.test.ts tests/child-subagent-tool.test.ts tests/subagent.test.ts tests/subagent-chain.test.ts tests/rpc.test.ts
git commit -m "refactor: replace spawn dependency bag"
```

Expected: focused tests, typecheck, and touched-file lint pass; no `_deps` field or `AgentManager` dependency on `RuntimeDeps` remains.

### Task 2: Centralize Agent lifecycle transitions

**Files:**

- Modify: `src/core/agent-manager.ts`
- Modify: `tests/agent-manager.test.ts`
- Modify: `tests/subagent-chain.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Add table-driven tests for success, runner rejection, output-cleanup failure, worktree-cleanup failure, immediate setup failure, queued setup failure, queued stop, normal-Agent running stop, Chain completion/error/abort, and resume completion/error/abort. Each terminal test must assert `status`, `completedAt`, `durationMs`, `live.activeTools`, callback count, and background-slot behavior.

Add explicit assertions for these two abort contracts:

```ts
expect(manager.abort(agentId)).toBe(true);
expect(record.status).toBe("stopped");
expect(record.completedAt).toBeDefined();
// Later runner settlement may fill result/error but cannot replace "stopped".
```

```ts
expect(manager.abort(chainId)).toBe(true);
await manager.getRecord(chainId)?.promise;
expect(manager.getRecord(chainId)?.status).toBe("aborted");
```

Also assert `waitForAll()` does not resolve while a stopped normal Agent's runner promise remains unsettled, and that a throwing `onComplete` or Chain `onClear` callback neither changes terminal status nor produces a second callback.

- [ ] **Step 2: Verify the tests fail on duplicated settlement paths**

Run:

```bash
pnpm vitest run tests/agent-manager.test.ts tests/subagent-chain.test.ts
```

Expected: immediate-stop, setup-failure, exact-once, resume-duration, and stopped-`waitForAll` tests fail because terminal mutation is still duplicated.

- [ ] **Step 3: Add minimal private lifecycle state**

Replace the numeric `runningBackground` field with:

```ts
private readonly finalizedRuns = new Set<string>();
private readonly runningBackgroundIds = new Set<string>();
```

Use `runningBackgroundIds.size` for queue capacity. Clear a run's finalized marker before an Agent starts, before a Chain starts, and before a session resumes. Delete a background ID only during finalization; Chains never enter this set.

- [ ] **Step 4: Implement one idempotent finalizer**

Add private terminal types and this helper in `AgentManager`:

```ts
private finalizeRun(
  id: string,
  outcome: {
    status: Exclude<AgentRecord["status"], "queued" | "running">;
    result?: string;
    error?: string;
    session?: unknown;
  },
  options: { notify: boolean; cleanup?: () => void },
): void;
```

If `id` is already finalized, return immediately. Otherwise mark it finalized, retain `stopped` when a late normal-Agent settlement arrives, apply supplied result/error/session, set `completedAt` only when absent, calculate `durationMs`, and clear active tools. Run `options.cleanup` and `onComplete` in separate `try/catch` blocks. Release a background ID once, then call `drainQueue()` only when a slot was released.

The normal-Agent cleanup callback flushes `outputCleanup`, clears it, and runs `cleanupWorktree(options.cwd, record.worktree, record.invocation?.task ?? "")`, storing `worktreeResult` when returned. The Chain cleanup callback closes append admission and invokes `onClear`. Resume supplies no cleanup callback and `notify: false`.

- [ ] **Step 5: Make start failures and starts deterministic**

In `startAgent`, perform worktree creation, abort-controller setup, and custom-tool factory invocation before setting `status` to `running` or adding the Agent ID to `runningBackgroundIds`. If this setup throws, best-effort clean an already-created worktree and rethrow.

In immediate `spawn`, catch that throw, delete the newly-created record, decrement `spawnCount`, and rethrow. In `drainQueue`, route the queued record through `finalizeRun` with `status: "error"`, its error message, and `notify: true`, then continue the loop. Reset `startedAt` when a queued record actually begins execution. Call `onStart` defensively so a rendering callback cannot prevent execution.

- [ ] **Step 6: Route settlement, stop, Chain, and resume paths**

Route both `runAgent` handlers and both Chain promise handlers through `finalizeRun`. Remove public `registerExternalRecord` and `notifyComplete`; `fireAndForgetChain` directly stores its record before calling `startFactory`.

For a running non-Chain Agent, `abort` immediately assigns `status: "stopped"`, `completedAt`, `durationMs`, and empty active tools, then aborts its controller. It does not release the background slot or notify until settlement. For a Chain, retain its existing abort signal and append-admission closure; its promise finalizes as `aborted`.

In `resume`, create and store a fresh `AbortController`, forward the supplied signal into it, assign the resume promise to `record.promise`, and route its resolve/reject through `finalizeRun` with `notify: false`. A manager-directed abort can then stop a resumed Agent, and `waitForAll` can await its current promise.

Change `waitForAll` to await every record promise whose run ID is not in `finalizedRuns`, including an immediately stopped Agent whose runner has not yet settled.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm vitest run tests/agent-manager.test.ts tests/subagent-chain.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/agent-manager.ts tests/agent-manager.test.ts tests/subagent-chain.test.ts
git add src/core/agent-manager.ts tests/agent-manager.test.ts tests/subagent-chain.test.ts
git commit -m "refactor: centralize agent lifecycle transitions"
```

Expected: all focused lifecycle tests pass; each completion path invokes cleanup, notification, and slot release at most once.

## Final verification

- [ ] Run the full repository checks with the required process-local Git override:

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm check
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm release:check
git diff master...HEAD --check
```

Expected: all 1,157 baseline tests pass, touched-file lint introduces no diagnostics, package dry-run succeeds, and the diff has no whitespace errors. The repository currently emits existing Biome warnings; this phase must not add any.

## Scope and compatibility

- Preserve command names, Pi tool schemas, RPC payloads, notification text, and TUI rendering.
- Initial Agent runs, queued start failures, and background Chains remain completion-notification eligible. Resumes and never-started queued stops remain ineligible.
- A normal running Agent becomes `stopped` immediately on user abort; a Chain becomes `aborted` when its aggregate execution settles.
- Do not add dependencies, a public lifecycle state-machine type, a new module, or a compatibility wrapper for `_deps`.
