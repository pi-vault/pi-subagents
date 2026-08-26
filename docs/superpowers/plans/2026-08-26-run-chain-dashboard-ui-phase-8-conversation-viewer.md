# Phase 8: Conversation Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the conversation viewer and composer to the shared framed dashboard layout while preserving live control of background agents.

**Architecture:** Frame the existing viewer, raise its viewport allocation from `70%` to `85%`, and forward focus to the native composer. Keep subscriptions, steering, stop actions, and scrolling in the existing component.

**Tech Stack:** TypeScript, Pi/TUI `0.84.3`, Vitest.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phase 7 fleet list.

**Usable result:** A responsive, focus-correct conversation overlay can inspect, steer, and stop background agents.

## Constraints

- Preserve message rendering, live subscription updates, scrolling, steer submission, stop, Escape, and cleanup.
- Use shared centered `92%` width/`85%` max-height options.
- Reuse Pi's native input for the composer; do not build a custom editor.

### Task 1: Add failing viewer regressions

**Files:** `tests/conversation-viewer.test.ts`

- [ ] Add assertions for heavy frame, header/status hierarchy, `85%` viewport constant, footer hints, narrow-terminal fallback, scroll bounds, and composer visibility.
- [ ] Add/retain behavior tests for focus forwarding, CSI-u and legacy keys, key releases, live subscription updates, steering submit, stop action, Escape, and disposal. Run the file; expected: new layout/focus assertions fail.

### Task 2: Apply the frame and focus contract

**Files:** `src/tui/conversation-viewer.ts`

- [ ] Change `VIEWPORT_HEIGHT_PCT` from `0.7` to `DASHBOARD_MAX_HEIGHT_RATIO` (`0.85`). Render header, messages, composer, and footer through the shared frame and small-terminal fallback.
- [ ] Implement/retain `Focusable`; forward `focused` to the native composer when it is active. Fit the message viewport without changing chronological ordering or subscription behavior.
- [ ] Keep steer and stop routing exactly as-is; visual buttons/hints must call the existing actions.

### Task 3: Verify and commit

- [ ] Run `pnpm vitest run tests/conversation-viewer.test.ts tests/fleet-list.test.ts`, then `pnpm check` and `git diff --check`. Manually inspect a live background agent, scroll, steer, stop, and close at small and normal sizes.
- [ ] Commit with `git add src/tui/conversation-viewer.ts tests/conversation-viewer.test.ts && git commit -m "feat: migrate conversation viewer to dashboard layout"`.
