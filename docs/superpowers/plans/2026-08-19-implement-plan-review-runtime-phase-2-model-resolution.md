# Implement Plan Review Runtime — Phase 2: Model Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve explicit model requests to authenticated Pi model objects and validate explicit thinking levels without fallback or clamping.

**Architecture:** Keep the legacy metadata-only `resolveModel()` unchanged for its existing RPC and scheduling callers. Add a registry-facing resolver that selects one canonical model from Pi’s active registry, checks that it is available, and returns the actual object from `find()`. Keep thinking capability validation as a separate helper so phase 4 and phase 5 can validate an already-selected model without coupling selection to execution precedence.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Current Repository Fit

- `src/core/model-resolver.ts` currently returns `{ id, provider }` metadata and uses first-match fuzzy behavior. Existing callers must keep that function and behavior.
- `src/shared/thinking.ts` already exports `normalizeThinkingLevel()` and `ChainThinkingLevel`; reuse it instead of adding another lexical vocabulary or normalizer.
- `src/core/model-scope.ts` already accepts canonical string IDs. Scope integration belongs to phase 5, after effective chain behavior and preflight traversal exist.
- Pi’s `ExtensionContext.modelRegistry` is the active synchronous registry. Its `getAll()` and `getAvailable()` return model metadata/objects, and `find(provider, id)` returns the runtime model object.

## Reference Alignment

- Pi’s `ModelRegistry` exposes synchronous `getAll()`, `getAvailable()`, and `find()`. Pi AI exports `getSupportedThinkingLevels(model)` and defines the runtime object as `Model<Api>`.
- `nicobailon-pi-subagents` separates canonical model metadata from runtime selection, normalizes model segments, and never switches providers for a qualified request.
- `tintinweb-pi-subagents` resolves against available models and passes the actual `Model` object into the runner rather than a `{ provider, id }` copy.

## Global Constraints

- The registry resolver receives a required `ModelRegistryLike`; missing-registry handling is owned by the later runtime entrypoint tasks.
- Match candidates from `getAll()` before applying availability from `getAvailable()`. A model that exists but is not available must report unavailable; a query with multiple matches must report ambiguous even if only one match is available.
- Matching is case-insensitive and trims surrounding whitespace. Exact provider/ID wins, then exact ID, then a unique fuzzy ID/name match.
- A qualified `provider/id` query never falls back to another provider. If the first segment is not a registered provider, treat the full value as an ID/name so owner/name-style IDs remain valid.
- Return the exact object from `registry.find(provider, id)`. Never reconstruct a model object from metadata.
- Explicit unsupported thinking levels throw. Never call Pi’s clamping helper and never silently fall back to the parent model.
- Preserve the existing `resolveModel(query, models): ResolvedModel | undefined` signature and behavior.

---

### Task 1: Add Strict Registry Model Selection

**Files:**

- Modify: `src/core/model-resolver.ts`
- Test: `tests/model-resolver.test.ts`

**Interfaces:**

```ts
import type { Api, Model } from "@earendil-works/pi-ai";

export interface ModelRegistryLike {
  getAll(): ModelInfo[];
  getAvailable(): ModelInfo[];
  find(provider: string, id: string): Model<Api> | undefined;
}

export interface ResolvedModelSelection {
  requested: string;
  canonical: string;
  model: Model<Api>;
}

export function resolveModelSelection(
  requested: string,
  registry: ModelRegistryLike,
): ResolvedModelSelection;
```

- [ ] **Step 1: Add failing registry fixtures and selection tests.**

  Keep the existing `mockModels` tests unchanged. Add a registry fixture whose `getAll()` contains:
  - `openai-codex/gpt-5.6-luna`, returned by `find()` as `sentinelModel`;
  - `openai/gpt-5.6-luna`, also matching the fuzzy term `luna`;
  - one model present in `getAll()` but absent from `getAvailable()`.

  Add assertions for these named cases:

  ```ts
  expect(resolveModelSelection("openai-codex/gpt-5.6-luna", registry)).toEqual({
    requested: "openai-codex/gpt-5.6-luna",
    canonical: "openai-codex/gpt-5.6-luna",
    model: sentinelModel,
  });
  expect(resolveModelSelection("gpt-5.6-luna", uniqueIdRegistry).model).toBe(
    sentinelModel,
  );
  expect(resolveModelSelection("Claude Sonnet", namedRegistry).canonical).toBe(
    "anthropic/claude-sonnet-4-20250514",
  );
  expect(() => resolveModelSelection("luna", registry)).toThrow(/ambiguous/i);
  expect(() => resolveModelSelection("unavailable", registry)).toThrow(
    /unavailable/i,
  );
  expect(() => resolveModelSelection("missing", registry)).toThrow(/unknown/i);
  expect(() => resolveModelSelection("   ", registry)).toThrow(/non-empty/i);
  ```

  Cast only the minimal test sentinel fixture to `Model<Api>`; the production return type must remain `Model<Api>`.

