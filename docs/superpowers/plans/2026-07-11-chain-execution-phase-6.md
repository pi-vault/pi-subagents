# Chain Execution — Phase 6: Chain Execution Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/core/chain-execution.ts` — the core orchestrator that runs the chain step loop, dispatching sequential, parallel, and dynamic-parallel steps.

**Architecture:** The `executeChain()` function accepts a params object with steps, task, and adapter functions (`spawnAndWait`, `findAgent`). It validates output bindings, resolves templates, then iterates through steps dispatching to the appropriate handler (sequential, parallel, or dynamic). Each step result is captured in a `ChainOutputMap` and feeds forward via `{previous}` or `{outputs.name}`.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` — port from `src/runs/foreground/chain-execution.ts`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 (types), Phase 2 (chain-settings for type guards and template resolution), Phase 1 Task 2 (chain-outputs for validation and resolution), Phase 4 (chain-append for async consume).

---

### Task 7: Create `src/core/chain-execution.ts`

**Files:**

- Create: `src/core/chain-execution.ts`
- Test: `tests/chain-execution.test.ts`

Port from: reference `src/runs/foreground/chain-execution.ts`

This task is large. The implementation should be ported methodically from the reference, adapting to our project's `AgentManager.spawnAndWait()` for step execution. Consult the reference file directly during implementation.

- [ ] **Step 1: Write the integration test file with sequential chain tests**

Create `tests/chain-execution.test.ts`. The tests mock `AgentManager.spawnAndWait()` to avoid needing real agent sessions:

```typescript
import { describe, expect, test, vi } from "vitest";
import { executeChain } from "../src/core/chain-execution.js";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  WorkflowGraphSnapshot,
} from "../src/shared/types.js";

// Minimal mock deps
function makeMockDeps(stepResults: Array<{ result: string; status?: string }>) {
  let callIndex = 0;
  const spawnAndWait = vi.fn(async () => {
    const r = stepResults[callIndex++] ?? { result: "(no output)" };
    const record: Partial<AgentRecord> = {
      id: `agent-${callIndex}`,
      type: "mock",
      status: (r.status as AgentRecord["status"]) ?? "completed",
      result: r.result,
      error: r.status === "error" ? r.result : undefined,
      toolUses: 0,
      turnCount: 1,
      startedAt: Date.now(),
      completedAt: Date.now(),
      durationMs: 100,
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    };
    return { id: record.id, record: record as AgentRecord };
  });

  const findAgent = vi.fn(
    (name: string): AgentDefinition => ({
      name,
      description: `mock ${name}`,
      tools: [],
      subagentAgents: [],
      systemPrompt: "You are a test agent.",
      sourcePath: "/mock",
    }),
  );

  return { spawnAndWait, findAgent };
}

