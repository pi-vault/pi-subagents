# Codebase Architecture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the existing Agent, Chain, Watchdog, configuration, and presentation modules while preserving user-facing commands, tool shapes, files, and rendered output.

**Architecture:** Apply six small, behavior-preserving refactors from simplest to most complex: watchdog policy, Agent persistence, configuration, live activity, Chain definition normalization, and Agent lifecycle. Reuse existing modules and seams; delete duplicated implementation instead of adding a framework or new dependency.

**Tech Stack:** TypeScript, Node.js 24, Vitest, Biome, TypeBox, Pi coding-agent/TUI packages.

---

## Shared rules

- Work in the current branch; do not reset or overwrite unrelated changes.
- Use test-first changes for each task: add focused failing tests, implement the smallest change, run the focused test, then run typecheck/lint.
- Commit each task independently with the commit message shown below.
- Preserve command names, tool parameter wire shapes, settings values, notification text, and TUI rendering unless a task explicitly states an approved behavior change.
- The process-local Git override below is required because the sandbox blocks GPG signing in temporary test repositories:

```bash
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=commit.gpgsign
export GIT_CONFIG_VALUE_0=false
```

## Task 0: Record the approved domain language

**Files:**

- Create: `CONTEXT.md`
- Create: `docs/superpowers/specs/2026-07-15-architecture-deepening-design.md`

- [ ] **Step 1: Write the glossary and design record**

Add only project-specific terms to `CONTEXT.md`:

```md
# Pi Subagents Context

This context names the concepts used by the Pi subagents extension.

## Language

**Agent**:
A configured delegated worker with a prompt, tool policy, and execution record.
_Avoid_: worker when referring to the domain concept

**Chain**:
A declared sequence or parallel group of Agent invocations whose outputs can feed later steps.
_Avoid_: pipeline when referring to the domain concept

**Watchdog**:
An optional review Agent that inspects an ended Agent's changes or conversation and may request fixes.
_Avoid_: reviewer when referring to the domain concept
```

Record the approved six-phase design, compatibility decisions, and configuration precedence in the design document. Do not add generic terms such as module, interface, or adapter to the glossary.

- [ ] **Step 2: Validate the documentation**

Run:

```bash
test -s CONTEXT.md
test -s docs/superpowers/specs/2026-07-15-architecture-deepening-design.md
git diff --check
```

Expected: both files exist and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md docs/superpowers/specs/2026-07-15-architecture-deepening-design.md
git commit -m "docs: record architecture deepening design"
```

## Task 1: Fold child Watchdog policy into the Watchdog runtime

**Files:**

- Modify: `src/core/watchdog.ts`
- Modify: `src/index.ts`
- Delete: `src/core/watchdog-child.ts`
- Modify: `tests/watchdog.test.ts`
- Delete: `tests/watchdog-child.test.ts`

- [ ] **Step 1: Add runtime-level policy tests**

Extend `tests/watchdog.test.ts` with cases that call the runtime using an Agent subject and assert model/thinking selection for parent defaults, child defaults, per-Agent overrides, and disabled child overrides. Also assert that the warning callback is invoked once through the single runtime.

Use this subject shape in the tests:

```ts
const subject = { id: "agent-1", type: "scout", cwd: tmp };
await runtime.handleAgentEnd(subject);
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
pnpm vitest run tests/watchdog.test.ts
```

Expected: TypeScript/test failures because `handleAgentEnd` still accepts two positional arguments and child policy is outside the runtime.

- [ ] **Step 3: Implement the runtime seam**

Define the subject and update the interface:

```ts
export interface WatchdogSubject {
  id: string;
  type: string;
  cwd: string;
}

export interface WatchdogRuntime {
  handleAgentEnd(subject: WatchdogSubject): Promise<WatchdogWarning[]>;
  status(): "idle" | "reviewing" | "disabled";
  dispose(): void;
}
```

Move child override resolution into `watchdog.ts`. When a child configuration is selected, use its model/thinking; otherwise retain the existing parent runtime behavior. Keep reviewer failures non-fatal and preserve the existing warning payload.

Update `src/index.ts` to pass `{ id: record.id, type: record.type, cwd: record.cwd ?? process.cwd() }` and remove child runtime construction/imports. Delete `watchdog-child.ts` and its direct test file after moving coverage.

- [ ] **Step 4: Verify**

```bash
pnpm vitest run tests/watchdog.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/watchdog.ts src/index.ts tests/watchdog.test.ts
```

Expected: focused tests, typecheck, and touched-file lint pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog.ts src/index.ts tests/watchdog.test.ts
git rm src/core/watchdog-child.ts tests/watchdog-child.test.ts
git commit -m "refactor: deepen watchdog runtime policy"
```

## Task 2: Put Agent persistence behind the Agent module

