# Implement Plan Review Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime support for per-step model and thinking propagation so the saved `implement-plan-review` chain runs each stage with its configured Pi model and thinking level.

**Architecture:** Keep model and thinking values as strings in agent and chain definitions, then resolve explicit models once against Pi's active registry into actual `Model` objects at the runtime boundary. Share the resolver and preflight logic across single-agent, inline-chain, saved-chain, sequential, parallel, and dynamic execution paths; keep the saved chain as the integration artifact produced by those capabilities.

**Tech Stack:** TypeScript, Pi Coding Agent SDK `@earendil-works/pi-coding-agent`, Pi AI model registry, Vitest, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

## Global Constraints

- Use the existing `@pi-vault/pi-subagents` package and its bundled agents.
- Use canonical saved-chain models `openai-codex/gpt-5.6-luna` and `minimax/MiniMax-M3`.
- Resolve explicit models before stage 1; unknown, ambiguous, unavailable, or unsupported requests must fail without spawning a stage.
- Pass the actual Pi `Model` object to session creation; never pass a model query string as the session model.
- Effective precedence is step override, then agent definition, then parent model.
- Keep stages sequential, independent, and in the current working tree; do not inherit the parent conversation or create a worktree.
- Review all current dirty changes with `git diff HEAD`; do not create automatic commits, retries, rollback, or recovery behavior.
- Stage 1 may edit only the supplied plan; review stages may edit product code but not the plan.
- `acceptance.command` remains definition metadata and is not executed by the runtime.
- Do not add dependencies, new agent roles, runtime acceptance gates, or parallelism.
- Preserve existing behavior when no model or thinking override is configured.

---

### Task 1: Add Thinking-Level Contracts and Parsing

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/chain-settings.ts`
- Modify: `src/core/chain-serializer.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Test: `tests/chain-serializer.test.ts`
- Test: `tests/slash-chain.test.ts`

**Interfaces:**

- Add `thinking?: string` to `SequentialStep`, `ParallelTaskItem`, `DynamicParallelTemplate`, `ChainStepConfig`, and inline chain configuration.
- Add `thinking?: string` to `StepOverrides`, `ResolvedStepBehavior`, `AgentBehaviorDefaults`, and `StepSpawnOptions`.
- Keep these fields string-valued at parsing/configuration boundaries; normalize them to lowercase runtime values.
- Accept exactly `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, case-insensitively.

- [ ] **Step 1: Add failing serializer tests for Markdown and JSON thinking fields.**

  Extend `tests/chain-serializer.test.ts` with a Markdown fixture containing `thinking: MAX` and a JSON fixture containing `thinking: "High"`. Assert both normalize to lowercase and that serialization emits the normalized value.

  Also add invalid cases for `thinking: extreme`, `thinking: ""`, and non-string JSON values; assert the error identifies the step and the accepted values.

- [ ] **Step 2: Run the focused serializer tests and confirm the new assertions fail.**

  Run:

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts
  ```

  Expected: existing tests pass and the new thinking assertions fail because the field is currently rejected or discarded.

- [ ] **Step 3: Add the thinking field to all parser and behavior types.**

  Update the recognized field sets in `chain-serializer.ts`, parse `thinking:` in `.chain.md`, include it in JSON normalization/serialization, and add `thinking=<level>` to `parseInlineConfig`. Reuse one normalization function so saved and inline chains have identical validation.

- [ ] **Step 4: Thread thinking through behavior resolution.**

  Update `resolveStepBehavior` so `overrides.thinking ?? agentDefaults.thinking` is returned. Add `thinking` to the inline-to-step mapping and to the TypeBox chain task schema used by the `subagent` tool.

