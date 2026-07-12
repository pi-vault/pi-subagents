# Phase 3: Nested Subagents

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable child agents with `subagent_agents` allowlists to spawn their own sub-agents. Add `spawnedBy` tracking and scoped `get_subagent_result`. Thread `customTools` through `RunOptions` to `createAgentSession()`.

**Prerequisite:** Phase 2 (Wait) is complete. No runtime dependency, but the codebase should have the wait tool committed.

**Tech Stack:** TypeScript, Vitest, Biome, TypeBox, `@earendil-works/pi-coding-agent` (`defineTool`, `ToolDefinition`)

**Spec:** `docs/superpowers/specs/2026-07-12-rpc-wait-nesting-design.md` (Feature 3)

**Deliverable:** `npm run check` passes. Child agents can spawn sub-agents per their allowlist. ~25 unit tests.

---

### Task 3.1: Add `spawnedBy` to `AgentRecord` and `customTools` to `RunOptions`

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `spawnedBy` to `AgentRecord`**

In `src/shared/types.ts`, find the `AgentRecord` interface (around line 219). After the `compactionCount?: number;` field, add:

```typescript
  spawnedBy?: string;
```

- [ ] **Step 2: Add `customTools` to `RunOptions`**

In `src/shared/types.ts`, find the `RunOptions` interface (around line 250). After the `toolBudget?: ResolvedToolBudget;` field, add:

```typescript
  customTools?: unknown[];
```

We use `unknown[]` here to avoid importing `ToolDefinition` from pi-coding-agent into the shared types file. The actual typing happens in `agent-runner.ts` where it's cast.

- [ ] **Step 3: Add `spawnedBy` to `SpawnOptions`**

In `src/shared/types.ts`, find the `SpawnOptions` interface (around line 282). After the `toolBudget?: ResolvedToolBudget;` field, add:

```typescript
  spawnedBy?: string;
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

---

### Task 3.2: Thread `customTools` through `agent-runner.ts`

**Files:**

- Modify: `src/core/agent-runner.ts`

- [ ] **Step 1: Import `ToolDefinition` type**

At the top of `src/core/agent-runner.ts`, add to the existing pi-coding-agent type import (line 9):

Change:

```typescript
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
```

To:

```typescript
import type {
  AgentSession,
  AgentSessionEvent,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 2: Pass `customTools` to `createAgentSession`**

In the `runAgent` function, find the `createAgentSession` call (around line 253). Change:

```typescript
const { session } = await createAgentSession({
  cwd: options.cwd,
  agentDir,
  sessionManager,
  settingsManager,
  model,
  tools: allowedTools,
  resourceLoader: loader,
  ...(thinkingLevel ? { thinkingLevel: thinkingLevel as never } : {}),
});
```

To:

```typescript
const customTools = (options.customTools ?? []) as ToolDefinition[];
const { session } = await createAgentSession({
  cwd: options.cwd,
  agentDir,
  sessionManager,
  settingsManager,
  model,
  tools: allowedTools,
  resourceLoader: loader,
  ...(thinkingLevel ? { thinkingLevel: thinkingLevel as never } : {}),
  ...(customTools.length > 0 ? { customTools } : {}),
});
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

---

### Task 3.3: Create `src/core/child-subagent-tool.ts`

**Files:**

- Create: `src/core/child-subagent-tool.ts`

- [ ] **Step 1: Write the child subagent tool factory**

Create `src/core/child-subagent-tool.ts`:

```typescript
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "./agent-manager.js";
import type { AgentDefinition, AgentDiscoveryResult } from "../shared/types.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import { resolveModel } from "./model-resolver.js";
import { resolveInvocationConfig } from "./invocation-config.js";

const CHILD_SUBAGENT_PARAMS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  model: Type.Optional(
    Type.String({
      description:
        "Model override (provider/modelId or fuzzy name like 'haiku', 'sonnet')",
    }),
  ),
  thinking: Type.Optional(
    Type.String({ description: "Thinking level: off, low, medium, high" }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description: "Maximum agentic turns before stopping",
      minimum: 1,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description:
        "If true, agent gets no extension/MCP tools, only built-in tools",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description: "If true, fork parent conversation into the agent",
    }),
  ),
  tool_budget: Type.Optional(
    Type.Object(
      {
        soft: Type.Optional(
          Type.Number({ minimum: 1, description: "Advisory nudge threshold" }),
        ),
        hard: Type.Number({ minimum: 1, description: "Hard block threshold" }),
        block: Type.Optional(
          Type.Union([Type.Array(Type.String()), Type.Literal("*")], {
            description: "Tools to block at hard limit",
          }),
        ),
      },
      { description: "Tool call budget with soft/hard limits" },
    ),
  ),
});