- [ ] **Step 2: Run the focused resolver tests and confirm the new assertions fail.**

  ```bash
  pnpm vitest run tests/model-resolver.test.ts
  ```

  Expected: the existing metadata tests pass and the new registry tests fail because `resolveModelSelection()` does not exist.

- [ ] **Step 3: Implement the smallest registry resolver.**

  In `src/core/model-resolver.ts`:
  1. Trim and case-fold the request; reject blank input.
  2. Build canonical candidate keys from `registry.getAll()`, deduplicated by lowercased `provider/id`.
  3. Select one candidate in this order: exact qualified provider/ID, exact ID, then unique fuzzy ID/name. For fuzzy matching, normalize case and cosmetic `.`, `_`, and repeated `-` separators; compare the normalized query against the model ID and optional display name. Restrict qualified queries to their named provider.
  4. Throw an ambiguity error listing canonical candidates when more than one canonical candidate matches.
  5. Compare the selected canonical key against `registry.getAvailable()`. Throw an unavailable error if it is absent.
  6. Call `registry.find(selected.provider, selected.id)`. Throw if the active registry cannot return the selected runtime object.
  7. Return `{ requested, canonical: `${provider}/${id}`, model }`, preserving the trimmed request and the registry’s canonical provider/ID spelling.

  Do not modify `resolveModel()` or `src/core/model-scope.ts`.

- [ ] **Step 4: Run the resolver tests and verify the selection contract.**

  ```bash
  pnpm vitest run tests/model-resolver.test.ts
  ```

  Expected: all metadata and registry-selection tests pass, including sentinel object identity, exact-match precedence, unique fuzzy matching, ambiguity, unknown, unavailable, and blank-request errors.

- [ ] **Step 5: Commit registry selection.**

  ```bash
  git add src/core/model-resolver.ts tests/model-resolver.test.ts
  git commit -m "feat: resolve configured models through Pi registry"
  ```

### Task 2: Add Strict Thinking Capability Validation

**Files:**

- Modify: `src/core/model-resolver.ts`
- Test: `tests/model-resolver.test.ts`

**Interfaces:**

```ts
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ChainThinkingLevel } from "../shared/thinking.js";

export function validateModelThinking(
  model: Model<Api>,
  canonical: string,
  requested: unknown,
): ChainThinkingLevel | undefined;
```

- [ ] **Step 1: Add failing capability-validation tests.**

  Use one reasoning model whose `thinkingLevelMap` exposes `max`, one reasoning model without `max`, and one non-reasoning model. Add assertions for:
  - `undefined` returns `undefined` and preserves omission;
  - `" HIGH "` returns `"high"`;
  - explicit `"off"` succeeds for the non-reasoning model;
  - `"max"` succeeds only for the model exposing `max`;
  - unsupported `"max"`/`"xhigh"` throws an error containing the requested level, canonical model, and supported levels;
  - an invalid lexical value throws the existing accepted-level error from `normalizeThinkingLevel()`.

- [ ] **Step 2: Run the capability tests and confirm failure.**

  ```bash
  pnpm vitest run tests/model-resolver.test.ts
  ```

  Expected: the new validation assertions fail because `validateModelThinking()` does not exist.

- [ ] **Step 3: Implement validation using the existing helpers.**

  Return `undefined` for an omitted request. Otherwise call `normalizeThinkingLevel(requested, "model " + canonical)`, call Pi’s `getSupportedThinkingLevels(model)`, and require the normalized level to be included. Throw an error that names the requested level, canonical model, and comma-separated supported levels when the capability check fails. Do not clamp or replace the request.

- [ ] **Step 4: Run resolver, scope, and type checks.**

  ```bash
  pnpm vitest run tests/model-resolver.test.ts tests/model-scope.test.ts
  pnpm typecheck
  ```

  Expected: all focused tests pass and TypeScript accepts the actual `Model<Api>` registry object passed to Pi’s capability helper. `tests/model-scope.test.ts` is a regression check only; it is not modified by this phase.

- [ ] **Step 5: Commit strict thinking validation.**

  ```bash
  git add src/core/model-resolver.ts tests/model-resolver.test.ts
  git commit -m "feat: validate model thinking capabilities"
  ```

## Phase Result

Phase 2 exposes two composable runtime primitives: explicit model strings resolve deterministically to authenticated Pi model objects, and explicit thinking levels normalize and fail strictly against the selected model’s real capabilities. Phase 4 owns forwarding; phase 5 owns chain-wide preflight and canonical scope enforcement.
