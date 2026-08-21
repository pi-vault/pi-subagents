# Implement Plan Review Runtime — Phase 7: Verification Implementation Plan

> **For agentic workers:** This is a verification-only phase. Do not modify source, tests, agents, chains, or this plan while executing it.

**Goal:** Verify the complete runtime change, saved chain, package contents, committed implementation scope, and current working-tree scope after phases 1–6.

**Architecture:** This phase changes no product files. It runs the repository's existing checks and confirms the runtime contracts through the tests already added by phases 1–6. A product or test failure is fixed in its owning phase and then reverified here.

**Tech Stack:** Node `>=24.15.0`, pnpm, Biome, TypeScript, Vitest, and pnpm package dry-run tooling.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Reference alignment

- `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents/src/runs/shared/model-fallback.ts` and `src/runs/shared/parallel-utils.ts` validate effective explicit/configured/parent model selection and retain raw model/thinking settings on runner tasks. The existing local tests cover those contracts; this phase adds no second smoke harness.
- `/Users/lanh/Developer/pi-packages/tintinweb-pi-subagents/src/agent-runner.ts` resolves an actual registry model before session creation, while its package scripts separate lint, typecheck, and full tests. The local `pnpm check` remains the authoritative combined command.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/src/core/model-registry.ts` exposes synchronous `getAll()`, `getAvailable()`, and `find()` lookups, and the Pi package tests use `getSupportedThinkingLevels()` for capability behavior. The local resolver/preflight tests use those same boundaries.
- The reference packages keep tests out of their published package boundary. This repository's `package.json.files` publishes `src`, `agents`, and `chains`, so the dry-run must verify runtime files and integration artifacts, not `tests/`.

## Global constraints

- Require Node `>=24.15.0`; a lower version is a precondition failure, not a passing verification result.
- Do not run live model calls or `acceptance.command`; all runtime coverage is local and uses existing test doubles/sentinels.
- Do not add tests, scripts, dependencies, acceptance gates, retries, commits, or generated files.
- Do not run formatting or auto-fix commands. Existing unrelated Biome warnings do not authorize source cleanup in this phase; only a non-zero check result blocks verification.
- Preserve the parent plan and all phase artifacts. Review any current dirty changes with `git diff HEAD`.
- The implementation base recorded before Phase 1 is `9619442b0208ac16299f1423db2ab959410c1e87`. Review committed Phase 1–6 scope against that fixed base; do not derive the range from `HEAD~N`.

---

### Task 1: Run complete verification

**Files:**

- Modify: none
- Test: all files under `tests/` through `pnpm check`

**Interfaces:**

- No new interfaces. This phase verifies the contracts delivered by phases 1–6.

- [ ] **Step 1: Check the toolchain before running the suite.**

  ```bash
  node --version
  pnpm --version
  ```

  Expected: Node is `v24.15.0` or newer. Stop and report the environment if it is older; do not sign off on the phase using an unsupported engine.

- [ ] **Step 2: Run the complete check command with signing disabled for child test repositories.**

  ```bash
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgsign \
  GIT_CONFIG_VALUE_0=false \
  pnpm check
  ```

  The environment override is process-local and prevents host-level Git signing settings from breaking tests that create temporary repositories. It does not change repository configuration.

  Expected: Biome lint, TypeScript compilation, and the complete Vitest suite exit with status 0. Pre-existing Biome warnings may be reported because the repository's `lint` script does not treat warnings as errors.

- [ ] **Step 3: Run the package dry run and verify the published boundary.**

  ```bash
  pnpm pack:dry-run
  ```

  Expected: the package list includes `chains/implement-plan-review.chain.md`, `agents/worker.md`, and all runtime files under `src/`, including `src/core/chain-preflight.ts` and `src/shared/thinking.ts`. It must not be used to expect files under `tests/`; `package.json.files` intentionally excludes them.

- [ ] **Step 4: Verify whitespace, committed scope, dirty scope, and plan immutability.**

  First, review the committed Phase 1–6 range using the recorded implementation base:

  ```bash
  git diff --check 9619442b0208ac16299f1423db2ab959410c1e87..HEAD
  git diff --stat 9619442b0208ac16299f1423db2ab959410c1e87..HEAD
  git diff --name-only 9619442b0208ac16299f1423db2ab959410c1e87..HEAD
  ```

  Confirm that the committed range contains only the expected Phase 1–6 artifacts: the phase plan documents, runtime files under `src/`, tests, and the saved chain/agent artifacts. This historical committed-scope review is separate from the current dirty-scope review below.

  Then review the current working tree and index:

  ```bash
  git diff --check
  git diff --cached --check
  git diff HEAD --stat
  git diff HEAD --name-only
  git diff --exit-code HEAD -- docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md
  git diff --cached --exit-code -- docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md
  git status --short
  ```

  Confirm that there are no whitespace errors, no staged or unstaged edits to the parent plan, and no unrelated dirty files. If this review has not been committed, the only allowed pre-existing dirty file is this Phase 7 plan itself. The current dirty-scope review uses `git diff HEAD` because it is the actual handoff scope; the committed-scope review above uses the recorded implementation base rather than a moving `HEAD~N` range.

- [ ] **Step 5: Close verification without a commit.**

  If a product or test check fails after the toolchain precondition is satisfied, do not patch it here. Return the failure to the phase that owns the behavior, make the smallest fix there, and rerun this phase. Leave the working tree exactly as received after verification.

## Phase result

The complete runtime and saved chain pass the supported-toolchain checks, the package dry run contains the intended runtime and chain/agent artifacts, the committed Phase 1–6 range is within its expected scope, the parent plan is unchanged, and no unrelated working-tree changes remain.
