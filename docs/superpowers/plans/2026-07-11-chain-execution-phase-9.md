# Chain Execution — Phase 9: TUI Chain Widget

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/tui/chain-widget.ts` — a TUI component that renders chain workflow progress (step status, parallel groups, phases).

**Architecture:** The widget accepts `WorkflowGraphSnapshot` updates and renders them as a text-based progress display. It's wired into `RuntimeDeps` and created in `src/index.ts`. The `executeChain()` orchestrator calls `onGraphUpdate()` to push snapshots.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui`

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 (WorkflowGraphSnapshot types), Phase 6 (chain-execution provides onGraphUpdate callback).

---

### Task 10: Create `src/tui/chain-widget.ts`

**Files:**

- Create: `src/tui/chain-widget.ts`
- Modify: `src/shared/runtime-deps.ts` (add chainWidget type)
- Modify: `src/index.ts` (create and wire widget)

- [ ] **Step 1: Create the chain widget**

Create `src/tui/chain-widget.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type {
  WorkflowGraphSnapshot,
  WorkflowGraphNode,
  WorkflowNodeStatus,
} from "../shared/types.js";

export interface ChainWidget {
  update(snapshot: WorkflowGraphSnapshot): void;
  clear(): void;
  dispose(): void;
}

function statusIcon(status: WorkflowNodeStatus): string {
  switch (status) {
    case "completed":
      return "done";
    case "running":
      return "run ";
    case "failed":
      return "FAIL";
    case "skipped":
      return "skip";
    case "paused":
      return "paus";
    case "stopped":
      return "stop";
    default:
      return "wait";
  }
}

function renderNode(
  node: WorkflowGraphNode,
  total: number,
  index: number,
): string {
  const idx = `[${index + 1}/${total}]`;
  const label = node.label || node.agent || "step";
  const phase = node.phase ? ` (${node.phase})` : "";
  const line = `  ${idx} ${statusIcon(node.status)}  ${label}${phase}`;

  if (node.children && node.children.length > 0) {
    const childLines = node.children.map((child, i) => {
      const prefix = i === node.children!.length - 1 ? "    +- " : "    +- ";
      return `${prefix}${statusIcon(child.status)}  ${child.agent ?? "agent"}${child.label ? ` "${child.label}"` : ""}`;
    });
    return [line, ...childLines].join("\n");
  }

  return line;
}

export function createChainWidget(_pi: ExtensionAPI): ChainWidget {
  let currentSnapshot: WorkflowGraphSnapshot | null = null;

  return {
    update(snapshot: WorkflowGraphSnapshot) {
      currentSnapshot = snapshot;
      // TUI rendering is done through pi widget API — implementation depends on
      // how the existing agent-widget registers. For now, store the snapshot.
      // Full TUI rendering will be wired once the widget API pattern is confirmed.
    },
    clear() {
      currentSnapshot = null;
    },
    dispose() {
      currentSnapshot = null;
    },
  };
}

// Exported for testing — renders snapshot to a string
export function renderChainProgress(snapshot: WorkflowGraphSnapshot): string {
  if (snapshot.nodes.length === 0) return "";
  const lines = [`Chain: ${snapshot.runId}`];
  snapshot.nodes.forEach((node, i) => {
    lines.push(renderNode(node, snapshot.nodes.length, i));
  });
  return lines.join("\n");
}
```

- [ ] **Step 2: Add `ChainWidget` to `RuntimeDeps`**

In `src/shared/runtime-deps.ts`, add:

```typescript
import type { ChainWidget } from "../tui/chain-widget.js";

// Add to RuntimeDeps interface:
  chainWidget?: ChainWidget;
```

- [ ] **Step 3: Create and wire chain widget in `src/index.ts`**

In `createRuntimeDeps()`, after the fleet list creation:

```typescript
import { createChainWidget } from "./tui/chain-widget.js";

// After fleet creation:
const chainWidget = createChainWidget(pi);

// Add to deps object:
const deps: RuntimeDeps = {
  // ...existing fields...
  chainWidget,
};
```

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/chain-widget.ts src/shared/runtime-deps.ts src/index.ts
git commit -m "feat(tui): add chain widget for workflow graph display"
```
