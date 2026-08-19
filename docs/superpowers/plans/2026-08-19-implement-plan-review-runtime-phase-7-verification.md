# Implement Plan Review Runtime — Phase 7: Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the complete runtime change, saved chain, package contents, and final diff after phases 1–6.

**Architecture:** This is a verification-only phase. It changes no source, tests, agent, or chain files; any failure is fixed in the originating phase and reverified here.

**Tech Stack:** pnpm, Biome, TypeScript, Vitest, package dry-run tooling.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Global Constraints

- The parent plan remains unchanged.
- No automatic acceptance-command execution is added.
- The package must include the saved chain and modified worker agent.
- Do not add generated or unrelated files.

---

### Task 1: Run Complete Verification

**Files:**

- Modify: none
- Test: all files under `tests/` through `pnpm check`

**Interfaces:**

- No new interfaces. This phase verifies the contracts delivered by phases 1–6.

- [ ] **Step 1: Run the complete check command.**

  ```bash
  pnpm check
  ```

  Expected: Biome lint, TypeScript compilation, and the complete Vitest suite exit with status 0.

- [ ] **Step 2: Run the package dry run.**

  ```bash
  pnpm pack:dry-run
  ```

  Expected: the package list includes `chains/implement-plan-review.chain.md`, `agents/worker.md`, and all modified source/test files.

- [ ] **Step 3: Verify diff scope and whitespace.**

  ```bash
  git diff --check
  git status --short
  git diff --stat HEAD~6..HEAD
  ```

  Confirm that only runtime resolver/propagation/preflight changes, tests, the saved chain, and the worker delegation allowlist changed. Confirm the parent plan file is unchanged.

- [ ] **Step 4: Close verification without a commit.**

  Do not create a verification commit. If a check fails, return to the phase that owns the failing behavior, make the smallest fix there, rerun its focused test, and repeat this phase.

## Phase Result

The complete runtime and saved chain are verified, packageable, and limited to the requested scope.
