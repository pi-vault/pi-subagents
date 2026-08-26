# Phase 3: Dashboard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one local dashboard renderer and use it for the chain preview, establishing the visual system without changing other surfaces.

**Architecture:** A dependency-free `dashboard-style.ts` owns overlay sizing, ANSI-safe frame width, selected-row viewport fitting, and the small-terminal fallback. The chain preview is the first consumer.

**Tech Stack:** TypeScript, Pi/TUI `0.84.3`, Vitest.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phase 2 chain input repair.

**Usable result:** The chain preview has a responsive pi-status-inspired frame and viewport while retaining all repaired interactions.

## Constraints

- Use only Pi's active theme; add no palettes, settings, config, pi-status dependency, or shared package.
- Overlay options are centered, `width: "92%"`, `maxHeight: "85%"`.
- Preserve chain behavior and readonly parallel steps.
- ANSI-aware width/truncation must use the TUI utilities already available in Pi/TUI.

### Task 1: Specify the renderer with failing tests

**Files:** Create `tests/dashboard-style.test.ts`

- [ ] Add exact tests for: a frame rendered at width `24`; `dashboardContentWidth(24) === 18`; a selected row scrolled into view with a stable offset; and `renderDashboardTooSmall(30, 3, theme)` containing `Esc`. Run `pnpm vitest run tests/dashboard-style.test.ts`; expected: module-not-found failure.

### Task 2: Add the minimal shared renderer

**Files:** Create `src/tui/dashboard-style.ts`

- [ ] Export exactly:

  ```ts
  export const DASHBOARD_MAX_HEIGHT_RATIO = 0.85;
  export const DASHBOARD_OVERLAY_OPTIONS: OverlayOptions;
  export const MIN_DASHBOARD_FRAME_WIDTH = 7;
  export function dashboardContentWidth(width: number): number;
  export function renderDashboardFrame(lines: readonly string[], width: number, theme: Theme): string[];
  export function fitDashboardViewport(lines: readonly string[], selectedLine: number | undefined, height: number, offset: number): { lines: string[]; offset: number };
  export function renderDashboardTooSmall(width: number, height: number, theme: Theme): string[];
  ```

- [ ] Use horizontal padding `2`, heavy frame glyphs `┏ ┓ ┗ ┛ ━ ┃`, and `{ anchor: "center", width: "92%", maxHeight: "85%" }`. Clamp every width/height calculation; keep the selected line visible without unnecessary offset jumps.
- [ ] Run `pnpm vitest run tests/dashboard-style.test.ts`; expected: all exact-width, viewport, and narrow-terminal tests pass.

### Task 3: Apply it only to chain preview

**Files:** `src/tui/chain-clarify.ts`, `tests/chain-clarify.test.ts`, `tests/core/chain-clarify-integration.test.ts`

- [ ] Add failing render tests for the heavy frame, visible `▸` selection marker, footer hints, narrow fallback, and selected-row scrolling.
- [ ] Render the preview through the shared frame and viewport. Keep parallel steps readonly and retain native input/focus behavior from Phase 2.
- [ ] Run the three focused test files, then `pnpm check` and `git diff --check`.

### Task 4: Commit the atomic result

- [ ] Commit with `git add src/tui/dashboard-style.ts src/tui/chain-clarify.ts tests/dashboard-style.test.ts tests/chain-clarify.test.ts tests/core/chain-clarify-integration.test.ts && git commit -m "feat: add dashboard chain preview"`.
