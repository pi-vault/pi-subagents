# Implement Plan Review Runtime — Phase 5: Chain Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject invalid effective chain models and thinking levels before stage 1, and before any later appended batch can spawn.

**Architecture:** Add one shared preflight traversal used by the saved/inline slash-chain path and the `subagent` chain path. It reuses phase 2's strict registry resolver and thinking validator plus phase 4's effective precedence, scans sequential/static-parallel/dynamic-template tasks, and runs after final clarification edits. Pass the same preflight callback into `executeChain` so appended batches are checked immediately before they are added to the executable sequence.

**Tech Stack:** TypeScript, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Current Repository Fit

- Phase 2 already provides `resolveModelSelection()` and `validateModelThinking()` in `src/core/model-resolver.ts`; do not add another resolver or capability vocabulary.
- Phase 3 emits raw effective `model`, `modelSource`, and `thinking` values from all three `chain-execution.ts` builders. Phase 4 resolves those values again at each spawn boundary.
- `slash-chain.ts` and `subagent.ts` currently normalize and validate agent names before clarification, then execute foreground/background chains. Shared model preflight must be a separate call after the final clarification normalization.
- `subagent.ts` still performs a raw-string model-scope check inside its chain `spawnAndWait` closure. Phase 5 must remove that chain-only check after canonical preflight is wired, or inherited warnings will duplicate and fuzzy names can be classified against the wrong string. Keep the single-agent scope check unchanged.
- `executeChain()` consumes `chain_append` batches after a completed stage. The entrypoints must pass it a preflight callback so an invalid appended batch fails before its first child spawn; the append queue remains responsible only for structural/output-reference validation.

## Reference Alignment

- `nicobailon-pi-subagents/src/runs/shared/model-fallback.ts` resolves explicit → agent-definition → parent values, distinguishes explicit versus inherited scope decisions, and refuses unresolved explicit models instead of silently inheriting the parent. Reuse the local phase-2 strictness; do not copy its fallback behavior for invalid explicit values.
- `nicobailon-pi-subagents/src/runs/shared/parallel-utils.ts` keeps raw `model` and `thinking` on each sequential/parallel runner task, including one shared template for dynamic fan-out. Validate the dynamic template once; do not expand items or consume spawn budget during preflight.
- `tintinweb-pi-subagents/src/agent-runner.ts` passes an actual registry model object into the session and uses explicit → configured → parent precedence. The local phase-4 runner already owns this runtime selection; preflight only validates the same effective choice.
- `pi/packages/coding-agent/src/core/model-registry.ts` exposes synchronous `getAll()`, `getAvailable()`, and `find(provider, id)`. `pi/packages/ai/src/models.ts` exposes `getSupportedThinkingLevels(model)`; never use Pi's clamping helper for an authored request.

## Global Constraints

- Initial `/chain`, `/run-chain`, and `subagent.chain` requests must reject unknown, ambiguous, unavailable, registry-missing, unsupported-thinking, and explicit scope-blocked models before stage 1 and before `fireAndForgetChain`.
- Every appended batch must run the same callback before `executeChain()` adds it to the executable sequence. A structurally valid append may be accepted into the queue first; a model/thinking failure must still prevent that batch from spawning.
- Effective raw precedence is `step.model ?? agentDef.model`; if both are omitted, use the actual parent model only for thinking validation and preserve existing parent/default execution behavior.
- A pure parent-model inheritance path does not add a new model-scope warning; this preserves the current chain behavior. An agent-definition model is inherited and warns, while a step model is explicit and throws on violation.
- Errors identify the chain location (`step N`, parallel item, or dynamic template), agent name, and the underlying requested/canonical model where available.
- Dynamic preflight validates the template once. It does not expand runtime items, mutate chain definitions, allocate chain directories, consume spawn budget, or execute acceptance commands.
- Interactive clarification is complete before preflight runs. If clarification edits are invalid, return through the existing normalization error path without invoking model lookup.

---

### Task 1: Implement Shared Chain Preflight

**Files:**

- Create: `src/core/chain-preflight.ts`
- Test: `tests/chain-preflight.test.ts`

**Interfaces:**

```ts
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentDefinition, ChainStep } from "../shared/types.js";
import type { ModelRegistryLike } from "./model-resolver.js";
import type { ModelScopeConfig, ModelScopeViolation } from "./model-scope.js";

export interface ChainPreflightOptions {
  registry?: ModelRegistryLike;
  parentModel?: Model<Api>;
  modelScope?: ModelScopeConfig;
  onScopeWarning?: (warning: ModelScopeViolation) => void;
}

export function preflightChainModels(
  steps: ChainStep[],
  findAgent: (name: string) => AgentDefinition,
  options: ChainPreflightOptions,
): void;
```

- [ ] **Step 1: Add failing no-spawn and precedence tests.**

  Create `tests/chain-preflight.test.ts` with a registry fixture returning distinct runtime-model sentinels. Cover sequential, static parallel, and dynamic-template tasks. Assert that step override beats agent-definition model, agent-definition model beats the parent, and omission preserves the parent/default path.

  Add invalid cases for unknown, ambiguous, unavailable, missing registry, unsupported thinking, and explicit out-of-scope models. Use a `spawned = false` sentinel in the integration-shaped cases, assert the helper throws, and assert it remains false. Add a valid pure-parent case, a requested-thinking-with-parent case, and an inherited out-of-scope case that reaches `onScopeWarning` instead of throwing.

  Assert failures contain the step location and agent name; scope messages use canonical `provider/id`, not the fuzzy/raw request.

