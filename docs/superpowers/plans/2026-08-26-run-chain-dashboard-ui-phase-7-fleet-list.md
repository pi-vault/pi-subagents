# Phase 7: Fleet List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle FleetList and align its viewer overlay sizing without changing keyboard capture or agent activation.

**Architecture:** Keep the below-editor fleet as an unboxed compact list; use shared overlay sizing only when it opens the conversation viewer. Preserve the current roster and activation state machine.

**Tech Stack:** TypeScript, Pi/TUI `0.84.3`, Vitest.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phase 6 inline renderers.

**Usable result:** Background-agent navigation matches the dashboard language and still opens the correct conversation reliably.

## Constraints

- FleetList remains below the editor and displays five rows.
- Preserve input capture, key-release handling, right-aligned metadata, roster filtering, activation, and cleanup.
- Do not put the persistent fleet inside a box.

### Task 1: Add failing fleet regressions

**Files:** `tests/fleet-list.test.ts`

- [ ] Assert an unboxed `✦ Agents` heading, `▸` selected row, dim `•` unselected rows, dashboard footer hints, five-row viewport, right-aligned metadata, and shared `92%`/`85%` viewer overlay options.
- [ ] Retain/add behavior assertions for CSI-u and legacy navigation, key-release suppression, correct agent activation, roster changes, and cleanup. Run the file; expected: new visual/overlay assertions fail.

### Task 2: Restyle the existing component

**Files:** `src/tui/fleet-list.ts`

- [ ] Change render composition only: add the heading, markers, compact metadata, and footer; keep existing five-row viewport and ANSI-safe width calculations.
- [ ] When activating a row, open the conversation viewer with `DASHBOARD_OVERLAY_OPTIONS`. Do not move focus or input handling into a new controller.

### Task 3: Verify and commit

- [ ] Run `pnpm vitest run tests/fleet-list.test.ts`, then `pnpm check` and `git diff --check`. Manually start a background agent, navigate the fleet, open it, close it, and confirm editor input is restored.
- [ ] Commit with `git add src/tui/fleet-list.ts tests/fleet-list.test.ts && git commit -m "feat: restyle background agent fleet"`.