- [ ] **Step 5: Run the focused tests and confirm they pass.**

  Run:

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/slash-chain.test.ts
  ```

  Expected: all focused parser, serializer, normalization, and inline-thinking tests pass.

- [ ] **Step 6: Commit the parsing contract.**

  ```bash
  git add src/shared/types.ts src/core/chain-settings.ts src/core/chain-serializer.ts src/core/slash-chain.ts src/core/subagent.ts tests/chain-serializer.test.ts tests/slash-chain.test.ts
  git commit -m "feat: add chain thinking configuration"
  ```

### Task 2: Implement Pi Model Resolution and Capability Validation

**Files:**

- Modify: `src/core/model-resolver.ts`
- Test: `tests/model-resolver.test.ts`

**Interfaces:**

- Preserve `resolveModel(query, models): ResolvedModel | undefined` for canonical metadata and existing callers.
- Add a registry-facing resolver with this contract:

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

- The returned `model` must be the actual object returned by `registry.find`, not `{ provider, id }` metadata.
- Add one shared thinking normalizer and one capability check using Pi's supported thinking levels; explicit unsupported levels must throw instead of relying on Pi's native clamping.
- Import `getSupportedThinkingLevels` from `@earendil-works/pi-ai`; do not duplicate Pi's model-capability table.

- [ ] **Step 1: Add failing resolver tests for exact, fuzzy, ambiguous, unavailable, and actual-object resolution.**

  Extend `tests/model-resolver.test.ts` with a registry fixture whose `getAll()` contains two models matching `"luna"`, whose `getAvailable()` contains only one canonical model, and whose `find()` returns a sentinel object. Assert:

  ```ts
  expect(resolveModelSelection("openai-codex/gpt-5.6-luna", registry)).toEqual({
    requested: "openai-codex/gpt-5.6-luna",
    canonical: "openai-codex/gpt-5.6-luna",
    model: sentinelModel,
  });
  expect(() => resolveModelSelection("luna", registry)).toThrow(/ambiguous/i);
  expect(() => resolveModelSelection("unavailable", registry)).toThrow(
    /available/i,
  );
  expect(() => resolveModelSelection("missing", registry)).toThrow(/unknown/i);
  ```

- [ ] **Step 2: Run the resolver tests and confirm the new cases fail.**

  Run:

  ```bash
  pnpm vitest run tests/model-resolver.test.ts
  ```

  Expected: the existing metadata tests pass and the new registry-object assertions fail because the current resolver has no registry object or ambiguity policy.

- [ ] **Step 3: Implement unique model selection against Pi's registry.**

  Use this precedence:
  1. exact `provider/id` match;
  2. exact model ID match;
  3. unique fuzzy ID/name match.

  Reject zero matches, multiple fuzzy matches, missing registry methods, and models absent from `getAvailable()`. Build the canonical string from the registry result and obtain the runtime object with `find(provider, id)`.

- [ ] **Step 4: Implement strict thinking normalization and capability checks.**

  Normalize case-insensitively to `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Use Pi's `getSupportedThinkingLevels(model)` for explicit values and throw an error naming the requested level, canonical model, and supported levels when the value is not supported.

- [ ] **Step 5: Preserve canonical model-scope matching.**

  Keep `checkModelScope` string-based and pass it the canonical `provider/id`, without a thinking suffix. Preserve explicit-model errors and inherited-model warnings.

- [ ] **Step 6: Run the focused resolver and scope tests.**

  ```bash
  pnpm vitest run tests/model-resolver.test.ts tests/model-scope.test.ts
  ```

  Expected: all tests pass, including actual-object identity and strict failure cases.

- [ ] **Step 7: Commit the resolver.**

  ```bash
  git add src/core/model-resolver.ts tests/model-resolver.test.ts
  git commit -m "feat: resolve configured models through Pi registry"
  ```

### Task 3: Propagate Effective Models and Thinking Through Execution

**Files:**

- Modify: `src/core/chain-settings.ts`
- Modify: `src/core/chain-execution.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/agent-runner.ts`
- Test: `tests/chain-execution.test.ts`
- Test: `tests/subagent-chain.test.ts`
- Test: `tests/subagent.test.ts`
- Test: `tests/agent-manager.test.ts`

**Interfaces:**

