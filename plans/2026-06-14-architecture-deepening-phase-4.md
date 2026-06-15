# Phase 4: Encapsulate the Nested-Context Env-Var Protocol

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the 15 environment-variable constants, their parsing helpers, and the child-env construction logic from `src/core/subagent.ts` into a dedicated `src/core/nested-context.ts` module. The env-var protocol between parent and child pi processes becomes an explicit, independently-testable interface.

**Architecture:** `nested-context.ts` owns all knowledge of how the nesting protocol is encoded in environment variables and filesystem route/runtime files. `subagent.ts` becomes a thin consumer that reads context, validates delegation, and receives a built env dict — without knowing which env vars exist or how they're assembled.

**Tech Stack:** TypeScript, vitest. No new dependencies.

---

## File Map

| File                           | Role                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `src/core/nested-context.ts`   | **New.** Owns env-var constants, parsing, validation, child-env construction       |
| `src/core/subagent.ts`         | **Modified.** Drops ~130 lines of constants/functions, imports from nested-context |
| `tests/nested-context.test.ts` | **New.** Isolated tests for the extracted module                                   |
| `tests/subagent.test.ts`       | **Modified.** Nested-context integration paths still pass                          |

---

### Task 1: Create `src/core/nested-context.ts`

Extract constants, types, helpers, and functions into the new module.

- [x] Create `src/core/nested-context.ts` with the module header and imports:
  - `import { dirname, join } from "node:path"`
  - `import { resolveRuntimeArtifactsPaths } from "../shared/artifacts.js"`
  - `import type { AgentDefinition, AgentDiscoveryResult, LoadedConfig, ResolvedPaths, SubagentToolInput } from "../shared/types.js"`
  - Import `SubagentRuntimeDeps` type from `./subagent.js` (or define a minimal interface to avoid circular deps — see step below)

- [x] Move the 15 env-var constants (currently lines 55–70 of `subagent.ts`) as **non-exported** module-private constants:

  ```
  PI_SUBAGENT_CHILD, PI_SUBAGENT_FANOUT_CHILD, PI_SUBAGENT_RUN_ID,
  PI_SUBAGENT_DEPTH, PI_SUBAGENT_MAX_DEPTH, PI_SUBAGENT_ALLOWED_AGENTS,
  PI_SUBAGENT_RUNTIME_STATE, PI_SUBAGENT_PARENT_EVENT_SINK,
  PI_SUBAGENT_PARENT_CONTROL_INBOX, PI_SUBAGENT_PARENT_ROOT_RUN_ID,
  PI_SUBAGENT_PARENT_RUN_ID, PI_SUBAGENT_PARENT_CHILD_INDEX,
  PI_SUBAGENT_PARENT_DEPTH, PI_SUBAGENT_PARENT_PATH,
  PI_SUBAGENT_PARENT_CAPABILITY_TOKEN
  ```

- [x] Move `ROUTE_FILE_NAME` and `RUNTIME_STATE_FILE_NAME` as non-exported constants.

- [x] Move helper functions (keep non-exported):
  - `parseInteger(value: string | undefined, fallback: number): number`
  - `splitCommaSeparatedList(value: string | undefined): string[]`

- [x] Export the `NestedRuntimeContext` type:

  ```typescript
  export type NestedRuntimeContext = {
    isNestedChild: boolean;
    currentRunId?: string;
    depth: number;
    maxDepth: number;
    rootRunId?: string;
    allowedAgents?: string[];
    parentPath: string;
  };
  ```

- [x] Export the `NestedChildLaunch` type:

  ```typescript
  export type NestedChildLaunch = {
    childArgs: string[];
    childEnv: NodeJS.ProcessEnv;
  };
  ```

- [x] Define a minimal `NestedContextRuntimeDeps` interface to avoid circular imports with `subagent.ts`:

  ```typescript
  export interface NestedContextRuntimeDeps {
    createRunId: () => string;
    writeFile: (path: string, content: string) => void;
    mkdirp: (path: string) => void;
  }
  ```

  The `SubagentRuntimeDeps` in `subagent.ts` already satisfies this shape.

- [x] Export `readContext(loadedConfig: LoadedConfig, env?: NodeJS.ProcessEnv): NestedRuntimeContext` — body from `readNestedRuntimeContext()` (lines 348–371). The optional `env` parameter defaults to `process.env`, enabling hermetic tests without mutating the real environment.

