# Implement Plan Review Runtime — Phase 2: Model Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a tested resolver that converts explicit model requests into canonical IDs and actual Pi model objects with strict availability and thinking-capability checks.

**Architecture:** Extend the existing metadata resolver with a registry-facing function. Exact provider/ID and exact ID matches take priority; fuzzy matches must be unique. The resolver uses Pi’s registry and capability helpers rather than duplicating SDK model data.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Global Constraints

- Use `getAll()`, `getAvailable()`, and `find()` from Pi’s active model registry.
- Explicit unknown, ambiguous, unavailable, or unsupported requests must throw; do not silently fall back or clamp.
- Preserve `resolveModel(query, models): ResolvedModel | undefined` for existing callers.
- Keep model-scope matching canonical and string-based.

---

### Task 1: Implement Registry Model Selection

**Files:**

- Modify: `src/core/model-resolver.ts`
- Test: `tests/model-resolver.test.ts`
- Test: `tests/model-scope.test.ts`

**Interfaces:**

```ts
export interface ModelRegistryLike {
  getAll(): ModelInfo[];
  getAvailable(): ModelInfo[];
  find(provider: string, id: string): unknown | undefined;
}

export interface ResolvedModelSelection {
  requested: string;
  canonical: string;
  model: unknown;
}

export function resolveModelSelection(
  requested: string,
  registry: ModelRegistryLike,
): ResolvedModelSelection;
```

- [ ] **Step 1: Add failing exact, fuzzy, ambiguity, availability, and identity tests.**

  Use a registry fixture with a sentinel model returned by `find()`. Assert exact `openai-codex/gpt-5.6-luna` returns the sentinel, fuzzy `luna` rejects multiple matches, unavailable models reject, and missing models reject.

- [ ] **Step 2: Run the resolver tests and confirm failure.**

  ```bash
  pnpm vitest run tests/model-resolver.test.ts
  ```

  Expected: new registry-object and ambiguity assertions fail.

- [ ] **Step 3: Implement exact and unique-fuzzy resolution.**

  Resolve in this order: exact provider/ID, exact ID, unique fuzzy ID/name. Reject zero or multiple matches, require availability, build `provider/id`, and return the object from `registry.find()`.

- [ ] **Step 4: Add strict thinking capability validation.**

  Reuse phase 1’s lexical normalizer and call `getSupportedThinkingLevels(model)` from `@earendil-works/pi-ai`. Reject explicit unsupported values with the requested level, canonical model, and supported levels in the error.

- [ ] **Step 5: Run resolver and scope regressions.**

  ```bash
  pnpm vitest run tests/model-resolver.test.ts tests/model-scope.test.ts
  ```

  Expected: all resolver and existing canonical scope tests pass.

- [ ] **Step 6: Commit the phase.**

  ```bash
  git add src/core/model-resolver.ts tests/model-resolver.test.ts
  git commit -m "feat: resolve configured models through Pi registry"
  ```

## Phase Result

Runtime code can deterministically resolve an explicit request to `{ requested, canonical, model }` and reject invalid thinking/model combinations. No caller uses this result yet.
