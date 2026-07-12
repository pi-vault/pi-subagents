# Chain Execution — Phase 9: TUI Chain Widget

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chain execution progress visible in the TUI — build the workflow graph snapshot at each step transition, emit it via the existing `onGraphUpdate` callback, and render it as a live widget above the editor.

**Architecture:** Three pieces work together: (1) a pure function `buildWorkflowGraphSnapshot()` constructs a `WorkflowGraphSnapshot` from chain steps + execution state, (2) the `executeChain()` step loop calls this builder and emits via `onGraphUpdate` at each state transition, (3) a `ChainWidget` class (following the established `AgentWidget` pattern) receives snapshots and renders themed progress lines via `UICtx.setWidget()`.

**Tech Stack:** TypeScript, Vitest, `@earendil-works/pi-tui` (Text, Container, truncateToWidth)

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents/src/runs/shared/workflow-graph.ts`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 (WorkflowGraphSnapshot types in `src/shared/types.ts`), Phase 6 (`executeChain()` with `onGraphUpdate` param defined).

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/core/workflow-graph.ts` | Pure function `buildWorkflowGraphSnapshot()` — constructs `WorkflowGraphSnapshot` from steps + execution state |
| `src/tui/chain-widget.ts` | `ChainWidget` class — receives snapshots, renders themed progress via `UICtx.setWidget()` |
| `tests/workflow-graph.test.ts` | Tests for graph builder |
| `tests/chain-widget.test.ts` | Tests for widget rendering |

### Modified Files

| File | Changes |
|------|---------|
| `src/core/chain-execution.ts` | Add snapshot building + emission at step boundaries |
| `src/shared/runtime-deps.ts` | Add optional `chainWidget` field |
| `src/index.ts` | Create `ChainWidget`, add to deps, share `UICtx` |
| `src/core/slash-chain.ts` | Pass `onGraphUpdate` to `executeChain()` |
| `src/core/subagent.ts` | Pass `onGraphUpdate` to `executeChain()` |

---

## Task 10: Workflow Graph Builder

**Files:**

- Create: `src/core/workflow-graph.ts`
- Create: `tests/workflow-graph.test.ts`

- [ ] **Step 1: Write failing tests for graph builder**

Create `tests/workflow-graph.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { buildWorkflowGraphSnapshot } from "../src/core/workflow-graph.js";
import type {
  ChainStep,
  SequentialStep,
  ParallelStep,
  DynamicParallelStep,
  WorkflowNodeStatus,
} from "../src/shared/types.js";

describe("buildWorkflowGraphSnapshot", () => {
  test("builds snapshot for sequential steps", () => {
    const steps: ChainStep[] = [
      { agent: "scout", task: "scan", label: "Scan files" },
      { agent: "planner", task: "plan" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "test-run",
      steps,
    });

    expect(snapshot.runId).toBe("test-run");
    expect(snapshot.mode).toBe("chain");
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0]).toMatchObject({
      id: "step-0",
      kind: "step",
      agent: "scout",
      label: "Scan files",
      status: "pending",
      flatIndex: 0,
      stepIndex: 0,
    });
    expect(snapshot.nodes[1]).toMatchObject({
      id: "step-1",
      kind: "step",
      agent: "planner",
      label: "planner",
      status: "pending",
      flatIndex: 1,
      stepIndex: 1,
    });
  });

  test("marks current step as running", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t" },
      { agent: "b", task: "t" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      currentStepIndex: 1,
      currentFlatIndex: 1,
    });

    expect(snapshot.nodes[0]!.status).toBe("pending");
    expect(snapshot.nodes[1]!.status).toBe("running");
    expect(snapshot.currentNodeId).toBe("step-1");
  });

  test("uses stepStatuses when provided", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t" },
      { agent: "b", task: "t" },
      { agent: "c", task: "t" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      currentFlatIndex: 2,
      stepStatuses: [
        { status: "completed" },
        { status: "completed" },
        { status: "running" },
      ],
    });

    expect(snapshot.nodes[0]!.status).toBe("completed");
    expect(snapshot.nodes[1]!.status).toBe("completed");
    expect(snapshot.nodes[2]!.status).toBe("running");
  });

  test("builds snapshot for parallel step", () => {
    const steps: ChainStep[] = [
      { agent: "first", task: "t" },
      {
        parallel: [
          { agent: "worker-a", task: "t", label: "Worker A" },
          { agent: "worker-b", task: "t" },
        ],
      },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      stepStatuses: [
        { status: "completed" },
        { status: "running" },
        { status: "pending" },
      ],
    });

    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0]!.status).toBe("completed");
    const group = snapshot.nodes[1]!;
    expect(group.kind).toBe("parallel-group");
    expect(group.status).toBe("running");
    expect(group.children).toHaveLength(2);
    expect(group.children![0]).toMatchObject({
      kind: "agent",
      agent: "worker-a",
      label: "Worker A",
      status: "running",
      flatIndex: 1,
    });
    expect(group.children![1]).toMatchObject({
      kind: "agent",
      agent: "worker-b",
      label: "worker-b",
      status: "pending",
      flatIndex: 2,
    });
  });

  test("builds snapshot for dynamic parallel step", () => {
    const steps: ChainStep[] = [
      {
        expand: { from: { output: "items", path: "/list" } },
        parallel: { agent: "processor", task: "handle {item}" },
        collect: { as: "results" },
      } as DynamicParallelStep,
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
    });

    expect(snapshot.nodes).toHaveLength(1);
    const group = snapshot.nodes[0]!;
    expect(group.kind).toBe("dynamic-parallel-group");
    expect(group.label).toBe("Dynamic fanout (results)");
    expect(group.status).toBe("pending");
    expect(group.dynamic).toMatchObject({
      sourceOutput: "items",
      sourcePath: "/list",
      collectAs: "results",
    });
  });

  test("groups nodes by phase", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t", phase: "Setup" },
      { agent: "b", task: "t", phase: "Setup" },
      { agent: "c", task: "t", phase: "Execute" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({ runId: "r1", steps });

    expect(snapshot.phases).toHaveLength(2);
    expect(snapshot.phases[0]).toEqual({
      title: "Setup",
      nodeIds: ["step-0", "step-1"],
    });
    expect(snapshot.phases[1]).toEqual({
      title: "Execute",
      nodeIds: ["step-2"],
    });
  });

  test("records error on failed step", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "t" }];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      stepStatuses: [{ status: "failed", error: "timeout" }],
    });

    expect(snapshot.nodes[0]!.status).toBe("failed");
    expect(snapshot.nodes[0]!.error).toBe("timeout");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/workflow-graph.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/core/workflow-graph.ts`**

