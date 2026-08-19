# Implement Plan Review Runtime — Phase 4: Session Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure single-agent and chain dispatch paths pass actual Pi model objects and normalized thinking values into agent sessions.

**Architecture:** Consume phase 2’s resolver and phase 3’s raw chain behavior. Resolve at the dispatch/runtime boundary, pass the object through `SpawnOptions.model`, and keep `runAgent` able to resolve configured string fallbacks for child callers.

**Tech Stack:** TypeScript, Pi Coding Agent SDK, Pi AI, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Global Constraints

- `createAgentSession({ model })` receives the actual model object returned by Pi’s registry.
- Never silently replace an explicit model with the parent model.
- Preserve behavior when no model or thinking override exists.
- Do not change chain preflight timing yet; that belongs to phase 5.

---

### Task 1: Forward Resolved Models from Chain Wrappers

**Files:**

- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Test: `tests/subagent-chain.test.ts`

**Interfaces:**

- Chain wrappers consume `StepSpawnOptions.model?: string` and `thinking?: string`.
- They pass `SpawnOptions.model?: unknown` as the actual object returned by `resolveModelSelection` and pass normalized `SpawnOptions.thinking`.

- [ ] **Step 1: Add failing wrapper assertions.**

  Inject a registry whose `find()` returns a sentinel model. Spy on `manager.spawnAndWait` and assert that both `/chain` and `subagent` chain execution pass the same sentinel object and requested thinking value.

- [ ] **Step 2: Run the wrapper tests and confirm failure.**

  ```bash
  pnpm vitest run tests/subagent-chain.test.ts
  ```

  Expected: model is currently absent or remains a raw string.

- [ ] **Step 3: Resolve and pass the model object in both wrappers.**

  Resolve the effective raw model before `spawnAndWait`; retain skill overrides and custom-tool creation, but stop relying on a temporary `AgentDefinition.model` string for session selection.

- [ ] **Step 4: Run wrapper tests.**

  ```bash
  pnpm vitest run tests/subagent-chain.test.ts
  ```

  Expected: wrapper spies observe the sentinel model object and normalized thinking.

### Task 2: Fix Single-Agent and Session Runtime Forwarding

**Files:**

- Modify: `src/core/subagent.ts`
- Modify: `src/core/agent-runner.ts`
- Test: `tests/subagent.test.ts`
- Test: `tests/agent-manager.test.ts`

**Interfaces:**

- Single-agent `spawnOptions` includes the resolved model object and normalized thinking.
- `runAgent` resolves an agent-definition string fallback when callers do not provide an object.
- `createAgentSession` receives the resolved model object and thinking level.

- [ ] **Step 1: Add failing single-agent/session identity tests.**

  Use a sentinel registry/model and mock session creation. Assert the sentinel object reaches the manager and the session, with the configured thinking level unchanged.

- [ ] **Step 2: Run the focused tests and confirm failure.**

  ```bash
  pnpm vitest run tests/subagent.test.ts tests/agent-manager.test.ts
  ```

  Expected: current code falls back to `ctx.model` or omits the explicit model.

- [ ] **Step 3: Implement the single-agent and runner forwarding.**

  Resolve `resolveInvocationConfig`’s effective model, pass the actual object and normalized thinking to the manager, and add the runner fallback for child/RPC callers that still provide a configured string.

- [ ] **Step 4: Run all forwarding tests.**

  ```bash
  pnpm vitest run tests/subagent.test.ts tests/agent-manager.test.ts tests/subagent-chain.test.ts tests/chain-execution.test.ts
  ```

  Expected: all single-agent and chain session-forwarding tests pass.

- [ ] **Step 5: Commit the phase.**

  ```bash
  git add src/core/slash-chain.ts src/core/subagent.ts src/core/agent-runner.ts tests/subagent-chain.test.ts tests/subagent.test.ts tests/agent-manager.test.ts
  git commit -m "fix: forward resolved models to agent sessions"
  ```

## Phase Result

Existing single-agent and chain invocations now create sessions with the configured actual model object and thinking level. Invalid chain requests may still be discovered at spawn time until phase 5 adds preflight.
