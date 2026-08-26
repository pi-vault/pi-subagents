# Phase 1: Pi Dependency Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the project to the tested Pi/TUI `0.84.3` baseline without changing product behavior or UI.

**Architecture:** Update only the three Pi development packages and the generated lockfile. Keep wildcard peer dependencies so the published extension remains compatible with its host. Make compiler-driven compatibility edits only if `0.84.3` requires them.

**Tech Stack:** TypeScript, pnpm, Vitest, Biome, `@earendil-works/pi-ai@0.84.3`, `@earendil-works/pi-coding-agent@0.84.3`, `@earendil-works/pi-tui@0.84.3`.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** None.

**Usable result:** The unchanged extension builds, tests, and packages against Pi `0.84.3`; README states Pi `0.84.3+`.

## Constraints

- Do not change commands, schemas, settings, rendering, or interaction behavior.
- Leave `peerDependencies` as `"*"`; update only the three Pi `devDependencies`.
- Do not add pi-status or any other dependency.
- Limit source edits to errors proven by the `0.84.3` typecheck or tests.

### Task 1: Update and verify the dependency baseline

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify only if compilation requires it: the exact source/test call site reported by `pnpm typecheck`

- [ ] **Step 1: Record the baseline.**

  Run `pnpm check` before editing. Expected: the current suite passes; if it does not, record the pre-existing failure and stop rather than folding an unrelated fix into this phase.

- [ ] **Step 2: Update only the Pi development packages.**

  Set these exact values in `package.json`:

  ```json
  "@earendil-works/pi-ai": "^0.84.3",
  "@earendil-works/pi-coding-agent": "^0.84.3",
  "@earendil-works/pi-tui": "^0.84.3"
  ```

  Leave TypeScript, Vitest, Biome, TypeBox, engines, and all peer dependencies unchanged. Run `pnpm install --lockfile-only` to regenerate `pnpm-lock.yaml`.

- [ ] **Step 3: Document the minimum tested host.**

  In `README.md`, update the Pi prerequisite/compatibility text to say `0.84.3+`. Do not document dashboard behavior yet.

- [ ] **Step 4: Prove compatibility.**

  Run `pnpm check`. Expected: lint, `tsc --noEmit`, and all Vitest tests pass. If the compiler identifies a Pi API change, make the smallest call-site adaptation, add or update the nearest focused test, and rerun the failing command before the full check.

- [ ] **Step 5: Verify package and scope.**

  Run `pnpm run pack:dry-run`, `git diff --check`, and `git diff -- package.json pnpm-lock.yaml README.md`. Expected: the package dry-run succeeds; only the three versions, their lockfile graph, and minimum-version documentation change unless Step 4 proved a required compatibility edit.

- [ ] **Step 6: Commit the atomic result.**

  ```bash
  git add package.json pnpm-lock.yaml README.md
  git commit -m "chore: update pi dependencies to 0.84.3"
  ```
