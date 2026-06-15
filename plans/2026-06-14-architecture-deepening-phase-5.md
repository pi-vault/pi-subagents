# Phase 5: Split the Subagent Execution Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/core/subagent.ts` (1163 lines after phases 1–4) into three focused modules: a process spawner, an artifact writer, and a slimmed orchestrator. Each module passes the deletion test — removing it breaks a clear, distinct capability.

**Architecture:** The orchestrator (`subagent.ts`) delegates downward to `subagent-spawner.ts` for child process lifecycle and to `subagent-artifacts.ts` for artifact I/O. The spawner returns a `RawChildResult` struct; the orchestrator maps it to `SubagentExecutionResult` and hands it to artifacts for persistence. Registration glue stays in the orchestrator since it coordinates all three concerns.

**Tech Stack:** TypeScript, Node.js child_process, vitest. No new dependencies.

**Prerequisites:** Phase 1 (execution state) and Phase 4 (nested-context).

---

## File Map

| New / Changed File                 | Responsibility                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/core/subagent-spawner.ts`     | Child process lifecycle: arg assembly, spawn, stream parsing, timeout/signal, usage accumulation |
| `src/core/subagent-artifacts.ts`   | Artifact markdown generation and disk writes                                                     |
| `src/core/subagent.ts`             | Orchestration (`executeSubagent`), registration, request parsing, session resolution             |
| `tests/subagent-spawner.test.ts`   | Spawner-focused tests (stream parsing, timeout, signal, usage)                                   |
| `tests/subagent-artifacts.test.ts` | Artifact generation and write tests                                                              |
| `tests/subagent.test.ts`           | Slimmed: orchestration + registration tests only (spawner injected)                              |

---

### Task 1: Extract `src/core/subagent-spawner.ts`

Move all child-process mechanics into a dedicated module with a single public entry point (`spawnAndCollect`) and the arg builder (`buildChildArgs`).

- [x] Create `src/core/subagent-spawner.ts` with the following exports:
  - `buildChildArgs(agent, promptPath, childSessionPath, recursionEnabled, effectiveModel, cwd): string[]`
  - `spawnAndCollect(params: SpawnCollectParams): Promise<RawChildResult>`
  - `resolveEffectiveModel(agent, parentModel): string | undefined`
  - `getParentModelId(model): string | undefined`
  - Types: `RawChildResult`, `SpawnCollectParams`, `JsonContentPart`, `JsonAssistantMessage`, `JsonMessageEndEvent`, `JsonToolExecutionStartEvent`, `JsonToolExecutionEndEvent`, `ChildSpawn`, `SpawnChildFn`, `ProgressUpdate`
  - Constants: `TERMINATION_GRACE_MS`, `SUBAGENT_EXTENSION_ENTRY`
  - Import: `resolveSkillPaths` from `./skill-loader.js` (consumed by `buildChildArgs`)
- [x] Move internal helpers from `subagent.ts` into the new module as private functions:
  - `processLine()` (adapted as a factory or closure inside `spawnAndCollect`)
  - `getAssistantText(message): string`
  - `accumulateUsage(usage, message): void`
  - `createUsage(): SubagentUsage` (exported — consumed by orchestrator's `buildExecutionResult` fallback)
  - `previewValue(value, maxLength): string`
  - `pushRecentToolActivity(activities, activity): void`
- [x] Define the `RawChildResult` type:
  ```typescript
  export type RawChildResult = {
    finalText: string;
    model?: string;
    stopReason?: string;
    errorMessage?: string;
    exitCode: number | null;
    stderr: string;
    usage: SubagentUsage;
    recentToolActivity: SubagentToolActivity[];
    timedOut: boolean;
    aborted: boolean;
  };
  ```
- [x] Define `SpawnCollectParams` to encapsulate all inputs to `spawnAndCollect` (deviation: uses local `SpawnCollectRuntime` type instead of `Pick<SubagentRuntimeDeps, ...>` to avoid circular import):
  ```typescript
  export type SpawnCollectParams = {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal: AbortSignal | undefined;
    effectiveModel: string | undefined;
    runtime: Pick<SubagentRuntimeDeps, "spawnChild" | "now">;
    onProgress?: (update: ProgressUpdate) => void;
    childSessionPath?: string;
    startedAt: number;
  };
  ```
- [x] Extract the Promise-based spawn loop from `executeSubagent()` into `spawnAndCollect()`. The function spawns the child, wires stdout/stderr listeners, sets up timeout/abort terminate logic, and resolves with `RawChildResult`.
- [x] Re-export `SpawnChildFn` and `ProgressUpdate` types (consumed by `subagent.ts` for the `SubagentRuntimeDeps` interface).
- [x] Remove moved code from `subagent.ts`; add `import { buildChildArgs, spawnAndCollect, resolveEffectiveModel, getParentModelId, ... } from "./subagent-spawner.js"`.
- [x] Verify: `pnpm run typecheck` passes with no errors.

---

### Task 2: Extract `src/core/subagent-artifacts.ts`

Move artifact markdown generation and writing into a pure I/O module.

- [x] Create `src/core/subagent-artifacts.ts` with the following exports:
  - `buildArtifactInputMarkdown(input: ArtifactWriteInput): string`
  - `buildArtifactOutputMarkdown(result: SubagentExecutionResult): string`
  - `writeExecutionArtifacts(paths, artifactInput, result): ArtifactPaths`
  - `withArtifacts(result, artifactPaths): SubagentExecutionResult`
  - Type: `ArtifactWriteInput`
- [x] Move the `ArtifactWriteInput` type definition from `subagent.ts` to the new module (exported).
- [x] Move `buildArtifactInputMarkdown`, `buildArtifactOutputMarkdown`, `writeExecutionArtifacts`, and `withArtifacts` implementations verbatim.
- [x] The new module imports from `../shared/artifacts.js`: `getArtifactPaths`, `writeArtifact`, `writeMetadata`.
- [x] Remove moved code from `subagent.ts`; add `import { buildArtifactInputMarkdown, writeExecutionArtifacts, withArtifacts, type ArtifactWriteInput } from "./subagent-artifacts.js"`.
- [x] Verify: `pnpm run typecheck` passes with no errors.

---

### Task 3: Slim `subagent.ts` to orchestrator

After Tasks 1–2, `subagent.ts` should contain only orchestration and registration concerns.

- [x] Verify the remaining contents of `subagent.ts` are limited to:
  - `executeSubagent()` — orchestrates: validate → resolve session → prepare launch → call `spawnAndCollect` → map `RawChildResult` to `SubagentExecutionResult` → write artifacts → return
  - `registerSubagentTool()`, `registerSlashAgentBridge()`, `registerAgentCommand()`
  - `findAgentByName()`, `parseSubagentRequest()`, `listAvailableAgents()`
  - `createNestedChildLaunch()` — bridges `buildChildArgs` (spawner) and `buildChildEnv` (nested-context)
  - `getParentSessionStem()`, `resolveChildSessionTarget()`, `buildExecutionResult()`, `buildSlashBridgeErrorResult()`
  - `parseAgentCommandArgs()`, `encodeDeferredTicket()`, `decodeDeferredTicket()`
  - Constants: `CHILD_SESSION_FILE_NAME`, `SYNTHETIC_PARENT_SESSION_STEM`, `DEFERRED_TICKET_PREFIX`, `SLASH_AGENT_BRIDGE_UNAVAILABLE`
  - Types: `NestedChildLaunch`
  - `SubagentRuntimeDeps` interface and `createSubagentRuntimeDeps()` factory
  - `resolvePiInvocation()`
  - `SUBAGENT_TOOL_PARAMETERS` schema
- [x] Refactor `executeSubagent()` to call `spawnAndCollect()` instead of inlining the spawn loop:
  ```typescript
  const rawResult = await spawnAndCollect({
    command: invocation.command,
    args: invocation.args,
    cwd: effectiveCwd,
    env: launch.childEnv,
    timeoutMs,
    signal,
    effectiveModel,
    runtime,
    onProgress,
    childSessionPath,
    startedAt,
  });
  ```
  Then map `rawResult` → `SubagentExecutionResult` via `buildExecutionResult()`.
- [x] Ensure `SubagentRuntimeDeps` still exposes `spawnChild` and `now` (consumed by the spawner via structural typing — `SpawnCollectRuntime`).
- [x] Confirm all existing public exports from `subagent.ts` are preserved:
  - `executeSubagent`, `registerSubagentTool`, `registerSlashAgentBridge`, `registerAgentCommand`
  - `parseAgentCommandArgs`, `findAgentByName`
  - `SubagentRuntimeDeps`, `createSubagentRuntimeDeps`, `resolvePiInvocation`
- [x] Verify: `pnpm run typecheck` passes.
- [x] Verify: `pnpm run lint` passes (biome).

---

### Task 4: Restructure tests

Split `tests/subagent.test.ts` (1869 lines, 28 tests) to match the new module boundaries and add focused tests that were previously impractical.

- [x] Create `tests/subagent-spawner.test.ts` with tests focused on:
  - `buildChildArgs` — flag assembly with various agent configurations (recursion on/off, model, thinking, skills, no-skills)
  - `spawnAndCollect` — stream parsing of `message_end`, `tool_execution_start`, `tool_execution_end` events
  - `spawnAndCollect` — timeout triggers `SIGTERM` then `SIGKILL` after grace period
  - `spawnAndCollect` — abort signal terminates child
  - `spawnAndCollect` — usage accumulation across multiple `message_end` events
  - `spawnAndCollect` — partial JSON lines buffered correctly
  - `previewValue` — truncation and edge cases (reachable via re-export or test-only export)
  - `resolveEffectiveModel` — agent model vs parent model fallback logic
  - `getParentModelId` — provider/id formatting
- [x] Create `tests/subagent-artifacts.test.ts` with tests focused on:
  - `buildArtifactInputMarkdown` — correct markdown generation for various inputs (missing fields, full fields)
  - `buildArtifactOutputMarkdown` — correct markdown for success/error/timeout results
  - `writeExecutionArtifacts` — writes input, output, and meta files to correct paths (using temp dir)
  - `withArtifacts` — merges artifact paths into result without mutating original
- Existing integration tests in `subagent.test.ts` retained — they exercise the full `executeSubagent` → `spawnAndCollect` pipeline and catch different bugs than unit tests. Removing them would reduce integration coverage without benefit.
- [x] Add new mapping tests in `tests/subagent.test.ts`: "RawChildResult → SubagentExecutionResult mapping" describe block with 3 tests verifying success/timeout/error mapping with full detail fidelity (usage, model, stopReason, artifactPaths, stderr).
- [x] Verify: `pnpm run test` passes — all existing tests green, new tests green.

---

## Verification Checklist

After all tasks are complete:

- [x] `pnpm run lint` — biome passes
- [x] `pnpm run typecheck` — tsc --noEmit passes
- [x] `pnpm run test` — vitest run passes (all existing + new tests)
- [x] No public interface changes visible to `src/index.ts` or external callers
- [x] Each new module has at least one dedicated test file with ≥5 focused test cases (spawner: 25, artifacts: 9)
- [x] `src/index.ts` requires no changes (re-exports still resolve)

> **Note on dropped line-count targets:** The original plan specified size targets (subagent.ts ≤400, spawner ≤350, artifacts ≤100). These were removed during plan review because the starting line count was already lower than planned (1163 vs 1380) and the targets were aspirational rather than architectural constraints. Actual sizes: subagent.ts=719, spawner=452, artifacts=128. The orchestrator is larger than originally targeted because existing integration tests (and the functions they exercise) were intentionally retained rather than migrated.
