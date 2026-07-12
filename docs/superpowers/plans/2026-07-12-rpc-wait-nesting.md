# Cross-Extension RPC, Wait Tool, and Nested Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three features to pi-subagents: cross-extension RPC via the event bus, a `wait` tool for blocking on background agents, and nested subagent support via tool injection.

**Architecture:** Three independent features layered from simplest to most complex. RPC is a pure event-bus handler with no tool registration. Wait is a new tool registered in `index.ts`. Nested subagents adds a tool factory (`child-subagent-tool.ts`) whose output is passed as `customTools` to `createAgentSession()` via a new field on `RunOptions`.

**Tech Stack:** TypeScript, Vitest, Biome, TypeBox (schema), `@earendil-works/pi-coding-agent` (platform API)

**Spec:** `docs/superpowers/specs/2026-07-12-rpc-wait-nesting-design.md`

---

## File Map

| File                                | Action | Responsibility                                                            |
| ----------------------------------- | ------ | ------------------------------------------------------------------------- |
| `src/core/rpc.ts`                   | Create | RPC handler registration: `registerRpcHandlers()`                         |
| `src/core/wait.ts`                  | Create | Wait tool factory: `createWaitTool()`                                     |
| `src/core/child-subagent-tool.ts`   | Create | Child subagent + scoped get_subagent_result tool factories                |
| `src/shared/types.ts`               | Modify | Add `spawnedBy?: string` to `AgentRecord`, `customTools` to `RunOptions`  |
| `src/core/agent-manager.ts`         | Modify | Set `spawnedBy` on records, construct `customTools`, pass to `runAgent()` |
| `src/core/agent-runner.ts`          | Modify | Accept `customTools` in `RunOptions`, forward to `createAgentSession()`   |
| `src/index.ts`                      | Modify | Register RPC handlers, register wait tool, dispose on shutdown            |
| `tests/rpc.test.ts`                 | Create | Unit tests for RPC handlers                                               |
| `tests/wait.test.ts`                | Create | Unit tests for wait tool                                                  |
| `tests/child-subagent-tool.test.ts` | Create | Unit tests for child tool factories                                       |
| `tests/agent-manager.test.ts`       | Modify | Tests for `spawnedBy`, `customTools` passthrough                          |

---

## Phase 1: Cross-Extension RPC

**Plan:** `docs/superpowers/plans/2026-07-12-phase-1-rpc.md`

Deliverable: Other extensions can `ping`, `spawn`, `stop`, `status`, and `steer` subagents via `pi.events`. Fully tested. No changes to existing tools or types.

## Phase 2: Wait Tool

**Plan:** `docs/superpowers/plans/2026-07-12-phase-2-wait.md`

Deliverable: A `wait` tool registered alongside existing tools. Supports `id`, `all`, and `timeout_ms` parameters. Sets `resultConsumed` to suppress nudge notifications. Fully tested.

## Phase 3: Nested Subagents

**Plan:** `docs/superpowers/plans/2026-07-12-phase-3-nesting.md`

Deliverable: Child agents with `subagent_agents` allowlists can spawn their own sub-agents. `spawnedBy` tracking on `AgentRecord`. `customTools` threaded through `RunOptions` to `createAgentSession()`. Scoped `get_subagent_result` restricts visibility. Fully tested.
