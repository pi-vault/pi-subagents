# Implement Plan Review Runtime — Phase 3: Chain Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chain execution shape calculate and forward its effective raw model and thinking settings.

**Architecture:** Extend the existing chain behavior resolver and the three execution branches—sequential, static parallel, and dynamic parallel—without resolving SDK model objects yet. This creates a stable raw behavior contract for the runtime boundary in phase 4.

**Tech Stack:** TypeScript, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Global Constraints

- Effective precedence is step override, then agent definition, then parent model.
- Existing output, progress, tools, budgets, isolation, and chain status behavior remains unchanged.
- `StepSpawnOptions.model` remains the requested raw model string in this phase.
- No model registry lookup or session creation changes belong in this phase.

---

### Task 1: Propagate Raw Chain Behavior

**Files:**

- Modify: `src/core/chain-settings.ts`
- Modify: `src/core/chain-execution.ts`
- Test: `tests/chain-execution.test.ts`

**Interfaces:**

- `StepSpawnOptions` carries `model?: string` and `thinking?: string`.
- `agentDefaults(agentDef)` returns `model: agentDef.model` and `thinking: agentDef.thinking`.
- `resolveStepBehavior()` returns the effective raw `model` and `thinking` values.

- [ ] **Step 1: Add failing precedence tests.**

  Define an agent with `model: "agent/model"` and `thinking: "medium"`. Assert a step override produces `model: "step/model"` and `thinking: "high"`, while an omitted step inherits the agent values. Cover sequential, static parallel, and dynamic execution.

- [ ] **Step 2: Run the chain tests and confirm failure.**

  ```bash
  pnpm vitest run tests/chain-execution.test.ts
  ```

  Expected: existing model tests pass but new thinking/default assertions fail.

- [ ] **Step 3: Add model/thinking to behavior defaults and overrides.**

  Update `StepOverrides`, `ResolvedStepBehavior`, and `AgentBehaviorDefaults`; use `overrides.field ?? agentDefaults.field` for both model and thinking.

- [ ] **Step 4: Update all three spawn-option builders.**

  Set raw model and thinking on sequential, static-parallel, and dynamic `StepSpawnOptions` whenever the effective values are defined.

- [ ] **Step 5: Run focused chain tests.**

  ```bash
  pnpm vitest run tests/chain-execution.test.ts
  ```

  Expected: sequential, parallel, dynamic, override, and default tests pass.

- [ ] **Step 6: Commit the phase.**

  ```bash
  git add src/core/chain-settings.ts src/core/chain-execution.ts tests/chain-execution.test.ts
  git commit -m "feat: propagate raw chain model and thinking settings"
  ```

## Phase Result

Every chain execution branch emits a complete effective raw behavior contract. The chain still relies on its existing spawn wrapper for actual session configuration.