Create `src/core/workflow-graph.ts`:

```typescript
import {
  isParallelStep,
  isDynamicParallelStep,
} from "./chain-settings.js";
import type {
  ChainStep,
  DynamicParallelStep,
  ParallelStep,
  SequentialStep,
  SubagentRunMode,
  WorkflowGraphNode,
  WorkflowGraphSnapshot,
  WorkflowNodeStatus,
} from "../shared/types.js";

export interface WorkflowGraphBuildInput {
  runId: string;
  mode?: SubagentRunMode;
  steps: ChainStep[];
  currentStepIndex?: number;
  currentFlatIndex?: number;
  stepStatuses?: Array<{ status?: string; error?: string }>;
}

function normalizeStatus(raw: string | undefined): WorkflowNodeStatus {
  switch (raw) {
    case "complete":
    case "completed":
      return "completed";
    case "running":
      return "running";
    case "failed":
    case "error":
      return "failed";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function nodeStatus(
  input: WorkflowGraphBuildInput,
  flatIndex: number,
): WorkflowNodeStatus {
  const override = input.stepStatuses?.[flatIndex];
  if (override?.status) return normalizeStatus(override.status);
  if (input.currentFlatIndex === flatIndex) return "running";
  return "pending";
}

function summarizeParallelStatuses(
  statuses: WorkflowNodeStatus[],
): WorkflowNodeStatus {
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "paused")) return "paused";
  if (statuses.length > 0 && statuses.every((s) => s === "completed"))
    return "completed";
  if (statuses.some((s) => s === "completed")) return "running";
  return "pending";
}

function pushPhase(
  phases: WorkflowGraphSnapshot["phases"],
  phase: string | undefined,
  nodeId: string,
): void {
  if (!phase) return;
  let group = phases.find((g) => g.title === phase);
  if (!group) {
    group = { title: phase, nodeIds: [] };
    phases.push(group);
  }
  group.nodeIds.push(nodeId);
}

export function buildWorkflowGraphSnapshot(
  input: WorkflowGraphBuildInput,
): WorkflowGraphSnapshot {
  const nodes: WorkflowGraphNode[] = [];
  const phases: WorkflowGraphSnapshot["phases"] = [];
  let flatIndex = 0;
  let currentNodeId: string | undefined;

  for (let stepIndex = 0; stepIndex < input.steps.length; stepIndex++) {
    const step = input.steps[stepIndex]!;

    if (isParallelStep(step)) {
      const groupId = `step-${stepIndex}`;
      const children: WorkflowGraphNode[] = [];
      const childStatuses: WorkflowNodeStatus[] = [];

      for (let i = 0; i < step.parallel.length; i++) {
        const task = step.parallel[i]!;
        const status = nodeStatus(input, flatIndex);
        childStatuses.push(status);
        const childId = `step-${stepIndex}-agent-${i}`;
        children.push({
          id: childId,
          kind: "agent",
          agent: task.agent,
          phase: task.phase,
          label: task.label?.trim() || task.agent,
          status,
          flatIndex,
          stepIndex,
          outputName: task.as,
          structured: Boolean(task.outputSchema),
          error: input.stepStatuses?.[flatIndex]?.error,
        });
        pushPhase(phases, task.phase, childId);
        if (status === "running") currentNodeId = childId;
        flatIndex++;
      }

      const groupStatus = summarizeParallelStatuses(childStatuses);
      if (input.currentStepIndex === stepIndex && !currentNodeId)
        currentNodeId = groupId;
      nodes.push({
        id: groupId,
        kind: "parallel-group",
        label:
          step.parallel.length === 1
            ? "Parallel task"
            : `Parallel group (${step.parallel.length})`,
        status: groupStatus,
        stepIndex,
        children,
      });
      continue;
    }

    if (isDynamicParallelStep(step)) {
      const groupId = `step-${stepIndex}`;
      const groupStatus =
        input.currentStepIndex === stepIndex ? "running" : "pending";
      if (input.currentStepIndex === stepIndex) currentNodeId = groupId;

      nodes.push({
        id: groupId,
        kind: "dynamic-parallel-group",
        label:
          step.parallel.label?.trim() ||
          `Dynamic fanout (${step.collect.as})`,
        status: groupStatus as WorkflowNodeStatus,
        stepIndex,
        outputName: step.collect.as,
        structured: Boolean(step.collect.outputSchema),
        dynamic: {
          sourceOutput: step.expand.from.output,
          sourcePath: step.expand.from.path,
          itemName: step.expand.item ?? "item",
          maxItems: step.expand.maxItems,
          collectAs: step.collect.as,
        },
        children: [],
      });
      continue;
    }

    // Sequential step
    const seq = step as SequentialStep;
    const status = nodeStatus(input, flatIndex);
    const id = `step-${stepIndex}`;
    nodes.push({
      id,
      kind: "step",
      agent: seq.agent,
      phase: seq.phase,
      label: seq.label?.trim() || seq.agent,
      status,
      flatIndex,
      stepIndex,
      outputName: seq.as,
      structured: Boolean(seq.outputSchema),
      error: input.stepStatuses?.[flatIndex]?.error,
    });
    pushPhase(phases, seq.phase, id);
    if (
      status === "running" ||
      input.currentFlatIndex === flatIndex ||
      input.currentStepIndex === stepIndex
    )
      currentNodeId = id;
    flatIndex++;
  }

  return {
    runId: input.runId,
    mode: input.mode ?? "chain",
    phases,
    nodes,
    currentNodeId,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/workflow-graph.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow-graph.ts tests/workflow-graph.test.ts
git commit -m "feat(workflow-graph): add pure function to build WorkflowGraphSnapshot from chain state"
```

