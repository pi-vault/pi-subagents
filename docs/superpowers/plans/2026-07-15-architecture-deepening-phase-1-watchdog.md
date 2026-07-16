# Watchdog Policy Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Watchdog runtime own child-policy selection without changing current review, warning, or auto-follow behavior.

**Architecture:** Pass an Agent subject into one Watchdog runtime, resolve parent-versus-child review configuration privately inside `watchdog.ts`, and expose only the selected configuration and source through existing test/delivery callbacks. Keep `index.ts` as the warning-delivery adapter and delete the one-caller child-policy module.

**Tech Stack:** TypeScript, Node.js 24, Vitest, Biome, TypeBox, Pi coding-agent.

---

## Preconditions

- Work in the current Phase 1 branch and preserve unrelated changes.
- Read `docs/superpowers/specs/2026-07-15-watchdog-policy-deepening-design.md` before editing runtime code.
- Prefix Vitest commands with the process-local Git configuration shown in this plan. Do not export it into the shell used for real commits; repository commit signing must remain unchanged.

## File responsibilities

- `CONTEXT.md`: project-specific Agent, Chain, and Watchdog vocabulary.
- `docs/superpowers/specs/2026-07-15-architecture-deepening-design.md`: approved six-phase architecture and compatibility record.
- `src/core/watchdog.ts`: Watchdog configuration, policy selection, review execution, auto-follow, and runtime interface.
- `src/index.ts`: Agent completion adapter and warning delivery.
- `tests/watchdog.test.ts`: Watchdog runtime and policy behavior.
- `src/core/watchdog-child.ts`: obsolete external policy resolver; delete after migration.
- `tests/watchdog-child.test.ts`: obsolete direct resolver tests; delete after runtime coverage moves.

## Commit sequence

1. `docs: record architecture deepening design`
2. `refactor: deepen watchdog runtime policy`

### Task 1: Record the domain vocabulary and architecture decisions

**Files:**
- Create: `CONTEXT.md`
- Create: `docs/superpowers/specs/2026-07-15-architecture-deepening-design.md`

- [ ] **Step 1: Create the root glossary**

Create `CONTEXT.md` with exactly the project-specific terms below:

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

- [ ] **Step 2: Create the architecture decision record**

Create `docs/superpowers/specs/2026-07-15-architecture-deepening-design.md` with this content, derived from the authoritative parent plan at `docs/superpowers/plans/2026-07-15-architecture-deepening.md`:

```md
# Architecture Deepening Design

## Goal

Deepen the existing Agent, Chain, Watchdog, configuration, and presentation modules while preserving user-facing commands, tool shapes, files, and rendered output.

## Phases

1. Move child Watchdog policy into the Watchdog runtime and delete the external one-caller resolver.
2. Put Agent persistence behind the Agent module so the TUI delegates reads and writes.
3. Consolidate settings resolution and writes behind one settings module.
4. Replace parallel activity maps with one live Agent record per running Agent.
5. Normalize Chain definitions once before command and tool adapters execute them.
6. Replace the spawn dependency bag and centralize Agent lifecycle transitions.

Each phase is independently usable and keeps the extension passing its focused checks before the next phase begins.

## Compatibility

- Preserve command names, tool parameter wire shapes, notification text, settings values, files, and TUI rendering.
- Canonical settings writes use the Pi global settings location for global scope and `.pi/subagents.json` for project scope.
- Legacy global settings remain readable indefinitely.
- The settings menu asks for project or global scope once per menu visit.
- Max Recursive Level becomes effective through the unified settings path; no other behavior change is approved.

## Settings Precedence

Resolve settings in this order, with later values winning:

1. built-in defaults;
2. legacy global settings;
3. canonical Pi global settings;
4. project settings.

## Constraints

- Reuse existing modules and dependencies.
- Delete replaced implementation instead of retaining compatibility wrappers.
- Do not introduce a framework, migration command, or speculative extension point.
```

- [ ] **Step 3: Verify the documentation**

Run:

```bash
test -s CONTEXT.md
test -s docs/superpowers/specs/2026-07-15-architecture-deepening-design.md
git diff --check
```

Expected: both files exist, contain the approved vocabulary and decisions, and have no whitespace errors.

- [ ] **Step 4: Commit the standalone documentation task**

