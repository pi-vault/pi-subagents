# Phase 9: Chain Advanced — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/chain status` and `/chain cancel` subcommands with live step-progress tracking, and wire the existing chain clarification TUI into foreground execution.

**Architecture:** Task 1 adds subcommand routing to the `/chain` handler (following the watchdog subcommand pattern). Task 2 wires the existing `ChainClarifyComponent` (in `src/tui/chain-clarify.ts`) into the foreground execution path via `ctx.ui.custom<T>()`.

**Tech Stack:** TypeScript, Vitest, Pi SDK Extension API (`registerCommand`, `ui.notify`, `ui.custom`), pi-tui `Component` interface

**Already implemented (do NOT re-implement):**

- `--bg` flag and `fireAndForgetChain` (agent-manager.ts:165-204)
- Chain append queue (`src/core/chain-append.ts` — `enqueueChainAppendRequest`, `consumeChainAppendRequests`, integrated at chain-execution.ts:489)
- Chain clarification TUI component (`src/tui/chain-clarify.ts` — `ChainClarifyComponent`, 211 lines)
- Chain clarification tests (`tests/chain-clarify.test.ts` — 257 lines, 15 tests)
- Workflow graph snapshot building (`src/core/workflow-graph.ts`, `src/tui/chain-widget.ts`)

---

## File Map

| Task                      | Create                     | Modify                                                                        | Test                                           |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| 1: Chain Status/Cancel    | `src/core/chain-status.ts` | `src/shared/types.ts`, `src/core/agent-manager.ts`, `src/core/slash-chain.ts` | `tests/core/chain-status.test.ts`              |
| 2: Wire Clarification TUI | —                          | `src/core/slash-chain.ts`                                                     | `tests/core/chain-clarify-integration.test.ts` |

---

## Verified API Surface

These were verified against the Pi SDK (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) and the nicobailon and tintinweb reference implementations.

**`ctx.ui.custom<T>()`** — launches TUI overlay, returns `Promise<T>`:

```typescript
// Signature (from pi SDK ExtensionUIContext):
custom<T>(
  factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void)
    => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean; overlayOptions?: OverlayOptions | (() => OverlayOptions) },
): Promise<T>;
```

**`deps.manager.listAgents()`** — returns `AgentRecord[]` (line 540). No `getAgents()` exists.

**`deps.manager.abort(id)`** — returns `boolean` (line 486). Handles queued and running agents.

**`ChainClarifyComponent`** constructor — `(tui: TUI, theme: Theme, steps: ChainStep[], done: (result: ChainClarifyResult) => void)`.

**`ChainClarifyResult`** — `{ action: "run" | "cancel" | "bg"; steps: ChainStep[] }`. Note: `steps` includes any task/model overrides applied by the user.

**`WorkflowGraphSnapshot`** — contains `nodes: WorkflowGraphNode[]` where each node has `{ label, status: WorkflowNodeStatus, ... }`. The `onGraphUpdate` callback in `executeChain` emits these as steps transition through pending/running/completed/failed.

**Subcommand routing pattern** (from nicobailon watchdog — `src/watchdog/register-main.ts:250`):

```typescript
const input = args.trim();
if (!input || input === "status") {
  /* handle status */
}
if (input.startsWith("cancel ")) {
  /* handle cancel */
}
// ... fall through to normal execution
```

---

### Task 1: Chain Status/Cancel Subcommands

**Files:**

- Create: `src/core/chain-status.ts`
- Modify: `src/shared/types.ts:231-262` (add `chainSteps` to `AgentRecord`)
- Modify: `src/core/agent-manager.ts:165-204` (init `chainSteps` in `fireAndForgetChain`)
- Modify: `src/core/slash-chain.ts:590-625` (add subcommand routing before expression parsing)
- Modify: `src/core/slash-chain.ts:543-558` (pass `onGraphUpdate` that syncs to record.chainSteps)
- Test: `tests/core/chain-status.test.ts`

- [ ] **Step 1: Add `chainSteps` to `AgentRecord` type**

