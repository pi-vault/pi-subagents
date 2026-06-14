# Phase 4: Encapsulate the Nested-Context Env-Var Protocol

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the 16 environment-variable constants, their parsing helpers, and the child-env construction logic from `src/core/subagent.ts` into a dedicated `src/core/nested-context.ts` module. The env-var protocol between parent and child pi processes becomes an explicit, independently-testable interface.

**Architecture:** `nested-context.ts` owns all knowledge of how the nesting protocol is encoded in environment variables and filesystem route/runtime files. `subagent.ts` becomes a thin consumer that reads context, validates delegation, and receives a built env dict — without knowing which env vars exist or how they're assembled.

**Tech Stack:** TypeScript, vitest. No new dependencies.

---

## File Map

| File | Role |
| ---- | ---- |
| `src/core/nested-context.ts` | **New.** Owns env-var constants, parsing, validation, child-env construction |
| `src/core/subagent.ts` | **Modified.** Drops ~130 lines of constants/functions, imports from nested-context |
| `tests/nested-context.test.ts` | **New.** Isolated tests for the extracted module |
| `tests/subagent.test.ts` | **Modified.** Nested-context integration paths still pass |

---

### Task 1: Create `src/core/nested-context.ts`

Extract constants, types, helpers, and functions into the new module.

- [ ] Create `src/core/nested-context.ts` with the module header and imports:
  - `import { dirname, join } from "node:path"`
  - `import { resolveRuntimeArtifactsPaths } from "../shared/artifacts.js"`
  - `import type { AgentDefinition, AgentDiscoveryResult, LoadedConfig, ResolvedPaths, SubagentToolInput } from "../shared/types.js"`
  - Import `SubagentRuntimeDeps` type from `./subagent.js` (or define a minimal interface to avoid circular deps — see step below)

- [ ] Move the 16 env-var constants (currently lines 67–82 of `subagent.ts`) as **non-exported** module-private constants:
  ```
  PI_SUBAGENT_CHILD, PI_SUBAGENT_FANOUT_CHILD, PI_SUBAGENT_RUN_ID,
  PI_SUBAGENT_DEPTH, PI_SUBAGENT_MAX_DEPTH, PI_SUBAGENT_ALLOWED_AGENTS,
  PI_SUBAGENT_RUNTIME_STATE, PI_SUBAGENT_PARENT_EVENT_SINK,
  PI_SUBAGENT_PARENT_CONTROL_INBOX, PI_SUBAGENT_PARENT_ROOT_RUN_ID,
  PI_SUBAGENT_PARENT_RUN_ID, PI_SUBAGENT_PARENT_CHILD_INDEX,
  PI_SUBAGENT_PARENT_DEPTH, PI_SUBAGENT_PARENT_PATH,
  PI_SUBAGENT_PARENT_CAPABILITY_TOKEN
  ```

- [ ] Move `ROUTE_FILE_NAME` and `RUNTIME_STATE_FILE_NAME` as non-exported constants.

- [ ] Move helper functions (keep non-exported):
  - `parseInteger(value: string | undefined, fallback: number): number`
  - `splitCommaSeparatedList(value: string | undefined): string[]`

- [ ] Export the `NestedRuntimeContext` type:
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

- [ ] Export the `NestedChildLaunch` type:
  ```typescript
  export type NestedChildLaunch = {
    childArgs: string[];
    childEnv: NodeJS.ProcessEnv;
  };
  ```

- [ ] Define a minimal `NestedContextRuntimeDeps` interface to avoid circular imports with `subagent.ts`:
  ```typescript
  export interface NestedContextRuntimeDeps {
    createRunId: () => string;
    writeFile: (path: string, content: string) => void;
    mkdirp: (path: string) => void;
  }
  ```
  The `SubagentRuntimeDeps` in `subagent.ts` already satisfies this shape.

- [ ] Export `readContext(loadedConfig: LoadedConfig): NestedRuntimeContext` — body from `readNestedRuntimeContext()` (lines 360–383).

- [ ] Export `validateDelegation(discovery: AgentDiscoveryResult, input: SubagentToolInput, context: NestedRuntimeContext): void` — body from `ensureNestedDelegationAllowed()` (lines 385–417). This function also needs `listAvailableAgents()` — either inline the one-liner or accept the discovery type that already exposes agents. Prefer inlining: `discovery.agents.map(a => a.name).join(", ") || "none"`.

- [ ] Export `stripNestedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv` — body from `withoutNestedSubagentEnv()` (lines 469–491).

- [ ] Export `buildChildEnv(params: BuildChildEnvParams): { env: NodeJS.ProcessEnv; routeDir: string }` with the parameter type:
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
  };
  ```
  Body extracted from `createNestedChildLaunch()` lines 522–611 (the `if (recursionEnabled)` branch): computes `childDepth`, `rootRunId`, `parentRunId`, `capabilityToken`, calls `resolveRuntimeArtifactsPaths`, writes route/runtime JSON files, and assembles the child env dict.

- [ ] Verify the module compiles in isolation: `npx tsc --noEmit src/core/nested-context.ts` or equivalent via `pnpm typecheck`.

---

### Task 2: Rewire `subagent.ts` to delegate to nested-context

Remove moved code and replace with imports from the new module.

- [ ] Add import block at the top of `subagent.ts`:
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

- [ ] Delete from `subagent.ts`:
  - The 16 `PI_SUBAGENT_*` constants (lines 67–82)
  - `ROUTE_FILE_NAME` and `RUNTIME_STATE_FILE_NAME` constants (lines 65–66)
  - `NestedRuntimeContext` type (lines 135–143)
  - `NestedChildLaunch` type (lines 145–148)
  - `parseInteger()` function (lines 340–347)
  - `splitCommaSeparatedList()` function (lines 349–358)
  - `readNestedRuntimeContext()` function (lines 360–383)
  - `ensureNestedDelegationAllowed()` function (lines 385–417)
  - `withoutNestedSubagentEnv()` function (lines 469–491)

- [ ] Slim down `createNestedChildLaunch()` to a thin orchestrator:
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
      agent, promptPath, childSessionPath, recursionEnabled, effectiveModel, cwd,
    );

    if (!recursionEnabled) {
      return { childArgs, childEnv: stripNestedEnv(process.env) };
    }

    const { env } = buildChildEnv({
      agent, context, childRunId, paths, cwd,
      parentSessionFile, parentSessionDir, runtime,
    });
    return { childArgs, childEnv: env };
  }
  ```