---

## Task 11: Emit Snapshots in `executeChain()`

**Files:**

- Modify: `src/core/chain-execution.ts`

- [ ] **Step 1: Add import and snapshot emission helper**

At the top of `src/core/chain-execution.ts`, add import:

```typescript
import { buildWorkflowGraphSnapshot } from "./workflow-graph.js";
import type { WorkflowNodeStatus } from "../shared/types.js";
```

(Add `WorkflowNodeStatus` to the existing type import from `"../shared/types.js"`.)

- [ ] **Step 2: Add step status tracking and emission to the step loop**

Replace the current `executeChain` function body (lines 45-259) with the version below. The logic is identical, with three additions: `stepStatuses` tracking array, `emitSnapshot()` helper, and calls at each transition point.

```typescript
export async function executeChain(
  params: ChainExecutionParams,
): Promise<ChainExecutionResult> {
  const { steps, task, spawnAndWait, findAgent, cwd, runId, signal, onGraphUpdate } = params;

  // 1. Validate output bindings
  validateChainOutputBindings(steps);

  // 2. Resolve templates
  const templates = resolveChainTemplates(steps);

  // 3. Create chain directory
  const chainDir = params.chainDir ?? createChainDir(runId);

  // 4. Step loop
  const outputs: ChainOutputMap = {};
  let prev = "";
  const results: Array<{ agent: string; output: string; status: string }> = [];
  const chainSteps = [...steps];

  // --- Snapshot state ---
  const stepStatuses: Array<{ status?: string; error?: string }> = [];
  let currentFlatIndex = 0;

  function emitSnapshot(currentStepIndex?: number): void {
    if (!onGraphUpdate) return;
    const snapshot = buildWorkflowGraphSnapshot({
      runId,
      steps: chainSteps,
      currentStepIndex,
      currentFlatIndex,
      stepStatuses,
    });
    onGraphUpdate(snapshot);
  }

  // Emit initial snapshot (all pending)
  emitSnapshot(0);

  let aborted = false;
  let flatIndex = 0;
  for (let stepIndex = 0; stepIndex < chainSteps.length; stepIndex++) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    const step = chainSteps[stepIndex]!;
    const template = templates[stepIndex];

    if (isParallelStep(step)) {
      // --- Parallel step ---
      const taskTemplates = template as string[];

      // Mark all parallel items as running
      for (let i = 0; i < step.parallel.length; i++) {
        stepStatuses[flatIndex + i] = { status: "running" };
      }
      emitSnapshot(stepIndex);

      const promises = step.parallel.map(async (item, i) => {
        const agentDef = findAgent(item.agent);
        let taskStr = taskTemplates[i] ?? "{previous}";
        taskStr = taskStr
          .replace(/\{task\}/g, task)
          .replace(/\{previous\}/g, prev)
          .replace(/\{chain_dir\}/g, chainDir);
        taskStr = resolveOutputReferences(taskStr, outputs);

        const { record } = await spawnAndWait(agentDef, taskStr, cwd);
        const output = record.result ?? "";
        const itemFlatIndex = flatIndex + i;

        // Update status as each item completes
        stepStatuses[itemFlatIndex] = {
          status: record.status === "error" ? "failed" : "completed",
          error: record.error,
        };
        emitSnapshot(stepIndex);

        if (item.as) {
          outputs[item.as] = outputEntryFromResult(item.agent, output, stepIndex);
        }
        return { output, status: record.status, agent: item.agent };
      });

      const parallelResults = await Promise.all(promises);

      const failed = parallelResults.filter((r) => r.status === "error");
      if (step.failFast && failed.length > 0) {
        return {
          content: `Chain failed at parallel step ${stepIndex + 1}: ${failed[0]!.output}`,
          isError: true,
          workflowGraph: buildWorkflowGraphSnapshot({ runId, steps: chainSteps, stepStatuses }),
        };
      }

      prev = parallelResults.map((r) => r.output).join("\n---\n");
      for (const r of parallelResults) {
        results.push({ agent: r.agent, output: r.output, status: r.status });
      }
      flatIndex += step.parallel.length;
    } else if (isDynamicParallelStep(step)) {
      // --- Dynamic parallel step ---
      stepStatuses[flatIndex] = { status: "running" };
      emitSnapshot(stepIndex);

      const sourceEntry = outputs[step.expand.from.output];
      if (!sourceEntry?.structured) {
        stepStatuses[flatIndex] = { status: "failed", error: `no structured output from '${step.expand.from.output}'` };
        emitSnapshot(stepIndex);
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: no structured output from '${step.expand.from.output}'`,
          isError: true,
          workflowGraph: buildWorkflowGraphSnapshot({ runId, steps: chainSteps, stepStatuses }),
        };
      }

      const pathParts = step.expand.from.path.split("/").filter(Boolean);
      let items: unknown = sourceEntry.structured;
      for (const part of pathParts) {
        if (items && typeof items === "object") {
          items = (items as Record<string, unknown>)[part];
        }
      }
      if (!Array.isArray(items)) {
        if (step.expand.onEmpty === "skip") {
          stepStatuses[flatIndex] = { status: "skipped" };
          emitSnapshot(stepIndex);
          prev = "";
          flatIndex++;
          continue;
        }
        stepStatuses[flatIndex] = { status: "failed", error: "expanded items is not an array" };
        emitSnapshot(stepIndex);
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: expanded items is not an array`,
          isError: true,
          workflowGraph: buildWorkflowGraphSnapshot({ runId, steps: chainSteps, stepStatuses }),
        };
      }
      if (items.length === 0 && step.expand.onEmpty === "skip") {
        stepStatuses[flatIndex] = { status: "skipped" };
        emitSnapshot(stepIndex);
        prev = "";
        flatIndex++;
        continue;
      }
      if (step.expand.maxItems && items.length > step.expand.maxItems) {
        items = items.slice(0, step.expand.maxItems);
      }

      const dynamicResults = await Promise.all(
        (items as unknown[]).map(async (item) => {
          const agentDef = findAgent(step.parallel.agent);
          let taskStr = step.parallel.task ?? "{previous}";
          const itemName = step.expand.item ?? "item";
          if (item && typeof item === "object") {
            for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
              taskStr = taskStr.replace(
                new RegExp(`\\{${itemName}\\.${k}\\}`, "g"),
                String(v),
              );
            }
          }
          taskStr = taskStr
            .replace(/\{task\}/g, task)
            .replace(/\{previous\}/g, prev)
            .replace(/\{chain_dir\}/g, chainDir);
          taskStr = resolveOutputReferences(taskStr, outputs);

          const { record } = await spawnAndWait(agentDef, taskStr, cwd);
          return { output: record.result ?? "", status: record.status };
        }),
      );

      const failed = dynamicResults.filter((r) => r.status === "error");
      if (step.failFast && failed.length > 0) {
        stepStatuses[flatIndex] = { status: "failed", error: failed[0]?.output };
        emitSnapshot(stepIndex);
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: ${failed[0]?.output}`,
          isError: true,
          workflowGraph: buildWorkflowGraphSnapshot({ runId, steps: chainSteps, stepStatuses }),
        };
      }

      const collectedOutput = dynamicResults.map((r) => r.output).join("\n---\n");
      outputs[step.collect.as] = outputEntryFromResult(step.parallel.agent, collectedOutput, stepIndex);
      prev = collectedOutput;
      stepStatuses[flatIndex] = { status: "completed" };
      emitSnapshot(stepIndex);
      for (const r of dynamicResults) {
        results.push({ agent: step.parallel.agent, output: r.output, status: r.status });
      }
      flatIndex++;
    } else {
      // --- Sequential step ---
      const seqStep = step as SequentialStep;
      const agentDef = findAgent(seqStep.agent);

      stepStatuses[flatIndex] = { status: "running" };
      emitSnapshot(stepIndex);

      let taskStr = (template as string) ?? "{task}";
      taskStr = taskStr
        .replace(/\{task\}/g, task)
        .replace(/\{previous\}/g, prev)
        .replace(/\{chain_dir\}/g, chainDir);
      taskStr = resolveOutputReferences(taskStr, outputs);

      const { record } = await spawnAndWait(agentDef, taskStr, cwd);
      const output = record.result ?? "";

      if (record.status === "error") {
        stepStatuses[flatIndex] = { status: "failed", error: record.error };
        emitSnapshot(stepIndex);
        return {
          content: `Chain failed at step ${stepIndex + 1} (${seqStep.agent}): ${record.error ?? output}`,
          isError: true,
          workflowGraph: buildWorkflowGraphSnapshot({ runId, steps: chainSteps, stepStatuses }),
        };
      }

      stepStatuses[flatIndex] = { status: "completed" };
      emitSnapshot(stepIndex);

      if (seqStep.as) {
        outputs[seqStep.as] = outputEntryFromResult(seqStep.agent, output, stepIndex);
      }
      prev = output;
      results.push({ agent: seqStep.agent, output, status: record.status });
      flatIndex++;
    }

    // Check for appended steps (async chains)
    if (params.isAsync) {
      const appended = consumeChainAppendRequests(runId);
      if (appended.length > 0) {
        chainSteps.push(...appended);
        templates.push(...resolveChainTemplates(appended));
      }
    }
  }

  // 5. Build summary
  const summary = results
    .map((r) => `[${r.agent}] ${r.output.slice(0, 200)}`)
    .join("\n\n");

  const finalGraph = buildWorkflowGraphSnapshot({ runId, steps: chainSteps, stepStatuses });

  if (aborted) {
    return {
      content: `Chain aborted after ${results.length} of ${chainSteps.length} steps.\n\n${summary}`,
      isError: true,
      workflowGraph: finalGraph,
    };
  }

  return {
    content: prev || summary,
    isError: false,
    workflowGraph: finalGraph,
  };
}
```

- [ ] **Step 3: Run existing chain-execution tests**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: PASS (behavior unchanged; `onGraphUpdate` is optional so existing tests still pass)

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/chain-execution.ts
git commit -m "feat(chain-execution): emit WorkflowGraphSnapshot at each step transition"
```