Execute the focused Phase 2 plan in
`docs/superpowers/plans/2026-07-15-architecture-deepening-phase-2-agent-persistence.md`.
It is authoritative for the catalog API, exact override reads, path validation,
RuntimeDeps and `src/index.ts` wiring, adapter tests, two-commit sequence, and
verification commands.

## Task 3: Consolidate configuration and make recursion effective

**Files:**

- Modify: `src/core/settings.ts`
- Delete: `src/core/config.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/index.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/settings.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add precedence and scoped-save tests**

Cover defaults → legacy global → canonical global → project precedence; map legacy `maxConcurrency` to `maxConcurrent`; preserve unrelated keys on a single-field save; select project/global once per settings-menu visit; and apply `maxRecursiveLevel` to the manager at startup and after editing.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run tests/config.test.ts tests/settings.test.ts tests/index.test.ts
```

Expected: new settings interfaces and recursion assertions fail against the two-reader implementation.

- [ ] **Step 3: Deepen `settings.ts`**

Use a single scope type and merged loader:

```ts
export type SettingsScope = "project" | "global";

export function loadSettings(
  cwd: string = process.cwd(),
  scope?: SettingsScope,
): SubagentsSettings;

export function saveSetting(
  cwd: string,
  scope: SettingsScope,
  key: keyof SubagentsSettings,
  value: unknown,
): boolean;
```

Read the legacy `resolvePaths(cwd).configPath` as a compatibility source only. Write canonical global settings under `getAgentDir()/subagents.json` or project settings under `.pi/subagents.json`; preserve unknown fields when updating one key. Keep malformed-file fallback behavior.

- [ ] **Step 4: Rewire callers and menu scope selection**

Replace `loadConfig`/`saveConfig` dependencies with the settings module. Ask for project/global scope once when entering the settings menu, use that scope for all edits in the visit, and apply `maxRecursiveLevel` through `manager.setMaxDepth` at startup and after edits. Remove `config.ts` after all imports are gone.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/config.test.ts tests/settings.test.ts tests/index.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/settings.ts src/index.ts src/core/subagent.ts src/core/slash-chain.ts src/tui/agents-menu.ts
git add src/core/settings.ts src/shared/types.ts src/shared/runtime-deps.ts src/index.ts src/core/subagent.ts src/core/slash-chain.ts src/tui/agents-menu.ts tests/config.test.ts tests/settings.test.ts tests/index.test.ts
git rm src/core/config.ts
git commit -m "refactor: consolidate subagent settings"
```

## Task 4: Collapse mirrored live activity state

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/tui/agent-widget.ts`
- Modify: `src/tui/fleet-list.ts`
- Modify: `src/tui/conversation-viewer.ts`
- Delete: `src/tui/activity.ts`
- Modify: `tests/agent-manager.test.ts`
- Modify: `tests/subagent.test.ts`
- Modify: `tests/agent-widget.test.ts`
- Modify: `tests/fleet-list.test.ts`

- [ ] **Step 1: Add record-driven activity tests**

Assert that AgentManager updates active tools, response text, turns, usage, and max turns from runner callbacks; repeated simultaneous tools with the same name are tracked independently; and all three TUI adapters render from the same record.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/subagent.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts
```

Expected: activity fields are absent from `AgentRecord` and the adapters still require the mirrored map.

- [ ] **Step 3: Add one live snapshot to `AgentRecord`**

Add only the fields not already present:

```ts
export interface AgentLiveState {
  activeTools: string[];
  responseText: string;
  maxTurns?: number;
}

export interface AgentRecord {
  // existing fields...
  live: AgentLiveState;
}
```

Have AgentManager update `live.activeTools` on start/end, `live.responseText` on text delta, and existing counters/usage on their current callbacks. Add `onActivity?: (record: AgentRecord) => void` to `SpawnOptions` for foreground working-message updates.

- [ ] **Step 4: Remove the mirror**

Update widget, fleet, and viewer code to read `record.live`; remove `createActivityTracker`, the shared activity map, related RuntimeDeps fields, and duplicate fallback calculations. Preserve output text and timing behavior.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/subagent.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/types.ts src/core/agent-manager.ts src/core/subagent.ts src/tui/agent-widget.ts src/tui/fleet-list.ts src/tui/conversation-viewer.ts
git add src/shared/types.ts src/core/agent-manager.ts src/core/subagent.ts src/tui/agent-widget.ts src/tui/fleet-list.ts src/tui/conversation-viewer.ts tests/agent-manager.test.ts tests/subagent.test.ts tests/agent-widget.test.ts tests/fleet-list.test.ts
git rm src/tui/activity.ts
git commit -m "refactor: use one agent activity snapshot"
```

## Task 5: Deepen Chain definition normalization

**Files:**

- Modify: `src/core/chain-serializer.ts`
- Modify: `src/core/chain-settings.ts`
- Modify: `src/core/chain-outputs.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/chain-serializer.test.ts`
- Modify: `tests/chain-execution.test.ts`
- Modify: `tests/slash-chain.test.ts`
- Modify: `tests/chain-outputs.test.ts`

