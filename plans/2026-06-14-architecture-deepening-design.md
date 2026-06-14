# Architecture Deepening: pi-subagents

**Date:** 2026-06-14
**Goal:** Improve codebase structure through five phased refactors that deepen modules, increase locality, and expand test coverage. Each phase produces an atomic, usable result (passes `pnpm check`).

**Ordering:** Easiest → hardest. Phases 1 and 4 are prerequisites for Phase 5. Phases 2 and 3 are independent.

---

## Constraints

- Each phase must leave the codebase passing `pnpm check` (lint + typecheck + tests)
- Tests are migrated alongside code and new tests are added that were previously impossible
- The objective is structural depth, not line-count reduction
- Public interfaces consumed by `index.ts` and external callers remain stable across all phases

---

## Split into 5 independently-mergeable phases

| Phase | Plan                                                                                          | Deliverable                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1     | [phase-1-execution-state](./2026-06-14-architecture-deepening-phase-1.md)                     | Merge deferred + live state into `ExecutionStateStore` class. Inject via deps.                                 |
| 2     | [phase-2-skill-loader-bfs](./2026-06-14-architecture-deepening-phase-2.md)                    | Collapse 4 duplicated BFS traversals into `walkSkillTree(root, visitor)`.                                     |
| 3     | [phase-3-agent-format](./2026-06-14-architecture-deepening-phase-3.md)                        | Extract frontmatter parsing/serialization into `agent-format.ts`.                                             |
| 4     | [phase-4-nested-context](./2026-06-14-architecture-deepening-phase-4.md)                      | Encapsulate 16 env-var constants behind `nested-context.ts`.                                                  |
| 5     | [phase-5-subagent-split](./2026-06-14-architecture-deepening-phase-5.md)                      | Split `subagent.ts` into orchestrator + spawner + artifacts.                                                  |

Each phase passes `pnpm check` on its own and can be merged independently (except Phase 5 which requires 1 + 4).

## Dependency Order

```
Phase 2 (skill-loader BFS)     ← independent
Phase 3 (agent-format)         ← independent

Phase 1 (execution state)  ──┐
                              ├──→ Phase 5 (subagent split)
Phase 4 (nested-context)   ──┘
```

---

## Phase 1: Unify execution state into `ExecutionStateStore`

### Files involved

- `src/core/deferred-slash-state.ts` (deleted)
- `src/core/slash-live-state.ts` (deleted)
- `src/core/execution-state.ts` (new)
- `src/index.ts` (instantiates and injects the store)
- `src/core/subagent.ts` (consumes the store instead of free-function imports)
- `src/tui/render.ts` (consumes the store for snapshot access)

### What changes

- `deferred-slash-state.ts` and `slash-live-state.ts` merge into a single `execution-state.ts` module
- The module exports an `ExecutionStateStore` class instead of 14 free functions over global Maps
- The class is instantiated once in `index.ts` and injected into consumers

### Interface

```typescript
class ExecutionStateStore {
  // Live execution tracking
  startLive(input): SlashLiveDetails;
  updateLive(requestId, patch): void;
  tickLive(requestId): void;
  finalizeLive(requestId, result): void;
  isLiveRunning(requestId): boolean;
  clearLive(requestId): void;
  getSnapshot(requestId): SlashSnapshot | undefined;
  getRenderableMessage(
    details,
  ): { content: string; details: SubagentMessageDetails } | undefined;

  // Deferred slash requests
  rememberDeferred(pi, request): void;
  markDeferredConsumed(pi, requestId): void;
  setDeferredRuntimeState(requestId, state): void;
  takeDeferredRuntimeState(requestId): DeferredSlashRuntimeState | undefined;
  getDeferredRequest(requestId): PersistedDeferredSlashRequest | undefined;
  hydrateFromSession(sessionManager): void;
}
```

The store is injected by adding it to the existing `RuntimeDeps` interface (or as a direct constructor parameter to registration functions). The implementation plan will determine which threading approach is cleaner given the existing call sites.

### Why this deepens

- Callers no longer know about internal Maps, version counters, or pruning policy
- Tests create a fresh `ExecutionStateStore()` — no module-level state pollution between tests
- The two-map split (persisted vs runtime) becomes an implementation detail