---

## Task 12: Chain Widget

**Files:**

- Create: `src/tui/chain-widget.ts`
- Create: `tests/chain-widget.test.ts`

- [ ] **Step 1: Write failing tests for chain widget rendering**

Create `tests/chain-widget.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { ChainWidget } from "../src/tui/chain-widget.js";
import type { Theme, UICtx } from "../src/tui/agent-widget.js";
import type { WorkflowGraphSnapshot } from "../src/shared/types.js";

function mockTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function mockUICtx(): UICtx & { widgets: Map<string, unknown>; statuses: Map<string, string | undefined> } {
  const widgets = new Map<string, unknown>();
  const statuses = new Map<string, string | undefined>();
  return {
    widgets,
    statuses,
    setWidget(key, content) {
      widgets.set(key, content);
    },
    setStatus(key, text) {
      statuses.set(key, text);
    },
  };
}

function makeSnapshot(overrides: Partial<WorkflowGraphSnapshot> = {}): WorkflowGraphSnapshot {
  return {
    runId: "test-chain",
    mode: "chain",
    phases: [],
    nodes: [],
    ...overrides,
  };
}

describe("ChainWidget", () => {
  test("does nothing when no UICtx is set", () => {
    const widget = new ChainWidget();
    // Should not throw
    widget.update(makeSnapshot());
    widget.clear();
    widget.dispose();
  });

  test("registers widget on first update", () => {
    const widget = new ChainWidget();
    const ctx = mockUICtx();
    widget.setUICtx(ctx);

    widget.update(
      makeSnapshot({
        nodes: [
          { id: "step-0", kind: "step", agent: "scout", label: "Scan", status: "running", flatIndex: 0, stepIndex: 0 },
          { id: "step-1", kind: "step", agent: "planner", label: "Plan", status: "pending", flatIndex: 1, stepIndex: 1 },
        ],
        currentNodeId: "step-0",
      }),
    );

    expect(ctx.widgets.has("chain")).toBe(true);
  });

  test("unregisters widget on clear()", () => {
    const widget = new ChainWidget();
    const ctx = mockUICtx();
    widget.setUICtx(ctx);

    widget.update(
      makeSnapshot({
        nodes: [{ id: "step-0", kind: "step", agent: "a", label: "A", status: "running", flatIndex: 0, stepIndex: 0 }],
      }),
    );
    expect(ctx.widgets.has("chain")).toBe(true);

    widget.clear();
    expect(ctx.widgets.get("chain")).toBeUndefined();
  });

  test("renderLines produces correct output for sequential steps", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          { id: "step-0", kind: "step", agent: "scout", label: "Scan files", status: "completed", flatIndex: 0, stepIndex: 0 },
          { id: "step-1", kind: "step", agent: "planner", label: "Create plan", status: "running", flatIndex: 1, stepIndex: 1 },
          { id: "step-2", kind: "step", agent: "coder", label: "Implement", status: "pending", flatIndex: 2, stepIndex: 2 },
        ],
      }),
      mockTheme(),
    );

    expect(lines.length).toBeGreaterThanOrEqual(4); // heading + 3 steps
    expect(lines[0]).toContain("Chain");
    expect(lines[1]).toContain("Scan files");
    expect(lines[2]).toContain("Create plan");
    expect(lines[3]).toContain("Implement");
  });

  test("renderLines handles parallel groups with children", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "parallel-group",
            label: "Parallel group (2)",
            status: "running",
            stepIndex: 0,
            children: [
              { id: "step-0-agent-0", kind: "agent", agent: "worker-a", label: "Worker A", status: "completed", flatIndex: 0, stepIndex: 0 },
              { id: "step-0-agent-1", kind: "agent", agent: "worker-b", label: "Worker B", status: "running", flatIndex: 1, stepIndex: 0 },
            ],
          },
        ],
      }),
      mockTheme(),
    );

    expect(lines.some((l) => l.includes("Parallel group"))).toBe(true);
    expect(lines.some((l) => l.includes("Worker A"))).toBe(true);
    expect(lines.some((l) => l.includes("Worker B"))).toBe(true);
  });

  test("renderLines shows error info", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          { id: "step-0", kind: "step", agent: "a", label: "Failing step", status: "failed", flatIndex: 0, stepIndex: 0, error: "timeout" },
        ],
      }),
      mockTheme(),
    );

    expect(lines.some((l) => l.includes("timeout"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-widget.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/tui/chain-widget.ts`**

