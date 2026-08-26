# Phase 4: Live Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the persistent AgentWidget and ChainWidget with the dashboard hierarchy while preserving placement and lifecycle.

**Architecture:** Keep each widget's existing state and update hooks. Change only rendering to compact themed headings, status rows, activity continuations, and summaries; reuse existing truncation and active-theme roles.

**Tech Stack:** TypeScript, Pi/TUI `0.84.3`, Vitest.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phase 3 dashboard foundation.

**Usable result:** Running agents and chains display a consistent compact dashboard treatment above the editor.

## Constraints

- AgentWidget and ChainWidget remain above the editor.
- Do not change manager state, timers, task ordering, completion behavior, or settings.
- Use the active Pi theme and existing helpers; do not wrap persistent widgets in overlay frames.

### Task 1: Lock the intended output

**Files:** `tests/agent-widget.test.ts`, `tests/chain-widget.test.ts`

- [ ] Replace/add focused snapshots or line assertions for this hierarchy:

  ```text
  ╭─ ✦ AGENTS
  │ ● worker  description · metadata
  │   ⎿ activity
  ╰─ running/queued summary
  ```

  Apply the analogous `CHAINS` heading and chain metadata. Cover narrow truncation and empty/terminal states already supported. Run both test files; expected: visual assertions fail before implementation.

### Task 2: Restyle without changing lifecycle

**Files:** `src/tui/agent-widget.ts`, `src/tui/chain-widget.ts`

- [ ] Replace only render composition: themed `✦` headings, semantic status dot/icon, one primary row, indented `⎿` activity, and compact summary. Preserve existing constructors, subscriptions, invalidation, data selection, and placement calls.
- [ ] Use ANSI-safe truncation already present in the repository/Pi/TUI. Do not import pi-status or create another rendering abstraction.

### Task 3: Verify and commit

- [ ] Run `pnpm vitest run tests/agent-widget.test.ts tests/chain-widget.test.ts`, then `pnpm check` and `git diff --check`. Expected: behavior tests and new render assertions pass.
- [ ] Commit with `git add src/tui/agent-widget.ts src/tui/chain-widget.ts tests/agent-widget.test.ts tests/chain-widget.test.ts && git commit -m "feat: restyle live agent and chain widgets"`.