- `StepSpawnOptions` continues to carry the requested `model?: string`, gains `thinking?: string`, and carries `modelSource?: "explicit" | "inherited"` for the existing chain model-scope classification; it is the chain executor's raw behavior contract.
- `AgentManager.spawn`/`spawnAndWait` continue receiving `SpawnOptions.model?: unknown`; callers must provide the resolved Pi model object at the runtime boundary.
- `runAgent` must resolve any configured string fallback before calling `createAgentSession`, so `createAgentSession({ model })` always receives an actual model object.

- [ ] **Step 1: Add failing chain behavior tests for model and thinking precedence.**

  Extend `tests/chain-execution.test.ts` with an agent definition containing `model: "agent/model"` and `thinking: "medium"`. Execute sequential, static-parallel, and dynamic steps with and without overrides, and assert the captured options are:

  ```ts
  expect(received[0]).toMatchObject({ model: "step/model", thinking: "high" });
  expect(received[1]).toMatchObject({
    model: "agent/model",
    thinking: "medium",
  });
  ```

  Add equivalent assertions for each execution path.

- [ ] **Step 2: Run the chain execution tests and confirm the new assertions fail.**

  ```bash
  pnpm vitest run tests/chain-execution.test.ts
  ```

  Expected: current model tests pass, while thinking/default assertions fail because only skills and step model strings are currently propagated.

- [ ] **Step 3: Include agent model and thinking in chain defaults and all spawn-option builders.**

  Update `agentDefaults` to return `agentDef.model` and `agentDef.thinking`. Pass `thinking` into `resolveStepBehavior`, then set both `model` and `thinking` on sequential, static-parallel, and dynamic `StepSpawnOptions` when defined.

- [ ] **Step 4: Resolve and forward actual models in both chain dispatch wrappers.**

  In `executeSlashChain` and the `subagent` chain path, resolve the effective raw model with `resolveModelSelection` before calling `deps.manager.spawnAndWait`. Pass the returned `.model` object as `SpawnOptions.model` and the normalized thinking value as `SpawnOptions.thinking`. Do not rely on a temporary `AgentDefinition.model` string for session selection.

- [ ] **Step 5: Fix the single-agent runtime boundary.**

  In the single-agent path, resolve the effective model from `resolveInvocationConfig` and include the actual model object plus normalized thinking in `spawnOptions`. In `runAgent`, retain a fallback resolver for child/RPC callers that still provide an agent-definition model string, then pass the resolved object to `createAgentSession`.

- [ ] **Step 6: Add manager/session forwarding assertions.**

  Extend `tests/subagent.test.ts` and `tests/agent-manager.test.ts` with a sentinel model registry and assert that the same sentinel model object reaches `spawnAndWait` and the mocked `createAgentSession`, alongside the requested thinking level.

- [ ] **Step 7: Run all propagation tests.**

  ```bash
  pnpm vitest run tests/chain-execution.test.ts tests/subagent-chain.test.ts tests/subagent.test.ts tests/agent-manager.test.ts
  ```

  Expected: all sequential, parallel, dynamic, chain-wrapper, and single-agent forwarding tests pass.

- [ ] **Step 8: Commit runtime propagation.**

  ```bash
  git add src/core/chain-settings.ts src/core/chain-execution.ts src/core/slash-chain.ts src/core/subagent.ts src/core/agent-runner.ts tests/chain-execution.test.ts tests/subagent-chain.test.ts tests/subagent.test.ts tests/agent-manager.test.ts
  git commit -m "fix: propagate chain models and thinking levels"
  ```

### Task 4: Add Strict Chain Model Preflight

**Files:**

- Create: `src/core/chain-preflight.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/chain-execution.ts`
- Test: `tests/chain-preflight.test.ts`
- Test: `tests/slash-chain.test.ts`
- Test: `tests/subagent-chain.test.ts`
- Test: `tests/chain-execution.test.ts`

**Interfaces:**

- Add:

  ```ts
  import type { Api, Model } from "@earendil-works/pi-ai";
  import type { ModelRegistryLike } from "./model-resolver.js";

  interface ChainPreflightOptions {
    registry?: ModelRegistryLike;
    parentModel?: Model<Api>;
    modelScope?: ModelScopeConfig;
    onScopeWarning?: (warning: ModelScopeViolation) => void;
  }

  function preflightChainModels(
    steps: ChainStep[],
    findAgent: (name: string) => AgentDefinition,
    options: ChainPreflightOptions,
  ): void;
  ```

