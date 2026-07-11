# Chain Execution — Phase 7: Tool Schema & Subagent Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire chain execution into the `subagent` tool — add `chain` and `chain_append` parameters to the tool schema, dispatch to `executeChain()` when chain mode is used.

**Architecture:** Extend `SubagentToolInput` with optional `chain` and `chain_append` fields. Extend `SUBAGENT_TOOL_PARAMETERS` TypeBox schema to match. Make `agent` optional. Add chain/append dispatch inside `execute()` after path/config/discovery setup but before single-agent logic.

**Tech Stack:** TypeScript, TypeBox, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 6 (`chain-execution.ts` exists), Phase 4 (`chain-append.ts` exists).

---

### Task 8: Extend `subagent.ts` with chain mode

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/subagent.ts`
- Create: `tests/subagent-chain.test.ts`

- [ ] **Step 1: Add `chain` and `chain_append` to `SubagentToolInput`**

In `src/shared/types.ts`, add the optional chain fields to the `SubagentToolInput` interface:

```typescript
export interface SubagentToolInput {
  agent: string;
  task: string;
  cwd?: string;
  model?: string;
  thinking?: string;
  max_turns?: number;
  isolated?: boolean;
  inherit_context?: boolean;
  run_in_background?: boolean;
  resume?: string;
  isolation?: string;
  tool_budget?: ToolBudgetConfig;
  // Chain mode fields
  chain?: ChainStep[];
  chain_append?: {
    chain_id: string;
    steps: ChainStep[];
  };
}
```

This depends on the `ChainStep` type already defined in the same file.

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

Also make `agent` optional in the schema — change `Type.String(...)` to `Type.Optional(Type.String(...))`:

```typescript
agent: Type.Optional(Type.String({ description: "Name of the agent to invoke" })),
```

- [ ] **Step 3: Add chain/append dispatch to `execute()`**

In `src/core/subagent.ts`, add imports at the top of the file:

```typescript
import type { ChainStep } from "../shared/types.js";
```

(Add `ChainStep` to the existing import from `"../shared/types.js"`.)

Insert the dispatch logic **inside the `execute()` function, after** the `effectiveCwd`, `paths`, `loadedConfig`, and `discovery` setup (lines 166–170) **but before** the `try` block (line 172). The dispatch uses these variables and needs its own try/catch:

```typescript
// --- Chain mode dispatch ---
if (params.chain) {
  try {
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
    return {
      content: [{ type: "text", text: chainResult.content }],
      isError: chainResult.isError,
      details: {
        status: chainResult.isError ? ("error" as const) : ("success" as const),
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
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
      details: {
        status: "error" as const,
        agent: "(chain)",
        task: params.task ?? "",
        sourcePath: "",
        cwd: effectiveCwd,
        maxTurns: 0,
        durationMs: 0,
        childSessionDir: "",
        childSessionPath: "",
        stopReason: "error",
        exitCode: null,
        stderr: message,
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
}

// --- Chain append dispatch ---
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
      status: "success" as const,
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

// --- Guard: agent required for single mode ---
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

**Notes:**

- Status values use `"success"` and `"error"` (matching `SubagentExecutionDetails` union, NOT `"completed"`).
- The dispatch code is placed after `effectiveCwd`/`paths`/`loadedConfig`/`discovery` (which it depends on) but before the existing `try` block with `parseAndResolveAgent`.
- Chain dispatch has its own try/catch so errors from `executeChain` are caught and returned properly.

- [ ] **Step 4: Update tool description**

Update the `description` field in `registerSubagentTool` to mention chain mode:

```typescript
description: "Delegate a task to a discovered agent. Supports single agent, chain (sequential/parallel pipeline), and chain_append modes.",
```

- [ ] **Step 5: Write tests for chain dispatch**

Create `tests/subagent-chain.test.ts` following the test patterns in `tests/subagent.test.ts`. Use the same `createPi()`, `createDeps()`, `createAgent()` helpers.

Tests to write:

```typescript
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import { registerSubagentTool } from "../src/core/subagent.js";
import type { RuntimeDeps } from "../src/shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  LifetimeUsage,
  SubagentToolInput,
} from "../src/shared/types.js";

// Reuse helpers from subagent.test.ts pattern
function createAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    name: "Scout",
    description: "Scout files",
    tools: ["read", "bash"],
    subagentAgents: [],
    systemPrompt: "You are Scout.",
    sourcePath: "/repo/agents/scout.md",
    ...overrides,
  };
}

function createDiscovery(agents: AgentDefinition[] = []): AgentDiscoveryResult {
  return { agents, diagnostics: [] };
}

function emptyUsage(): LifetimeUsage {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
}

function createDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return {
    resolvePaths: () => ({
      agentDir: "/tmp/pi-agent",
      configPath: "/tmp/pi-agent/extensions/subagents.json",
      userAgentsDir: "/tmp/pi-agent/agents",
      bundledAgentsDir: "/repo/agents",
      sessionsDir: "/tmp/pi-agent/sessions",
      userChainsDir: "/tmp/pi-agent/chains",
      bundledChainsDir: "/repo/chains",
    }),
    loadConfig: () => ({
      exists: false,
      config: {
        maxConcurrency: 3,
        maxRecursiveLevel: 3,
        defaultMaxTurns: 0,
        graceTurns: 5,
        defaultJoinMode: "smart" as const,
        maxSpawnsPerSession: 40,
      },
    }),
    discoverAgents: () => createDiscovery([createAgent()]),
    discoverToolNames: () => ["bash", "read"],
    createAgentFile: () => {
      throw new Error("not used");
    },
    exportAgentToUserScope: () => {
      throw new Error("not used");
    },
    disableAgentInUserScope: () => {
      throw new Error("not used");
    },
    deleteUserAgentOverride: () => {},
    saveConfig: () => {},
    manager: new AgentManager(),
    ...overrides,
  };
}

type ToolDef = {
  execute: (...args: unknown[]) => Promise<unknown>;
  [k: string]: unknown;
};

function createPi() {
  let toolDef: ToolDef | undefined;
  const pi = {
    registerTool(def: ToolDef) {
      toolDef = def;
    },
    registerCommand() {},
    sendMessage() {},
    getAllTools() {
      return [];
    },
    on() {},
    registerMessageRenderer() {},
    sendUserMessage() {},
  } as unknown as Parameters<typeof registerSubagentTool>[0];

  return {
    pi,
    registeredTool: () => {
      if (!toolDef) throw new Error("registerTool was not called");
      return toolDef;
    },
  };
}

const CTX = { cwd: "/repo" } as unknown as ExtensionContext;

async function executeTool(
  deps: RuntimeDeps,
  params: Partial<SubagentToolInput>,
): Promise<{
  isError: boolean;
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}> {
  const { pi, registeredTool } = createPi();
  registerSubagentTool(pi, deps);
  const tool = registeredTool();
  return tool.execute("tc-1", params, undefined, undefined, CTX) as Promise<{
    isError: boolean;
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// chain dispatch
// ---------------------------------------------------------------------------

describe("chain mode dispatch", () => {
  test("dispatches to executeChain and returns success", async () => {
    const manager = new AgentManager();
    vi.spyOn(manager, "spawnAndWait").mockResolvedValue({
      id: "step-1",
      record: {
        id: "step-1",
        type: "subagent",
        description: "chain step",
        status: "completed",
        startedAt: 1000,
        durationMs: 10,
        result: "step output",
        error: undefined,
        toolUses: 0,
        turnCount: 0,
        lifetimeUsage: emptyUsage(),
      },
    });

    const deps = createDeps({ manager });
    const result = await executeTool(deps, {
      task: "do stuff",
      chain: [{ agent: "Scout", task: "explore {task}" }],
    });

    expect(result.isError).toBe(false);
    expect(result.details.agent).toBe("(chain)");
    expect(result.details.status).toBe("success");
  });

  test("returns error when chain step agent is unknown", async () => {
    const deps = createDeps({
      discoverAgents: () => createDiscovery([createAgent()]),
    });
    const result = await executeTool(deps, {
      task: "do stuff",
      chain: [{ agent: "NonExistent", task: "explore" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown agent");
  });
});

// ---------------------------------------------------------------------------
// chain_append dispatch
// ---------------------------------------------------------------------------

describe("chain_append dispatch", () => {
  test("enqueues steps and returns success", async () => {
    const deps = createDeps();
    const result = await executeTool(deps, {
      task: "",
      chain_append: {
        chain_id: "chain-abc",
        steps: [{ agent: "Scout", task: "more work" }],
      },
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain("chain-abc");
    expect(result.details.status).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// missing agent guard
// ---------------------------------------------------------------------------

describe("missing agent guard", () => {
  test("returns error when neither agent nor chain provided", async () => {
    const deps = createDeps();
    const result = await executeTool(deps, { task: "do stuff" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Missing 'agent'");
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/subagent-chain.test.ts`
Expected: PASS

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (fix any type errors)

- [ ] **Step 8: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/core/subagent.ts tests/subagent-chain.test.ts
git commit -m "feat(subagent): add chain and chain_append modes to subagent tool"
```