- [ ] Replace `ensureNestedDelegationAllowed(discovery, input, context)` call sites in `subagent.ts` with `validateDelegation(discovery, input, context)`.

- [ ] Replace `readNestedRuntimeContext(loadedConfig)` call sites (outside of `createNestedChildLaunch`) with `readContext(loadedConfig)`.

- [ ] Verify no remaining references to the deleted identifiers: `grep -n "PI_SUBAGENT_\|readNestedRuntimeContext\|ensureNestedDelegationAllowed\|withoutNestedSubagentEnv\|parseInteger\|splitCommaSeparatedList\|ROUTE_FILE_NAME\|RUNTIME_STATE_FILE_NAME" src/core/subagent.ts` should return zero results.

- [ ] Run `pnpm typecheck` — must pass with zero errors.

- [ ] Run `pnpm test` — all existing tests in `tests/subagent.test.ts` must pass unchanged.

---

### Task 3: Add isolated nested-context tests

Create `tests/nested-context.test.ts` with focused unit tests for the extracted module.

- [ ] **`readContext()` tests:**
  - Returns default context when no env vars are set (depth=0, maxDepth from config, isNestedChild=false)
  - Reads all env vars correctly when `PI_SUBAGENT_CHILD=1` plus full env set
  - Handles malformed depth (non-numeric) gracefully via fallback
  - Parses `PI_SUBAGENT_ALLOWED_AGENTS` comma-separated list with trimming
  - Returns `undefined` for `allowedAgents` when env var is completely absent (vs empty string → empty array)
  - Uses `loadedConfig.config.maxRecursiveLevel` as fallback for max depth

- [ ] **`validateDelegation()` tests:**
  - No-op when `context.isNestedChild` is false (non-nested callers are unrestricted)
  - Throws when `depth >= maxDepth`
  - Throws when `allowedAgents` is empty array
  - Throws when requested agent is not in allowlist (case-insensitive comparison)
  - Passes when requested agent matches allowlist entry (case-insensitive)
  - Error messages include the requested agent name and available agents list

- [ ] **`stripNestedEnv()` tests:**
  - Removes all 16 `PI_SUBAGENT_*` keys from env dict
  - Preserves all non-`PI_SUBAGENT_*` keys
  - Returns a new object (does not mutate input)
  - Works correctly when none of the keys are present (no-op case)

- [ ] **`buildChildEnv()` tests:**
  - Returned env contains all 14 expected `PI_SUBAGENT_*` keys with correct values
  - `routeDir` path follows the expected `nestedEventsDir/{rootRunId}-{capabilityToken}` pattern
  - Calls `runtime.mkdirp` for route dir and runtime state dir
  - Calls `runtime.writeFile` for both `route.json` and `runtime.json`
  - Written `route.json` content includes expected fields (rootRunId, parentRunId, childRunId, capabilityToken)
  - Written `runtime.json` content includes expected fields (runId, depth, maxDepth, allowedAgents)
  - `childDepth` is `context.depth + 1`
  - `rootRunId` uses `context.rootRunId` when present, falls back to `childRunId`
  - `parentPath` appends `context.currentRunId` to `context.parentPath`

- [ ] All tests use injected/controlled inputs — no `process.env` mutation except in `readContext` tests (which should save/restore env).

- [ ] Run `pnpm test tests/nested-context.test.ts` — all tests pass.

- [ ] Run full suite: `pnpm check` (lint + typecheck + tests) — passes cleanly.

---

## Verification Checklist

- [ ] `pnpm run lint` passes (biome)
- [ ] `pnpm run typecheck` passes (tsc --noEmit)
- [ ] `pnpm run test` passes (vitest run) — both `tests/subagent.test.ts` and `tests/nested-context.test.ts`
- [ ] No public interface changes: `src/core/subagent.ts` still exports the same set of names consumed by `src/index.ts`
- [ ] `src/core/nested-context.ts` does not import from `./subagent.js` (no circular dependency)
- [ ] The 16 env-var constants are not exported from `nested-context.ts` — they are implementation details
- [ ] `grep -r "PI_SUBAGENT_" src/` only finds hits in `src/core/nested-context.ts`

---

## Risk Notes

- **Circular dependency:** `nested-context.ts` must not import from `subagent.ts`. The `NestedContextRuntimeDeps` minimal interface avoids this. If `SubagentRuntimeDeps` evolves to include more methods, the minimal interface protects nested-context from churn.
- **`listAvailableAgents` helper:** Used by `validateDelegation()` in error messages. Rather than importing it from `subagent.ts` (circular), inline the logic (`discovery.agents.map(a => a.name).join(", ") || "none"`) directly in the new module.
- **`process.env` in tests:** `readContext()` reads from `process.env`. Tests must either stub `process.env` entries and restore them, or the function should accept an optional `env` parameter for testing. Prefer adding an internal-only `env` param with `process.env` as default — keeps the public API unchanged while enabling hermetic tests.