- `preflightChainModels` scans sequential steps, static parallel items, and dynamic templates. It resolves `step.model ?? agentDef.model`, validates effective thinking against the selected model, and invokes `checkModelScope` with the canonical model.
- It throws before any spawn when a configured model needs a missing registry, or for an unresolved/ambiguous model, unsupported thinking, or explicit scope violation. Chains that only inherit the parent model retain the existing parent-model behavior.
- The entrypoints pass a `preflightChain` callback into `executeChain`; appended batches run it before they are added to the executable sequence. Remove only the duplicate raw chain scope check in `subagent.ts`; keep the single-agent scope path and phase-4 runtime resolution.

- [ ] **Step 1: Add failing no-spawn preflight tests.**

  Create `tests/chain-preflight.test.ts` with valid precedence/parent cases and invalid cases for unknown, ambiguous, unavailable, missing registry, unsupported-thinking, and scope-blocked models. Use a `spawned = false` sentinel and assert it remains false when preflight throws. Add wrapper no-spawn coverage and an appended-batch callback regression in the listed tests.

- [ ] **Step 2: Run the new preflight test and confirm it fails.**

  ```bash
  pnpm vitest run tests/chain-preflight.test.ts
  ```

  Expected: FAIL because neither chain dispatch path currently performs complete preflight.

- [ ] **Step 3: Implement the shared preflight scan.**

  Traverse every effective task shape, look up its agent, resolve configured models with Task 2's resolver, validate thinking capability, and report step number, agent name, requested model, and canonical model in errors. Do not spawn or mutate the chain. Validate dynamic templates once and use the actual parent model only when needed for thinking validation.

- [ ] **Step 4: Invoke preflight after final chain normalization/clarification.**

  Call it in both `/run-chain`/`/chain` execution and `subagent` chain execution immediately before foreground execution or `fireAndForgetChain`. For interactive clarification, run it after the user-edited chain is normalized; for background execution, run it before launching the background callback. Pass the same callback into `executeChain` and invoke it for each consumed append batch before that batch is pushed into execution.

- [ ] **Step 5: Run preflight and regression tests.**

  ```bash
  pnpm vitest run tests/chain-preflight.test.ts tests/chain-execution.test.ts tests/chain-append.test.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/model-scope.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: invalid chains fail before the first `spawnAndWait`, while valid chains preserve existing clarification and background behavior.

- [ ] **Step 6: Commit preflight.**

  ```bash
  git add src/core/chain-preflight.ts src/core/slash-chain.ts src/core/subagent.ts src/core/chain-execution.ts tests/chain-preflight.test.ts tests/slash-chain.test.ts tests/subagent-chain.test.ts tests/chain-execution.test.ts
  git commit -m "feat: preflight chain models before execution"
  ```

### Task 5: Add the Expected Saved Chain and Worker Review Permission

**Files:**

- Create: `chains/implement-plan-review.chain.md`
- Modify: `agents/worker.md`
- Test: `tests/chain-serializer.test.ts`
- Test: `tests/subagent-chain.test.ts`

**Interfaces:**

- The saved chain is consumed by the existing `/run-chain <name> -- <task>` loader; it does not introduce a new chain format or execution API.
- Add `reviewer` to the worker's existing `subagent_agents` list so `requesting-code-review` can delegate to the bundled read-only reviewer.

- [ ] **Step 1: Add failing saved-chain discovery and execution tests.**

  Assert that the packaged chain is discoverable as `implement-plan-review`, contains four sequential `worker` steps, and has these exact model/thinking/skill assignments:

  ```ts
  expect(steps.map((step) => [step.model, step.thinking, step.skills])).toEqual(
    [
      ["openai-codex/gpt-5.6-luna", "max", ["brainstorming"]],
      ["minimax/MiniMax-M3", "high", ["test-driven-development"]],
      ["openai-codex/gpt-5.6-luna", "max", ["requesting-code-review"]],
      ["openai-codex/gpt-5.6-luna", "max", ["ponytail-review"]],
    ],
  );
  ```

- [ ] **Step 2: Run the saved-chain tests and confirm they fail.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/subagent-chain.test.ts
  ```

  Expected: FAIL because the new chain file does not yet exist.

