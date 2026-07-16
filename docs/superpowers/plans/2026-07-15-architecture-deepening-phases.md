# Codebase Architecture Deepening Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved architecture deepening as six small, independently releasable phases.

**Architecture:** Each phase has one deepened module seam and leaves the extension usable before the next phase begins. Execute phases in order because early deletions shrink the implementation surface for later phases.

**Tech Stack:** TypeScript, Node.js 24, Vitest, Biome, TypeBox, Pi coding-agent/TUI packages.

---

## Prerequisites

Read the authoritative source plan without editing it: [architecture deepening parent plan](./2026-07-15-architecture-deepening.md).

For every phase, run tests with process-local Git signing disabled:

```bash
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=commit.gpgsign
export GIT_CONFIG_VALUE_0=false
```

## Phase sequence

| Phase | Plan | Usable result | Commit |
| --- | --- | --- | --- |
| 1 | [Watchdog policy](./2026-07-15-architecture-deepening-phase-1-watchdog.md) | One Watchdog runtime owns child policy; no duplicate child runtime. | `docs: record architecture deepening design` → `refactor: deepen watchdog runtime policy` |
| 2 | [Agent persistence](./2026-07-15-architecture-deepening-phase-2-agent-persistence.md) | Agents menu delegates safe persistence and precedence to the Agent module. | `refactor: add agent catalog seam` → `refactor: delegate agents menu persistence` |
| 3 | [Configuration](./2026-07-15-architecture-deepening-phase-3-settings.md) | One settings module resolves legacy/global/project values; recursion setting works. | `refactor: add unified settings resolver` → `refactor: migrate settings callers` |
| 4 | [Live activity](./2026-07-15-architecture-deepening-phase-4-activity.md) | One Agent record supplies live state to all TUI adapters. | `refactor: add agent live record` → `refactor: migrate tui activity state` |
| 5 | [Chain definitions](./2026-07-15-architecture-deepening-phase-5-chain-definition.md) | All Chain forms normalize before side effects. | `refactor: add chain definition normalizer` → `refactor: route chain adapters through normalizer` |
| 6 | [Agent lifecycle](./2026-07-15-architecture-deepening-phase-6-agent-lifecycle.md) | AgentManager owns lifecycle transitions and custom-tool setup. | `refactor: replace spawn dependency bag` → `refactor: centralize agent lifecycle transitions` |

## Phase gates

- [ ] Start each phase only after the preceding phase is committed and its focused tests, typecheck, and touched-file lint pass.
- [ ] Preserve command names, tool parameter shapes, settings values, notification text, and TUI output except the approved settings write location and applying Max Recursive Level.
- [ ] At the end of Phase 6, run:

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm check
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm release:check
git diff master...HEAD --check
```

Expected: all checks pass, no new lint warnings are introduced, and only the approved refactors, tests, and documentation are present.
