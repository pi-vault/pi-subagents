# Phase 9: Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the completed migration and prove the cumulative result is releasable.

**Architecture:** No product architecture changes. Update user-facing docs, run the full automated pipeline, audit scope/contracts, and execute the end-to-end terminal checklist against the integrated phases.

**Tech Stack:** TypeScript, pnpm, Biome, Vitest, Pi/TUI `0.84.3`.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phases 1–8 complete.

**Usable result:** The repaired and migrated extension is documented, packaged, and verified across automated and manual interaction paths.

## Constraints

- This phase fixes only defects introduced or exposed by the migration; unrelated cleanup remains out of scope.
- Preserve commands, flags, schemas, tool contracts, agent definitions, settings, and surface placements.
- Confirm there is no pi-status runtime dependency, copied palette/config system, or cross-extension read.

### Task 1: Finish user-facing documentation

**Files:** `README.md`, `CHANGELOG.md`

- [ ] In `README.md`, retain the Phase 1 `0.84.3+` prerequisite and document modern `/run-chain` preview keys, `--yes`, `--bg`, dashboard overlays, `/agents`, FleetList, and conversation steering at the level users need.
- [ ] In `CHANGELOG.md`, add one entry covering the CSI-u input repair, safe preview cancellation/failure, Pi `0.84.3` baseline, and dashboard UI migration. Do not claim unrelated changes.

### Task 2: Run the complete automated gate

- [ ] Run `pnpm check`. Expected: Biome lint, `tsc --noEmit`, and the complete Vitest suite pass.
- [ ] Run `pnpm run pack:dry-run`. Expected: the package is produced as a dry run and contains the required `src`, `agents`, `chains`, license, changelog, and README files.
- [ ] Run `git diff --check`. Expected: no whitespace errors.

### Task 3: Audit contracts and scope

- [ ] Review `git diff --stat` and `git diff`. Confirm changes are limited to the parent plan's named source/tests/docs/dependency files.
- [ ] Search the diff for changes to `/run-chain`, `/chain`, `/agents`, `--yes`, `--bg`, schemas, tool contracts, agent definition formats, settings, and widget placement. Expected: public contracts and placements are unchanged.
- [ ] Search dependencies/imports for `pi-status`. Expected: no runtime dependency or cross-extension import/read exists.

### Task 4: Run the terminal acceptance checklist

- [ ] In a modern CSI-u/Kitty-capable terminal, run `/run-chain implement -- inspect this repository`; verify arrows and `j`/`k`, editing, cancel/reopen, Enter confirmation, and first-agent launch.
- [ ] Press `b` in preview; verify the chain backgrounds, an ID is shown, and ChainWidget updates.
- [ ] Run with `--yes`; verify preview is skipped. Run non-TUI invocation; verify it does not attempt custom UI.
- [ ] Open `/agents`; verify list/detail scrolling, settings, native create input, and markdown editor focus.
- [ ] Start a background agent; verify FleetList navigation, viewer scrolling, steering, stop, and Escape focus restoration.
- [ ] Resize to the narrow fallback and back; verify recovery. Switch between available Pi themes; verify all surfaces remain legible.

### Task 5: Commit the release-ready result

- [ ] If every gate passes, commit documentation with `git add README.md CHANGELOG.md && git commit -m "docs: document dashboard ui migration"`. Record any unavailable manual environment check explicitly rather than marking it passed.