- [ ] **Step 3: Create the saved chain with autonomous stage prompts.**

  Use this exact structure:

  ```markdown
  ---
  name: implement-plan-review
  description: Prepare, implement, and review a plan in the current working tree
  ---

  ## worker

  phase: Plan readiness
  label: Make plan implementation-ready
  model: openai-codex/gpt-5.6-luna
  thinking: max
  skills: brainstorming

  Read the repository and {task}. The chain invocation is already approved: do not pause for approval or ask the parent a question. Edit only {task} when it is incomplete, contradictory, or not implementation-ready. Do not modify product code. Return only after the plan is implementation-ready.

  ## worker

  phase: Implementation
  label: Implement the plan
  model: minimax/MiniMax-M3
  thinking: high
  skills: test-driven-development

  Read and follow {task}. Implement it directly in the current working tree without creating a worktree or replacing the plan with a new design. Run the plan's tests and relevant repository-native checks.

  ## worker

  phase: Correctness review
  label: Review and fix correctness issues
  model: openai-codex/gpt-5.6-luna
  thinking: max
  skills: requesting-code-review

  Read {task}, inspect git diff HEAD including all current dirty changes, and review for defects, regressions, and missing coverage. Use the permitted read-only reviewer delegation when the skill requests it. Apply valid findings directly to product code, never the plan, and verify each fix. Treat HEAD as the review base and the uncommitted working tree as the review head; do not create a commit.

  ## worker

  phase: Simplicity review
  label: Remove unjustified complexity
  model: openai-codex/gpt-5.6-luna
  thinking: max
  skills: ponytail-review

  Read {task} and inspect the final git diff. Review only for unnecessary complexity, then apply valid simplifications directly to product code while preserving required interfaces. Do not modify the plan. Verify the final state and do not create a commit.
  ```

- [ ] **Step 4: Add `reviewer` to `agents/worker.md` and run saved-chain tests.**

  Change only the `subagent_agents` list to include `reviewer`, then run:

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/subagent-chain.test.ts
  ```

  Expected: all saved-chain parsing, assignment, and execution tests pass.

- [ ] **Step 5: Commit the integration artifact.**

  ```bash
  git add chains/implement-plan-review.chain.md agents/worker.md tests/chain-serializer.test.ts tests/subagent-chain.test.ts
  git commit -m "feat: add implement plan review chain"
  ```

### Task 6: Run Full Verification and Packaging Checks

**Files:**

- Modify: none; corrective edits belong in the originating task before this verification task is rerun
- Test: the complete existing Vitest suite

**Interfaces:**

- No new interfaces. This task verifies the contracts produced by Tasks 1–5 and checks that the package contains the saved chain and agent files.

- [ ] **Step 1: Run the complete check command.**

  ```bash
  pnpm check
  ```

  Expected: Biome lint, TypeScript compilation, and all Vitest tests exit with status 0.

- [ ] **Step 2: Run the package dry run.**

  ```bash
  pnpm pack:dry-run
  ```

  Expected: the package file list includes `chains/implement-plan-review.chain.md`, the modified `agents/worker.md`, and all required `src` files; no generated or unrelated files are added.

- [ ] **Step 3: Inspect the final diff and verify scope.**

  ```bash
  git diff --check
  git status --short
  git diff --stat HEAD~5..HEAD
  ```

  Confirm that only runtime propagation, resolver/preflight logic, tests, the saved chain, and the worker delegation allowlist changed. If any earlier task required a corrective edit, run the narrowest affected test again before declaring verification complete.

## Implementation Handoff

After each task commit, review the diff before starting the next task. Use `superpowers:subagent-driven-development` for fresh-agent task execution and review, or `superpowers:executing-plans` for inline execution with checkpoints. Do not invoke either execution skill until the plan is approved for implementation.