- [ ] **Step 2: Run the new tests and confirm failure.**

  ```bash
  pnpm vitest run tests/chain-preflight.test.ts
  ```

  Expected: FAIL because no shared traversal exists.

- [ ] **Step 3: Implement the smallest traversal.**

  Normalization is owned by the callers; this helper receives normalized `ChainStep[]`. Traverse sequential steps, each static parallel item, and each dynamic parallel template. Resolve each agent with `findAgent()` and use a location label such as `step 2 parallel item 1 (worker)` or `step 3 dynamic template (worker)` for every wrapped error, including unknown-agent failures.

  For each task:
  1. Compute `rawModel = task.model ?? agentDef.model` with `!== undefined` semantics. If it is defined, require `options.registry`, call `resolveModelSelection(rawModel, registry)`, and select its returned runtime model/canonical ID. Never fall back to the parent after an explicit/configured resolution failure.
  2. Otherwise, select `options.parentModel` when present and derive its canonical `provider/id`. If no model is selected and the effective thinking value is omitted, continue without registry access. If thinking is requested without a selected model, throw a contextual error before execution.
  3. Validate `task.thinking ?? agentDef.thinking` with `validateModelThinking()` against the selected model. Preserve explicit `off`; do not clamp or invent a value.
  4. Run `checkModelScope()` only for a configured raw model: source is `explicit` when `task.model` is defined, otherwise `inherited` for `agentDef.model`. Throw contextual explicit violations and send contextual inherited warnings through `onScopeWarning`.

  Wrap resolver, thinking, and scope errors without losing their original detail. The helper must not mutate the steps or agent definitions.

- [ ] **Step 4: Run the focused helper tests.**

  ```bash
  pnpm vitest run tests/chain-preflight.test.ts
  pnpm typecheck
  ```

  Expected: all task shapes, precedence, strict failures, canonical scope handling, and parent fallback cases pass.

### Task 2: Wire Preflight to Initial, Background, and Appended Execution

**Files:**

- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/chain-execution.ts`
- Test: `tests/slash-chain.test.ts`
- Test: `tests/subagent-chain.test.ts`
- Test: `tests/chain-execution.test.ts`

**Interfaces:**

```ts
export interface ChainExecutionParams {
  // existing fields...
  preflightChain?: (steps: ChainStep[]) => void;
}
```

- [ ] **Step 1: Add failing entrypoint and append regressions.**

  In `subagent-chain.test.ts` and `slash-chain.test.ts`, assert that an invalid initial chain does not call `spawnAndWait` and does not call `fireAndForgetChain` for background execution. Add a clarification case where the edited chain is valid/invalid and verify preflight runs only after the final normalized edit. Keep existing runtime model-forwarding assertions.

  In `chain-execution.test.ts`, pass a preflight callback for an appended batch, make it throw for that batch, and assert the first stage runs but the appended stage never calls `spawnAndWait`.

- [ ] **Step 2: Run the focused regressions and confirm failure.**

  ```bash
  pnpm vitest run tests/slash-chain.test.ts tests/subagent-chain.test.ts tests/chain-execution.test.ts
  ```

  Expected: invalid initial chains currently reach the runtime spawn boundary, and appended steps have no preflight callback.

- [ ] **Step 3: Wire the shared callback at both entrypoints.**

  Keep the existing structural normalization/agent-name validation before clarification. Build one entrypoint-local callback around `preflightChainModels()` using `ctx.modelRegistry`, `ctx.model`, `settings.modelScope`, and a warning handler that emits the existing `model_scope_warning` message. Invoke it after the final clarification normalization and before either foreground `executeChain()` or background `fireAndForgetChain()`. Catch initial preflight errors through the existing command/tool result path and return without dispatching the chain.

  Pass the same callback as `preflightChain` into every foreground/background `executeChain()` call. In `executeChain()`, call it on the batch returned by `consumeChainAppendRequests()` before pushing that batch into `chainSteps` or resolving its templates. Let the existing `finally`/manager lifecycle report an appended-batch preflight failure.

- [ ] **Step 4: Remove only the duplicate raw chain scope check.**

  Delete the chain-specific `checkModelScope(stepModel, ...)` block inside `subagent.ts`'s chain `spawnAndWait` closure; canonical scope preflight now owns it. Leave the single-agent scope block and all phase-4 model/thinking resolution intact. Do not change `chain-append.ts`'s structural validation or the model resolver.

- [ ] **Step 5: Run wrapper, append, and type regressions.**

  ```bash
  pnpm vitest run \
    tests/chain-preflight.test.ts \
    tests/chain-execution.test.ts \
    tests/chain-append.test.ts \
    tests/subagent-chain.test.ts \
    tests/slash-chain.test.ts \
    tests/model-scope.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: invalid initial and appended batches fail before their first child spawn; valid foreground, background, clarification, inherited-parent, and model-scope flows remain intact.

- [ ] **Step 6: Commit the phase.**

  ```bash
  git add src/core/chain-preflight.ts src/core/slash-chain.ts src/core/subagent.ts src/core/chain-execution.ts \
    tests/chain-preflight.test.ts tests/slash-chain.test.ts tests/subagent-chain.test.ts tests/chain-execution.test.ts
  git commit -m "feat: preflight chain models before execution"
  ```

## Phase Result

Initial chain submissions and subsequently appended batches fail safely before any invalid child stage spawns. Every sequential, static-parallel, and dynamic-template task uses the same strict model/thinking selection and canonical scope rules, while pure parent-model inheritance and existing valid execution behavior remain unchanged.
