# Chain Execution — Phase 10: Final Integration & Verification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run full verification suite, ensure no regressions, review the diff, and make any final integration fixes.

**Architecture:** No new code — this phase is pure verification. Run lint, typecheck, full test suite, review git diff.

**Tech Stack:** pnpm, Vitest, TypeScript

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** All previous phases (1-9) complete.

---

### Task 11: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Verify no existing tests are broken**

Run: `pnpm vitest run`
Expected: All existing tests still pass alongside new chain tests.

- [ ] **Step 3: Review the diff**

Run: `git diff master --stat`
Verify: Only expected files changed. No unintended modifications to existing modules.

- [ ] **Step 4: Final commit if any integration fixes were needed**

```bash
git add -A
git commit -m "chore: integration fixes for chain execution"
```