interface ChildSubagentToolOptions {
  manager: AgentManager;
  discovery: AgentDiscoveryResult;
  allowedAgents: string[];
  currentDepth: number;
  parentCwd: string;
  parentAgentId: string;
  deps: RuntimeDeps;
}

export function createChildSubagentTool(opts: ChildSubagentToolOptions) {
  const {
    manager,
    discovery,
    allowedAgents,
    currentDepth,
    parentCwd,
    parentAgentId,
    deps,
  } = opts;

  const allowedSet = new Set(allowedAgents.map((a) => a.trim().toLowerCase()));

  return defineTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate a task to a sub-agent. Always runs in background.",
      `Allowed agents: ${allowedAgents.join(", ") || "(none)"}`,
    ].join("\n"),
    promptSnippet: `Delegate to a sub-agent (allowed: ${allowedAgents.join(", ") || "none"})`,
    parameters: CHILD_SUBAGENT_PARAMS,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const agentName = params.agent.trim().toLowerCase();

      // Validate against allowlist
      if (!allowedSet.has(agentName)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent "${params.agent}" is not allowed. Allowed agents: ${allowedAgents.join(", ")}`,
            },
          ],
          isError: true,
          details: undefined,
        };
      }

      // Find agent definition
      const agentDef = discovery.agents.find(
        (a) => a.name.trim().toLowerCase() === agentName,
      );
      if (!agentDef) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent "${params.agent}" not found in discovery.`,
            },
          ],
          isError: true,
          details: undefined,
        };
      }

      // Resolve config
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const resolved = resolveInvocationConfig(
        agentDef,
        {
          maxTurns: params.max_turns,
          inheritContext: params.inherit_context,
          isolated: params.isolated,
        },
        loadedConfig.config,
      );

      // Resolve model if provided
      let model: unknown;
      if (params.model) {
        const ctxTyped = ctx as unknown as {
          modelRegistry?: {
            listModels?: () => Array<{
              id: string;
              provider: string;
              name?: string;
            }>;
          };
        };
        if (ctxTyped.modelRegistry?.listModels) {
          const match = resolveModel(
            params.model,
            ctxTyped.modelRegistry.listModels(),
          );
          if (!match) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Unknown model: ${params.model}`,
                },
              ],
              isError: true,
              details: undefined,
            };
          }
          model = match;
        }
      }

      // Resolve tool budget
      let toolBudget:
        | { soft?: number; hard: number; block: string[] | "*" }
        | undefined;
      if (params.tool_budget) {
        toolBudget = {
          soft: params.tool_budget.soft,
          hard: params.tool_budget.hard,
          block: params.tool_budget.block ?? ["read", "grep", "find", "ls"],
        };
      }

      try {
        const id = manager.spawn(ctx as unknown, agentDef, {
          prompt: params.task.trim(),
          cwd: parentCwd,
          maxTurns: resolved.maxTurns,
          graceTurns: loadedConfig.config.graceTurns,
          inheritContext: resolved.inheritContext,
          parentSignal: signal ?? undefined,
          currentDepth,
          isBackground: true, // Child spawns are always background
          model,
          spawnedBy: parentAgentId,
          toolBudget,
          ...(params.thinking ? { thinking: params.thinking } : {}),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Background agent started: ${id}\nAgent: ${agentDef.name}\nTask: ${params.task.slice(0, 80)}`,
            },
          ],
          details: undefined,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to spawn agent: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
          details: undefined,
        };
      }
    },
  });
}

/**
 * Create a scoped get_subagent_result that only sees agents spawned by parentAgentId.
 */
