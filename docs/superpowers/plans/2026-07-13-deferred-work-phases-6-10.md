# Deferred Work Completion (Phases 6-10) — Parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all 19 deferred items from phases 1-5, organized into 5 atomic phases ordered from simplest to most complex.

**Architecture:** Each phase is independently shippable (passes typecheck + tests after completion). Phases 6, 7, and 8 have no inter-dependencies and can be implemented in parallel. Phase 9 depends on Phase 8. Phase 10 is independent of 7-9.

**Tech Stack:** TypeScript, Vitest, Node.js child_process, Pi SDK Extension API

**Spec:** `docs/superpowers/specs/2026-07-13-deferred-work-phases-6-10-design.md`

---

## Phase Dependency Graph

```
Phase 6 (quick wins) ── independent
Phase 7 (watchdog)   ── depends on Phase 5 (done)
Phase 8 (chains)     ── depends on chain engine (done)
Phase 9 (chain adv)  ── depends on Phase 8
Phase 10 (platform)  ── depends on Phase 5 (watchdog) and spawn-limits (done)
```

---

## Phase 6: Quick Wins Sweep

**Plan:** `docs/superpowers/plans/2026-07-13-phase-6-quick-wins.md`

**Items (4):**
1. `maxSpawnsPerSession` in settings — wire through applier pattern
2. `.gitignore` notification for local memory — git check-ignore + one-time emit
3. Per-agent `maxDepth` frontmatter — parse, validate, apply at spawn
4. Batch spawns in `checkSpawnLimit` — budget check before parallel chain steps

**Estimated complexity:** Low (each task: 30-60 min)
**Branch:** `20260713-phase-6-quick-wins`

---

## Phase 7: Watchdog Completions

**Plan:** `docs/superpowers/plans/2026-07-13-phase-7-watchdog-completions.md`

**Items (5):**
1. Watchdog TUI renderer — registerMessageRenderer with severity colors + state labels
2. Model recommendation — intelligent cross-provider complementary model selection
3. Child watchdog — per-child instances with env-var config + stdout JSON status events
4. Turn-delta mode — boolean reviewChangesOnly + formatWatchdogTurnDelta with redaction
5. Auto-follow steering — manager.resume() + stalemate detection (disabled by default)

**Estimated complexity:** Low-High (tasks 1-2 low, 3-4 medium, 5 high)
**Branch:** `20260713-phase-7-watchdog-completions`

---

## Phase 8: Chain Completions

**Plan:** `docs/superpowers/plans/2026-07-13-phase-8-chain-completions.md`

**Already implemented (verified in codebase):**
- `buildChainInstructions` — exists at `chain-settings.ts:120-149`, called at chain-execution.ts lines 144, 272, 359
- `WorkflowGraphSnapshot` — types exist at `types.ts:460-489`, `buildWorkflowGraphSnapshot` + `emitSnapshot` already emit after each step
- Model override per step — `StepSpawnOptions.model` already passes through at chain-execution.ts:161

**Remaining items (2):**
1. Concurrency limiting — Semaphore class + dual-limit (per-step + global at 20). `ParallelStep.concurrency` field exists but is not enforced.
2. Worktree enhancements — basic `worktree.ts` exists (createWorktree/cleanupWorktree). Need: setup hooks, synthetic paths, conflict detection, node_modules linking.

**Estimated complexity:** Medium
**Branch:** `20260713-phase-8-chain-completions`

---

## Phase 9: Chain Advanced

**Plan:** `docs/superpowers/plans/2026-07-13-phase-9-chain-advanced.md`

**Already implemented (verified in codebase):**
- `--bg` flag — exists at `slash-chain.ts:55-73`, `stripExecutionFlags()` parses it
- `fireAndForgetChain` — fully working at `agent-manager.ts:161-200`
- Prompt workflow chains — `PromptWorkflow.chain` field exists, integration at `prompt-workflows.ts:245-261`

**Remaining items (2):**
1. Chain status/cancel commands — `/chain status <id>` and `/chain cancel <id>` subcommands + runtime step-append
2. Chain clarification TUI — interactive editor with behavior overrides before execution

**Estimated complexity:** Medium-High
**Branch:** `20260713-phase-9-chain-advanced`
**Depends on:** Phase 8 (concurrency limiting used by background chains)

---

## Phase 10: Platform Upgrades

**Plan:** `docs/superpowers/plans/2026-07-13-phase-10-platform-upgrades.md`

**Items (2):**
1. Full LSP client — JSON-RPC framing over stdio, per-file diagnostics, server lifecycle
2. Per-tool blocking — tool_call event handler with budget tracking and selective blocking

**Estimated complexity:** High
**Branch:** `20260713-phase-10-platform-upgrades`

---

## Execution Order

Implement in this order (simplest first, respecting dependencies):

1. **Phase 6** — Quick wins (independent, low complexity)
2. **Phase 7** — Watchdog completions (independent of 6 and 8, can parallelize)
3. **Phase 8** — Chain completions (independent of 6 and 7, can parallelize)
4. **Phase 9** — Chain advanced (depends on Phase 8)
5. **Phase 10** — Platform upgrades (independent of 7-9, highest complexity)

## Already Implemented (Verified)

These items from the original deferred list are already done in the codebase:
- `buildChainInstructions` integration (Phase 8 spec item 8.1)
- `WorkflowGraphSnapshot` building (Phase 8 spec item 8.3)
- Model override per step (Phase 8 spec item 8.4)
- Prompt workflow chains (Phase 9 spec item 9.3)
- Background chain `--bg` flag (Phase 9 spec item 9.1, partially)
- `resetSpawnCounter` for session reuse (Phase 6 spec, already done)
- Bundled chain files in `chains/` (Phase 6 spec, already done)

**Net remaining work:** 12 items across 5 phases (down from 19).

## Success Criteria

- All 12 remaining items implemented (or explicitly stubbed with documented blockers)
- Each phase passes typecheck + lint + tests independently
- New functionality has test coverage
- No regressions in existing tests (938+ tests as of Phase 5)
