# Chain Execution — Phase 7: Tool Schema & Subagent Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire chain execution into the `subagent` tool — add `chain` and `chain_append` parameters to the tool schema, dispatch to `executeChain()` when chain mode is used.

**Architecture:** Extend `SUBAGENT_TOOL_PARAMETERS` TypeBox schema with optional `chain` (array of step objects) and `chain_append` (object with chain_id + steps). Make `agent` optional. Add chain/append dispatch at the top of `execute()` before existing single-agent logic.

**Tech Stack:** TypeScript, TypeBox

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 6 (chain-execution.ts exists), Phase 4 (chain-append.ts exists).

---

### Task 8: Extend `subagent.ts` with chain mode

**Files:**

- Modify: `src/core/subagent.ts`
- Modify: `src/shared/runtime-deps.ts`

- [ ] **Step 1: Add `discoverChains` to RuntimeDeps**

In `src/shared/runtime-deps.ts`, add the import and field:

```typescript
import type { ChainDiscoveryResult } from "./types.js";

// Add to RuntimeDeps interface:
  discoverChains?: (paths: ResolvedPaths) => ChainDiscoveryResult;
```

- [ ] **Step 2: Add `chain` and `chain_append` to `SUBAGENT_TOOL_PARAMETERS`**

In `src/core/subagent.ts`, add to the TypeBox schema (after the existing `tool_budget` parameter):

```typescript
chain: Type.Optional(
  Type.Array(
    Type.Object({
      agent: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      phase: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      as: Type.Optional(Type.String()),
      output: Type.Optional(Type.Union([Type.String(), Type.Literal(false)])),
      outputMode: Type.Optional(Type.String()),
      reads: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
      model: Type.Optional(Type.String()),
      skills: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
      progress: Type.Optional(Type.Boolean()),
      cwd: Type.Optional(Type.String()),
      parallel: Type.Optional(Type.Array(Type.Any())),
      concurrency: Type.Optional(Type.Number()),
      failFast: Type.Optional(Type.Boolean()),
      worktree: Type.Optional(Type.Boolean()),
      expand: Type.Optional(Type.Any()),
      collect: Type.Optional(Type.Any()),
    }),
    { description: "Chain execution: sequential/parallel steps" },
  ),
),
chain_append: Type.Optional(
  Type.Object({
    chain_id: Type.String({ description: "ID of running async chain" }),
    steps: Type.Array(Type.Any(), { description: "Steps to append" }),
  }),
),
```

- [ ] **Step 3: Make `agent` optional in schema (required only when `chain` absent)**

Change `agent` from `Type.String(...)` to `Type.Optional(Type.String(...))`. Add runtime validation at the top of `execute()`:

```typescript
// At the top of execute(), before the existing code:
if (params.chain) {
  // Chain mode — dispatch to executeChain
  const { executeChain } = await import("./chain-execution.js");
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
  });
  const chainDetails: SubagentExecutionDetails = {
    status: chainResult.isError ? "error" : "completed",
    agent: "(chain)",
    task: params.task ?? "",
    sourcePath: "",
    cwd: effectiveCwd,
    maxTurns: 0,
    durationMs: 0,
    childSessionDir: "",
    childSessionPath: "",
    stopReason: chainResult.isError ? "error" : "completed",
    exitCode: null,
    stderr: chainResult.isError ? chainResult.content : "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      contextTokens: 0,
      cost: 0,
      turns: 0,
    },
    recentToolActivity: [],
  };
  return {
    content: [{ type: "text", text: chainResult.content }],
    isError: chainResult.isError,
    details: chainDetails,
  };
}

if (params.chain_append) {
  const { enqueueChainAppendRequest } = await import("./chain-append.js");
  enqueueChainAppendRequest(
    params.chain_append.chain_id,
    params.chain_append.steps as ChainStep[],
  );
  return {
    content: [
      {
        type: "text",
        text: `Steps appended to chain ${params.chain_append.chain_id}.`,
      },
    ],
    isError: false,
    details: {
      status: "completed" as const,
      agent: "(chain-append)",
      task: `append to ${params.chain_append.chain_id}`,
      sourcePath: "",
      cwd: effectiveCwd,
      maxTurns: 0,
      durationMs: 0,
      childSessionDir: "",
      childSessionPath: "",
      stopReason: "completed",
      exitCode: null,
      stderr: "",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 0,
        cost: 0,
        turns: 0,
      },
      recentToolActivity: [],
    },
  };
}

if (!params.agent) {
  return {
    content: [
      {
        type: "text",
        text: "Missing 'agent'. Provide 'agent' for single mode or 'chain' for chain mode.",
      },
    ],
    isError: true,
    details: {
      status: "error" as const,
      agent: "",
      task: params.task ?? "",
      sourcePath: "",
      cwd: effectiveCwd,
      maxTurns: 0,
      durationMs: 0,
      childSessionDir: "",
      childSessionPath: "",
      stopReason: "error",
      exitCode: null,
      stderr: "Missing agent",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 0,
        cost: 0,
        turns: 0,
      },
      recentToolActivity: [],
    },
  };
}
```

- [ ] **Step 4: Update tool description**

Update the `description` field in `registerSubagentTool` to mention chain mode:

```typescript
description: "Delegate a task to a discovered agent. Supports single agent, chain (sequential/parallel pipeline), and chain_append modes.",
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (fix any type errors)

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/subagent.ts src/shared/runtime-deps.ts
git commit -m "feat(subagent): add chain and chain_append modes to subagent tool"
```
