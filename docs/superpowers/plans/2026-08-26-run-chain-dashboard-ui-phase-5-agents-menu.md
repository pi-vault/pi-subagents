# Phase 5: Agents Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `/agents` list and detail menus to responsive framed dashboard overlays while preserving native editing dialogs.

**Architecture:** Reuse the shared overlay options, frame, and viewport around existing menu state. Keep multi-step creation and full markdown editing on Pi's native input/editor components.

**Tech Stack:** TypeScript, Pi/TUI `0.84.3`, Vitest.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phase 4 live widgets.

**Usable result:** `/agents` is readable and scrollable on normal and small terminals, with all create/edit/delete actions unchanged.

## Constraints

- Preserve `/agents`, agent definitions, validation, settings formats, and action semantics.
- Native input/editor dialogs remain native and receive focus.
- Center overlays at `92%` width and `85%` maximum height.

### Task 1: Add failing menu regressions

**Files:** `tests/agents-menu.test.ts`

- [ ] Add assertions for heavy framed list/detail views, visible selected row, footer key hints, selected-row-aware scrolling, `30x3` fallback, and `DASHBOARD_OVERLAY_OPTIONS` passed to the custom UI.
- [ ] Retain/add interaction tests for navigation, create, edit, delete confirmation, Escape, and focus transfer into native input/editor dialogs. Run `pnpm vitest run tests/agents-menu.test.ts`; expected: only new layout assertions fail.

### Task 2: Apply shared layout

**Files:** `src/tui/agents-menu.ts`

- [ ] Render list and detail contents with `renderDashboardFrame`; calculate inner height and use `fitDashboardViewport` so selection stays visible.
- [ ] Use `renderDashboardTooSmall` below the minimum dimensions and a clear `▸` selection marker plus compact footer hints.
- [ ] Pass `DASHBOARD_OVERLAY_OPTIONS` to the `/agents` custom UI. Leave the creation wizard and full markdown editor implementations intact; explicitly forward focus whenever the active child is focusable.

### Task 3: Verify and commit

- [ ] Run `pnpm vitest run tests/agents-menu.test.ts`, then `pnpm check` and `git diff --check`. Manually open `/agents`, scroll, create/cancel an agent, and open/cancel markdown editing.
- [ ] Commit with `git add src/tui/agents-menu.ts tests/agents-menu.test.ts && git commit -m "feat: migrate agents menu to dashboard layout"`.