Create `src/tui/chain-widget.ts`:

```typescript
/**
 * chain-widget.ts — Persistent widget showing chain execution progress above the editor.
 *
 * Follows the same lifecycle and rendering pattern as AgentWidget:
 * - setUICtx() to receive the TUI context
 * - update(snapshot) to push new state and trigger re-render
 * - clear() to remove the widget
 * - dispose() to clean up resources
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme, UICtx } from "./agent-widget.js";
import type { WorkflowGraphNode, WorkflowGraphSnapshot, WorkflowNodeStatus } from "../shared/types.js";
import { SPINNER } from "./format.js";

const WIDGET_KEY = "chain";

function statusIcon(status: WorkflowNodeStatus, theme: Theme, frame?: string): string {
  switch (status) {
    case "completed":
      return theme.fg("success", "\u2713");
    case "running":
      return theme.fg("accent", frame ?? "\u2022");
    case "failed":
      return theme.fg("error", "\u2717");
    case "skipped":
      return theme.fg("dim", "\u2013");
    case "paused":
      return theme.fg("warning", "\u2016");
    case "stopped":
      return theme.fg("dim", "\u25A0");
    default:
      return theme.fg("dim", "\u25CB");
  }
}

export class ChainWidget {
  private uiCtx: UICtx | undefined;
  private snapshot: WorkflowGraphSnapshot | null = null;
  private widgetRegistered = false;
  // biome-ignore lint/suspicious/noExplicitAny: tui type is unavoidably any
  private tui: any | undefined;
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | undefined;

  setUICtx(ctx: UICtx): void {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
    }
  }

  update(snapshot: WorkflowGraphSnapshot): void {
    this.snapshot = snapshot;
    this.ensureTimer();
    this.render();
  }

  clear(): void {
    this.snapshot = null;
    if (this.uiCtx) {
      this.uiCtx.setWidget(WIDGET_KEY, undefined);
      this.widgetRegistered = false;
      this.tui = undefined;
    }
    this.stopTimer();
  }

  dispose(): void {
    this.clear();
    this.uiCtx = undefined;
  }

  /** Exposed for testing — renders snapshot to themed lines without needing UICtx. */
  renderLines(snapshot: WorkflowGraphSnapshot, theme: Theme): string[] {
    const total = snapshot.nodes.length;
    if (total === 0) return [];

    const spinnerFrame = SPINNER[this.frame % SPINNER.length];
    const hasRunning = snapshot.nodes.some(
      (n) => n.status === "running" || n.children?.some((c) => c.status === "running"),
    );
    const headingIcon = hasRunning ? theme.fg("accent", "\u25CF") : theme.fg("dim", "\u25CB");
    const headingColor = hasRunning ? "accent" : "dim";

    const lines: string[] = [
      `${headingIcon} ${theme.fg(headingColor, "Chain")} ${theme.fg("dim", snapshot.runId)}`,
    ];

    for (let i = 0; i < total; i++) {
      const node = snapshot.nodes[i]!;
      const connector = i === total - 1 ? "\u2514\u2500" : "\u251C\u2500";
      const prefix = theme.fg("dim", connector);
      const idx = theme.fg("dim", `[${(node.stepIndex ?? i) + 1}/${total}]`);
      const icon = statusIcon(node.status, theme, spinnerFrame);

      if (node.kind === "parallel-group" || node.kind === "dynamic-parallel-group") {
        lines.push(`${prefix} ${idx} ${icon} ${theme.bold(node.label)}`);
        const children = node.children ?? [];
        for (let c = 0; c < children.length; c++) {
          const child = children[c]!;
          const childConnector = c === children.length - 1 ? "\u2514\u2500" : "\u251C\u2500";
          const indent = i === total - 1 ? "   " : theme.fg("dim", "\u2502  ");
          const childIcon = statusIcon(child.status, theme, spinnerFrame);
          let childLine = `${indent}${theme.fg("dim", childConnector)} ${childIcon} ${child.label}`;
          if (child.error) childLine += ` ${theme.fg("error", `(${child.error})`)}`;
          lines.push(childLine);
        }
      } else {
        let line = `${prefix} ${idx} ${icon} ${node.label}`;
        if (node.phase) line += ` ${theme.fg("dim", `(${node.phase})`)}`;
        if (node.error) line += ` ${theme.fg("error", node.error)}`;
        lines.push(line);
      }
    }

    return lines;
  }

  private render(): void {
    if (!this.uiCtx) return;
    if (!this.snapshot || this.snapshot.nodes.length === 0) {
      if (this.widgetRegistered) {
        this.uiCtx.setWidget(WIDGET_KEY, undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      this.stopTimer();
      return;
    }

    this.frame++;

    if (!this.widgetRegistered) {
      this.uiCtx.setWidget(
        WIDGET_KEY,
        (tui, theme) => {
          this.tui = tui;
          return {
            render: () => {
              if (!this.snapshot) return [];
              const w = tui.terminal.columns;
              return this.renderLines(this.snapshot, theme).map((l) =>
                truncateToWidth(l, w),
              );
            },
            invalidate: () => {
              this.widgetRegistered = false;
              this.tui = undefined;
            },
          };
        },
        { placement: "aboveEditor" },
      );
      this.widgetRegistered = true;
    } else {
      this.tui?.requestRender();
    }
  }

  private ensureTimer(): void {
    if (!this.interval) {
      this.interval = setInterval(() => this.render(), 80);
    }
  }

  private stopTimer(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-widget.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tui/chain-widget.ts tests/chain-widget.test.ts
git commit -m "feat(tui): add ChainWidget for chain execution progress display"
```

