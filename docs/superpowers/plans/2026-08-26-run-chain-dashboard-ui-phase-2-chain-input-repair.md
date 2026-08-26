# Phase 2: Chain Input Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/run-chain` and `/chain` previews respond to modern CSI-u/Kitty keyboard input and prevent failed or cancelled previews from launching a chain.

**Architecture:** Replace raw byte comparisons in `ChainClarifyComponent` with Pi/TUI `matchesKey()` and native `Input`, forward focus through `Focusable`, and gate preview execution to interactive TUI mode. Preserve the current preview appearance; dashboard styling starts in Phase 3.

**Tech Stack:** TypeScript, Pi/TUI `0.84.3`, Vitest.

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md`

**Prerequisite:** Phase 1 dependency baseline.

**Usable result:** `/run-chain` works in modern terminals, remains scriptable outside TUI mode, and never launches after preview rejection, cancellation, or UI failure.

## Constraints

- Preserve `/run-chain`, `/chain`, `--yes`, `--bg`, schemas, and `ChainClarifyResult`.
- Show preview only when `ctx.mode === "tui" && !bg && !yes`.
- Do not introduce dashboard primitives or visual changes in this phase.
- Every new input and failure branch needs a focused regression.

### Task 1: Reproduce modern input failures

**Files:** `tests/chain-clarify.test.ts`

- [ ] Add failing tests that send `"\x1b[13u"` for Enter, `"\x1b[106u"` for `j`, and `"\x1b[98u"` for `b`. Assert Enter confirms, `j` moves selection, and `b` returns the background action. Run `pnpm vitest run tests/chain-clarify.test.ts`; expected: the new cases fail against raw string comparisons.

### Task 2: Repair input and focus at the boundary

**Files:** `src/tui/chain-clarify.ts`, `tests/chain-clarify.test.ts`

- [ ] Make `ChainClarifyComponent` implement `Component, Focusable`; replace the hand-rolled text buffer with Pi/TUI `Input`; expose `focused` and forward it to the input.
- [ ] Use `matchesKey(data, Key.*)` for navigation, Enter, Escape, and editing shortcuts; ignore `isKeyRelease(data)`. Retain printable-key behavior through native `Input` and preserve the existing `ChainClarifyResult` variants.
- [ ] Run `pnpm vitest run tests/chain-clarify.test.ts`. Expected: legacy and CSI-u cases pass, focus reaches the native input, and key-release events do not act twice.

### Task 3: Gate previews and fail closed

**Files:** `src/core/slash-chain.ts`, `tests/slash-chain.test.ts`, `tests/core/chain-clarify-integration.test.ts`

- [ ] Add failing tests for non-TUI invocation, `--yes`, `--bg`, cancelled previews, and rejected `ctx.ui.custom` promises for both `/chain` and `/run-chain`.
- [ ] Centralize the preview condition as `ctx.mode === "tui" && !bg && !yes`. On cancellation or rejection, emit a visible `pi-subagent-result` error and return before spawning any agent. Non-TUI, `--yes`, and `--bg` paths bypass the preview according to existing semantics.
- [ ] Run `pnpm vitest run tests/slash-chain.test.ts tests/core/chain-clarify-integration.test.ts`. Expected: every bypass and failure path has an explicit no-spawn assertion.

### Task 4: Verify and commit

- [ ] Run `pnpm check` and `git diff --check`. Manually run `/run-chain` in a CSI-u/Kitty-capable terminal and confirm arrows/`j`/`k`, editing, Escape, reopen, Enter, and `b` work.
- [ ] Commit with `git add src/tui/chain-clarify.ts src/core/slash-chain.ts tests/chain-clarify.test.ts tests/slash-chain.test.ts tests/core/chain-clarify-integration.test.ts && git commit -m "fix: support modern chain preview input"`.