export function createChildGetResultTool(
  manager: AgentManager,
  parentAgentId: string,
) {
  return defineTool({
    name: "get_subagent_result",
    label: "Get Agent Result",
    description:
      "Check status and retrieve results from a background agent you spawned.",
    promptSnippet:
      "Check status and retrieve results from a background agent you spawned",
    parameters: Type.Object({
      agent_id: Type.String({ description: "The agent ID to check." }),
      wait: Type.Optional(
        Type.Boolean({
          description: "If true, wait for completion. Default: false.",
        }),
      ),
    }),

    async execute(_toolCallId, params) {
      const record = manager.getRecord(params.agent_id);
      if (!record || record.spawnedBy !== parentAgentId) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent not found: "${params.agent_id}".`,
            },
          ],
          details: undefined,
        };
      }

      if (params.wait && record.status === "running" && record.promise) {
        record.resultConsumed = true;
        await record.promise;
      }

      let output = `Agent: ${record.id}\nStatus: ${record.status}\n`;
      if (record.status === "running" || record.status === "queued") {
        output += "Agent is still running. Use wait: true or check back later.";
      } else if (record.status === "error") {
        output += `Error: ${record.error}`;
      } else {
        output += record.result?.trim() || "No output.";
      }

      if (record.status !== "running" && record.status !== "queued") {
        record.resultConsumed = true;
      }

      return {
        content: [{ type: "text" as const, text: output }],
        details: undefined,
      };
    },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

---

### Task 3.4: Wire `spawnedBy` and `customTools` in `agent-manager.ts`

**Files:**

- Modify: `src/core/agent-manager.ts`

- [ ] **Step 1: Import the child tool factories**

At the top of `src/core/agent-manager.ts`, add:

```typescript
import {
  createChildSubagentTool,
  createChildGetResultTool,
} from "./child-subagent-tool.js";
```

- [ ] **Step 2: Set `spawnedBy` on the record in `spawn()`**

In the `spawn()` method (around line 102), after the record is created but before `this.agents.set(id, record)`, add:

Change (around line 116):

```typescript
this.agents.set(id, record);
```

To:

```typescript
if (options.spawnedBy) {
  record.spawnedBy = options.spawnedBy;
}
this.agents.set(id, record);
```

- [ ] **Step 3: Construct `customTools` and pass through `RunOptions` in `startAgent()`**

In `startAgent()` (around line 247-290), find where `allowRecursion` is computed and the `runAgent` call. After the `allowRecursion` computation (line 247-248), add the customTools construction.

After:

```typescript
const allowRecursion =
  agentDef.subagentAgents.length > 0 &&
  (options.currentDepth ?? 0) + 1 < this.maxDepth;
```

Add:

```typescript
// Build custom tools for child sessions that allow recursion
let customTools: unknown[] = [];
if (allowRecursion) {
  const paths = (options as { _deps?: RuntimeDeps })._deps?.resolvePaths?.();
  const deps = (options as { _deps?: RuntimeDeps })._deps;
  if (deps && paths) {
    const discovery = deps.discoverAgents(paths);
    customTools = [
      createChildSubagentTool({
        manager: this,
        discovery,
        allowedAgents: agentDef.subagentAgents,
        currentDepth: (options.currentDepth ?? 0) + 1,
        parentCwd: effectiveCwd,
        parentAgentId: id,
        deps,
      }),
      createChildGetResultTool(this, id),
    ];
  }
}
```

Then in the `runAgent` call, add `customTools` to the options object. Find:

```typescript
        toolBudget: options.toolBudget,
      },
```

And add `customTools` after `toolBudget`:

```typescript
        toolBudget: options.toolBudget,
        customTools,
      },
```

- [ ] **Step 4: Thread `_deps` through `SpawnOptions`**

In `src/shared/types.ts`, add `_deps?: unknown;` to the `SpawnOptions` interface (after `spawnedBy`):

```typescript
  _deps?: unknown;
```

This is the escape hatch for passing `RuntimeDeps` to `startAgent()` without polluting the public API. The underscore prefix signals it's internal.

- [ ] **Step 5: Pass `_deps` when spawning from the subagent tool**

In `src/core/subagent.ts`, add `_deps: deps` to the `spawnOptions` object (around line 498-508). The `deps` variable is the `RuntimeDeps` parameter of `registerSubagentTool`, already in scope.

Change the `spawnOptions` construction from:

```typescript
const spawnOptions = {
  prompt: params.task.trim(),
  cwd: effectiveCwd,
  maxTurns: resolved.maxTurns,
  graceTurns: loadedConfig.config.graceTurns,
  inheritContext: resolved.inheritContext,
  parentSystemPrompt,
  parentSignal: signal,
  currentDepth: 0,
  toolBudget: resolvedBudget,
};
```

To:

```typescript
const spawnOptions = {
  prompt: params.task.trim(),
  cwd: effectiveCwd,
  maxTurns: resolved.maxTurns,
  graceTurns: loadedConfig.config.graceTurns,
  inheritContext: resolved.inheritContext,
  parentSystemPrompt,
  parentSignal: signal,
  currentDepth: 0,
  toolBudget: resolvedBudget,
  _deps: deps,
};
```

This object is spread into both `manager.spawn()` (line 550, background path) and `manager.spawnAndWait()` (line 606, foreground path), so `_deps` propagates to both without further changes.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

---

### Task 3.5: Write tests for child subagent tools

**Files:**

- Create: `tests/child-subagent-tool.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/child-subagent-tool.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createChildSubagentTool,
  createChildGetResultTool,
} from "../src/core/child-subagent-tool.js";
import { AgentManager } from "../src/core/agent-manager.js";
import { createAgent, createDeps, createDiscovery } from "./_test-helpers.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: {},
    aborted: false,
    steered: false,
  }),
}));