- [x] Export `validateDelegation(discovery: AgentDiscoveryResult, input: SubagentToolInput, context: NestedRuntimeContext): void` — body from `ensureNestedDelegationAllowed()` (lines 385–417). This function also needs `listAvailableAgents()` — either inline the one-liner or accept the discovery type that already exposes agents. Prefer inlining: `discovery.agents.map(a => a.name).join(", ") || "none"`.

- [x] Export `stripNestedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv` — body from `withoutNestedSubagentEnv()` (lines 469–491).

- [x] Export `buildChildEnv(params: BuildChildEnvParams): { env: NodeJS.ProcessEnv; routeDir: string }` with the parameter type:

  ```typescript
  export type BuildChildEnvParams = {
    agent: AgentDefinition;
    context: NestedRuntimeContext;
    childRunId: string;
    paths: ResolvedPaths;
    cwd: string;
    parentSessionFile?: string;
    parentSessionDir?: string;
    runtime: NestedContextRuntimeDeps;
    baseEnv?: NodeJS.ProcessEnv;
  };
  ```

  The optional `baseEnv` parameter defaults to `process.env`, enabling hermetic tests without environment mutation.

  Body extracted from `createNestedChildLaunch()` lines 481–601 (the `if (recursionEnabled)` branch): computes `childDepth`, `rootRunId`, `parentRunId`, `capabilityToken`, calls `resolveRuntimeArtifactsPaths`, writes route/runtime JSON files, and assembles the child env dict.

- [x] Verify the module compiles in isolation: `npx tsc --noEmit src/core/nested-context.ts` or equivalent via `pnpm typecheck`.

---

### Task 2: Rewire `subagent.ts` to delegate to nested-context

Remove moved code and replace with imports from the new module.

- [x] Add import block at the top of `subagent.ts`:

  ```typescript
  import {
    type NestedRuntimeContext,
    type NestedChildLaunch,
    readContext,
    validateDelegation,
    stripNestedEnv,
    buildChildEnv,
  } from "./nested-context.js";
  ```

- [x] Delete from `subagent.ts`:
  - The 15 `PI_SUBAGENT_*` constants (lines 55–70)
  - `ROUTE_FILE_NAME` and `RUNTIME_STATE_FILE_NAME` constants (lines 53–54)
  - `NestedRuntimeContext` type (lines 123–131)
  - `NestedChildLaunch` type (lines 133–136)
  - `parseInteger()` function (lines 328–335)
  - `splitCommaSeparatedList()` function (lines 337–346)
  - `readNestedRuntimeContext()` function (lines 348–371)
  - `ensureNestedDelegationAllowed()` function (lines 373–405)
  - `withoutNestedSubagentEnv()` function (lines 457–479)

- [x] Slim down `createNestedChildLaunch()` to a thin orchestrator:

  ```typescript
  function createNestedChildLaunch(
    paths: ResolvedPaths,
    cwd: string,
    agent: AgentDefinition,
    promptPath: string | undefined,
    childSessionPath: string,
    loadedConfig: LoadedConfig,
    runtime: SubagentRuntimeDeps,
    childRunId: string,
    parentSessionFile: string | undefined,
    parentSessionDir: string | undefined,
    effectiveModel: string | undefined,
  ): NestedChildLaunch {
    const context = readContext(loadedConfig);
    const recursionEnabled =
      agent.tools.includes("subagent") && context.depth < context.maxDepth;
    const childArgs = buildChildArgs(
      agent,
      promptPath,
      childSessionPath,
      recursionEnabled,
      effectiveModel,
      cwd,
    );

    if (!recursionEnabled) {
      return { childArgs, childEnv: stripNestedEnv(process.env) };
    }

    const { env } = buildChildEnv({
      agent,
      context,
      childRunId,
      paths,
      cwd,
      parentSessionFile,
      parentSessionDir,
      runtime,
      baseEnv: process.env,
    });
    return { childArgs, childEnv: env };
  }
  ```

- [x] Replace `ensureNestedDelegationAllowed(discovery, input, context)` call sites in `subagent.ts` with `validateDelegation(discovery, input, context)`.

- [x] Replace `readNestedRuntimeContext(loadedConfig)` call sites (outside of `createNestedChildLaunch`) with `readContext(loadedConfig)`.

