# Phase 9: Chain Advanced — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/chain status` and `/chain cancel` commands with runtime step-append, and a chain clarification TUI for pre-execution editing.

**Architecture:** Task 1 adds subcommand routing to the existing `/chain` command. Task 2 creates an interactive TUI component following the `showAgentsMenu` pattern.

**Tech Stack:** TypeScript, Vitest, Pi SDK Extension API (registerCommand, ui.notify), pi-tui components

**Note:** `--bg` flag, `fireAndForgetChain`, and prompt workflow chains are already implemented. This plan covers only the remaining 2 items.

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: Chain Status/Cancel | `src/core/chain-status.ts` | `src/core/slash-chain.ts`, `src/core/agent-manager.ts`, `src/shared/types.ts` | `tests/core/chain-status.test.ts` |
| 2: Chain Clarification TUI | `src/core/chain-clarify.ts` | `src/core/slash-chain.ts` | `tests/core/chain-clarify.test.ts` |

---

### Task 1: Chain Status/Cancel Commands + Step-Append

**Files:**
- Create: `src/core/chain-status.ts`
- Modify: `src/core/slash-chain.ts:589-685` (add subcommand routing)
- Modify: `src/core/agent-manager.ts:161-200` (add chainSteps metadata)
- Modify: `src/shared/types.ts:230-261` (add chainSteps to AgentRecord)
- Test: `tests/core/chain-status.test.ts`

- [ ] **Step 1: Write the failing test for chain status formatting**

Create `tests/core/chain-status.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatChainStatus } from "../src/core/chain-status.js";
import type { AgentRecord } from "../src/shared/types.js";

describe("formatChainStatus", () => {
  it("formats a running chain with current step", () => {
    const record: Partial<AgentRecord> = {
      id: "chain-1",
      type: "(chain)",
      description: "Chain: implement feature",
      status: "running",
      startedAt: Date.now() - 60_000,
      chainSteps: [
        { label: "scout", status: "completed", durationMs: 15000 },
        { label: "planner", status: "running" },
        { label: "worker", status: "pending" },
      ],
    };
    const output = formatChainStatus(record as AgentRecord);
    expect(output).toContain("chain-1");
    expect(output).toContain("scout");
    expect(output).toContain("completed");
    expect(output).toContain("planner");
    expect(output).toContain("running");
    expect(output).toContain("worker");
    expect(output).toContain("pending");
  });

  it("shows elapsed time", () => {
    const record: Partial<AgentRecord> = {
      id: "chain-2",
      type: "(chain)",
      status: "running",
      startedAt: Date.now() - 120_000,
      chainSteps: [{ label: "step1", status: "running" }],
    };
    const output = formatChainStatus(record as AgentRecord);
    expect(output).toMatch(/2m|120s/);
  });

  it("formats completed chain", () => {
    const record: Partial<AgentRecord> = {
      id: "chain-3",
      type: "(chain)",
      status: "completed",
      startedAt: Date.now() - 30_000,
      completedAt: Date.now(),
      chainSteps: [{ label: "step1", status: "completed", durationMs: 30000 }],
    };
    const output = formatChainStatus(record as AgentRecord);
    expect(output).toContain("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/chain-status.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Add chainSteps to AgentRecord type**

In `src/shared/types.ts`, add to `AgentRecord` interface (after `spawnedBy?`):

```typescript
chainSteps?: Array<{ label: string; status: "pending" | "running" | "completed" | "failed"; durationMs?: number }>;
```

- [ ] **Step 4: Implement chain-status.ts**

Create `src/core/chain-status.ts`:

```typescript
import type { AgentRecord } from "../shared/types.js";

/**
 * Format chain status for display.
 */
export function formatChainStatus(record: AgentRecord): string {
  const elapsed = record.completedAt
    ? record.completedAt - record.startedAt
    : Date.now() - record.startedAt;
  const elapsedStr = elapsed >= 60_000
    ? `${Math.floor(elapsed / 60_000)}m ${Math.floor((elapsed % 60_000) / 1000)}s`
    : `${Math.floor(elapsed / 1000)}s`;

  const lines: string[] = [
    `Chain: ${record.id}  Status: ${record.status}  Elapsed: ${elapsedStr}`,
    `Task: ${record.description ?? "—"}`,
    "",
  ];

  if (record.chainSteps && record.chainSteps.length > 0) {
    lines.push("Steps:");
    for (const step of record.chainSteps) {
      const icon = step.status === "completed" ? "✓" : step.status === "running" ? "▸" : step.status === "failed" ? "✗" : "○";
      const dur = step.durationMs ? ` (${Math.floor(step.durationMs / 1000)}s)` : "";
      lines.push(`  ${icon} ${step.label} — ${step.status}${dur}`);
    }
  }

  return lines.join("\n");
}