const CTX = { cwd: "/repo" } as unknown as ExtensionContext;

describe("createChildSubagentTool", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager();
  });

  it("spawns an allowed agent in background", async () => {
    const scout = createAgent({ name: "Scout" });
    const deps = createDeps({ manager });
    const discovery = createDiscovery([scout]);

    const tool = createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: ["Scout"],
      currentDepth: 1,
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    const result = await tool.execute(
      "tc-1",
      { agent: "Scout", task: "find files" },
      undefined,
      undefined,
      CTX,
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Background agent started:");
  });

  it("rejects agent not in allowlist", async () => {
    const scout = createAgent({ name: "Scout" });
    const deps = createDeps({ manager });
    const discovery = createDiscovery([scout]);

    const tool = createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: ["Writer"],
      currentDepth: 1,
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    const result = await tool.execute(
      "tc-1",
      { agent: "Scout", task: "find files" },
      undefined,
      undefined,
      CTX,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowed");
  });

  it("rejects agent not found in discovery", async () => {
    const deps = createDeps({ manager });
    const discovery = createDiscovery([]);

    const tool = createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: ["Ghost"],
      currentDepth: 1,
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    const result = await tool.execute(
      "tc-1",
      { agent: "Ghost", task: "test" },
      undefined,
      undefined,
      CTX,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found in discovery");
  });

  it("always spawns in background mode", async () => {
    const scout = createAgent({ name: "Scout" });
    const deps = createDeps({ manager });
    const discovery = createDiscovery([scout]);

    const tool = createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: ["Scout"],
      currentDepth: 1,
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    await tool.execute(
      "tc-1",
      { agent: "Scout", task: "test" },
      undefined,
      undefined,
      CTX,
    );

    const agents = manager.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].isBackground).toBe(true);
  });

  it("sets spawnedBy on the record", async () => {
    const scout = createAgent({ name: "Scout" });
    const deps = createDeps({ manager });
    const discovery = createDiscovery([scout]);

    const tool = createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: ["Scout"],
      currentDepth: 1,
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    await tool.execute(
      "tc-1",
      { agent: "Scout", task: "test" },
      undefined,
      undefined,
      CTX,
    );

    const agents = manager.listAgents();
    expect(agents[0].spawnedBy).toBe("parent-1");
  });

  it("passes incremented depth to spawn", async () => {
    const scout = createAgent({ name: "Scout" });
    const deps = createDeps({ manager });
    const discovery = createDiscovery([scout]);

    // depth 2 with maxDepth 3 should work
    const tool = createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: ["Scout"],
      currentDepth: 2,
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    const result = await tool.execute(
      "tc-1",
      { agent: "Scout", task: "test" },
      undefined,
      undefined,
      CTX,
    );

    expect(result.isError).toBeUndefined();
  });

  it("returns error when depth limit exceeded", async () => {
    const scout = createAgent({ name: "Scout" });
    const managerShallow = new AgentManager(2); // maxDepth = 2
    const deps = createDeps({ manager: managerShallow });
    const discovery = createDiscovery([scout]);

    const tool = createChildSubagentTool({
      manager: managerShallow,
      discovery,
      allowedAgents: ["Scout"],
      currentDepth: 2, // at depth 2, maxDepth 2 should block
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    const result = await tool.execute(
      "tc-1",
      { agent: "Scout", task: "test" },
      undefined,
      undefined,
      CTX,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nesting limit");
  });

  it("is case-insensitive for agent names", async () => {
    const scout = createAgent({ name: "Scout" });
    const deps = createDeps({ manager });
    const discovery = createDiscovery([scout]);

    const tool = createChildSubagentTool({
      manager,
      discovery,
      allowedAgents: ["scout"],
      currentDepth: 1,
      parentCwd: "/tmp",
      parentAgentId: "parent-1",
      deps,
    });

    const result = await tool.execute(
      "tc-1",
      { agent: "SCOUT", task: "test" },
      undefined,
      undefined,
      CTX,
    );

    expect(result.isError).toBeUndefined();
  });
});

describe("createChildGetResultTool", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager();
  });

  it("returns result for agent spawned by parent", async () => {
    const scout = createAgent({ name: "Scout" });
    const { id, record } = await manager.spawnAndWait({}, scout, {
      prompt: "test",
      cwd: "/tmp",
      spawnedBy: "parent-1",
    });
    record.spawnedBy = "parent-1";

    const tool = createChildGetResultTool(manager, "parent-1");
    const result = await tool.execute(
      "tc-1",
      { agent_id: id },
      undefined,
      undefined,
      CTX,
    );

    expect(result.content[0].text).toContain("completed");
  });

  it("rejects agent not spawned by parent", async () => {
    const scout = createAgent({ name: "Scout" });
    const { id } = await manager.spawnAndWait({}, scout, {
      prompt: "test",
      cwd: "/tmp",
    });

    const tool = createChildGetResultTool(manager, "parent-1");
    const result = await tool.execute(
      "tc-1",
      { agent_id: id },
      undefined,
      undefined,
      CTX,
    );

    expect(result.content[0].text).toContain("Agent not found");
  });

  it("rejects unknown agent id", async () => {
    const tool = createChildGetResultTool(manager, "parent-1");
    const result = await tool.execute(
      "tc-1",
      { agent_id: "nonexistent" },
      undefined,
      undefined,
      CTX,
    );

    expect(result.content[0].text).toContain("Agent not found");
  });

  it("waits for running agent when wait=true", async () => {
    const scout = createAgent({ name: "Scout" });
    const id = manager.spawn({}, scout, {
      prompt: "test",
      cwd: "/tmp",
      isBackground: true,
      spawnedBy: "parent-1",
    });
    const record = manager.getRecord(id)!;
    record.spawnedBy = "parent-1";

    const tool = createChildGetResultTool(manager, "parent-1");
    const result = await tool.execute(
      "tc-1",
      { agent_id: id, wait: true },
      undefined,
      undefined,
      CTX,
    );

    expect(result.content[0].text).toContain("Status:");
  });

  it("sets resultConsumed on completed agent", async () => {
    const scout = createAgent({ name: "Scout" });
    const { id, record } = await manager.spawnAndWait({}, scout, {
      prompt: "test",
      cwd: "/tmp",
    });
    record.spawnedBy = "parent-1";

    const tool = createChildGetResultTool(manager, "parent-1");
    await tool.execute("tc-1", { agent_id: id }, undefined, undefined, CTX);

    expect(record.resultConsumed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/child-subagent-tool.test.ts`

Expected: All tests pass.

- [ ] **Step 3: Fix any failures and re-run**

Iterate until all tests pass.

---

### Task 3.6: Run full check suite

**Files:**

- All modified files

- [ ] **Step 1: Run checks**

Run: `npm run check`

Expected: No errors, no warnings.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass, including existing tests (no regressions).

- [ ] **Step 3: Fix any issues**

If any existing tests break (e.g. from the new `spawnedBy` field), fix them.

---

### Task 3.7: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add \
  src/shared/types.ts \
  src/core/agent-runner.ts \
  src/core/child-subagent-tool.ts \
  src/core/agent-manager.ts \
  src/core/subagent.ts \
  tests/child-subagent-tool.test.ts
git commit -m "feat(agent): add nested subagent support via tool injection

Child agents with subagent_agents allowlists receive injected
subagent and get_subagent_result tools via customTools.
Adds spawnedBy tracking on AgentRecord for scoped visibility.
Child spawns always run in background, share parent concurrency.

Spec: docs/superpowers/specs/2026-07-12-rpc-wait-nesting-design.md"
```