- [x] Verify no remaining references to the deleted identifiers: `grep -n "PI_SUBAGENT_\|readNestedRuntimeContext\|ensureNestedDelegationAllowed\|withoutNestedSubagentEnv\|parseInteger\|splitCommaSeparatedList\|ROUTE_FILE_NAME\|RUNTIME_STATE_FILE_NAME" src/core/subagent.ts` should return zero results.

- [x] Run `pnpm typecheck` — must pass with zero errors.

- [x] Run `pnpm test` — all existing tests in `tests/subagent.test.ts` must pass unchanged.

---

### Task 3: Add isolated nested-context tests

Create `tests/nested-context.test.ts` with focused unit tests for the extracted module.

- [x] **`readContext()` tests:**
  - Returns default context when no env vars are set (depth=0, maxDepth from config, isNestedChild=false)
  - Reads all env vars correctly when `PI_SUBAGENT_CHILD=1` plus full env set
  - Handles malformed depth (non-numeric) gracefully via fallback
  - Parses `PI_SUBAGENT_ALLOWED_AGENTS` comma-separated list with trimming
  - Returns `undefined` for `allowedAgents` when env var is completely absent (vs empty string → empty array)
  - Uses `loadedConfig.config.maxRecursiveLevel` as fallback for max depth

- [x] **`validateDelegation()` tests:**
  - No-op when `context.isNestedChild` is false (non-nested callers are unrestricted)
  - Throws when `depth >= maxDepth`
  - Throws when `allowedAgents` is empty array
  - Throws when requested agent is not in allowlist (case-insensitive comparison)
  - Passes when requested agent matches allowlist entry (case-insensitive)
  - Error messages include the requested agent name and available agents list

- [x] **`stripNestedEnv()` tests:**
  - Removes all 15 `PI_SUBAGENT_*` keys from env dict
  - Preserves all non-`PI_SUBAGENT_*` keys
  - Returns a new object (does not mutate input)
  - Works correctly when none of the keys are present (no-op case)

- [x] **`buildChildEnv()` tests:**
  - Returned env contains all 15 expected `PI_SUBAGENT_*` keys with correct values
  - `routeDir` path follows the expected `nestedEventsDir/{rootRunId}-{capabilityToken}` pattern
  - Calls `runtime.mkdirp` for route dir and runtime state dir
  - Calls `runtime.writeFile` for both `route.json` and `runtime.json`
  - Written `route.json` content includes expected fields (rootRunId, parentRunId, childRunId, capabilityToken)
  - Written `runtime.json` content includes expected fields (runId, depth, maxDepth, allowedAgents)
  - `childDepth` is `context.depth + 1`
  - `rootRunId` uses `context.rootRunId` when present, falls back to `childRunId`
  - `parentPath` appends `context.currentRunId` to `context.parentPath`

- [x] All tests use injected/controlled inputs — no `process.env` mutation except in `readContext` tests (which should save/restore env).

- [x] Run `pnpm test tests/nested-context.test.ts` — all tests pass.

- [x] Run full suite: `pnpm check` (lint + typecheck + tests) — passes cleanly.

---

## Verification Checklist

- [x] `pnpm run lint` passes (biome)
- [x] `pnpm run typecheck` passes (tsc --noEmit)
- [x] `pnpm run test` passes (vitest run) — both `tests/subagent.test.ts` and `tests/nested-context.test.ts`
- [x] No public interface changes: `src/core/subagent.ts` still exports the same set of names consumed by `src/index.ts`
- [x] `src/core/nested-context.ts` does not import from `./subagent.js` (no circular dependency)
- [x] The 15 env-var constants are not exported from `nested-context.ts` — they are implementation details
- [x] `grep -r "PI_SUBAGENT_" src/` only finds hits in `src/core/nested-context.ts`

---

## Risk Notes

- **Circular dependency:** `nested-context.ts` must not import from `subagent.ts`. The `NestedContextRuntimeDeps` minimal interface avoids this. If `SubagentRuntimeDeps` evolves to include more methods, the minimal interface protects nested-context from churn.
- **`listAvailableAgents` helper:** Used by `validateDelegation()` in error messages. Rather than importing it from `subagent.ts` (circular), inline the logic (`discovery.agents.map(a => a.name).join(", ") || "none"`) directly in the new module.
- **`process.env` in tests:** Both `readContext()` and `buildChildEnv()` access `process.env`. Both accept an optional `env`/`baseEnv` parameter (defaulting to `process.env`) so tests can pass controlled env dicts without mutating the real environment.