---

## Task 13: Wire Into Runtime and Call Sites

**Files:**

- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/index.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Add `ChainWidget` to `RuntimeDeps`**

In `src/shared/runtime-deps.ts`, add import and field:

Add to imports at top:

```typescript
import type { ChainWidget } from "../tui/chain-widget.js";
```

Add to the `RuntimeDeps` interface (after the `ensureTimers` field):

```typescript
  /** Chain progress widget — present when TUI is active. */
  chainWidget?: ChainWidget;
```

- [ ] **Step 2: Create and wire `ChainWidget` in `src/index.ts`**

Add import at top of `src/index.ts`:

```typescript
import { ChainWidget } from "./tui/chain-widget.js";
```

After line 193 (`fleet = new FleetList(manager, agentActivity);`), add:

```typescript
  const chainWidget = new ChainWidget();
```

Add `chainWidget` to the `deps` object (after `fleet,` around line 220):

```typescript
    chainWidget,
```

- [ ] **Step 3: Share `UICtx` with chain widget**

In `src/index.ts`, find the `tool_execution_start` handler (around line 388) where `deps.widget?.setUICtx(ctx.ui as UICtx)` is called. Add right after it:

```typescript
    deps.chainWidget?.setUICtx(ctx.ui as UICtx);
```

The full handler should look like:

```typescript
  pi.on("tool_execution_start", (_event, ctx) => {
    deps.widget?.setUICtx(ctx.ui as UICtx);
    deps.chainWidget?.setUICtx(ctx.ui as UICtx);
    deps.fleet?.setUICtx(ctx.ui as unknown as FleetUICtx);
    deps.widget?.onTurnStart();
  });
```

- [ ] **Step 4: Pass `onGraphUpdate` in `slash-chain.ts`**

In `src/core/slash-chain.ts`, find the `executeChain()` call (around line 511). Add `onGraphUpdate` to the params object:

```typescript
    const chainResult = await executeChain({
      steps: chain,
      task,
      spawnAndWait: async (agentDef, prompt, stepCwd) => {
        return deps.manager.spawnAndWait(ctx, agentDef, {
          prompt,
          cwd: stepCwd || ctx.cwd,
          maxTurns: loadedConfig.config.defaultMaxTurns,
        });
      },
      findAgent: (name) => {
        const agent = findAgentByName(discovery, name);
        if (!agent) throw new Error(`Unknown agent: "${name}"`);
        return agent;
      },
      cwd: ctx.cwd,
      runId: `chain-${Date.now().toString(36)}`,
      onGraphUpdate: (snapshot) => deps.chainWidget?.update(snapshot),
    });
```