```bash
git add CONTEXT.md docs/superpowers/specs/2026-07-15-architecture-deepening-design.md
git commit -m "docs: record architecture deepening design"
```

Expected: one documentation-only commit; repository commit signing uses its normal configuration.

### Task 2: Move child policy behind the Watchdog runtime

**Files:**
- Modify: `src/core/watchdog.ts`
- Modify: `src/index.ts`
- Modify: `tests/watchdog.test.ts`
- Delete: `src/core/watchdog-child.ts`
- Delete: `tests/watchdog-child.test.ts`

- [ ] **Step 1: Add failing runtime-level policy tests**

Append policy cases to the `WatchdogRuntime` coverage in `tests/watchdog.test.ts`. Use turn-delta mode so policy tests do not need a temporary Git repository:

```ts
const policyCases = [
  {
    name: "uses parent defaults when child policy is disabled",
    raw: {
      enabled: true,
      model: "parent-model",
      thinking: "high",
      children: { enabled: false },
    },
    type: "worker",
    expectedModel: "parent-model",
    expectedThinking: "high",
    expectedSource: "parent",
  },
  {
    name: "uses child defaults with parent fallback",
    raw: {
      enabled: true,
      model: "parent-model",
      thinking: "high",
      children: { enabled: true, model: "child-model" },
    },
    type: "worker",
    expectedModel: "child-model",
    expectedThinking: "high",
    expectedSource: "child",
  },
  {
    name: "uses per-Agent overrides",
    raw: {
      enabled: true,
      model: "parent-model",
      thinking: "high",
      children: {
        enabled: true,
        model: "child-model",
        overrides: { scout: { model: "scout-model", thinking: "low" } },
      },
    },
    type: "scout",
    expectedModel: "scout-model",
    expectedThinking: "low",
    expectedSource: "child",
  },
  {
    name: "falls back to parent when the Agent override disables child policy",
    raw: {
      enabled: true,
      model: "parent-model",
      thinking: "high",
      children: {
        enabled: true,
        model: "child-model",
        overrides: { scout: { enabled: false } },
      },
    },
    type: "scout",
    expectedModel: "parent-model",
    expectedThinking: "high",
    expectedSource: "parent",
  },
] as const;

it.each(policyCases)("$name", async ({
  raw,
  type,
  expectedModel,
  expectedThinking,
  expectedSource,
}) => {
  let selected: { model?: string; thinking?: string } | undefined;
  let deliveredSource: "parent" | "child" | undefined;
  let callbackCount = 0;

  const runtime = createWatchdogRuntime(
    parseWatchdogConfig({ ...raw, reviewChangesOnly: false }),
    {
      runReview: async (_diff, _lsp, _agentId, reviewConfig) => {
        selected = reviewConfig;
        return [{
          severity: "concern",
          summary: "Policy test",
          evidence: "file.ts:1",
          recommendedAction: "Inspect",
          category: "other",
        }];
      },
      onWarnings: (_agentId, _warnings, source) => {
        callbackCount++;
        deliveredSource = source;
      },
    },
  );

  await runtime.handleAgentEnd({ id: "agent-1", type, cwd: "/tmp" });

  expect(selected?.model).toBe(expectedModel);
  expect(selected?.thinking).toBe(expectedThinking);
  expect(deliveredSource).toBe(expectedSource);
  expect(callbackCount).toBe(1);
});

it("does not auto-follow child-policy reviews", async () => {
  let reviewCount = 0;
  let resumeCount = 0;
  const runtime = createWatchdogRuntime(
    parseWatchdogConfig({
      enabled: true,
      reviewChangesOnly: false,
      children: { enabled: true },
      autoFollow: { blockers: true, maxAttempts: 2 },
    }),
    {
      runReview: async () => {
        reviewCount++;
        return [{
          severity: "blocker",
          summary: "Child issue",
          evidence: "file.ts:1",
          recommendedAction: "Fix",
          category: "correctness",
        }];
      },
      resumeAgent: async () => { resumeCount++; },
    },
  );

  await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: "/tmp" });

  expect(reviewCount).toBe(1);
  expect(resumeCount).toBe(0);
});
```

- [ ] **Step 2: Run the new tests and verify they fail for the missing runtime seam**