### New tests

- Isolated state lifecycle tests (start → update → finalize)
- Hydration round-trip tests
- Pruning behavior tests (previously untested)
- Concurrent request interaction tests

---

## Phase 2: Collapse BFS traversals in skill-loader

### Files involved

- `src/core/skill-loader.ts` (refactored)

### What changes

- Extract a single `walkSkillTree(root, visitor)` function that owns the BFS loop, symlink checks, dotfile/node_modules skipping, and skill-vs-category classification
- The four current BFS implementations (`findSkillBFS`, `findSkillPathBFS`, `collectSkillNames`, `collectSkillPaths`) are deleted and replaced by calls to `walkSkillTree` with different visitor callbacks
- The flat-file scanning (root-level `.md` files) also consolidates

### Interface

```typescript
type SkillEntry =
  | { kind: "flat"; name: string; filePath: string } // root-level name.md
  | { kind: "directory"; name: string; dirPath: string; skillMdPath: string }; // dir with SKILL.md

function walkSkillTree(
  root: string,
  visitor: (entry: SkillEntry) => boolean,
): void;
// visitor returns true to stop early (found what it needs), false to continue
// Handles both flat .md files at root and directory skills found via BFS
```

### Why this deepens

- Security logic (symlink rejection, dotfile skip, traversal guards) lives in one place
- The four public functions keep their current interface unchanged — callers don't notice
- The seam between "how we walk the filesystem" and "what we collect" becomes explicit

### New tests

- Direct tests for `walkSkillTree` with a crafted temp directory tree
- Tests that verify early-exit behavior (visitor returns `true`)
- Tests that security invariants hold at the walk level

---

## Phase 3: Extract frontmatter parsing into `agent-format.ts`

### Files involved

- `src/core/agent-format.ts` (new)
- `src/core/agents.ts` (slimmed — delegates format concerns)

### What changes

- A new `agent-format.ts` module owns all format concerns: frontmatter extraction, YAML-like field parsing, string-array normalization, field validation, and markdown serialization
- `agents.ts` retains domain operations: discovery, merge logic, file creation/export/disable
- Internal helpers that move: `parseFrontmatter()`, `parseStringArray()`, field validation logic, `createAgentMarkdown()`

### Interface

```typescript
// agent-format.ts

type ParseResult =
  | { ok: true; definition: AgentDefinition }
  | { ok: false; reason: string };

function parseAgentContent(filePath: string, content: string): ParseResult;
function serializeAgent(input: AgentCreationInput): string;
```

### What stays in `agents.ts`

- `discoverAgents(paths)` — reads directories, calls `parseAgentContent` per file, merges with conflict resolution
- `createAgentFile(paths, input, discovery, toolNames)` — validates uniqueness/tool names, calls `serializeAgent`, writes to disk
- `exportAgentToUserScope`, `disableAgentInUserScope`, `deleteUserAgentOverride` — file I/O orchestration
- `discoverToolNames` — unchanged

### Why this deepens

- The format module is pure: string in → structured data out (or error). No file I/O, no side effects
- Locality: format bugs isolated from discovery bugs
- The seam becomes testable in isolation — exhaustive parsing tests without temp directories
- A future format change only touches one module

### New tests

- Exhaustive unit tests: malformed frontmatter, edge-case YAML, unicode, empty body, missing fields
- Round-trip test: `serializeAgent(parseAgentContent(path, content).definition)` ≈ original
- `agents.ts` orchestration tests using a spy on `parseAgentContent`

---

## Phase 4: Encapsulate the nested-context env-var protocol

### Files involved

- `src/core/nested-context.ts` (new)
- `src/core/subagent.ts` (sheds ~250 lines of env-var logic)

### What changes

- A new `nested-context.ts` module owns the 16 environment variable constants, their parsing, validation, and child-env construction
- All env-var constants move from `subagent.ts` as private implementation details
- Functions that move: `readNestedRuntimeContext()`, `ensureNestedDelegationAllowed()`, `withoutNestedSubagentEnv()`, and env-var assembly from `createNestedChildLaunch()`

### Interface

