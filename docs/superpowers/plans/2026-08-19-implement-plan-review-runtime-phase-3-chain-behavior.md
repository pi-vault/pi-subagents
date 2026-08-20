# Implement Plan Review Runtime — Phase 3: Chain Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chain execution shape calculate and forward its effective raw model and thinking settings.

**Architecture:** Extend the existing chain behavior resolver and the three execution branches—sequential, static parallel, and dynamic parallel. Phase 3 resolves only step overrides against agent-definition defaults and emits raw strings through `StepSpawnOptions`; Phase 4 owns parent-model fallback, registry lookup, model objects, and session forwarding.

**Tech Stack:** TypeScript, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Current Repository Fit

- Phase 1 already adds `thinking?: ChainThinkingLevel` to sequential steps, static parallel items, and dynamic templates, and normalizes authored values before execution.
- Phase 2 already provides strict registry model selection and model-capability thinking validation; neither belongs in this phase.
- `AgentDefinition` already has `model?: string` and `thinking?: string`.
- `src/core/chain-execution.ts` currently resolves only `skills` defaults and forwards only step model strings. Its three builders are the complete raw behavior boundary for this phase.
- `SpawnOptions` already accepts `model?: unknown` and `thinking?: string`; Phase 4 will map the raw chain options to that runtime contract.

## Reference Alignment

- `tintinweb-pi-subagents/src/agent-runner.ts` resolves explicit option → agent configuration → parent model and passes the selected model object plus `thinkingLevel` to the session. This phase stops before that runtime resolution.
- `nicobailon-pi-subagents/src/runs/shared/parallel-utils.ts` models each runner step with raw `model?: string` and `thinking?: string`; its foreground executor resolves effective launch values separately. This phase follows the same authored-versus-runtime split.
- `pi/packages/coding-agent/src/core/model-registry.ts` exposes synchronous `getAll()`, `getAvailable()`, and `find()`, while `pi/packages/ai/src/models.ts` owns thinking capability discovery. Those APIs remain Phase 2/4 concerns.

## Global Constraints

- For this phase, effective raw precedence is step override, then agent definition. If both are omitted, leave the option undefined so Phase 4 can apply the parent-model/session fallback.
- `StepSpawnOptions.model` remains a requested raw model string, and `StepSpawnOptions.thinking` remains a raw/normalized thinking string. Do not resolve registry objects, validate model capabilities, clamp thinking, or create sessions here.
- Preserve existing output, progress, tools, budgets, isolation, concurrency, cancellation, and chain-status behavior.
- Do not modify chain schema/types, serializer/parser code, `/chain` or `subagent` dispatch wrappers, `AgentManager`, `agent-runner`, or model resolution in this phase.
- Set `model` and `thinking` when their effective values are defined; do not use truthiness checks that accidentally change the raw contract.

---

### Task 1: Propagate Raw Chain Behavior

**Files:**

- Modify: `src/core/chain-settings.ts`
- Modify: `src/core/chain-execution.ts`
- Test: `tests/chain-execution.test.ts`

**Interfaces:**

```ts
export interface StepSpawnOptions {
  toolBudget?: ResolvedToolBudget;
  isolation?: "worktree";
  skills?: string[];
  model?: string;
  thinking?: string;
  parentSignal?: AbortSignal;
}

export interface StepOverrides {
  output?: string | false;
  outputMode?: OutputMode;
  reads?: string[] | false;
  progress?: boolean;
  skills?: string[] | false;
  model?: string;
  thinking?: string;
}

export interface ResolvedStepBehavior {
  output: string | false;
  outputMode: OutputMode;
  reads: string[] | false;
  progress: boolean;
  skills: string[] | false;
  model?: string;
  thinking?: string;
}

export interface AgentBehaviorDefaults {
  output?: string | false;
  reads?: string[] | false;
  progress?: boolean;
  skills?: string[] | false;
  model?: string;
  thinking?: string;
}
```

- [ ] **Step 1: Extend the test agent fixture and add failing precedence tests.**

  Let the `makeAgentDef` test helper accept `Partial<AgentDefinition>` overrides. Use an agent with:

  ```ts
  { model: "agent/model", thinking: "medium" }
  ```

  Capture the fourth `spawnAndWait` argument and cover each execution shape:
  - Sequential: run one step with `model: "step/model"` and `thinking: "high"`, followed by an omitted step. Assert the captured options are respectively `{ model: "step/model", thinking: "high" }` and `{ model: "agent/model", thinking: "medium" }`.
  - Static parallel: run two items for the same agent, one with both overrides and one omitted. Use `concurrency: 1` so call order is deterministic, then assert the same override/default pair.
  - Dynamic parallel: seed a named structured output with `{"items":["one"]}` and expand `/items`. Run the dynamic template once with both overrides and once without them; assert the first emits the step values and the second emits the agent defaults.

  Keep existing model-only and unrelated execution tests unchanged. The tests must assert that an omitted step receives agent defaults and that no model/thinking fields are invented when both sources omit them.

- [ ] **Step 2: Run the focused chain tests and confirm the new assertions fail.**

  ```bash
  pnpm vitest run tests/chain-execution.test.ts
  ```

  Expected: existing tests pass, while the new thinking/default assertions fail because `StepSpawnOptions` has no thinking field and `agentDefaults()` currently returns only skills.

- [ ] **Step 3: Add model and thinking to the behavior contract.**

  In `src/core/chain-settings.ts` and `src/core/chain-execution.ts`:
  1. Add `thinking?: string` to `StepOverrides`, `ResolvedStepBehavior`, and `AgentBehaviorDefaults`.
  2. Keep `model?: string` on all three interfaces and add `model: agentDef.model` plus `thinking: agentDef.thinking` to `agentDefaults()` in `src/core/chain-execution.ts`.
  3. Resolve both fields with nullish precedence:

  ```ts
  model: overrides.model ?? agentDefaults.model,
  thinking: overrides.thinking ?? agentDefaults.thinking,
  ```

  Preserve explicit authored values, including `"off"`, and preserve omission as `undefined`.

- [ ] **Step 4: Update all three spawn-option builders.**

  Add `thinking?: string` to `StepSpawnOptions`. Pass `thinking: <step>.thinking` into `resolveStepBehavior()` for sequential steps, static parallel items, and dynamic templates. In each branch, set both effective fields without mutating the agent definition:

  ```ts
  if (behavior.model !== undefined) options.model = behavior.model;
  if (behavior.thinking !== undefined) options.thinking = behavior.thinking;
  ```

  Retain the current skills, budget, isolation, parent-signal, prompt, result, and status handling exactly as-is.

- [ ] **Step 5: Run focused tests and type verification.**

  ```bash
  pnpm vitest run tests/chain-execution.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: all chain-execution tests pass, TypeScript accepts the new raw option, and the diff has no whitespace errors.

- [ ] **Step 6: Commit the phase.**

  ```bash
  git add src/core/chain-settings.ts src/core/chain-execution.ts tests/chain-execution.test.ts
  git commit -m "feat: propagate raw chain model and thinking settings"
  ```

## Phase Result

Every sequential, static-parallel, and dynamic-parallel execution branch emits the effective raw step/agent model and thinking values. Omitted values remain undefined for Phase 4 to resolve against the parent runtime; no registry, capability, wrapper, or session behavior changes in this phase.
