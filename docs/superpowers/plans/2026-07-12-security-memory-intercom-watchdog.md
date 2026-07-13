# Security, Model Scope, Memory, Intercom, and Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five features to pi-subagents: safe filesystem helpers, model scope enforcement, persistent agent memory, a supervisor intercom channel, and an adversarial watchdog reviewer.

**Architecture:** Five phases ordered from simplest to most complex. Each phase is atomic and delivers a usable result independently. Phase 1 (safe-fs) provides security primitives consumed by Phases 3 and 5. Phases 2 and 4 are fully independent. All phases follow existing patterns: pure modules in `src/core/`, types in `src/shared/types.ts`, DI via `RuntimeDeps`, Vitest tests in `tests/`.

**Tech Stack:** TypeScript, Vitest, Biome, TypeBox (schema), `@earendil-works/pi-coding-agent` (platform API)

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md`

---

## File Map

| File                         | Action | Responsibility                                                                             |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `src/core/safe-fs.ts`        | Create | Path traversal protection: `isSymlink`, `safeReadFile`, `isUnsafeName`, `resolveContained` |
| `src/core/model-scope.ts`    | Create | Model allowlist enforcement: `checkModelScope`, `readPiEnabledModels`, `matchesPattern`    |
| `src/core/memory.ts`         | Create | Agent memory: `resolveMemoryDir`, `readMemoryFile`, `buildMemoryInjection`                 |
| `src/core/intercom.ts`       | Create | Supervisor channel: `IntercomManager`, child/parent tool factories                         |
| `src/core/watchdog.ts`       | Create | Watchdog runtime: change detection, review orchestration, auto-follow                      |
| `src/core/watchdog-lsp.ts`   | Create | LSP diagnostics via `tsc --noEmit`                                                         |
| `src/shared/types.ts`        | Modify | Add `memory`, `intercom` to `AgentDefinition`; add `ModelScopeConfig` to `SubagentsConfig` |
| `src/shared/runtime-deps.ts` | Modify | Add `intercom` and `watchdog` optional fields                                              |
| `src/core/agent-runner.ts`   | Modify | Wire memory injection, intercom tool injection                                             |
| `src/core/agents.ts`         | Modify | Use `safeReadFile`/`isUnsafeName` in discovery                                             |
| `src/core/subagent.ts`       | Modify | Call `checkModelScope` after `resolveModel`                                                |
| `src/core/settings.ts`       | Modify | Add `modelScope` and `watchdog` to settings schema                                         |
| `src/index.ts`               | Modify | Init intercom/watchdog, register parent tools, slash commands                              |
| `tests/safe-fs.test.ts`      | Create | Unit tests for safe filesystem helpers                                                     |
| `tests/model-scope.test.ts`  | Create | Unit tests for model scope enforcement                                                     |
| `tests/memory.test.ts`       | Create | Unit tests for agent memory                                                                |
| `tests/intercom.test.ts`     | Create | Unit tests for intercom manager and tools                                                  |
| `tests/watchdog.test.ts`     | Create | Unit tests for watchdog runtime                                                            |
| `tests/watchdog-lsp.test.ts` | Create | Unit tests for LSP diagnostics                                                             |

---

## Phase 1: Security Hardening

**Plan:** `docs/superpowers/plans/2026-07-12-phase-1-safe-fs.md`

Deliverable: `src/core/safe-fs.ts` with four exported helpers (`isSymlink`, `safeReadFile`, `isUnsafeName`, `resolveContained`). Agent/chain discovery hardened to reject symlinks and traversal. Fully tested.

## Phase 2: Model Scope Enforcement

**Plan:** `docs/superpowers/plans/2026-07-12-phase-2-model-scope.md`

Deliverable: `src/core/model-scope.ts` validates agent models against allow patterns + pi's `enabledModels`. Blocks out-of-scope explicit models with an error, warns for inherited. Settings schema extended. Fully tested.

## Phase 3: Agent Memory

**Plan:** `docs/superpowers/plans/2026-07-12-phase-3-memory.md`

Deliverable: `src/core/memory.ts` provides persistent per-agent memory with user/project/local scopes. Memory block injected into system prompt. Read-only mode for agents without write tools. Fully tested. Depends on Phase 1.

## Phase 4: Intercom / Supervisor Channel

**Plan:** `docs/superpowers/plans/2026-07-12-phase-4-intercom.md`

Deliverable: `src/core/intercom.ts` enables child→parent communication. Child `contact_supervisor` tool blocks on decisions, parent `intercom` tool replies. Promise-based in-process. Fully tested.

## Phase 5: Watchdog System

**Plan:** `docs/superpowers/plans/2026-07-12-phase-5-watchdog.md`

Deliverable: `src/core/watchdog.ts` + `src/core/watchdog-lsp.ts`. Detects changes at agent-end boundaries, runs LLM review via `watchdog_warn` tool, collects LSP diagnostics, surfaces warnings. Auto-follow marked experimental. Fully tested.