In `src/shared/types.ts`, add after `spawnedBy?` (line 261):

```typescript
  chainSteps?: Array<{
    label: string;
    status: WorkflowNodeStatus;
    durationMs?: number;
    error?: string;
  }>;
```

This reuses the existing `WorkflowNodeStatus` type (line 452) rather than defining a new union.

- [ ] **Step 2: Write failing tests for chain-status**

Create `tests/core/chain-status.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatChainStatus, listChains } from "../src/core/chain-status.js";
import type { AgentRecord } from "../src/shared/types.js";

function makeRecord(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: "chain-1",
    type: "(chain)",
    description: "Chain: test",
    status: "running",
    startedAt: Date.now() - 60_000,
    toolUses: 0,
    turnCount: 0,
    lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    ...overrides,
  } as AgentRecord;
}

describe("formatChainStatus", () => {
  it("formats a running chain with step statuses", () => {
    const record = makeRecord({
      chainSteps: [
        { label: "scout", status: "completed", durationMs: 15000 },
        { label: "planner", status: "running" },
        { label: "worker", status: "pending" },
      ],
    });
    const output = formatChainStatus(record);
    expect(output).toContain("chain-1");
    expect(output).toContain("scout");
    expect(output).toContain("completed");
    expect(output).toContain("planner");
    expect(output).toContain("running");
    expect(output).toContain("worker");
    expect(output).toContain("pending");
  });

  it("shows elapsed time for running chain", () => {
    const record = makeRecord({
      id: "chain-2",
      startedAt: Date.now() - 120_000,
      chainSteps: [{ label: "step1", status: "running" }],
    });
    const output = formatChainStatus(record);
    expect(output).toMatch(/2m/);
  });

  it("shows duration for completed chain", () => {
    const now = Date.now();
    const record = makeRecord({
      id: "chain-3",
      status: "completed",
      startedAt: now - 30_000,
      completedAt: now,
      chainSteps: [{ label: "step1", status: "completed", durationMs: 30000 }],
    });
    const output = formatChainStatus(record);
    expect(output).toContain("completed");
    expect(output).toContain("30s");
  });

  it("handles chain with no chainSteps gracefully", () => {
    const record = makeRecord({});
    const output = formatChainStatus(record);
    expect(output).toContain("chain-1");
    expect(output).not.toContain("Steps:");
  });

  it("shows error on failed step", () => {
    const record = makeRecord({
      chainSteps: [
        { label: "worker", status: "failed", error: "Build failed" },
      ],
    });
    const output = formatChainStatus(record);
    expect(output).toContain("failed");
    expect(output).toContain("Build failed");
  });
});

describe("listChains", () => {
  it("filters to chain-type records", () => {
    const records: AgentRecord[] = [
      makeRecord({ id: "chain-1", type: "(chain)" }),
      makeRecord({ id: "agent-1", type: "scout" }),
      makeRecord({ id: "chain-2", type: "(chain)" }),
    ];
    const chains = listChains(records);
    expect(chains).toHaveLength(2);
    expect(chains.map((c) => c.id)).toEqual(["chain-1", "chain-2"]);
  });

  it("returns empty array when no chains", () => {
    const records: AgentRecord[] = [
      makeRecord({ id: "agent-1", type: "scout" }),
    ];
    expect(listChains(records)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/core/chain-status.test.ts --reporter=verbose`
Expected: FAIL — module `chain-status.js` not found

- [ ] **Step 4: Implement `chain-status.ts`**

Create `src/core/chain-status.ts`:

```typescript
import type { AgentRecord } from "../shared/types.js";

export function formatChainStatus(record: AgentRecord): string {
  const elapsed = record.completedAt
    ? record.completedAt - record.startedAt
    : Date.now() - record.startedAt;
  const elapsedStr =
    elapsed >= 60_000
      ? `${Math.floor(elapsed / 60_000)}m ${Math.floor((elapsed % 60_000) / 1000)}s`
      : `${Math.floor(elapsed / 1000)}s`;

  const lines: string[] = [
    `Chain: ${record.id}  Status: ${record.status}  Elapsed: ${elapsedStr}`,
    `Task: ${record.description ?? "\u2014"}`,
  ];

  if (record.chainSteps && record.chainSteps.length > 0) {
    lines.push("", "Steps:");
    for (const step of record.chainSteps) {
      const icon =
        step.status === "completed"
          ? "\u2713"
          : step.status === "running"
            ? "\u25b8"
            : step.status === "failed"
              ? "\u2717"
              : "\u25cb";
      const dur =
        step.durationMs != null
          ? ` (${Math.floor(step.durationMs / 1000)}s)`
          : "";
      const err = step.error ? ` \u2014 ${step.error}` : "";
      lines.push(`  ${icon} ${step.label} \u2014 ${step.status}${dur}${err}`);
    }
  }

  return lines.join("\n");
}

export function listChains(agents: AgentRecord[]): AgentRecord[] {
  return agents.filter((r) => r.type === "(chain)");
}
```

Note: `listChains` accepts `AgentRecord[]` (matching `deps.manager.listAgents()` return type), NOT `Map<string, AgentRecord>`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/core/chain-status.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Init `chainSteps` in `fireAndForgetChain`**

In `src/core/agent-manager.ts`, inside `fireAndForgetChain` (line 172-183), add `chainSteps: []` to the record literal:

```typescript
const record: AgentRecord = {
  id,
  type: "(chain)",
  description: `Chain: ${task.slice(0, 60)}`,
  status: "running",
  startedAt: Date.now(),
  toolUses: 0,
  turnCount: 0,
  lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
  isBackground: true,
  cwd,
  chainSteps: [],
};
```

- [ ] **Step 7: Sync `onGraphUpdate` to `record.chainSteps` for background chains**

In `src/core/slash-chain.ts`, in the background chain path (lines 543-558), the `onGraphUpdate` callback currently only updates the chain widget. Add a second line to sync `record.chainSteps`:

Before (line 549):

```typescript
      executeChain({ steps: chain, task, spawnAndWait, findAgent, cwd: ctx.cwd, runId: chainRunId, onGraphUpdate: (s) => deps.chainWidget?.update(s), getSpawnBudget: () => deps.manager.getSpawnBudget() }),
```

After:

```typescript
      executeChain({
        steps: chain,
        task,
        spawnAndWait,
        findAgent,
        cwd: ctx.cwd,
        runId: chainRunId,
        onGraphUpdate: (snapshot) => {
          deps.chainWidget?.update(snapshot);
          const record = deps.manager.getRecord(chainRunId);
          if (record) {
            record.chainSteps = snapshot.nodes
              .filter((n) => n.kind === "step" || n.kind === "agent")
              .map((n) => ({ label: n.label, status: n.status, error: n.error }));
          }
        },
        getSpawnBudget: () => deps.manager.getSpawnBudget(),
      }),
```

Also update the foreground path (line 570) similarly:

```typescript
      onGraphUpdate: (snapshot) => {
        deps.chainWidget?.update(snapshot);
        const record = deps.manager.getRecord(chainRunId);
        if (record) {
          record.chainSteps = snapshot.nodes
            .filter((n) => n.kind === "step" || n.kind === "agent")
            .map((n) => ({ label: n.label, status: n.status, error: n.error }));
        }
      },
```

Note: `deps.manager.getRecord(id)` exists at line 536 and returns `AgentRecord | undefined`.

- [ ] **Step 8: Add subcommand routing to `/chain` handler**

In `src/core/slash-chain.ts`, modify the `/chain` handler (line 613) to detect subcommands before falling through to expression parsing:

```typescript
    handler: async (args, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();

      // Subcommand: /chain status [id]
      if (trimmed === "status" || trimmed.startsWith("status ")) {
        const chainId = trimmed === "status" ? "" : trimmed.slice(7).trim();
        const { formatChainStatus, listChains } = await import("./chain-status.js");
        const chains = listChains(deps.manager.listAgents());
        if (chainId) {
          const record = chains.find((r) => r.id === chainId || r.id.startsWith(chainId));
          if (!record) {
            ctx.ui.notify(`Chain not found: ${chainId}`, "error");
            return;
          }
          ctx.ui.notify(formatChainStatus(record), "info");
        } else {
          if (chains.length === 0) {
            ctx.ui.notify("No chains running.", "info");
            return;
          }
          ctx.ui.notify(chains.map(formatChainStatus).join("\n\n"), "info");
        }
        return;
      }

      // Subcommand: /chain cancel <id>
      if (trimmed === "cancel" || trimmed.startsWith("cancel ")) {
        const chainId = trimmed === "cancel" ? "" : trimmed.slice(7).trim();
        if (!chainId) {
          ctx.ui.notify("Usage: /chain cancel <id>", "error");
          return;
        }
        const success = deps.manager.abort(chainId);
        ctx.ui.notify(
          success
            ? `Chain ${chainId} cancelled.`
            : `Chain not found or already completed: ${chainId}`,
          success ? "info" : "error",
        );
        return;
      }

      // Normal chain execution (existing code, unchanged)
      const { args: cleanedArgs, bg } = stripExecutionFlags(args);
      const paths = deps.resolvePaths();
      const agents = deps.discoverAgents(paths).agents;

      const built = buildChainSteps(cleanedArgs, agents, (msg) =>
        ctx.ui.notify(msg, "error"),
      );
      if (!built) return;

      await executeSlashChain(pi, ctx, deps, built.chain, built.task, bg);
    },
```

- [ ] **Step 9: Typecheck and run all chain tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/chain-status.test.ts tests/core/chain-execution.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 10: Commit**

```bash
git add src/core/chain-status.ts src/core/slash-chain.ts src/core/agent-manager.ts src/shared/types.ts tests/core/chain-status.test.ts
git commit -m "feat(chains): add /chain status, /chain cancel with live step tracking"
```

---

### Task 2: Wire Chain Clarification TUI into Foreground Execution

**Files:**

- Modify: `src/core/slash-chain.ts:504-512` (add `--yes` to `ExecutionFlags`)
- Modify: `src/core/slash-chain.ts:60-73` (parse `--yes` flag in `stripExecutionFlags`)
- Modify: `src/core/slash-chain.ts:504-560` (add clarification gate before `executeChain`)
- Test: `tests/core/chain-clarify-integration.test.ts`

**No new source files.** The TUI component already exists at `src/tui/chain-clarify.ts` with `ChainClarifyComponent` and `ChainClarifyResult` (tested in `tests/chain-clarify.test.ts`).

- [ ] **Step 1: Add `--yes` flag to `ExecutionFlags` and `stripExecutionFlags`**

In `src/core/slash-chain.ts`, update the `ExecutionFlags` interface (line 55):

```typescript
export interface ExecutionFlags {
  args: string;
  bg: boolean;
  yes: boolean;
}
```

Update `stripExecutionFlags` (line 61) to also strip `--yes`:

```typescript
export function stripExecutionFlags(rawArgs: string): ExecutionFlags {
  let args = rawArgs.trim();
  let bg = false;
  let yes = false;
  for (;;) {
    if (args.endsWith(" --bg") || args === "--bg") {
      args = args === "--bg" ? "" : args.slice(0, -5).trim();
      bg = true;
    } else if (args.endsWith(" --fork") || args === "--fork") {
      args = args === "--fork" ? "" : args.slice(0, -7).trim();
    } else if (args.endsWith(" --yes") || args === "--yes") {
      args = args === "--yes" ? "" : args.slice(0, -6).trim();
      yes = true;
    } else break;
  }
  return { args, bg, yes };
}
```

- [ ] **Step 2: Thread `yes` flag through `executeSlashChain`**

Update the `executeSlashChain` signature (line 505) to accept the `yes` flag:

```typescript
export async function executeSlashChain(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  chain: ChainStep[],
  task: string,
  bg = false,
  yes = false,
): Promise<void> {
```

