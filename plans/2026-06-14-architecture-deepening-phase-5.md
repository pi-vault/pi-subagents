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

- [ ] Create `src/core/subagent-spawner.ts` with the following exports:
  - `buildChildArgs(agent, promptPath, childSessionPath, recursionEnabled, effectiveModel, cwd): string[]`
  - `spawnAndCollect(params: SpawnCollectParams): Promise<RawChildResult>`
  - `resolveEffectiveModel(agent, parentModel): string | undefined`
  - `getParentModelId(model): string | undefined`
  - Types: `RawChildResult`, `SpawnCollectParams`, `JsonContentPart`, `JsonAssistantMessage`, `JsonMessageEndEvent`, `JsonToolExecutionStartEvent`, `JsonToolExecutionEndEvent`, `ChildSpawn`, `SpawnChildFn`, `ProgressUpdate`
  - Constants: `TERMINATION_GRACE_MS`, `SUBAGENT_EXTENSION_ENTRY`
  - Import: `resolveSkillPaths` from `./skill-loader.js` (consumed by `buildChildArgs`)
- [ ] Move internal helpers from `subagent.ts` into the new module as private functions:
  - `processLine()` (adapted as a factory or closure inside `spawnAndCollect`)
  - `getAssistantText(message): string`
  - `accumulateUsage(usage, message): void`
  - `createUsage(): SubagentUsage`
  - `previewValue(value, maxLength): string`
  - `pushRecentToolActivity(activities, activity): void`
- [ ] Define the `RawChildResult` type:
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
- [ ] Define `SpawnCollectParams` to encapsulate all inputs to `spawnAndCollect`:
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
- [ ] Extract the Promise-based spawn loop from `executeSubagent()` into `spawnAndCollect()`. The function spawns the child, wires stdout/stderr listeners, sets up timeout/abort terminate logic, and resolves with `RawChildResult`.
- [ ] Re-export `SpawnChildFn` and `ProgressUpdate` types (consumed by `subagent.ts` for the `SubagentRuntimeDeps` interface).
- [ ] Remove moved code from `subagent.ts`; add `import { buildChildArgs, spawnAndCollect, resolveEffectiveModel, getParentModelId, ... } from "./subagent-spawner.js"`.
- [ ] Verify: `pnpm run typecheck` passes with no errors.

---

### Task 2: Extract `src/core/subagent-artifacts.ts`

Move artifact markdown generation and writing into a pure I/O module.

- [ ] Create `src/core/subagent-artifacts.ts` with the following exports:
  - `buildArtifactInputMarkdown(input: ArtifactWriteInput): string`
  - `buildArtifactOutputMarkdown(result: SubagentExecutionResult): string`
  - `writeExecutionArtifacts(paths, artifactInput, result): ArtifactPaths`
  - `withArtifacts(result, artifactPaths): SubagentExecutionResult`
  - Type: `ArtifactWriteInput`
- [ ] Move the `ArtifactWriteInput` type definition from `subagent.ts` to the new module (exported).
- [ ] Move `buildArtifactInputMarkdown`, `buildArtifactOutputMarkdown`, `writeExecutionArtifacts`, and `withArtifacts` implementations verbatim.
- [ ] The new module imports from `../shared/artifacts.js`: `getArtifactPaths`, `writeArtifact`, `writeMetadata`.
- [ ] Remove moved code from `subagent.ts`; add `import { buildArtifactInputMarkdown, writeExecutionArtifacts, withArtifacts, type ArtifactWriteInput } from "./subagent-artifacts.js"`.
- [ ] Verify: `pnpm run typecheck` passes with no errors.

---

### Task 3: Slim `subagent.ts` to orchestrator

After Tasks 1–2, `subagent.ts` should contain only orchestration and registration concerns.

- [ ] Verify the remaining contents of `subagent.ts` are limited to:
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
- [ ] Refactor `executeSubagent()` to call `spawnAndCollect()` instead of inlining the spawn loop:
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
- [ ] Ensure `SubagentRuntimeDeps` still exposes `spawnChild` and `now` (consumed by the spawner via `Pick`).
- [ ] Confirm all existing public exports from `subagent.ts` are preserved:
  - `executeSubagent`, `registerSubagentTool`, `registerSlashAgentBridge`, `registerAgentCommand`
  - `parseAgentCommandArgs`, `findAgentByName`
  - `SubagentRuntimeDeps`, `createSubagentRuntimeDeps`, `resolvePiInvocation`
- [ ] Verify: `pnpm run typecheck` passes.
- [ ] Verify: `pnpm run lint` passes (biome).

---

### Task 4: Restructure tests

Split `tests/subagent.test.ts` (1869 lines, 28 tests) to match the new module boundaries and add focused tests that were previously impractical.

- [ ] Create `tests/subagent-spawner.test.ts` with tests focused on:
  - `buildChildArgs` — flag assembly with various agent configurations (recursion on/off, model, thinking, skills, no-skills)
  - `spawnAndCollect` — stream parsing of `message_end`, `tool_execution_start`, `tool_execution_end` events
  - `spawnAndCollect` — timeout triggers `SIGTERM` then `SIGKILL` after grace period
  - `spawnAndCollect` — abort signal terminates child
  - `spawnAndCollect` — usage accumulation across multiple `message_end` events
  - `spawnAndCollect` — partial JSON lines buffered correctly
  - `previewValue` — truncation and edge cases (reachable via re-export or test-only export)
  - `resolveEffectiveModel` — agent model vs parent model fallback logic
  - `getParentModelId` — provider/id formatting
- [ ] Create `tests/subagent-artifacts.test.ts` with tests focused on:
  - `buildArtifactInputMarkdown` — correct markdown generation for various inputs (missing fields, full fields)
  - `buildArtifactOutputMarkdown` — correct markdown for success/error/timeout results
  - `writeExecutionArtifacts` — writes input, output, and meta files to correct paths (using temp dir)
  - `withArtifacts` — merges artifact paths into result without mutating original
- [ ] Migrate tests from `tests/subagent.test.ts`:
  - Move stream-parsing and timeout tests into `subagent-spawner.test.ts`
  - Move artifact-related assertions into `subagent-artifacts.test.ts`
  - Keep orchestration and registration tests in `subagent.test.ts`
- [ ] Update imports in `tests/subagent.test.ts`:
  - Import spawner types/functions from `../src/core/subagent-spawner.js` where referenced
  - Import artifact types from `../src/core/subagent-artifacts.js` where referenced
- [ ] Add new integration test in `tests/subagent.test.ts`: `executeSubagent` with a mock spawner that returns a canned `RawChildResult`, verifying the orchestrator maps it correctly and writes artifacts.
- [ ] Verify: `pnpm run test` passes — all existing tests green, new tests green.
- [ ] Verify: no test uses `FakeChildProcess` directly in `subagent.test.ts` anymore (those live in spawner tests).

---

## Verification Checklist

After all tasks are complete:

- [ ] `pnpm run lint` — biome passes
- [ ] `pnpm run typecheck` — tsc --noEmit passes
- [ ] `pnpm run test` — vitest run passes (all existing + new tests)
- [ ] No public interface changes visible to `src/index.ts` or external callers
- [ ] Each new module has at least one dedicated test file with ≥5 focused test cases
- [ ] `src/index.ts` requires no changes (re-exports still resolve)