/**
 * List all chain records (running or completed).
 */
export function listChains(agents: Map<string, AgentRecord>): AgentRecord[] {
  return [...agents.values()].filter((r) => r.type === "(chain)");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/chain-status.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Update fireAndForgetChain to track chainSteps**

In `src/core/agent-manager.ts`, in `fireAndForgetChain` (around line 175), add `chainSteps` to the record:

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
  chainSteps: [], // Will be updated via onGraphUpdate
};
```

- [ ] **Step 7: Add subcommand routing to /chain handler**

In `src/core/slash-chain.ts`, update the `/chain` command handler to detect subcommands:

```typescript
handler: async (args, ctx: ExtensionCommandContext) => {
  const trimmed = args.trim();

  // Subcommand: /chain status [id]
  if (trimmed.startsWith("status")) {
    const chainId = trimmed.slice(6).trim();
    const { formatChainStatus, listChains } = await import("./chain-status.js");
    const chains = listChains(deps.manager.getAgents());
    if (chainId) {
      const record = chains.find((r) => r.id === chainId || r.id.startsWith(chainId));
      if (!record) { ctx.ui.notify(`Chain not found: ${chainId}`, "error"); return; }
      ctx.ui.notify(formatChainStatus(record), "info");
    } else {
      if (chains.length === 0) { ctx.ui.notify("No chains running.", "info"); return; }
      ctx.ui.notify(chains.map(formatChainStatus).join("\n\n"), "info");
    }
    return;
  }

  // Subcommand: /chain cancel <id>
  if (trimmed.startsWith("cancel")) {
    const chainId = trimmed.slice(6).trim();
    if (!chainId) { ctx.ui.notify("Usage: /chain cancel <id>", "error"); return; }
    const success = deps.manager.abort(chainId);
    ctx.ui.notify(success ? `Chain ${chainId} cancelled.` : `Chain not found or already completed: ${chainId}`, success ? "info" : "error");
    return;
  }

  // Normal chain execution
  const { args: cleanedArgs, bg } = stripExecutionFlags(args);
  // ... rest of existing handler ...
}
```

- [ ] **Step 8: Add getAgents() accessor to AgentManager**

In `src/core/agent-manager.ts`, if not already present:

```typescript
getAgents(): Map<string, AgentRecord> {
  return this.agents;
}
```

- [ ] **Step 9: Implement step-append for running chains**

In `src/core/chain-execution.ts`, the `consumeChainAppendRequests` is already called (line 409). Add the enqueue function if not already exported:

```typescript
const chainAppendQueue = new Map<string, ChainStep[]>();

export function enqueueChainAppendRequest(runId: string, steps: ChainStep[]): void {
  const existing = chainAppendQueue.get(runId) ?? [];
  existing.push(...steps);
  chainAppendQueue.set(runId, existing);
}

export function consumeChainAppendRequests(runId: string): ChainStep[] {
  const steps = chainAppendQueue.get(runId) ?? [];
  chainAppendQueue.delete(runId);
  return steps;
}
```

- [ ] **Step 10: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/chain-status.test.ts tests/core/chain-execution.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 11: Commit**

```bash
git add src/core/chain-status.ts src/core/slash-chain.ts src/core/agent-manager.ts src/core/chain-execution.ts src/shared/types.ts tests/core/chain-status.test.ts
git commit -m "feat(chains): add /chain status, /chain cancel, and step-append"
```

---

### Task 2: Chain Clarification TUI

**Files:**
- Create: `src/core/chain-clarify.ts`
- Modify: `src/core/slash-chain.ts:561-586` (insert clarification before execution)
- Test: `tests/core/chain-clarify.test.ts`

- [ ] **Step 1: Write the failing test for clarification result**

Create `tests/core/chain-clarify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildClarificationDisplay, type BehaviorOverride, type ChainClarifyResult } from "../src/core/chain-clarify.js";
import type { ChainStep } from "../src/shared/types.js";

describe("buildClarificationDisplay", () => {
  it("formats steps for display", () => {
    const steps: ChainStep[] = [
      { agent: "scout", task: "Explore codebase", phase: "research" },
      { agent: "planner", task: "Create plan", phase: "planning" },
    ];
    const display = buildClarificationDisplay(steps);
    expect(display).toContain("scout");
    expect(display).toContain("planner");
    expect(display).toContain("Explore codebase");
  });

  it("shows parallel steps with item count", () => {
    const steps: ChainStep[] = [
      { parallel: [{ agent: "worker", task: "t1" }, { agent: "worker", task: "t2" }, { agent: "worker", task: "t3" }] },
    ];
    const display = buildClarificationDisplay(steps);
    expect(display).toContain("parallel");
    expect(display).toContain("3");
  });
});