Update both call sites in `registerChainCommands` to pass `yes`:

- `/chain` handler (around line 623): `await executeSlashChain(pi, ctx, deps, built.chain, built.task, bg, yes);`
- `/run-chain` handler (around line 676): `await executeSlashChain(pi, ctx, deps, chain.steps as ChainStep[], task, bg, yes);`

Note: both call sites destructure from `stripExecutionFlags(args)` which now returns `{ args, bg, yes }`.

- [ ] **Step 3: Add clarification gate in foreground path**

In `executeSlashChain`, insert the clarification gate after line 541 (`const findAgent = ...`) and before the background check at line 543 (`if (bg) {`):

```typescript
// Clarification TUI — show step preview before foreground execution
// Skip when: --bg (background), --yes (auto-confirm), or no UI available
if (!bg && !yes) {
  const { ChainClarifyComponent } = await import("../tui/chain-clarify.js");
  type ClarifyResult = import("../tui/chain-clarify.js").ChainClarifyResult;

  const result = await ctx.ui.custom<ClarifyResult>(
    (tui, theme, _kb, done) =>
      new ChainClarifyComponent(tui, theme, chain, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" },
    },
  );

  if (!result || result.action === "cancel") return;
  if (result.action === "bg") {
    bg = true;
    chain = result.steps; // Apply any edits
  } else {
    chain = result.steps; // Apply task/model overrides from TUI
  }
}
```

This uses the same `ctx.ui.custom()` pattern verified in nicobailon (`chain-execution.ts:593-612`) and tintinweb (`index.ts:1685-1697`).

The `ChainClarifyComponent` calls `done({ action, steps })` when the user presses Enter (run), b (background), or Esc (cancel). Overridden task/model values are baked into the returned `steps` array by `applyOverrides()` (chain-clarify.ts:197-210).

- [ ] **Step 4: Make `chain` parameter mutable**

The `chain` parameter in `executeSlashChain` is currently `chain: ChainStep[]`. Since we reassign it from the clarification result, change it to `let`:

At the top of the function body (after destructuring), reassign through `let`:

```typescript
export async function executeSlashChain(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  inputChain: ChainStep[],
  task: string,
  bg = false,
  yes = false,
): Promise<void> {
  let chain = inputChain;
```

Rename the parameter to `inputChain` and add `let chain = inputChain;` at the top. The rest of the function already uses `chain` throughout, so no further changes are needed.

- [ ] **Step 5: Write integration test for clarification wiring**

Create `tests/core/chain-clarify-integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stripExecutionFlags } from "../src/core/slash-chain.js";

describe("stripExecutionFlags --yes support", () => {
  it("strips --yes flag", () => {
    const result = stripExecutionFlags('scout "task" -> planner --yes');
    expect(result.yes).toBe(true);
    expect(result.bg).toBe(false);
    expect(result.args).toBe('scout "task" -> planner');
  });

  it("strips --yes and --bg together", () => {
    const result = stripExecutionFlags('scout "task" --bg --yes');
    expect(result.yes).toBe(true);
    expect(result.bg).toBe(true);
    expect(result.args).toBe('scout "task"');
  });

  it("strips --yes alone", () => {
    const result = stripExecutionFlags("--yes");
    expect(result.yes).toBe(true);
    expect(result.args).toBe("");
  });

  it("does not set yes when flag absent", () => {
    const result = stripExecutionFlags('scout "task"');
    expect(result.yes).toBe(false);
  });
});
```

- [ ] **Step 6: Typecheck and run tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/chain-clarify-integration.test.ts tests/chain-clarify.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/core/slash-chain.ts tests/core/chain-clarify-integration.test.ts
git commit -m "feat(chains): wire clarification TUI into foreground execution

Shows interactive step preview (task/model editing, bg switch) before
running foreground chains. Skip with --yes flag."
```

---

### Task 3: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass (including existing chain-clarify.test.ts, chain-execution.test.ts)

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npx biome check src/ tests/`
Expected: No errors (or only pre-existing warnings)