- [ ] **Step 1: Add normalization tests**

Cover valid sequential, parallel, dynamic, append, JSON, Markdown, slash, and tool inputs. Add rejection cases for non-object steps, missing/invalid agents, malformed parallel shapes, invalid budgets, duplicate output names, unknown output references, and invalid output names. Add a test that a rejected definition never calls `mkdir` or `spawnAndWait`.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run tests/chain-serializer.test.ts tests/chain-execution.test.ts tests/slash-chain.test.ts tests/chain-outputs.test.ts
```

Expected: malformed tool inputs still reach casts and duplicate step guards remain in separate modules.

- [ ] **Step 3: Add the existing-module normalization interface**

Implement the structural seam in `chain-serializer.ts`:

```ts
export function normalizeChainSteps(
  value: unknown,
  source: string,
): ChainStep[];
```

Validate and normalize nested sequential, parallel, and dynamic shapes, tool budgets, and output bindings. Throw a source-prefixed `ChainDefinitionError` before any execution side effect. Move shared step guards to this module; keep output text substitution in `chain-outputs.ts`.

- [ ] **Step 4: Route every adapter through the seam**

Replace raw casts in `subagent.ts`, append dispatch, JSON parsing, Markdown parsing, and slash-chain construction with `normalizeChainSteps`. Preserve agent-name lookup and user-facing error text at the existing adapters.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/chain-serializer.test.ts tests/chain-execution.test.ts tests/slash-chain.test.ts tests/chain-outputs.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/chain-serializer.ts src/core/chain-settings.ts src/core/chain-outputs.ts src/core/slash-chain.ts src/core/subagent.ts
git add src/core/chain-serializer.ts src/core/chain-settings.ts src/core/chain-outputs.ts src/core/slash-chain.ts src/core/subagent.ts src/shared/types.ts tests/chain-serializer.test.ts tests/chain-execution.test.ts tests/slash-chain.test.ts tests/chain-outputs.test.ts
git commit -m "refactor: centralize chain definition validation"
```

## Task 6: Centralize Agent lifecycle transitions

**Files:**

- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/child-subagent-tool.ts`
- Modify: `src/core/rpc.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/agent-manager.test.ts`
- Modify: `tests/child-subagent-tool.test.ts`
- Modify: `tests/subagent.test.ts`

- [ ] **Step 1: Add transition tests**

Use table-driven tests for normal success/error, queued start failure, background Chain completion, resume, running abort, queued abort, worktree cleanup, and custom-tool creation. Assert status/timestamps/duration/cleanup consistency and no duplicate completion notification.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/child-subagent-tool.test.ts tests/subagent.test.ts
```

Expected: lifecycle mutation remains duplicated and `_deps` is still accepted as an unknown spawn option.

- [ ] **Step 3: Replace hidden dependency plumbing**

Replace the hidden field with a named factory:

```ts
export interface SpawnOptions {
  // existing fields...
  createCustomTools?: (context: {
    id: string;
    cwd: string;
    parentAgentId?: string;
  }) => unknown[];
}
```

Build child-subagent and supervisor tools in the caller-provided factory. `AgentManager` invokes it after assigning the Agent ID and effective working directory; it no longer casts `SpawnOptions` to `RuntimeDeps`.

- [ ] **Step 4: Centralize terminal transitions**

Add one private manager helper that accepts the terminal status and result/error, updates timestamps and duration, performs best-effort output/worktree cleanup, invokes the existing completion adapter exactly once where the current path is notification-eligible, and drains the queue. Route normal run completion, run failure, Chain tracking, resume completion, and abort paths through it. Remove `registerExternalRecord` and `notifyComplete` from the public surface.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/agent-manager.test.ts tests/child-subagent-tool.test.ts tests/subagent.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/agent-manager.ts src/core/subagent.ts src/core/child-subagent-tool.ts src/core/rpc.ts src/shared/types.ts
git add src/core/agent-manager.ts src/core/subagent.ts src/core/child-subagent-tool.ts src/core/rpc.ts src/shared/types.ts tests/agent-manager.test.ts tests/child-subagent-tool.test.ts tests/subagent.test.ts
git commit -m "refactor: centralize agent lifecycle transitions"
```

## Final verification and handoff

- [ ] Run the complete suite with the process-local Git signing override:

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm check
```

Expected: lint completes without new warnings, TypeScript succeeds, and all tests pass.

- [ ] Run the package check:

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm release:check
```

Expected: checks pass and the package dry-run contains the expected `src` and `agents` files.

- [ ] Review the final diff for deleted pass-through code, accidental command/tool-shape changes, and preserved legacy settings reads:

```bash
git diff master...HEAD --stat
git diff master...HEAD --check
git status --short
```

Expected: only the six approved refactors, tests, and documentation are present; the worktree is clean after commits.