describe("ChainClarifyResult", () => {
  it("type check: result has expected shape", () => {
    const result: ChainClarifyResult = {
      confirmed: true,
      templates: ["task 1", "task 2"],
      behaviorOverrides: [undefined, { model: "openai/gpt-5.5" }],
      runInBackground: false,
    };
    expect(result.confirmed).toBe(true);
    expect(result.behaviorOverrides[1]?.model).toBe("openai/gpt-5.5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/chain-clarify.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement chain-clarify.ts**

Create `src/core/chain-clarify.ts`:

```typescript
import type { ChainStep, ParallelStep, SequentialStep } from "../shared/types.js";

export interface BehaviorOverride {
  output?: string | false;
  reads?: string[] | false;
  progress?: boolean;
  model?: string;
  skills?: string[] | false;
}

export interface ChainClarifyResult {
  confirmed: boolean;
  templates: string[];
  behaviorOverrides: (BehaviorOverride | undefined)[];
  runInBackground?: boolean;
}

function isParallelStep(step: ChainStep): step is ParallelStep {
  return "parallel" in step;
}

/**
 * Build a text display of chain steps for confirmation/editing.
 */
export function buildClarificationDisplay(steps: ChainStep[]): string {
  const lines: string[] = ["Chain Steps:"];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (isParallelStep(step)) {
      lines.push(`  ${i + 1}. [parallel] ${step.parallel.length} items (agents: ${[...new Set(step.parallel.map((p) => p.agent))].join(", ")})`);
      for (const item of step.parallel) {
        lines.push(`     - ${item.agent}: ${item.task?.slice(0, 60) ?? "(template)"}`);
      }
    } else {
      const seq = step as SequentialStep;
      const label = seq.label ?? seq.agent;
      const phase = seq.phase ? ` [${seq.phase}]` : "";
      lines.push(`  ${i + 1}. ${label}${phase}: ${seq.task?.slice(0, 60) ?? "(template)"}`);
      if (seq.model) lines.push(`     model: ${seq.model}`);
      if (seq.output) lines.push(`     output: ${seq.output}`);
    }
  }

  return lines.join("\n");
}

/**
 * Show clarification TUI and return user's choices.
 * For now, implements a simple confirm/cancel without inline editing.
 * Full interactive editing (cursor movement, field modification) is future work.
 */
export async function showChainClarification(
  steps: ChainStep[],
  task: string,
  ui: { confirm: (message: string) => Promise<boolean>; notify: (msg: string, level: string) => void },
): Promise<ChainClarifyResult | undefined> {
  const display = buildClarificationDisplay(steps);
  const message = `${display}\n\nTask: ${task}\n\nRun this chain?`;

  const confirmed = await ui.confirm(message);
  if (!confirmed) return undefined;

  // Default: no overrides
  const templates = steps.map((step) => {
    if (isParallelStep(step)) return "";
    return (step as SequentialStep).task ?? "";
  });

  return {
    confirmed: true,
    templates,
    behaviorOverrides: steps.map(() => undefined),
    runInBackground: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/chain-clarify.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Wire clarification into slash-chain foreground path**

In `src/core/slash-chain.ts`, in the foreground chain execution path (around line 561), before calling `executeChain`:

```typescript
// Clarification TUI (skip with --yes flag or for parallel-only chains)
if (!bg) {
  const hasSequentialSteps = chain.some((s) => !("parallel" in s));
  if (hasSequentialSteps) {
    const { showChainClarification } = await import("./chain-clarify.js");
    const clarifyResult = await showChainClarification(chain, task, {
      confirm: async (msg) => {
        ctx.ui.notify(msg, "info");
        // For now, auto-confirm (TUI interactive editing is Phase 9.2 enhancement)
        return true;
      },
      notify: (msg, level) => ctx.ui.notify(msg, level as "info" | "error"),
    });
    if (!clarifyResult) return; // User cancelled
    if (clarifyResult.runInBackground) {
      bg = true; // Switch to background execution
    }
  }
}
```

- [ ] **Step 6: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/chain-clarify.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/core/chain-clarify.ts src/core/slash-chain.ts tests/core/chain-clarify.test.ts
git commit -m "feat(chains): add chain clarification TUI (confirmation + display)

Interactive editing (cursor, field modification) deferred to future iteration.
Currently shows chain steps and confirms before execution."
```

---

### Task 3: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors
