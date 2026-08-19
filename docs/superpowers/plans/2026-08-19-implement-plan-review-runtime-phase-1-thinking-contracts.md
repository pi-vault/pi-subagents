# Implement Plan Review Runtime — Phase 1: Thinking Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved and inline chain definitions accept, normalize, validate, and serialize per-task thinking levels.

**Architecture:** Add one small shared lexical normalizer at `src/shared/thinking.ts`, then use the existing chain normalization boundary for saved, executable, append, and inline-chain inputs. This phase defines the chain data contract only; it does not resolve model capabilities, change chain behavior resolution, or forward values into sessions.

**Tech Stack:** TypeScript, Vitest, TypeBox, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Current Repository Fit

The repository already has `thinking` on agent definitions, single-agent tool input, `RunOptions`, `SpawnOptions`, and the agent runner. Phase 1 must leave those existing contracts and single-agent behavior unchanged.

The current chain path is different: chain step types, saved-chain field recognition, Markdown/JSON serialization, inline token configuration, and the chain TypeBox schema do not support `thinking`. `resolveStepBehavior()` and `StepSpawnOptions` are intentionally owned by Phase 3, which already plans model/thinking precedence and all three execution branches. Keeping that boundary prevents Phase 1 and Phase 3 from editing the same behavior plumbing.

## Reference Alignment

- Pi’s `packages/ai/src/types.ts` defines the same seven-value model-thinking vocabulary (with `off` represented by `ModelThinkingLevel`), while `packages/ai/src/models.ts` owns concrete-model capability discovery. Phase 1 mirrors the vocabulary but does not call the capability helper.
- `tintinweb-pi-subagents/src/types.ts`, `src/agent-manager.ts`, and `src/agent-runner.ts` keep thinking as a typed spawn setting with explicit override precedence over agent configuration. That confirms the existing local single-agent contract should remain untouched here.
- `nicobailon-pi-subagents/src/shared/settings.ts`, `src/runs/shared/parallel-utils.ts`, and `src/runs/foreground/subagent-executor.ts` separate authored chain steps from the resolved runner launch contract. Phase 1 therefore stops at normalized authored data; Phase 3/4 own effective behavior and session forwarding.

## Contract

- Accept exactly `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, case-insensitively.
- Trim surrounding whitespace before comparison and serialize the normalized lowercase value.
- Preserve omission: an absent `thinking` field remains absent; explicit `thinking: off` remains explicit.
- Reject empty strings, non-strings, and unsupported strings. Errors must identify the source/step and list the accepted levels.
- Per-task placement is supported on `SequentialStep`, `ParallelTaskItem`, and the dynamic parallel template (the `DynamicParallelTemplate` alias inherits the parallel-task field). There is no group-level thinking field.
- Inline syntax is per agent token, for example `scout[thinking=MAX] "scan"`; group suffixes remain group-only options.
- Phase 1 performs lexical validation only. Pi model capability checks and any clamp/reject decision against a concrete model belong to Phase 2.

The shared helper should expose:

```ts
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ChainThinkingLevel = (typeof THINKING_LEVELS)[number];

export function normalizeThinkingLevel(
  value: unknown,
  source?: string,
): ChainThinkingLevel;
```

`value` is `unknown` because JSON and tool inputs cross a trust boundary. The helper is the single lexical source of truth; it must not inspect a model or silently downgrade a requested level.

---

### Task 1: Add the Shared Thinking Contract

**Files:**

- Create: `src/shared/thinking.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/chain-serializer.test.ts`

- [ ] **Step 1: Add failing contract tests.**

  Extend the existing chain-normalization tests with valid `MAX`/`High` values and invalid empty, `extreme`, `null`, and numeric values. Cover sequential, static parallel, and dynamic-template tasks. Assert normalized lowercase values, preserved omission, explicit `off`, step/source context, and the accepted-level list in failures.

- [ ] **Step 2: Run the focused serializer tests and confirm failure.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts
  ```

  Expected: new assertions fail because chain definitions currently reject `thinking` as an unknown field or retain no normalized value.

