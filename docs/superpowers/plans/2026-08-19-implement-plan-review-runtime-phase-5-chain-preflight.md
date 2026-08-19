# Implement Plan Review Runtime — Phase 5: Chain Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject invalid effective chain models and thinking levels before any chain stage spawns.

**Architecture:** Add one shared preflight traversal used by both saved/inline slash-chain execution and the `subagent` chain path. It reuses phase 2’s resolver and phase 4’s effective dispatch rules, scans every task shape, and runs after final clarification edits but before foreground or background execution.

**Tech Stack:** TypeScript, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Global Constraints

- Unknown, ambiguous, unavailable, unsupported, and explicit scope-blocked requests fail before stage 1.
- Chains that only inherit the parent model retain existing parent-model behavior.
- Preflight does not spawn agents, mutate chain definitions, or execute acceptance commands.
- Interactive clarification is complete before preflight runs.

---

### Task 1: Implement Shared Chain Preflight

**Files:**

- Create: `src/core/chain-preflight.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Test: `tests/chain-preflight.test.ts`

**Interfaces:**

```ts
import type { AgentDefinition, ChainStep } from "../shared/types.js";
import type { ModelRegistryLike } from "./model-resolver.js";
import type { ModelScopeConfig, ModelScopeViolation } from "./model-scope.js";

interface ChainPreflightOptions {
  registry?: ModelRegistryLike;
  parentModel?: unknown;
  modelScope?: ModelScopeConfig;
  onScopeWarning?: (warning: ModelScopeViolation) => void;
}

function preflightChainModels(
  steps: ChainStep[],
  findAgent: (name: string) => AgentDefinition,
  options: ChainPreflightOptions,
): void;
```

- [ ] **Step 1: Add failing no-spawn tests.**

  Cover unknown, ambiguous, unavailable, unsupported-thinking, and explicit scope-blocked models. Set `spawned = false`, invoke preflight, assert it throws, and assert `spawned` remains false. Add a valid inherited-parent case.

- [ ] **Step 2: Run the new test and confirm failure.**

  ```bash
  pnpm vitest run tests/chain-preflight.test.ts
  ```

  Expected: FAIL because no shared preflight exists.

- [ ] **Step 3: Traverse all chain task shapes.**

  Scan sequential steps, static parallel items, and dynamic templates. For each task resolve `step.model ?? agentDef.model`, validate effective thinking against the selected actual model, and preserve the step number and agent name in errors.

- [ ] **Step 4: Preserve canonical model-scope behavior.**

  Call `checkModelScope` with canonical `provider/id`; send inherited warnings through `onScopeWarning` and throw explicit violations.

- [ ] **Step 5: Invoke preflight at both chain entrypoints.**

  Run after final normalization/clarification and immediately before foreground execution or `fireAndForgetChain` in both `slash-chain.ts` and `subagent.ts`.

- [ ] **Step 6: Run preflight and wrapper regressions.**

  ```bash
  pnpm vitest run tests/chain-preflight.test.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts
  ```

  Expected: invalid chains fail before the first `spawnAndWait`; valid foreground, background, and clarification flows remain intact.

- [ ] **Step 7: Commit the phase.**

  ```bash
  git add src/core/chain-preflight.ts src/core/slash-chain.ts src/core/subagent.ts tests/chain-preflight.test.ts
  git commit -m "feat: preflight chain models before execution"
  ```

## Phase Result

All chain entrypoints fail safely before stage 1 when effective model or thinking configuration is invalid.