Run:

```bash
env \
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgsign \
  GIT_CONFIG_VALUE_0=false \
  pnpm vitest run tests/watchdog.test.ts
```

Expected: FAIL because `handleAgentEnd` still accepts positional arguments, `runReview` receives no selected configuration, and `onWarnings` receives no source.

- [ ] **Step 3: Add the subject and private policy selection seam**

In `src/core/watchdog.ts`, replace the positional runtime interface and extend the existing callbacks:

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

export interface WatchdogRuntimeOptions {
  /** Override reviewer execution for testing or custom implementations. */
  runReview?: (
    diff: string,
    lspOutput: string,
    agentId: string,
    reviewConfig: WatchdogConfig,
  ) => Promise<WatchdogWarning[]>;
  /** Called when warnings are produced. */
  onWarnings?: (
    agentId: string,
    warnings: WatchdogWarning[],
    source: "parent" | "child",
  ) => void;
  /** Return session messages for turn-delta mode (reviewChangesOnly: false). */
  getSessionMessages?: (agentId: string) => unknown[] | undefined;
  /** Resume a completed agent with a steering message. Used by auto-follow. */
  resumeAgent?: (agentId: string, message: string) => Promise<void>;
}
```

Add this private selector next to the Watchdog configuration code. Do not export it:

```ts
function selectReviewPolicy(
  config: WatchdogConfig,
  agentType: string,
): { reviewConfig: WatchdogConfig; source: "parent" | "child" } {
  const override = config.children.overrides[agentType];
  if (!config.children.enabled || override?.enabled === false) {
    return { reviewConfig: config, source: "parent" };
  }

  const model = override?.model ?? config.children.model ?? config.model;
  const thinking = override?.thinking ?? config.children.thinking ?? config.thinking;

  return {
    reviewConfig: {
      ...config,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
    },
    source: "child",
  };
}
```

The truthy conditional spreads preserve the current fallback behavior for empty override strings.

- [ ] **Step 4: Route review execution, warning delivery, and auto-follow through the selected policy**

At the start of `handleAgentEnd`, keep the disabled/disposed guard, then unpack the subject and select the policy:

```ts
async function handleAgentEnd(subject: WatchdogSubject): Promise<WatchdogWarning[]> {
  if (!config.enabled || disposed) return [];

  const { id: agentId, cwd } = subject;
  const { reviewConfig, source } = selectReviewPolicy(config, subject.type);
```

Change `shouldAutoFollow` to reject child-policy reviews before checking configured severities:

```ts
function shouldAutoFollow(
  warnings: WatchdogWarning[],
  source: "parent" | "child",
): boolean {
  if (source === "child" || !options?.resumeAgent) return false;
  const hasBlockers = warnings.some((w) => w.severity === "blocker");
  const hasConcerns = warnings.some((w) => w.severity === "concern");
  return (
    (config.autoFollow.blockers && hasBlockers) ||
    (config.autoFollow.concerns && hasConcerns)
  );
}
```

Add `source` to the existing `attemptAutoFollow` signature and change its first guard. Leave the steering loop below the guard byte-for-byte unchanged:

```diff
 async function attemptAutoFollow(
   agentId: string,
   initialWarnings: WatchdogWarning[],
   reReview: () => Promise<WatchdogWarning[]>,
+  source: "parent" | "child",
 ): Promise<WatchdogWarning[]> {
-  if (!shouldAutoFollow(initialWarnings)) return initialWarnings;
+  if (!shouldAutoFollow(initialWarnings, source)) return initialWarnings;
```

In the turn-delta branch, replace its injected and default review calls with:

```ts
if (options?.runReview) {
  return options.runReview(
    turnDelta,
    "N/A (turn-delta mode)",
    agentId,
    reviewConfig,
  );
}
const localSeen = new Set<string>();
return runDefaultReview(
  reviewConfig,
  turnDelta,
  "N/A (turn-delta mode)",
  agentId,
  localSeen,
);
```

In the change-review branch, replace its injected and default review calls with:

```ts
if (options?.runReview) {
  return options.runReview(diff, lspOutput, agentId, reviewConfig);
}
const localSeen = new Set<string>();
return runDefaultReview(reviewConfig, diff, lspOutput, agentId, localSeen);
```

Use `reviewConfig.lsp` for LSP enablement and diagnostics options. Pass `source` into both `attemptAutoFollow` calls, then deliver final warnings through:

```ts
if (warnings.length > 0) {
  options?.onWarnings?.(agentId, warnings, source);
}
```

Keep the existing `try/finally` status restoration and non-fatal reviewer error handling unchanged.

- [ ] **Step 5: Update existing runtime calls and consolidate policy tests**

In `tests/watchdog.test.ts`, replace every positional call:

```ts
await runtime.handleAgentEnd("agent-1", tmp);
```

with an Agent subject using the same id and cwd:

```ts
await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
```

Use each test's existing Agent id. Use `type: "worker"` unless that test explicitly exercises `scout` policy. Update non-awaited calls the same way:

```ts
const promise = runtime.handleAgentEnd({ id: "test-agent", type: "worker", cwd: tmp });
```

Confirm no positional test calls remain:

```bash
rg -n 'handleAgentEnd\("' tests/watchdog.test.ts
```

Expected: no matches.

The new runtime policy table replaces the direct cases in `tests/watchdog-child.test.ts`. Delete that test file only after the table covers parent defaults, child defaults, per-Agent overrides, and disabled overrides.

- [ ] **Step 6: Simplify the extension adapter and preserve warning payloads**

In `src/index.ts`, remove these imports:

```ts
import type { WatchdogWarning } from "./core/watchdog.js";
import { resolveChildWatchdogConfig } from "./core/watchdog-child.js";
```

Replace the Watchdog warning callback with one source-aware delivery path:

```ts
onWarnings: (agentId, warnings, source) => {
  for (const w of warnings) {
    const childLabel = source === "child" ? "/child" : "";
    const content = `[watchdog${childLabel}/${w.severity}] ${w.summary}\nEvidence: ${w.evidence}\nAction: ${w.recommendedAction}`;
    (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
      {
        customType: "watchdog-warning",
        content,
        display: true,
        details: {
          agentId,
          ...w,
          state: "displayed",
          ...(source === "child" ? { source } : {}),
        },
      } as unknown as Parameters<typeof pi.sendMessage>[0],
      { deliverAs: "followUp", triggerTurn: true },
    );
  }
},
```

Replace the child resolver, temporary runtime, and parent fallback block in the Agent completion callback with one call:

```ts
watchdog.handleAgentEnd({
  id: record.id,
  type: record.type,
  cwd: record.cwd ?? process.cwd(),
}).catch((err) => {
  console.error("[watchdog] handleAgentEnd failed:", err);
});
```

Keep the existing `watchdog.status() !== "disabled"` and `record.status === "completed"` guard around this call. Delete `src/core/watchdog-child.ts` after its only import is removed.

- [ ] **Step 7: Run focused and phase-level verification**

Run the consolidated runtime tests:

```bash
env \
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgsign \
  GIT_CONFIG_VALUE_0=false \
  pnpm vitest run tests/watchdog.test.ts
```

Expected: all tests in `tests/watchdog.test.ts` pass, including policy source/config selection and child auto-follow suppression.

Run the remaining Watchdog suite, typecheck, touched-file lint, and whitespace check:

```bash
env \
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgsign \
  GIT_CONFIG_VALUE_0=false \
  pnpm vitest run \
    tests/watchdog.test.ts \
    tests/watchdog-lsp.test.ts \
    tests/watchdog-model-selection.test.ts \
    tests/watchdog-render.test.ts \
    tests/watchdog-turn-delta.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/watchdog.ts src/index.ts tests/watchdog.test.ts
git diff --check
```

Expected: Watchdog tests and TypeScript pass; Biome reports no new errors; the diff has no whitespace errors. Existing non-failing lint warnings outside the changed lines are not part of this refactor.

- [ ] **Step 8: Commit the usable runtime refactor**

```bash
git add src/core/watchdog.ts src/index.ts tests/watchdog.test.ts
git rm src/core/watchdog-child.ts tests/watchdog-child.test.ts
git commit -m "refactor: deepen watchdog runtime policy"
```

Expected: one green refactor commit. `index.ts` owns delivery only, `watchdog.ts` owns policy and execution, and the deleted child module has no remaining imports.