- [ ] **Step 3: Implement the helper and type fields.**

  Add the allow-list and normalizer in `src/shared/thinking.ts`. Add `thinking?: ChainThinkingLevel` to `SequentialStep`, `ParallelTaskItem`, and `ChainStepConfig`; the dynamic template alias then carries it without a second field. Do not change the pre-existing agent/single-agent `thinking?: string` fields.

---

### Task 2: Normalize and Serialize Saved Chain Definitions

**Files:**

- Modify: `src/core/chain-serializer.ts`
- Test: `tests/chain-serializer.test.ts`

- [ ] **Step 1: Make the saved parser authoritative for `thinking`.**

  Add `thinking` to the sequential/static/dynamic recognized-field sets. In `validateTaskFields`, reject non-strings and call `normalizeThinkingLevel` for every task shape, including the dynamic template; wrap failures as the existing `ChainDefinitionError` with the source and step label. In `.chain.md`, run the helper even for an empty value so `thinking:` cannot silently become omission. Keep the existing step labels (`step N`, parallel-task labels, dynamic-template labels) in errors.

- [ ] **Step 2: Update both serializers.**

  Emit `thinking: <normalized-level>` in Markdown when present. Normalize/validate the steps before `serializeJsonChain` writes `chain`, just as `serializeChain` already normalizes its Markdown input; this keeps manually constructed configs subject to the same contract. Preserve ordinary extension fields and all existing output/schema behavior.

- [ ] **Step 3: Add saved-format tests.**

  Cover `.chain.md` and `.chain.json` parsing, round-trip serialization, uppercase normalization, explicit `off`, static parallel items, and dynamic templates. Assert invalid JSON values fail before materialization and that a serialized config never emits an uppercase level.

- [ ] **Step 4: Run the focused serializer tests.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts
  ```

  Expected: all existing chain validation/round-trip tests and the new thinking cases pass.

---

### Task 3: Add Inline Chain Parsing and Tool Schema Support

**Files:**

- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Test: `tests/slash-chain.test.ts`

- [ ] **Step 1: Add failing inline tests.**

  Assert `parseSingleTaskToken` and `buildChainSteps` accept `thinking=MAX`/`thinking=High` and produce lowercase values for sequential and parallel-group tasks. Add invalid, empty, and unsupported string values such as `thinking=1`; errors must identify the agent/token and accepted levels. Verify ordinary inline metadata and group options remain unchanged.

- [ ] **Step 2: Run the focused slash-chain tests and confirm failure.**

  ```bash
  pnpm vitest run tests/slash-chain.test.ts
  ```

  Expected: inline `thinking` is currently ignored and invalid values are not rejected.

- [ ] **Step 3: Implement the inline contract.**

  Add `thinking?: ChainThinkingLevel` to `InlineConfig`, normalize it in `parseInlineConfig`, and let `mapParsedStep` carry it into the existing `ChainStep` object. Wrap single-step parsing in the same notification/error path used for multi-step expressions so an invalid `thinking` value does not escape the `/chain` command handler.

  Add `thinking: Type.Optional(Type.String({ description: "Thinking level: off, minimal, low, medium, high, xhigh, max" }))` to `CHAIN_TASK_FIELDS` in `subagent.ts`. TypeBox only enforces the JSON shape here; `normalizeChainSteps` remains the semantic validator for tool chains and chain appends. Leave the already-supported top-level single-agent `thinking` parameter unchanged.

- [ ] **Step 4: Run focused parser tests.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/slash-chain.test.ts
  ```

  Expected: saved and inline parsing, normalization, serialization, and rejection tests pass.

---

## Verification and Handoff

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm lint`.
- [ ] Confirm `git diff --check` is clean.
- [ ] Commit only the Phase 1 files:

  ```bash
  git add src/shared/thinking.ts src/shared/types.ts src/core/chain-serializer.ts src/core/slash-chain.ts src/core/subagent.ts tests/chain-serializer.test.ts tests/slash-chain.test.ts
  git commit -m "feat: add chain thinking configuration"
  ```

## Phase Result

Saved, executable, appended, and inline chain definitions can carry a normalized `ChainThinkingLevel`, while omitted values preserve existing defaults. Phase 2 can reuse `normalizeThinkingLevel`; Phase 3 owns behavior precedence and `StepSpawnOptions` forwarding. No model lookup, capability validation, session creation, or single-agent execution behavior changes in this phase.
