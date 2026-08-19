# Implement Plan Review Runtime — Phase 1: Thinking Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved and inline chains accept, normalize, validate, and serialize per-step thinking levels.

**Architecture:** Add one shared lexical thinking normalizer and thread the normalized string through existing chain configuration types and parsers. This phase stops before model capability checks or session execution; later phases consume the normalized value.

**Tech Stack:** TypeScript, Vitest, TypeBox, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Global Constraints

- Accept exactly `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, case-insensitively.
- Existing definitions without `thinking` retain current defaults.
- Do not add dependencies or change execution behavior in this phase.
- Preserve the existing saved-chain and inline-chain formats.

---

### Task 1: Add Thinking-Level Parsing and Behavior Plumbing

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
- Export `normalizeThinkingLevel(value: string, source?: string)` returning the lowercase union `"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`; throw for invalid values.

- [ ] **Step 1: Add failing serializer tests.**

  Add Markdown and JSON fixtures using `MAX` and `High`; assert normalized lowercase output and serialized `thinking` fields. Add invalid `extreme`, empty, and non-string cases and assert errors name the step and accepted levels.

- [ ] **Step 2: Run the focused tests and confirm failure.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/slash-chain.test.ts
  ```

  Expected: new thinking assertions fail because the field is not currently recognized.

- [ ] **Step 3: Add the field to types and recognized parser fields.**

  Update Markdown parsing, JSON normalization, serialization, inline `thinking=<level>` parsing, and the TypeBox chain task schema. Normalize values at the shared parsing boundary.

- [ ] **Step 4: Thread thinking through `resolveStepBehavior`.**

  Resolve `overrides.thinking ?? agentDefaults.thinking` and preserve the existing default when both are absent.

- [ ] **Step 5: Run focused tests.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/slash-chain.test.ts
  ```

  Expected: all parser, serializer, normalization, and inline-thinking tests pass.

- [ ] **Step 6: Commit the phase.**

  ```bash
  git add src/shared/types.ts src/core/chain-settings.ts src/core/chain-serializer.ts src/core/slash-chain.ts src/core/subagent.ts tests/chain-serializer.test.ts tests/slash-chain.test.ts
  git commit -m "feat: add chain thinking configuration"
  ```

## Phase Result

Chain definitions and inline chains can author and transport normalized thinking levels. No model lookup, capability validation, or session behavior is changed yet.
