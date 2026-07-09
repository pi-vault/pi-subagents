# Phase 4: Tool Budgets Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tool budgets work end-to-end: frontmatter parsing, tool parameter, resolution, enforcement in runner.

**Prerequisite:** Phase 3 complete (spawn limits enforced, AgentManager updated).

**Tech Stack:** TypeScript, Vitest, Biome, TypeBox (schema)

**Spec:** `docs/superpowers/specs/2026-07-08-spawn-limits-tool-budgets-design.md`

**Deliverable:** An agent with `tool_budget: {"soft": 8, "hard": 15}` in its frontmatter (or passed via tool params) will get a steer at 8 tool calls and abort at 15 tool calls (for blocked tools).

---

### Task 4.1: Parse `tool_budget` from agent frontmatter

**Files:**

- Modify: `src/core/agent-format.ts`
- Modify: `tests/agent-format.test.ts`

- [ ] **Step 1: Add import in agent-format.ts**

Add at the top of `agent-format.ts`, after the existing import:

```typescript
import type { ToolBudgetConfig } from "../shared/types.js";
```

Update the existing import to include `ToolBudgetConfig`:

```typescript
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryDiagnostic,
  ToolBudgetConfig,
} from "../shared/types.js";
```

- [ ] **Step 2: Add `tool_budget` parsing in `parseAgentContent`**

After the `disallowedTools` parsing block (around line 398, before the `return { ok: true, agent: { ... } }`), add:

```typescript
// tool_budget (JSON object string)
let toolBudget: ToolBudgetConfig | undefined;
if (frontmatter.tool_budget !== undefined) {
  if (typeof frontmatter.tool_budget === "string") {
    const trimmed = frontmatter.tool_budget.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          toolBudget = parsed as ToolBudgetConfig;
        }
      } catch {
        return {
          ok: false,
          diagnostic: {
            path: filePath,
            reason: "tool_budget must be a valid JSON object",
          },
        };
      }
    }
  } else if (
    typeof frontmatter.tool_budget === "object" &&
    !Array.isArray(frontmatter.tool_budget)
  ) {
    toolBudget = frontmatter.tool_budget as ToolBudgetConfig;
  }
}
```

- [ ] **Step 3: Add `toolBudget` to the returned agent object**

In the `return { ok: true, agent: { ... } }` block, add after `disallowedTools,`:

```typescript
      toolBudget,
```

- [ ] **Step 4: Add `toolBudget` serialization in `serializeAgent`**

In the `serializeAgent` function, before `frontmatter.push("---", systemPrompt);`, add:

```typescript
if (input.toolBudget) {
  frontmatter.push(`tool_budget: ${JSON.stringify(input.toolBudget)}`);
}
```

- [ ] **Step 5: Write failing tests**

Add to `tests/agent-format.test.ts`, in the `"new frontmatter fields"` describe block:

```typescript
test("parses tool_budget as JSON object", () => {
  const content =
    '---\nname: test\ndescription: A test\ntools: read\ntool_budget: {"soft": 5, "hard": 10}\n---\nPrompt\n';
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.agent.toolBudget).toEqual({ soft: 5, hard: 10 });
  }
});

test("parses tool_budget with block list", () => {
  const content =
    '---\nname: test\ndescription: A test\ntools: read\ntool_budget: {"hard": 15, "block": ["read", "grep"]}\n---\nPrompt\n';
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.agent.toolBudget).toEqual({
      hard: 15,
      block: ["read", "grep"],
    });
  }
});

test("tool_budget is undefined when omitted", () => {
  const content =
    "---\nname: test\ndescription: A test\ntools: read\n---\nPrompt\n";
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.agent.toolBudget).toBeUndefined();
});

test("returns error for invalid tool_budget JSON", () => {
  const content =
    "---\nname: test\ndescription: A test\ntools: read\ntool_budget: {bad json}\n---\nPrompt\n";
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostic.reason).toContain("tool_budget");
});
```