After the chain completes (after `pi.sendMessage` for the result), clear the widget:

```typescript
    deps.chainWidget?.clear();
```

Add this in both the success path and the catch block.

- [ ] **Step 5: Pass `onGraphUpdate` in `subagent.ts`**

In `src/core/subagent.ts`, find the `executeChain()` call (around line 227). Add `onGraphUpdate` to the params:

```typescript
          const chainResult = await executeChain({
            steps: params.chain as ChainStep[],
            task: params.task ?? "",
            spawnAndWait: async (agentDef, prompt, stepCwd) => {
              return deps.manager.spawnAndWait(ctx, agentDef, {
                prompt,
                cwd: stepCwd || effectiveCwd,
                maxTurns: loadedConfig.config.defaultMaxTurns,
              });
            },
            findAgent: (name) => {
              const agent = findAgentByName(discovery, name);
              if (!agent) throw new Error(`Unknown agent: "${name}"`);
              return agent;
            },
            cwd: effectiveCwd,
            runId: `chain-${Date.now().toString(36)}`,
            signal,
            onGraphUpdate: (snapshot) => deps.chainWidget?.update(snapshot),
          });
```

After the chain result is returned (both success and error paths), clear the widget. Add before each `return` in the chain mode block:

```typescript
          deps.chainWidget?.clear();
```

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/runtime-deps.ts src/index.ts src/core/slash-chain.ts src/core/subagent.ts
git commit -m "feat(tui): wire ChainWidget into runtime deps and chain call sites"
```

---

## Task 14: Integration Verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm check`
Expected: PASS — no type errors, no lint issues.

- [ ] **Step 3: Verify chain-execution tests still pass with snapshot emission**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: PASS (the `onGraphUpdate` param is optional, so existing tests work unchanged. New tests can verify snapshots are emitted, but that's not required for this phase.)

- [ ] **Step 4: Final commit if any fixups were needed**

Only if fixups were required:

```bash
git add -A
git commit -m "fix(chain-widget): address integration issues"
```
