# Phase 6: Inline Renderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give subagent calls/results, completion notifications, watchdog warnings, and intercom messages one compact status-and-metadata hierarchy.

**Architecture:** Add two private formatting helpers in the existing render module and reuse them from existing inline render entry points. Preserve the native message shell, custom message types, payloads, and detail toggles.

**Tech Stack:** TypeScript, Pi/TUI `0.84.3`, Vitest.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phase 5 agents menu.

**Usable result:** Every inline pi-subagents message is visually consistent without changing its contract or interaction.

## Constraints

- Preserve tool call/result data, custom message types, expanded details, watchdog logic, and intercom delivery.
- Use active-theme semantic roles; no palettes or new public abstraction.
- Keep helpers private and local because there is only one renderer implementation.

### Task 1: Specify consistent inline output

**Files:** `tests/render.test.ts`, `tests/watchdog-render.test.ts`

- [ ] Add focused assertions for running/success/error subagent calls and results, collapsed/expanded metadata, completion notification, watchdog warning, and intercom message. Assert subject/status hierarchy and stable metadata separators, not terminal color escape values.
- [ ] Run `pnpm vitest run tests/render.test.ts tests/watchdog-render.test.ts`; expected: new presentation assertions fail.

### Task 2: Add the smallest shared formatting

**Files:** `src/tui/render.ts`, `src/index.ts`

- [ ] Add private helpers with these signatures:

  ```ts
  function statusHeader(icon: string, subject: string, status: string): string;
  function metadataLine(parts: readonly string[]): string;
  ```

- [ ] Use them for subagent tool call/result rendering, completion messages, watchdog warnings, and intercom messages. Filter absent metadata parts before joining; retain existing native shells, payload parsing, detail expansion, and theme application.

### Task 3: Verify and commit

- [ ] Run `pnpm vitest run tests/render.test.ts tests/watchdog-render.test.ts`, then `pnpm check` and `git diff --check`.
- [ ] Commit with `git add src/tui/render.ts src/index.ts tests/render.test.ts tests/watchdog-render.test.ts && git commit -m "feat: unify inline subagent status rendering"`.