- [ ] **Step 6: Run agent-format tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/agent-format.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```
feat(agent-format): parse tool_budget from frontmatter

- Parse tool_budget as JSON object string or YAML object
- Add toolBudget to returned agent definition
- Serialize toolBudget in serializeAgent
- 4 new tests: parse, parse with block, omitted, invalid JSON
```

---

### Task 4.2: Add `tool_budget` to subagent tool schema + resolve budget

**Files:**

- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `subagent.ts`:

```typescript
import type { ResolvedToolBudget } from "../shared/types.js";
import { validateToolBudget } from "./tool-budget.js";
```

The `ResolvedToolBudget` import is added to the existing type import block from `"../shared/types.js"`.

- [ ] **Step 2: Add `tool_budget` to `SUBAGENT_TOOL_PARAMETERS`**

After the `isolation` parameter in the schema, add:

```typescript
  tool_budget: Type.Optional(
    Type.Object(
      {
        soft: Type.Optional(
          Type.Number({ minimum: 1, description: "Advisory nudge threshold" }),
        ),
        hard: Type.Number({ minimum: 1, description: "Hard block threshold" }),
        block: Type.Optional(
          Type.Union([Type.Array(Type.String()), Type.Literal("*")], {
            description: "Tools to block at hard limit. Default: read, grep, find, ls",
          }),
        ),
      },
      { description: "Tool call budget with soft/hard limits" },
    ),
  ),
```

- [ ] **Step 3: Pass `toolBudget` through `resolveInvocationConfig`**

In the `execute` method, update the `resolveInvocationConfig()` call to include `toolBudget` in all three config objects:

```typescript
const resolved = resolveInvocationConfig(
  {
    model: agentDef.model,
    thinking: agentDef.thinking,
    maxTurns: agentDef.maxTurns,
    isolated: agentDef.isolated,
    inheritContext: agentDef.inheritContext,
    toolBudget: agentDef.toolBudget,
  },
  {
    model: params.model,
    thinking: params.thinking,
    maxTurns: params.max_turns,
    isolated: params.isolated,
    inheritContext: params.inherit_context,
    toolBudget: params.tool_budget,
  },
  {
    model: undefined,
    defaultMaxTurns: loadedConfig.config.defaultMaxTurns,
    toolBudget: loadedConfig.config.toolBudget,
  },
);
```

- [ ] **Step 4: Validate and resolve the merged budget**

After `detailBase` is defined (around line 260), add:

```typescript
// Validate the merged tool budget (from resolveInvocationConfig)
let resolvedBudget: ResolvedToolBudget | undefined;
if (resolved.toolBudget) {
  const validated = validateToolBudget(resolved.toolBudget);
  if (validated.error) {
    return {
      content: [{ type: "text", text: validated.error }],
      isError: true,
      details: {
        ...detailBase,
        status: "error" as const,
        stopReason: "error",
        stderr: validated.error,
      },
    };
  }
  resolvedBudget = validated.budget;
}
```

- [ ] **Step 5: Pass `toolBudget` through spawn options**

Update the `spawnOptions` object to include `toolBudget`:

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

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```
feat(subagent): add tool_budget to tool schema and resolve budget

- TypeBox schema for tool_budget parameter (soft/hard/block)
- Pass toolBudget through resolveInvocationConfig (3-layer)
- Validate merged budget, return error on invalid config
- Pass resolvedBudget through spawn options
```

---

### Task 4.3: Pass `toolBudget` through `AgentManager` to `runAgent`

**Files:**

- Modify: `src/core/agent-manager.ts`

- [ ] **Step 1: Pass `toolBudget` in `startAgent` runOptions**

In the `startAgent` method, in the call to `runAgent(agentDef, { ... }, ...)`, add `toolBudget` to the options object, after `onTextDelta`:

```typescript
        toolBudget: options.toolBudget,
```

This passes the resolved budget from spawn options through to the runner.

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat(agent-manager): pass toolBudget through to runAgent