```typescript
// nested-context.ts

type NestedRuntimeContext = {
  isNestedChild: boolean;
  currentRunId?: string;
  depth: number;
  maxDepth: number;
  rootRunId?: string;
  allowedAgents?: string[];
  parentPath: string;
};

function readContext(config: LoadedConfig): NestedRuntimeContext;

function validateDelegation(
  discovery: AgentDiscoveryResult,
  input: SubagentToolInput,
  context: NestedRuntimeContext,
): void; // throws on violation

function buildChildEnv(params: {
  agent: AgentDefinition;
  context: NestedRuntimeContext;
  childRunId: string;
  paths: ResolvedPaths;
  cwd: string;
  parentSessionFile?: string;
  parentSessionDir?: string;
  runtime: SubagentRuntimeDeps;
}): { env: NodeJS.ProcessEnv; routeDir: string };

function stripNestedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
```

### What stays in `subagent.ts`

- `createNestedChildLaunch()` becomes a thin caller: calls `readContext()`, `buildChildEnv()`, combines with `buildChildArgs()`
- All process spawning, execution, and artifact logic remains

### Why this deepens

- The env-var protocol is a real interface between parent and child processes — deserves its own module
- Locality: renaming an env var touches one file
- Testability: tests inject a `NestedRuntimeContext` struct instead of setting 16 `process.env` entries

### New tests

- `readContext()` with controlled `process.env` snapshots
- `validateDelegation()` with context structs: depth limits, allowlist enforcement, case-insensitive matching
- `buildChildEnv()` asserting returned env dict correctness
- `stripNestedEnv()` verifying all 16 keys removed, others preserved

---

## Phase 5: Split the subagent execution module

### Prerequisites

- Phase 1 (state behind a seam)
- Phase 4 (nested-context extracted)

### Files involved

- `src/core/subagent-spawner.ts` (new)
- `src/core/subagent-artifacts.ts` (new)
- `src/core/subagent.ts` (slimmed to orchestrator + registration)

### What changes

**`subagent-spawner.ts`** — owns the child process lifecycle:

- `buildChildArgs()` — assembles CLI flags from agent definition
- `spawnAndCollect()` — spawns child, parses JSON stdout stream, accumulates usage/tool-activity, handles timeout/abort/kill
- Internal helpers: `processLine()`, `getAssistantText()`, `accumulateUsage()`, `previewValue()`, `pushRecentToolActivity()`
- Interface: one function that takes agent definition + resolved params, returns `Promise<RawChildResult>`

**`subagent-artifacts.ts`** — owns artifact I/O:

- `buildArtifactInputMarkdown()`, `buildArtifactOutputMarkdown()`
- `writeExecutionArtifacts()`
- Interface: `writeExecutionArtifacts(paths, input, result) → ArtifactPaths`

**`subagent.ts`** (slimmed) — orchestrator and registration:

- `executeSubagent()` — orchestrates: validate → resolve session → call spawner → write artifacts → return result
- `registerSubagentTool()`, `registerSlashAgentBridge()`, `registerAgentCommand()`
- `parseSubagentRequest()`, `resolveChildSessionTarget()`, `buildExecutionResult()`
- Delegates to: spawner, nested-context, execution-state, artifacts

### Why this deepens

- The spawner module has a narrow interface with significant implementation behind it
- The orchestrator becomes readable top-to-bottom
- The artifacts module is pure I/O with no execution coupling
- Each module passes the deletion test

### New tests

- `subagent-spawner.ts`: focused stream parsing, timeout, and signal handling tests (no artifact/state concerns in setup)
- `subagent-artifacts.ts`: markdown generation and file writing without any execution mocking
- `subagent.ts` orchestration: integration tests with injected spawner

---

## Dependency graph

```
Phase 2 (skill-loader BFS)     ← independent
Phase 3 (agent-format)         ← independent

Phase 1 (execution state)  ──┐
                              ├──→ Phase 5 (subagent split)
Phase 4 (nested-context)   ──┘
```

Phases 2 and 3 can run in any order or in parallel with phases 1 and 4. Phase 5 must come last.

---

## Verification

Each phase must pass before merge:

- `pnpm run lint` (biome)
- `pnpm run typecheck` (tsc --noEmit)
- `pnpm run test` (vitest run)
- Manual review: no public interface changes visible to `index.ts` or external callers