describe("executeChain — sequential", () => {
  test("runs 2 sequential steps and passes {previous}", async () => {
    const mockDeps = makeMockDeps([
      { result: "step 1 output" },
      { result: "step 2 output" },
    ]);

    const steps: ChainStep[] = [
      { agent: "scout", task: "Analyze {task}" },
      { agent: "planner", task: "Plan from {previous}" },
    ];

    const result = await executeChain({
      steps,
      task: "build auth",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);

    // First step should have {task} replaced
    const firstCall = mockDeps.spawnAndWait.mock.calls[0]!;
    expect(firstCall[1]).toContain("build auth");

    // Second step should have {previous} replaced with step 1 output
    const secondCall = mockDeps.spawnAndWait.mock.calls[1]!;
    expect(secondCall[1]).toContain("step 1 output");
  });

  test("stores named output via 'as' and resolves {outputs.name}", async () => {
    const mockDeps = makeMockDeps([
      { result: "context data" },
      { result: "plan output" },
    ]);

    const steps: ChainStep[] = [
      { agent: "scout", task: "scan", as: "context" },
      { agent: "planner", task: "use {outputs.context}" },
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(false);
    const secondCall = mockDeps.spawnAndWait.mock.calls[1]!;
    expect(secondCall[1]).toContain("context data");
  });

  test("aborts chain on step failure", async () => {
    const mockDeps = makeMockDeps([
      { result: "error msg", status: "error" },
      { result: "should not run" },
    ]);

    const steps: ChainStep[] = [
      { agent: "a", task: "fail" },
      { agent: "b", task: "continue" },
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(true);
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-execution.ts` — the core orchestrator**

Create `src/core/chain-execution.ts`. This is the largest file. The implementation should be ported from the reference `src/runs/foreground/chain-execution.ts`, adapting the execution calls to use our project's pattern.

The core structure:

```typescript
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  ChainOutputMap,
  SequentialStep,
  ParallelStep,
  DynamicParallelStep,
  WorkflowGraphSnapshot,
  WorkflowGraphNode,
} from "../shared/types.js";
import {
  isParallelStep,
  isDynamicParallelStep,
  resolveChainTemplates,
  resolveStepBehavior,
  buildChainInstructions,
  createChainDir,
} from "./chain-settings.js";
import {
  validateChainOutputBindings,
  resolveOutputReferences,
  outputEntryFromResult,
} from "./chain-outputs.js";
import { consumeChainAppendRequests } from "./chain-append.js";

export interface ChainExecutionParams {
  steps: ChainStep[];
  task: string;
  spawnAndWait: (
    agentDef: AgentDefinition,
    prompt: string,
    cwd: string,
  ) => Promise<{ id: string; record: AgentRecord }>;
  findAgent: (name: string) => AgentDefinition;
  cwd: string;
  runId: string;
  chainDir?: string;
  signal?: AbortSignal;
  onGraphUpdate?: (snapshot: WorkflowGraphSnapshot) => void;
  isAsync?: boolean;
}

export interface ChainExecutionResult {
  content: string;
  isError: boolean;
  workflowGraph?: WorkflowGraphSnapshot;
}

export async function executeChain(
  params: ChainExecutionParams,
): Promise<ChainExecutionResult> {
  const { steps, task, spawnAndWait, findAgent, cwd, runId, signal } = params;

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

  for (let stepIndex = 0; stepIndex < chainSteps.length; stepIndex++) {
    if (signal?.aborted) break;

    const step = chainSteps[stepIndex]!;
    const template = templates[stepIndex];

    if (isParallelStep(step)) {
      // --- Parallel step ---
      const taskTemplates = template as string[];
      const taskOutputs: string[] = [];

      // Execute parallel items concurrently
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
        if (item.as) {
          outputs[item.as] = outputEntryFromResult(
            item.agent,
            output,
            stepIndex,
          );
        }
        return { output, status: record.status, agent: item.agent };
      });

      const parallelResults = await Promise.all(promises);

      // Check for failures
      const failed = parallelResults.filter((r) => r.status === "error");
      if (step.failFast && failed.length > 0) {
        return {
          content: `Chain failed at parallel step ${stepIndex + 1}: ${failed[0]!.output}`,
          isError: true,
        };
      }

      prev = parallelResults.map((r) => r.output).join("\n---\n");
      for (const r of parallelResults) {
        results.push({ agent: r.agent, output: r.output, status: r.status });
      }
    } else if (isDynamicParallelStep(step)) {
      // --- Dynamic parallel step ---
      const sourceEntry = outputs[step.expand.from.output];
      if (!sourceEntry?.structured) {
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: no structured output from '${step.expand.from.output}'`,
          isError: true,
        };
      }

      // JSON pointer resolution
      const pathParts = step.expand.from.path.split("/").filter(Boolean);
      let items: unknown = sourceEntry.structured;
      for (const part of pathParts) {
        if (items && typeof items === "object") {
          items = (items as Record<string, unknown>)[part];
        }
      }
      if (!Array.isArray(items)) {
        if (step.expand.onEmpty === "skip") {
          prev = "";
          continue;
        }
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: expanded items is not an array`,
          isError: true,
        };
      }
      if (items.length === 0 && step.expand.onEmpty === "skip") {
        prev = "";
        continue;
      }
      if (step.expand.maxItems && items.length > step.expand.maxItems) {
        items = items.slice(0, step.expand.maxItems);
      }

      const dynamicResults = await Promise.all(
        (items as unknown[]).map(async (item) => {
          const agentDef = findAgent(step.parallel.agent);
          let taskStr = step.parallel.task ?? "{previous}";
          // Replace item template variables
          const itemName = step.expand.item ?? "item";
          if (item && typeof item === "object") {
            for (const [k, v] of Object.entries(
              item as Record<string, unknown>,
            )) {
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

      const collectedOutput = dynamicResults
        .map((r) => r.output)
        .join("\n---\n");
      outputs[step.collect.as] = outputEntryFromResult(
        step.parallel.agent,
        collectedOutput,
        stepIndex,
      );
      prev = collectedOutput;
    } else {
      // --- Sequential step ---
      const seqStep = step as SequentialStep;
      const agentDef = findAgent(seqStep.agent);

      let taskStr = (template as string) ?? "{task}";
      taskStr = taskStr
        .replace(/\{task\}/g, task)
        .replace(/\{previous\}/g, prev)
        .replace(/\{chain_dir\}/g, chainDir);
      taskStr = resolveOutputReferences(taskStr, outputs);

      const { record } = await spawnAndWait(agentDef, taskStr, cwd);
      const output = record.result ?? "";

      if (record.status === "error") {
        return {
          content: `Chain failed at step ${stepIndex + 1} (${seqStep.agent}): ${record.error ?? output}`,
          isError: true,
        };
      }

      if (seqStep.as) {
        outputs[seqStep.as] = outputEntryFromResult(
          seqStep.agent,
          output,
          stepIndex,
        );
      }
      prev = output;
      results.push({ agent: seqStep.agent, output, status: record.status });
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

  return {
    content: prev || summary,
    isError: false,
  };
}
```

**What's included:** Sequential, parallel, and dynamic-parallel step dispatch; template variable resolution (`{task}`, `{previous}`, `{chain_dir}`, `{outputs.name}`); named outputs; error handling (sequential abort, parallel fail-fast); dynamic fanout item expansion; async chain append integration.

**Not included in this initial implementation** (can be added in follow-up tasks):

- `WorkflowGraphSnapshot` building (call `onGraphUpdate` callback after each step — add helper `buildWorkflowGraphSnapshot()` in this file, see reference `src/runs/shared/workflow-graph.ts`)
- Concurrency limiting for parallel steps (wrap in a semaphore respecting `step.concurrency`)
- Worktree support for parallel steps (call `createWorktree()` per item when `step.worktree` is true)
- `buildChainInstructions()` integration (inject read/write/progress prefix/suffix into task strings)

Each of these is a self-contained addition to the step loop. The core flow is complete and testable without them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-execution.ts tests/chain-execution.test.ts
git commit -m "feat(chain-execution): add core chain execution orchestrator"
```