- Add toolBudget to startAgent runOptions
```

---

### Task 4.4: Enforce tool budget in `src/core/agent-runner.ts`

**Files:**

- Modify: `src/core/agent-runner.ts`

- [ ] **Step 1: Add import**

Add at the top, after the existing imports:

```typescript
import { evaluateToolCall } from "./tool-budget.js";
```

- [ ] **Step 2: Add tracking variables**

In the `runAgent` function, after `let steered = false;` (line 271), add:

```typescript
let budgetToolCount = 0;
let budgetSoftNudged = false;
```

- [ ] **Step 3: Add budget enforcement in `tool_execution_start` handler**

Replace the existing `tool_execution_start` block:

```typescript
if (event.type === "tool_execution_start") {
  options.onToolActivity?.({ type: "start", toolName: event.toolName });
}
```

With:

```typescript
if (event.type === "tool_execution_start") {
  options.onToolActivity?.({ type: "start", toolName: event.toolName });
  if (options.toolBudget) {
    budgetToolCount++;
    const budgetResult = evaluateToolCall(
      options.toolBudget,
      budgetToolCount,
      event.toolName,
    );
    if (budgetResult.outcome === "soft-reached" && !budgetSoftNudged) {
      budgetSoftNudged = true;
      session.steer(budgetResult.message!);
      steered = true;
    } else if (budgetResult.outcome === "hard-blocked") {
      session.steer(budgetResult.message!);
      aborted = true;
      session.abort();
    }
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run lint**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx biome lint src/core/agent-runner.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```
feat(agent-runner): enforce tool budget soft/hard limits

- Track budgetToolCount + budgetSoftNudged in runAgent
- Soft limit: steer once at threshold
- Hard limit: steer + abort for blocked tools
```

---

### Task 4.5: Update tests

**Files:**

- Modify: `tests/agent-manager.test.ts` (verify passthrough)

Since `agent-runner.ts` is mocked in `agent-manager.test.ts`, we can verify that `toolBudget` is passed through to `runAgent`.

- [ ] **Step 1: Add toolBudget passthrough test to `tests/agent-manager.test.ts`**

Add to the `"maxTurns and graceTurns passthrough"` describe block:

```typescript
it("passes toolBudget to runAgent", async () => {
  const manager = new AgentManager(3);
  const spy = vi
    .spyOn(await import("../src/core/agent-runner.js"), "runAgent")
    .mockResolvedValue({
      responseText: "done",
      session: {},
      aborted: false,
      steered: false,
    });

  const budget = { soft: 5, hard: 10, block: ["read"] as string[] };
  await manager.spawnAndWait({}, makeAgentDef(), {
    prompt: "test",
    cwd: tmpDir,
    toolBudget: budget,
  });

  expect(spy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toolBudget: budget }),
    expect.anything(),
  );
  spy.mockRestore();
  manager.dispose();
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/agent-manager.test.ts tests/agent-format.test.ts tests/spawn-guard.test.ts tests/tool-budget.test.ts tests/config.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```
test: add toolBudget passthrough test

- Verify toolBudget flows from spawnAndWait through to runAgent
```

---

### Task 4.6: Phase 4 verification

- [ ] **Step 1: Run full check suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npm run check`
Expected: All pass

---

---

## Final Verification Checklist

After all 4 phases are complete:

- [ ] `npm run check` passes (lint + typecheck + all tests)
- [ ] `tests/spawn-guard.test.ts` -- ~15 unit tests for pure spawn guard logic
- [ ] `tests/tool-budget.test.ts` -- ~20 unit tests for pure tool budget logic
- [ ] `tests/config.test.ts` -- existing tests updated + 4 new for new config fields
- [ ] `tests/invocation-config.test.ts` -- 4 new toolBudget resolution tests (inverted priority)
- [ ] `tests/agent-manager.test.ts` -- 6 new spawn limit tests + 1 toolBudget passthrough test
- [ ] `tests/agent-format.test.ts` -- 4 new tool_budget frontmatter parsing tests
- [ ] Settings menu shows "Max Spawns Per Session" entry
- [ ] No changes to files outside the File Map

**Done.** All features from `docs/superpowers/specs/2026-07-08-spawn-limits-tool-budgets-design.md` are implemented.
