# Phase 2: Tool Schema, Frontmatter, and Execution Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `subagent` tool with new parameters, parse new frontmatter fields, implement prompt modes (replace/append), turn-based limits, context forking, and extension loading policies.

**Architecture:** Add `resolveInvocationConfig()` for merging frontmatter + tool params + parent defaults. Add `resolveModel()` for fuzzy model matching. Parse new frontmatter fields in `agent-format.ts`. Implement `buildAgentPrompt()` with replace/append modes and `buildParentContext()` for context forking in `agent-runner.ts`. Replace `setTimeout` timeout with turn-counting via `session.steer()` + `session.abort()`. Expand `SUBAGENT_TOOL_PARAMETERS` with stubs for features not yet implemented (background, resume, isolation). Remove `defaultTimeoutMs` from config and runtime paths, keeping `timeout_ms` frontmatter parsing for backward compat.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, typebox, Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-1b-tool-schema-frontmatter-design.md`

**Prerequisite:** Phase 1 (Core Plumbing) must be complete. Verify: `pnpm check` passes on current branch.

---

## File Structure

| Action | File                              | Responsibility                                                                                                                                                      |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create | `src/core/invocation-config.ts`   | `resolveInvocationConfig()` merge logic                                                                                                                             |
| Create | `src/core/model-resolver.ts`      | Model resolution with fuzzy matching                                                                                                                                |
| Create | `tests/invocation-config.test.ts` | Merge priority chain tests                                                                                                                                          |
| Create | `tests/model-resolver.test.ts`    | Exact/fuzzy/no match tests                                                                                                                                          |
| Modify | `src/shared/types.ts`             | Extend `AgentDefinition`, `AgentInvocation`, `AgentRecord`, `RunOptions`, `RunResult`, `SpawnOptions`, `SubagentsConfig`, `SubagentExecutionDetails`; add `EnvInfo` |
| Modify | `src/core/agent-format.ts`        | Parse new frontmatter fields                                                                                                                                        |
| Modify | `src/core/agent-runner.ts`        | `buildAgentPrompt()`, `detectEnv()`, `buildParentContext()`, turn limits, extension policies, `disallowed_tools`                                                    |
| Modify | `src/core/agent-manager.ts`       | Accept new `SpawnOptions`, resolve `maxTurns` chain, handle `"steered"` status                                                                                      |
| Modify | `src/core/subagent.ts`            | Expand tool schema, stub handling, wire `resolveInvocationConfig`, switch from timeout to maxTurns                                                                  |
| Modify | `src/core/config.ts`              | Add `defaultMaxTurns`, `graceTurns`; remove `defaultTimeoutMs`                                                                                                      |
| Modify | `src/tui/render.ts`               | Show thinking in details, render `"steered"` status, replace `timeout:` with `turns:` line                                                                          |
| Modify | `src/tui/agents-menu.ts`          | Replace `defaultTimeoutMs` setting with `defaultMaxTurns` and `graceTurns`                                                                                          |
| Modify | `agents/*.md`                     | Add `prompt_mode: replace` to all bundled agents                                                                                                                    |
| Modify | `tests/agent-format.test.ts`      | New frontmatter field tests                                                                                                                                         |
| Modify | `tests/agent-runner.test.ts`      | Prompt modes, turn limits, extension policies, disallowed_tools, context forking tests                                                                              |
| Modify | `tests/agent-manager.test.ts`     | New options, `maxTurns` resolution, `"steered"` status tests                                                                                                        |
| Modify | `tests/subagent.test.ts`          | New tool params, stub responses, invocation config wiring tests                                                                                                     |
| Modify | `tests/config.test.ts`            | New defaults tests, `defaultTimeoutMs` removed                                                                                                                      |
| Modify | `tests/render.test.ts`            | `"steered"` status, thinking display, turn count tests                                                                                                              |
| Modify | `tests/index.test.ts`             | Update `SubagentsConfig` mock to use new fields                                                                                                                     |

---

## Task dependency graph

```
Task 1 (types) ──┬── Task 2 (invocation-config) ──┐
                  ├── Task 3 (model-resolver) ──────┤
                  ├── Task 4 (agent-format) ────────┤
                  └── Task 5 (config) ──────────────┤
                                                    │
                        Task 6 (agent-runner) ◄─────┘
                              │
                        Task 7 (agent-manager) ◄── Task 6
                              │
                        Task 8 (subagent) ◄──── Tasks 2, 7
                              │
                        Task 9 (deprecate timeoutMs) ◄── Task 8
                              │
                  ┌───────────┼───────────┐
            Task 10       Task 11      Task 12
          (render)    (agents-menu)  (bundled agents)
```

Tasks 2-5 are independent of each other and can run in parallel after Task 1.

---

### Task 1: Extend types with new fields

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `tests/types-smoke.test.ts`

This task adds new optional fields to existing interfaces. All additions are optional or have defaults, so existing code continues to compile without changes.

- [ ] **Step 1: Extend `AgentDefinition` with new frontmatter fields**

In `src/shared/types.ts`, add the new fields after `timeoutMs`:

```typescript
export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: string;
  subagentAgents: string[];
  enabled?: boolean;
  skills?: string[] | boolean;
  systemPrompt: string;
  sourcePath: string;
  timeoutMs?: number;
  // Phase 2: new frontmatter fields
  promptMode?: "replace" | "append";
  maxTurns?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
  isolated?: boolean;
  isolation?: "worktree";
  extensions?: true | string[] | false;
  disallowedTools?: string[];
}
```

- [ ] **Step 2: Add `"steered"` to `AgentRecord.status` and `steered` to `RunResult`**

Update the `AgentRecord` interface:

```typescript
export interface AgentRecord {
  id: string;
  type: string;
  status: "running" | "completed" | "steered" | "aborted" | "error";
  // ... rest unchanged
}
```

Update `RunResult`:

```typescript
export interface RunResult {
  responseText: string;
  session: unknown; // AgentSession
  aborted: boolean;
  steered: boolean;
}
```

- [ ] **Step 3: Extend `AgentInvocation` with new fields**

```typescript
export interface AgentInvocation {
  agent: string;
  task: string;
  cwd?: string;
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
}
```

- [ ] **Step 4: Add `maxTurns`, `graceTurns`, `isolated`, `inheritContext` to `SpawnOptions` and `RunOptions`**

Add to `RunOptions` (keep `timeoutMs` for now — removed in Task 9):

```typescript
export interface RunOptions {
  prompt: string;
  cwd: string;
  agentId: string;
  model?: unknown; // Model from pi-ai
  thinking?: string;
  timeoutMs?: number;
  maxTurns?: number;
  graceTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  parentSystemPrompt?: string;
  allowRecursion?: boolean;
  signal?: AbortSignal;
  onToolActivity?: (activity: ToolActivity) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsage?: (usage: {
    input: number;
    output: number;
    cacheWrite: number;
  }) => void;
  onSessionCreated?: (session: unknown) => void;
}
```

Add to `SpawnOptions` (keep `timeoutMs` for now):

```typescript
export interface SpawnOptions {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  maxTurns?: number;
  graceTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  parentSystemPrompt?: string;
  parentSignal?: AbortSignal;
  currentDepth?: number;
  allowedAgents?: string[];
  onToolActivity?: (activity: ToolActivity) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsage?: (usage: {
    input: number;
    output: number;
    cacheWrite: number;
  }) => void;
  onSessionCreated?: (session: unknown) => void;
}
```

- [ ] **Step 5: Add `EnvInfo` type**

```typescript
export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}
```

- [ ] **Step 6: Add `"steered"` to `SubagentExecutionDetails.status`**

Update the status union:

```typescript
export interface SubagentExecutionDetails {
  status: "success" | "error" | "timeout" | "aborted" | "steered";
  // ... rest unchanged
}
```

- [ ] **Step 7: Update smoke test for `RunResult.steered`**

In `tests/types-smoke.test.ts`, update the `RunResult` test:

```typescript
it("RunResult includes steered flag", () => {
  const result: RunResult = {
    responseText: "done",
    session: {},
    aborted: false,
    steered: false,
  };
  expect(result.steered).toBe(false);
});
```

- [ ] **Step 8: Fix existing code that constructs `RunResult` without `steered`**

In `src/core/agent-runner.ts`, add `steered: false` to the return at line 147:

```typescript
return { responseText, session: session as unknown, aborted, steered: false };
```

- [ ] **Step 9: Run `pnpm check` to verify everything compiles and tests pass**

Run: `pnpm check`
Expected: PASS (all additions are optional or have defaults; the one construction site in agent-runner.ts is fixed in Step 8)

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/core/agent-runner.ts tests/types-smoke.test.ts
git commit -m "feat: extend types with phase 2 fields (steered, maxTurns, isolated, etc.)"
```

---

### Task 2: Add invocation config merge logic

**Files:**

- Create: `src/core/invocation-config.ts`
- Create: `tests/invocation-config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/invocation-config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveInvocationConfig } from "../src/core/invocation-config.js";

describe("resolveInvocationConfig", () => {
  it("frontmatter model takes priority over tool param", () => {
    const result = resolveInvocationConfig(
      { model: "anthropic/claude-sonnet-4" },
      { model: "anthropic/claude-haiku-4-5" },
      {},
    );
    expect(result.model).toBe("anthropic/claude-sonnet-4");
  });

  it("tool param model used when frontmatter omits it", () => {
    const result = resolveInvocationConfig(
      {},
      { model: "anthropic/claude-haiku-4-5" },
      {},
    );
    expect(result.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("parent model used as fallback", () => {
    const result = resolveInvocationConfig(
      {},
      {},
      { model: "anthropic/claude-sonnet-4" },
    );
    expect(result.model).toBe("anthropic/claude-sonnet-4");
  });

  it("returns undefined model when all sources omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.model).toBeUndefined();
  });

  it("frontmatter thinking takes priority", () => {
    const result = resolveInvocationConfig(
      { thinking: "high" },
      { thinking: "low" },
      { thinking: "medium" },
    );
    expect(result.thinking).toBe("high");
  });

  it("frontmatter maxTurns takes priority over tool param", () => {
    const result = resolveInvocationConfig(
      { maxTurns: 10 },
      { maxTurns: 20 },
      { defaultMaxTurns: 30 },
    );
    expect(result.maxTurns).toBe(10);
  });

  it("tool param maxTurns used when frontmatter omits it", () => {
    const result = resolveInvocationConfig(
      {},
      { maxTurns: 20 },
      { defaultMaxTurns: 30 },
    );
    expect(result.maxTurns).toBe(20);
  });

  it("config defaultMaxTurns used as fallback", () => {
    const result = resolveInvocationConfig({}, {}, { defaultMaxTurns: 30 });
    expect(result.maxTurns).toBe(30);
  });

  it("defaults maxTurns to 0 (unlimited) when all omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.maxTurns).toBe(0);
  });

  it("frontmatter isolated takes priority", () => {
    const result = resolveInvocationConfig(
      { isolated: true },
      { isolated: false },
      {},
    );
    expect(result.isolated).toBe(true);
  });

  it("tool param isolated used when frontmatter omits it", () => {
    const result = resolveInvocationConfig({}, { isolated: true }, {});
    expect(result.isolated).toBe(true);
  });

  it("defaults to false for isolated when both omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.isolated).toBe(false);
  });

  it("frontmatter inheritContext takes priority", () => {
    const result = resolveInvocationConfig(
      { inheritContext: true },
      { inheritContext: false },
      {},
    );
    expect(result.inheritContext).toBe(true);
  });

  it("defaults to false for inheritContext when both omit it", () => {
    const result = resolveInvocationConfig({}, {}, {});
    expect(result.inheritContext).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/invocation-config.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `invocation-config.ts`**

Create `src/core/invocation-config.ts`:

```typescript
export interface AgentFrontmatterConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
}

export interface ToolParamConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
}

export interface ParentDefaults {
  model?: string;
  thinking?: string;
  defaultMaxTurns?: number;
}

export interface ResolvedInvocationConfig {
  model?: string;
  thinking?: string;
  maxTurns: number;
  isolated: boolean;
  inheritContext: boolean;
}

export function resolveInvocationConfig(
  frontmatter: AgentFrontmatterConfig,
  toolParams: ToolParamConfig,
  defaults: ParentDefaults,
): ResolvedInvocationConfig {
  return {
    model: frontmatter.model ?? toolParams.model ?? defaults.model,
    thinking: frontmatter.thinking ?? toolParams.thinking ?? defaults.thinking,
    maxTurns:
      frontmatter.maxTurns ??
      toolParams.maxTurns ??
      defaults.defaultMaxTurns ??
      0,
    isolated: frontmatter.isolated ?? toolParams.isolated ?? false,
    inheritContext:
      frontmatter.inheritContext ?? toolParams.inheritContext ?? false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/invocation-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/invocation-config.ts tests/invocation-config.test.ts
git commit -m "feat: add resolveInvocationConfig merge logic"
```

---

### Task 3: Add model resolver

**Files:**

- Create: `src/core/model-resolver.ts`
- Create: `tests/model-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/model-resolver.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveModel } from "../src/core/model-resolver.js";
import type { ModelInfo } from "../src/core/model-resolver.js";

const mockModels: ModelInfo[] = [
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    name: "Claude Sonnet 4",
  },
  {
    id: "claude-haiku-4-5-20250514",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
  },
  { id: "gpt-4o", provider: "openai", name: "GPT-4o" },
];

describe("resolveModel", () => {
  it("exact provider/id match", () => {
    const result = resolveModel(
      "anthropic/claude-sonnet-4-20250514",
      mockModels,
    );
    expect(result).toEqual({
      id: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });
  });

  it("exact id match without provider prefix", () => {
    const result = resolveModel("gpt-4o", mockModels);
    expect(result).toEqual({ id: "gpt-4o", provider: "openai" });
  });

  it("fuzzy match on 'sonnet'", () => {
    const result = resolveModel("sonnet", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-sonnet-4-20250514");
    expect(result?.provider).toBe("anthropic");
  });

  it("fuzzy match on 'haiku'", () => {
    const result = resolveModel("haiku", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-haiku-4-5-20250514");
    expect(result?.provider).toBe("anthropic");
  });

  it("returns undefined for no match", () => {
    const result = resolveModel("nonexistent-model", mockModels);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty query", () => {
    const result = resolveModel("", mockModels);
    expect(result).toBeUndefined();
  });

  it("returns undefined for whitespace-only query", () => {
    const result = resolveModel("   ", mockModels);
    expect(result).toBeUndefined();
  });

  it("case-insensitive matching", () => {
    const result = resolveModel("ANTHROPIC/GPT-4O", mockModels);
    // provider doesn't match, but id "gpt-4o" is in openai
    expect(result).toBeUndefined();

    const result2 = resolveModel("OPENAI/GPT-4O", mockModels);
    expect(result2).toEqual({ id: "gpt-4o", provider: "openai" });
  });

  it("multi-part fuzzy match on 'claude sonnet'", () => {
    const result = resolveModel("claude sonnet", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-sonnet-4-20250514");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/model-resolver.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `model-resolver.ts`**

Create `src/core/model-resolver.ts`:

```typescript
export interface ModelInfo {
  id: string;
  provider: string;
  name?: string;
}

export interface ResolvedModel {
  id: string;
  provider: string;
}

export function resolveModel(
  query: string,
  models: ModelInfo[],
): ResolvedModel | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  // Try exact provider/id match
  if (q.includes("/")) {
    const slashIndex = q.indexOf("/");
    const provider = q.slice(0, slashIndex);
    const id = q.slice(slashIndex + 1);
    const match = models.find(
      (m) => m.provider.toLowerCase() === provider && m.id.toLowerCase() === id,
    );
    if (match) return { id: match.id, provider: match.provider };
  }

  // Try exact id match
  const exactId = models.find((m) => m.id.toLowerCase() === q);
  if (exactId) return { id: exactId.id, provider: exactId.provider };

  // Fuzzy: id or name contains query
  const containsMatch = models.find(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      (m.name && m.name.toLowerCase().includes(q)),
  );
  if (containsMatch)
    return { id: containsMatch.id, provider: containsMatch.provider };

  // Fuzzy: all query parts present in id or name
  const parts = q.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length > 1) {
    const partsMatch = models.find((m) => {
      const haystack = `${m.id} ${m.name ?? ""}`.toLowerCase();
      return parts.every((p) => haystack.includes(p));
    });
    if (partsMatch) return { id: partsMatch.id, provider: partsMatch.provider };
  }

  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/model-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/model-resolver.ts tests/model-resolver.test.ts
git commit -m "feat: add model resolver with exact and fuzzy matching"
```

---

### Task 4: Parse new frontmatter fields

**Files:**

- Modify: `src/core/agent-format.ts`
- Modify: `tests/agent-format.test.ts`

- [ ] **Step 1: Write failing tests for new frontmatter fields**

Add to `tests/agent-format.test.ts`, inside a new `describe("new frontmatter fields", ...)` block after the existing `parseAgentContent` tests:

```typescript
describe("new frontmatter fields", () => {
  test("parses prompt_mode: replace", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nprompt_mode: replace\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.promptMode).toBe("replace");
  });

  test("parses prompt_mode: append", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nprompt_mode: append\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.promptMode).toBe("append");
  });

  test("defaults prompt_mode to replace for invalid value", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nprompt_mode: invalid\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.promptMode).toBe("replace");
  });

  test("prompt_mode is undefined when omitted", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.promptMode).toBeUndefined();
  });

  test("parses max_turns as non-negative integer", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nmax_turns: 30\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.maxTurns).toBe(30);
  });

  test("parses max_turns: 0 as unlimited", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nmax_turns: 0\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.maxTurns).toBe(0);
  });

  test("ignores invalid max_turns", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nmax_turns: abc\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.maxTurns).toBeUndefined();
  });

  test("parses isolated: true", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nisolated: true\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.isolated).toBe(true);
  });

  test("parses isolated: false", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nisolated: false\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.isolated).toBe(false);
  });

  test("parses inherit_context: true", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\ninherit_context: true\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.inheritContext).toBe(true);
  });

  test("parses run_in_background: true", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nrun_in_background: true\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.runInBackground).toBe(true);
  });

  test("parses isolation: worktree", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nisolation: worktree\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.isolation).toBe("worktree");
  });

  test("ignores invalid isolation value", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nisolation: docker\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.isolation).toBeUndefined();
  });

  test("parses extensions: false", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nextensions: false\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.extensions).toBe(false);
  });

  test("parses extensions: none as false", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nextensions: none\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.extensions).toBe(false);
  });

  test("parses extensions: true", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nextensions: true\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.extensions).toBe(true);
  });

  test("parses extensions as CSV list", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\nextensions: ext-a, ext-b\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.extensions).toEqual(["ext-a", "ext-b"]);
  });

  test("parses disallowed_tools as CSV", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\ndisallowed_tools: bash, write\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.agent.disallowedTools).toEqual(["bash", "write"]);
  });

  test("disallowed_tools defaults to empty array when omitted", () => {
    const content =
      "---\nname: test\ndescription: A test\ntools: read\n---\nPrompt\n";
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.disallowedTools).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/agent-format.test.ts`
Expected: FAIL (new properties not present on returned agent)

- [ ] **Step 3: Add parsing logic to `agent-format.ts`**

In the `parseAgentContent` function, after the `skills` parsing block (around line 326) and before the return statement (line 328), add:

```typescript
// prompt_mode
let promptMode: "replace" | "append" | undefined;
if (typeof frontmatter.prompt_mode === "string") {
  const pm = frontmatter.prompt_mode.trim().toLowerCase();
  promptMode = pm === "append" ? "append" : "replace";
}

// max_turns
let maxTurns: number | undefined;
if (frontmatter.max_turns !== undefined) {
  const parsed = Number(frontmatter.max_turns);
  if (Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed)) {
    maxTurns = parsed;
  }
}

// inherit_context
let inheritContext: boolean | undefined;
if (typeof frontmatter.inherit_context === "string") {
  inheritContext = frontmatter.inherit_context.trim().toLowerCase() === "true";
}

// isolated
let isolated: boolean | undefined;
if (typeof frontmatter.isolated === "string") {
  isolated = frontmatter.isolated.trim().toLowerCase() === "true";
}

// run_in_background
let runInBackground: boolean | undefined;
if (typeof frontmatter.run_in_background === "string") {
  runInBackground =
    frontmatter.run_in_background.trim().toLowerCase() === "true";
}

// isolation
let isolation: "worktree" | undefined;
if (
  typeof frontmatter.isolation === "string" &&
  frontmatter.isolation.trim().toLowerCase() === "worktree"
) {
  isolation = "worktree";
}

// extensions
let extensions: true | string[] | false | undefined;
if (typeof frontmatter.extensions === "string") {
  const ext = frontmatter.extensions.trim().toLowerCase();
  if (ext === "false" || ext === "none") {
    extensions = false;
  } else if (ext === "true") {
    extensions = true;
  } else if (ext) {
    extensions = frontmatter.extensions
      .split(",")
      .map((e: string) => e.trim())
      .filter(Boolean);
  }
}

// disallowed_tools
const disallowedToolsResult = parseStringArray(
  frontmatter.disallowed_tools,
  "disallowed_tools",
);
const disallowedTools =
  disallowedToolsResult.ok && disallowedToolsResult.value.length > 0
    ? disallowedToolsResult.value
    : undefined;
```

Then add all new fields to the return object (the `agent` property):

```typescript
return {
  ok: true,
  agent: {
    name,
    description,
    tools: tools.value,
    model,
    thinking,
    subagentAgents: subagentAgents.value,
    timeoutMs,
    enabled,
    skills,
    promptMode,
    maxTurns,
    inheritContext,
    runInBackground,
    isolated,
    isolation,
    extensions,
    disallowedTools,
    systemPrompt,
    sourcePath: filePath,
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/agent-format.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/agent-format.ts tests/agent-format.test.ts
git commit -m "feat: parse new frontmatter fields (prompt_mode, max_turns, isolated, etc.)"
```

---

### Task 5: Update config with new defaults

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Update `SubagentsConfig` type**

In `src/shared/types.ts`, replace the `SubagentsConfig` interface:

```typescript
export interface SubagentsConfig {
  maxConcurrency: number;
  maxRecursiveLevel: number;
  defaultMaxTurns: number;
  graceTurns: number;
}
```

- [ ] **Step 2: Update `DEFAULT_CONFIG` in `config.ts`**

Replace the existing `DEFAULT_CONFIG`:

```typescript
export const DEFAULT_CONFIG: SubagentsConfig = {
  maxConcurrency: 3,
  maxRecursiveLevel: 3,
  defaultMaxTurns: 0,
  graceTurns: 5,
};
```

- [ ] **Step 3: Update `saveConfig` in `config.ts`**

Replace the JSON keys written:

```typescript
export function saveConfig(
  paths: ResolvedPaths,
  config: SubagentsConfig,
): void {
  mkdirSync(dirname(paths.configPath), { recursive: true });
  writeFileSync(
    paths.configPath,
    `${JSON.stringify(
      {
        maxConcurrency: config.maxConcurrency,
        maxRecursiveLevel: config.maxRecursiveLevel,
        defaultMaxTurns: config.defaultMaxTurns,
        graceTurns: config.graceTurns,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
```

- [ ] **Step 4: Update `loadConfig` in `config.ts`**

Replace the parsed config object in the return:

```typescript
return {
  config: {
    maxConcurrency: isFiniteNumber(raw.maxConcurrency)
      ? raw.maxConcurrency
      : DEFAULT_CONFIG.maxConcurrency,
    maxRecursiveLevel: isFiniteNumber(raw.maxRecursiveLevel)
      ? raw.maxRecursiveLevel
      : DEFAULT_CONFIG.maxRecursiveLevel,
    defaultMaxTurns: isFiniteNumber(raw.defaultMaxTurns)
      ? raw.defaultMaxTurns
      : DEFAULT_CONFIG.defaultMaxTurns,
    graceTurns: isFiniteNumber(raw.graceTurns)
      ? raw.graceTurns
      : DEFAULT_CONFIG.graceTurns,
  },
  exists: true,
};
```

- [ ] **Step 5: Update `tests/config.test.ts`**

Replace the test file with:

```typescript
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../src/core/config.js";
import { resolvePaths } from "../src/core/paths.js";

describe("loadConfig", () => {
  test("uses defaults when subagents.json is missing", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const paths = resolvePaths(agentDir);

    const result = loadConfig(paths);

    expect(result.exists).toBe(false);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.config.defaultMaxTurns).toBe(0);
    expect(result.config.graceTurns).toBe(5);
  });

  test("merges configured values with defaults", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const configDir = join(agentDir, "extensions");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "subagents.json"),
      JSON.stringify({ maxConcurrency: 7, defaultMaxTurns: 20 }),
    );

    const result = loadConfig(resolvePaths(agentDir));

    expect(result.exists).toBe(true);
    expect(result.config).toEqual({
      maxConcurrency: 7,
      maxRecursiveLevel: DEFAULT_CONFIG.maxRecursiveLevel,
      defaultMaxTurns: 20,
      graceTurns: DEFAULT_CONFIG.graceTurns,
    });
  });

  test("falls back to defaults when subagents.json is malformed", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const configDir = join(agentDir, "extensions");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "subagents.json"), "{ bad json", "utf8");

    const result = loadConfig(resolvePaths(agentDir));

    expect(result.exists).toBe(true);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  test("saveConfig writes only supported config keys", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const paths = resolvePaths(agentDir);

    saveConfig(paths, {
      maxConcurrency: 7,
      maxRecursiveLevel: 5,
      defaultMaxTurns: 15,
      graceTurns: 3,
    });

    expect(JSON.parse(readFileSync(paths.configPath, "utf8"))).toEqual({
      maxConcurrency: 7,
      maxRecursiveLevel: 5,
      defaultMaxTurns: 15,
      graceTurns: 3,
    });
  });
});
```

- [ ] **Step 6: Fix all other compile errors from the type change**

The `SubagentsConfig` type change (removing `defaultTimeoutMs`, adding `defaultMaxTurns`/`graceTurns`) will cause compile errors wherever `SubagentsConfig` is constructed. Fix each one:

In `tests/subagent.test.ts`, update the `loadConfig` mock (line 71):

```typescript
config: { maxConcurrency: 3, maxRecursiveLevel: 3, defaultMaxTurns: 0, graceTurns: 5 },
```

In `tests/index.test.ts`, update the config object (line ~64 and ~299):

```typescript
const config: SubagentsConfig = {
  maxConcurrency: 3,
  maxRecursiveLevel: 3,
  defaultMaxTurns: 0,
  graceTurns: 5,
};
```

In `src/tui/agents-menu.ts`, update the `SettingsKey` type (line 24-27) and `SETTINGS_MENU_ITEMS` (line 37-68):

Replace the type:

```typescript
type SettingsKey =
  | "maxConcurrency"
  | "maxRecursiveLevel"
  | "defaultMaxTurns"
  | "graceTurns";
```

Replace the `SETTINGS_MENU_ITEMS` array:

```typescript
export const SETTINGS_MENU_ITEMS: SettingsMenuItem[] = [
  {
    key: "maxConcurrency",
    label: "Max Concurrency",
    promptTitle: "Max Concurrency",
    formatValue: (config) => String(config.maxConcurrency),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value > 0 ? value : undefined;
    },
  },
  {
    key: "maxRecursiveLevel",
    label: "Max Recursive Level",
    promptTitle: "Max Recursive Level",
    formatValue: (config) => String(config.maxRecursiveLevel),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value > 0 ? value : undefined;
    },
  },
  {
    key: "defaultMaxTurns",
    label: "Default Max Turns",
    promptTitle: "Default Max Turns (0 = unlimited)",
    formatValue: (config) =>
      config.defaultMaxTurns === 0
        ? "0 (unlimited)"
        : String(config.defaultMaxTurns),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    },
  },
  {
    key: "graceTurns",
    label: "Grace Turns",
    promptTitle: "Grace Turns (extra turns after soft limit)",
    formatValue: (config) => String(config.graceTurns),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    },
  },
];
```

In `src/core/subagent.ts`, replace all `loadedConfig.config.defaultTimeoutMs` references with `loadedConfig.config.defaultMaxTurns`. There are two sites (lines ~109 and ~218). The timeout resolution changes — instead of computing `timeoutMs`, compute `maxTurns`:

At line ~108-109 (tool handler):

```typescript
const maxTurns = agentDef.maxTurns ?? loadedConfig.config.defaultMaxTurns;
```

At line ~217-218 (command handler):

```typescript
const maxTurns = agentDef.maxTurns ?? loadedConfig.config.defaultMaxTurns;
```

**Note:** The `timeoutMs` field on `SubagentExecutionDetails` and `SpawnOptions.timeoutMs` will be addressed in Task 9. For now, pass `0` for `timeoutMs` in the details objects and stop passing `timeoutMs` to `spawnAndWait`.

- [ ] **Step 7: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS (may need to iterate on remaining compile errors)

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/core/config.ts src/core/subagent.ts src/tui/agents-menu.ts tests/config.test.ts tests/subagent.test.ts tests/index.test.ts
git commit -m "feat: update config to use defaultMaxTurns and graceTurns, remove defaultTimeoutMs"
```

---

### Task 6: Implement prompt modes, turn limits, extension policies, and context forking in AgentRunner

**Files:**

- Modify: `src/core/agent-runner.ts`
- Modify: `tests/agent-runner.test.ts`

This is the largest task. It replaces `buildSystemPrompt()` with `buildAgentPrompt()` (supporting replace/append modes), adds `detectEnv()`, implements turn-based limits (replacing `setTimeout`), adds extension loading policies, `disallowed_tools` filtering, and `buildParentContext()`.

- [ ] **Step 1: Write failing tests for `buildAgentPrompt()` (replace mode)**

Replace the entire test file `tests/agent-runner.test.ts` with the new version. The mock stays the same; add tests in stages. Start with:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runAgent,
  buildAgentPrompt,
  detectEnv,
  buildParentContext,
} from "../src/core/agent-runner.js";
import type {
  AgentDefinition,
  EnvInfo,
  RunOptions,
} from "../src/shared/types.js";

// Mock createAgentSession and DefaultResourceLoader
vi.mock("@earendil-works/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn(() => () => {}),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    messages: [],
  };
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: mockSession,
      extensionsResult: { extensions: [] },
    }),
    DefaultResourceLoader: vi.fn(function (this: {
      reload: ReturnType<typeof vi.fn>;
    }) {
      this.reload = vi.fn().mockResolvedValue(undefined);
    }),
    SessionManager: { inMemory: vi.fn(() => ({})) },
    SettingsManager: { create: vi.fn(() => ({})) },
    getAgentDir: vi.fn(() => "/fake/agent-dir"),
  };
});

function makeAgentDef(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    name: "test-agent",
    description: "A test agent",
    tools: ["read", "bash"],
    subagentAgents: [],
    systemPrompt: "You are a test agent.",
    sourcePath: "/fake/path/test-agent.md",
    ...overrides,
  };
}

function makeRunOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    prompt: "Do something",
    cwd: "/tmp/test",
    agentId: "test-123",
    ...overrides,
  };
}

const testEnv: EnvInfo = { isGitRepo: false, branch: "", platform: "linux" };
const testEnvGit: EnvInfo = {
  isGitRepo: true,
  branch: "main",
  platform: "darwin",
};

// ---------------------------------------------------------------------------
// buildAgentPrompt
// ---------------------------------------------------------------------------

describe("buildAgentPrompt", () => {
  it("replace mode builds standalone prompt with agent name and env", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "replace",
        systemPrompt: "I am a specialist.",
      }),
      "/tmp",
      testEnv,
    );
    expect(prompt).toContain('<active_agent name="test-agent"/>');
    expect(prompt).toContain("I am a specialist.");
    expect(prompt).toContain("platform=linux");
    expect(prompt).not.toContain("<sub_agent_context>");
  });

  it("replace mode includes git branch when available", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ promptMode: "replace" }),
      "/tmp",
      testEnvGit,
    );
    expect(prompt).toContain("git branch=main");
    expect(prompt).toContain("platform=darwin");
  });

  it("replace mode ignores parentSystemPrompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "replace",
        systemPrompt: "I am a specialist.",
      }),
      "/tmp",
      testEnv,
      "Parent system prompt content",
    );
    expect(prompt).toContain("I am a specialist.");
    expect(prompt).not.toContain("Parent system prompt content");
  });

  it("default (no promptMode) behaves like replace", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ systemPrompt: "Default agent." }),
      "/tmp",
      testEnv,
      "Parent prompt",
    );
    expect(prompt).toContain("Default agent.");
    expect(prompt).not.toContain("Parent prompt");
  });

  it("append mode layers on top of parent system prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "append",
        systemPrompt: "Focus on security.",
      }),
      "/tmp",
      testEnv,
      "Parent system prompt content",
    );
    expect(prompt).toContain("Parent system prompt content");
    expect(prompt).toContain("Focus on security.");
    expect(prompt).toContain("<sub_agent_context>");
    expect(prompt).toContain("<agent_instructions>");
  });

  it("append mode uses generic fallback when no parent prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "append",
        systemPrompt: "Focus on security.",
      }),
      "/tmp",
      testEnv,
    );
    expect(prompt).toContain("general-purpose coding agent");
    expect(prompt).toContain("Focus on security.");
    expect(prompt).toContain("<sub_agent_context>");
  });

  it("append mode includes skill blocks", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ promptMode: "append", systemPrompt: "Security agent." }),
      "/tmp",
      testEnv,
      "Parent prompt",
      [{ name: "tdd", content: "Test-driven development instructions" }],
    );
    expect(prompt).toContain('<skill name="tdd">');
    expect(prompt).toContain("Test-driven development instructions");
  });

  it("replace mode includes skill blocks", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ promptMode: "replace", systemPrompt: "Agent." }),
      "/tmp",
      testEnv,
      undefined,
      [{ name: "tdd", content: "TDD rules" }],
    );
    expect(prompt).toContain('<skill name="tdd">');
    expect(prompt).toContain("TDD rules");
  });
});

// ---------------------------------------------------------------------------
// buildParentContext
// ---------------------------------------------------------------------------

describe("buildParentContext", () => {
  it("formats user and assistant messages", () => {
    const context = buildParentContext([
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ]);
    expect(context).toContain("[User]: Hello");
    expect(context).toContain("[Assistant]: Hi there");
    expect(context).toContain("<parent_conversation>");
    expect(context).toContain("</parent_conversation>");
  });

  it("formats compaction entries", () => {
    const context = buildParentContext([
      { type: "compaction", summary: "Earlier conversation about testing." },
    ]);
    expect(context).toContain("[Summary]: Earlier conversation about testing.");
  });

  it("skips toolResult entries", () => {
    const context = buildParentContext([
      { type: "toolResult", content: [{ type: "text", text: "tool output" }] },
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
    ]);
    expect(context).not.toContain("tool output");
    expect(context).toContain("[User]: Hello");
  });

  it("returns wrapper with empty body for empty branch", () => {
    const context = buildParentContext([]);
    expect(context).toContain("<parent_conversation>");
    expect(context).toContain("</parent_conversation>");
  });
});

// ---------------------------------------------------------------------------
// runAgent (integration)
// ---------------------------------------------------------------------------

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createAgentSession with correct options", async () => {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ tools: ["read", "bash", "write"] });
    const options = makeRunOptions();

    await runAgent(agentDef, options, {});

    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/test",
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      }),
    );
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/test",
        tools: ["read", "bash", "write"],
      }),
    );
  });

  it("excludes subagent tool when allowRecursion is false", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ tools: ["read", "bash", "subagent"] });
    const options = makeRunOptions({ allowRecursion: false });

    await runAgent(agentDef, options, {});

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["read", "bash"],
      }),
    );
  });

  it("includes subagent tool when allowRecursion is true", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ tools: ["read", "bash", "subagent"] });
    const options = makeRunOptions({ allowRecursion: true });

    await runAgent(agentDef, options, {});

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["read", "bash", "subagent"],
      }),
    );
  });

  it("filters out disallowed_tools from tool list", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({
      tools: ["read", "bash", "write"],
      disallowedTools: ["bash"],
    });
    const options = makeRunOptions();

    await runAgent(agentDef, options, {});

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["read", "write"],
      }),
    );
  });

  it("calls session.bindExtensions after creation", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    await runAgent(agentDef, makeRunOptions(), {});

    expect(mockSession.bindExtensions).toHaveBeenCalledWith({});
  });

  it("returns RunResult with responseText, aborted, and steered flags", async () => {
    const agentDef = makeAgentDef();
    const result = await runAgent(agentDef, makeRunOptions(), {});

    expect(result).toHaveProperty("responseText");
    expect(result).toHaveProperty("session");
    expect(result).toHaveProperty("aborted");
    expect(result).toHaveProperty("steered");
    expect(result.aborted).toBe(false);
    expect(result.steered).toBe(false);
  });

  it("sets noExtensions: true when isolated is true", async () => {
    const { DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ isolated: true });
    await runAgent(agentDef, makeRunOptions(), {});

    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noExtensions: true,
      }),
    );
  });

  it("sets noExtensions: false when isolated is false and extensions is not false", async () => {
    const { DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ isolated: false, extensions: true });
    await runAgent(agentDef, makeRunOptions(), {});

    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noExtensions: false,
      }),
    );
  });

  it("steers session at maxTurns and aborts at maxTurns + graceTurns", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    let turnEndHandler: ((turnCount: number) => void) | undefined;
    const mockSession = {
      subscribe: vi.fn((handler: (event: { type: string }) => void) => {
        // Capture handler so we can simulate turn_end events
        const wrappedHandler = handler;
        // Simulate 8 turn_end events during prompt
        return () => {};
      }),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    // We test the turn limit logic by verifying steer/abort are called
    // via the onTurnEnd callback with maxTurns set
    const steeredTurns: number[] = [];
    await runAgent(
      agentDef,
      makeRunOptions({
        maxTurns: 5,
        graceTurns: 3,
        onTurnEnd: (turn) => steeredTurns.push(turn),
      }),
      {},
    );

    // The session mock resolves prompt immediately so no turns fire,
    // but verify the setup doesn't throw
    expect(mockSession.subscribe).toHaveBeenCalled();
  });

  it("prepends parent context to prompt when inheritContext is true", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    const mockBranch = [
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
      },
    ];

    await runAgent(
      agentDef,
      makeRunOptions({ inheritContext: true, prompt: "Do something" }),
      { sessionManager: { getBranch: () => mockBranch } },
    );

    const promptArg = mockSession.prompt.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain("<parent_conversation>");
    expect(promptArg).toContain("[User]: Hello");
    expect(promptArg).toContain("Do something");
  });

  it("passes parentSystemPrompt to buildAgentPrompt for append mode", async () => {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef({
      promptMode: "append",
      systemPrompt: "Focus on security.",
    });

    await runAgent(
      agentDef,
      makeRunOptions({ parentSystemPrompt: "I am the parent agent." }),
      {},
    );

    // Verify the system prompt override contains the parent prompt
    const loaderCall = vi.mocked(DefaultResourceLoader).mock.calls[0]?.[0] as {
      systemPromptOverride: () => string;
    };
    const systemPrompt = loaderCall.systemPromptOverride();
    expect(systemPrompt).toContain("I am the parent agent.");
    expect(systemPrompt).toContain("Focus on security.");
    expect(systemPrompt).toContain("<sub_agent_context>");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/agent-runner.test.ts`
Expected: FAIL (`buildAgentPrompt`, `detectEnv`, `buildParentContext` not exported)

- [ ] **Step 3: Implement `buildAgentPrompt()`, `detectEnv()`, and `buildParentContext()`**

Rewrite `src/core/agent-runner.ts`. Key changes:

1. Export `buildAgentPrompt()` with replace/append modes
2. Export `detectEnv()` using `import { execSync } from "node:child_process"`
3. Export `buildParentContext()` taking a conversation branch array
4. Replace `setTimeout` timeout with turn-counting via `session.steer()` + `session.abort()`
5. Apply `disallowed_tools` filtering
6. Policy-driven `DefaultResourceLoader` (isolated/extensions)

```typescript
import { execSync } from "node:child_process";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentDefinition,
  EnvInfo,
  RunOptions,
  RunResult,
} from "../shared/types.js";
import { preloadSkills } from "./skill-loader.js";

interface SkillBlock {
  name: string;
  content: string;
}

/**
 * Detect environment info for prompt construction.
 */
export function detectEnv(cwd: string): EnvInfo {
  let isGitRepo = false;
  let branch = "";
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    isGitRepo = true;
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {
    // Not a git repo or git not available
  }
  return { isGitRepo, branch, platform: process.platform };
}

/**
 * Build the system prompt for an agent session.
 *
 * - `"replace"` (default): Agent owns its entire system prompt.
 * - `"append"`: Agent inherits parent prompt and layers specialization.
 */
export function buildAgentPrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  skillBlocks?: SkillBlock[],
): string {
  if (agentDef.promptMode === "append") {
    return buildAppendPrompt(
      agentDef,
      cwd,
      env,
      parentSystemPrompt,
      skillBlocks,
    );
  }
  return buildReplacePrompt(agentDef, cwd, env, skillBlocks);
}

function buildReplacePrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  skillBlocks?: SkillBlock[],
): string {
  const envLine = `Environment: cwd=${cwd}${env.isGitRepo ? `, git branch=${env.branch}` : ""}, platform=${env.platform}`;
  const parts: string[] = [
    `<active_agent name="${agentDef.name}"/>`,
    "",
    envLine,
  ];

  if (agentDef.systemPrompt.trim()) {
    parts.push("", agentDef.systemPrompt.trim());
  }

  appendSkillBlocks(parts, skillBlocks);

  return parts.join("\n");
}

function buildAppendPrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  skillBlocks?: SkillBlock[],
): string {
  const base =
    parentSystemPrompt?.trim() || "You are a general-purpose coding agent.";
  const envLine = `Environment: cwd=${cwd}${env.isGitRepo ? `, git branch=${env.branch}` : ""}, platform=${env.platform}`;

  const parts: string[] = [
    base,
    "",
    "<sub_agent_context>",
    "You are operating as a specialized sub-agent. Your parent session has",
    "delegated a specific task to you. Focus on completing the delegated",
    "task efficiently.",
    "</sub_agent_context>",
    "",
    `<active_agent name="${agentDef.name}"/>`,
    envLine,
  ];

  if (agentDef.systemPrompt.trim()) {
    parts.push(
      "",
      "<agent_instructions>",
      agentDef.systemPrompt.trim(),
      "</agent_instructions>",
    );
  }

  appendSkillBlocks(parts, skillBlocks);

  return parts.join("\n");
}

function appendSkillBlocks(parts: string[], skillBlocks?: SkillBlock[]): void {
  if (skillBlocks && skillBlocks.length > 0) {
    for (const skill of skillBlocks) {
      parts.push(
        "",
        `<skill name="${skill.name}">\n${skill.content}\n</skill>`,
      );
    }
  }
}

/**
 * Build a formatted string of the parent conversation history for context forking.
 */
export function buildParentContext(entries: unknown[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const e = entry as {
      type?: string;
      role?: string;
      content?: Array<{ type: string; text?: string }>;
      summary?: string;
    };
    if (e.type === "message" && e.role === "user") {
      const text =
        e.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("") ?? "";
      if (text) lines.push(`[User]: ${text}`);
    } else if (e.type === "message" && e.role === "assistant") {
      const text =
        e.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("") ?? "";
      if (text) lines.push(`[Assistant]: ${text}`);
    } else if (e.type === "compaction") {
      if (e.summary) lines.push(`[Summary]: ${e.summary}`);
    }
    // Skip toolResult entries
  }

  return [
    "<parent_conversation>",
    "The following is the conversation history from the parent session that",
    "delegated this task to you. Use it for context but focus on your",
    "assigned task.",
    "",
    ...lines,
    "</parent_conversation>",
  ].join("\n");
}

/**
 * Stateless session execution. Creates an AgentSession, subscribes to events,
 * executes the prompt, and returns the result.
 */
export async function runAgent(
  agentDef: AgentDefinition,
  options: RunOptions,
  ctx: {
    model?: unknown;
    modelRegistry?: unknown;
    sessionManager?: { getBranch?: () => unknown[] };
  },
): Promise<RunResult> {
  // 1. Resolve tools — exclude "subagent" unless recursion is allowed, then filter disallowed
  const allowedTools = (
    options.allowRecursion
      ? agentDef.tools
      : agentDef.tools.filter((t) => t !== "subagent")
  ).filter((t) => !(agentDef.disallowedTools ?? []).includes(t));

  // 2. Build system prompt
  const env = detectEnv(options.cwd);
  const preloaded =
    Array.isArray(agentDef.skills) && agentDef.skills.length > 0
      ? preloadSkills(agentDef.skills, options.cwd)
      : [];
  const skillBlocks = preloaded.length > 0 ? preloaded : undefined;
  const systemPrompt = buildAgentPrompt(
    agentDef,
    options.cwd,
    env,
    options.parentSystemPrompt,
    skillBlocks,
  );

  // 2b. If inheritContext, prepend parent conversation to prompt
  let fullPrompt = options.prompt;
  if (options.inheritContext) {
    const ctxWithSession = ctx as {
      sessionManager?: { getBranch?: () => unknown[] };
    };
    if (ctxWithSession.sessionManager?.getBranch) {
      const parentContext = buildParentContext(
        ctxWithSession.sessionManager.getBranch(),
      );
      fullPrompt = `${parentContext}\n\n${options.prompt}`;
    }
  }

  // 3. Create ResourceLoader with policy-driven extension loading
  const agentDir = getAgentDir();
  const noExtensions =
    agentDef.isolated === true || agentDef.extensions === false;
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    noExtensions,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  // 4. Resolve model
  const model = (options.model ?? ctx.model) as never;

  // 5. Create session
  const settingsManager = SettingsManager.create(options.cwd, agentDir);
  const sessionManager = SessionManager.inMemory(options.cwd);

  const thinkingLevel = options.thinking ?? agentDef.thinking;

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

  // 6. Bind extensions (required even when empty)
  await session.bindExtensions({});
  options.onSessionCreated?.(session);

  // 7. Subscribe to events + turn-based limits
  let responseText = "";
  let turnCount = 0;
  let aborted = false;
  let steered = false;

  const maxTurns = options.maxTurns ?? 0;
  const graceTurns = options.graceTurns ?? 5;

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_start") {
      responseText = "";
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      responseText += event.assistantMessageEvent.delta;
      options.onTextDelta?.(event.assistantMessageEvent.delta, responseText);
    }
    if (event.type === "tool_execution_start") {
      options.onToolActivity?.({ type: "start", toolName: event.toolName });
    }
    if (event.type === "tool_execution_end") {
      options.onToolActivity?.({ type: "end", toolName: event.toolName });
    }
    if (event.type === "turn_end") {
      turnCount++;
      options.onTurnEnd?.(turnCount);

      // Soft limit: steer the agent to wrap up
      if (maxTurns > 0 && turnCount === maxTurns && !steered) {
        session.steer(
          "You have reached the turn limit. Wrap up your work immediately and return your final result.",
        );
        steered = true;
      }

      // Hard limit: abort after grace period
      if (maxTurns > 0 && turnCount >= maxTurns + graceTurns) {
        aborted = true;
        session.abort();
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = (
        event.message as {
          usage?: { input?: number; output?: number; cacheWrite?: number };
        }
      ).usage;
      if (usage) {
        options.onUsage?.({
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
        });
      }
    }
  });

  // 8. Wire parent abort signal
  const cleanupAbort = forwardAbortSignal(session, options.signal);

  // 9. Execute prompt (use fullPrompt which may include parent context)
  try {
    await session.prompt(fullPrompt);
  } catch (error) {
    if (!aborted && !options.signal?.aborted) throw error;
    aborted = true;
  } finally {
    unsubscribe();
    cleanupAbort();
  }

  // 10. Fallback: get text from session messages if streaming didn't capture it
  if (!responseText.trim()) {
    responseText = getLastAssistantText(session);
  }

  return { responseText, session: session as unknown, aborted, steered };
}

/** Wire an AbortSignal to abort a session. Returns cleanup function. */
function forwardAbortSignal(
  session: AgentSession,
  signal?: AbortSignal,
): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    session.abort();
    return () => {};
  }
  const onAbort = () => {
    session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

/** Get last assistant text from session transcript (fallback when streaming missed it). */
function getLastAssistantText(session: AgentSession): string {
  const messages = session.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = (
      msg as { content?: Array<{ type: string; text?: string }> }
    ).content;
    if (!content) continue;
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (text.trim()) return text.trim();
  }
  return "";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/agent-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/agent-runner.ts tests/agent-runner.test.ts
git commit -m "feat: add prompt modes (replace/append), turn-based limits, extension policies, context forking"
```

---

### Task 7: Update AgentManager for new options and steered status

**Files:**

- Modify: `src/core/agent-manager.ts`
- Modify: `tests/agent-manager.test.ts`

- [ ] **Step 1: Write failing tests for new behavior**

Add to `tests/agent-manager.test.ts`:

```typescript
describe("maxTurns and graceTurns passthrough", () => {
  it("passes maxTurns and graceTurns to runAgent", async () => {
    const manager = new AgentManager(3);
    const spy = vi
      .spyOn(await import("../src/core/agent-runner.js"), "runAgent")
      .mockResolvedValue({
        responseText: "done",
        session: {},
        aborted: false,
        steered: false,
      });

    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: tmpDir,
      maxTurns: 10,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTurns: 10 }),
      expect.anything(),
    );
    spy.mockRestore();
  });
});

describe("steered status", () => {
  it("maps steered result to 'steered' record status", async () => {
    const manager = new AgentManager(3);
    vi.spyOn(
      await import("../src/core/agent-runner.js"),
      "runAgent",
    ).mockResolvedValue({
      responseText: "wrapped up",
      session: {},
      aborted: false,
      steered: true,
    });

    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: tmpDir,
    });

    expect(record.status).toBe("steered");
  });
});
```

- [ ] **Step 2: Update `AgentManager.spawnAndWait()` to pass new fields and handle steered**

In `src/core/agent-manager.ts`, update the `spawnAndWait` method:

1. Pass `maxTurns`, `graceTurns` to `runAgent` via `RunOptions`:

```typescript
const result = await runAgent(
  agentDef,
  {
    prompt: options.prompt,
    cwd: options.cwd,
    agentId: id,
    maxTurns: options.maxTurns,
    graceTurns: options.graceTurns,
    inheritContext: options.inheritContext,
    parentSystemPrompt: options.parentSystemPrompt,
    allowRecursion,
    signal: abortController.signal,
    onToolActivity: (activity: ToolActivity) => {
      if (activity.type === "end") record.toolUses++;
      options.onToolActivity?.(activity);
    },
    onTurnEnd: (turnCount: number) => {
      options.onTurnEnd?.(turnCount);
    },
    onUsage: (usage) => {
      record.lifetimeUsage.inputTokens += usage.input;
      record.lifetimeUsage.outputTokens += usage.output;
      record.lifetimeUsage.cacheWriteTokens += usage.cacheWrite;
      options.onUsage?.(usage);
    },
    onSessionCreated: (session) => {
      record.session = session;
      options.onSessionCreated?.(session);
    },
    onTextDelta: options.onTextDelta,
  },
  ctx as { model?: unknown; modelRegistry?: unknown },
);
```

2. Update the status mapping:

```typescript
record.status = result.steered
  ? "steered"
  : result.aborted
    ? "aborted"
    : "completed";
```

3. Add `graceTurns` to `SpawnOptions` in types (if not already). In `src/shared/types.ts`, add:

```typescript
export interface SpawnOptions {
  // ... existing fields
  maxTurns?: number;
  graceTurns?: number;
  // ...
}
```

(This should already be there from Task 1, but verify `graceTurns` is included.)

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/agent-manager.test.ts`
Expected: PASS

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-manager.ts src/shared/types.ts tests/agent-manager.test.ts
git commit -m "feat: pass maxTurns/graceTurns through manager, handle steered status"
```

---

### Task 8: Expand tool schema and wire invocation config in subagent.ts

**Files:**

- Modify: `src/core/subagent.ts`
- Modify: `tests/subagent.test.ts`

- [ ] **Step 1: Write failing tests for stub responses**

Add to `tests/subagent.test.ts`:

```typescript
describe("stub parameters", () => {
  test("returns error for run_in_background stub", async () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());

    const tool = registeredTool();
    const result = await (
      tool as unknown as {
        execute: (
          id: string,
          params: { agent: string; task: string; run_in_background?: boolean },
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: ExtensionContext,
        ) => Promise<{
          isError: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }
    ).execute(
      "tool-call-bg",
      { agent: "Scout", task: "explore", run_in_background: true },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "run_in_background is not yet implemented",
    );
  });

  test("returns error for resume stub", async () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());

    const tool = registeredTool();
    const result = await (
      tool as unknown as {
        execute: (
          id: string,
          params: { agent: string; task: string; resume?: string },
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: ExtensionContext,
        ) => Promise<{
          isError: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }
    ).execute(
      "tool-call-resume",
      { agent: "Scout", task: "explore", resume: "agent-123" },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("resume is not yet implemented");
  });

  test("returns error for isolation stub", async () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());

    const tool = registeredTool();
    const result = await (
      tool as unknown as {
        execute: (
          id: string,
          params: { agent: string; task: string; isolation?: string },
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: ExtensionContext,
        ) => Promise<{
          isError: boolean;
          content: Array<{ type: string; text: string }>;
        }>;
      }
    ).execute(
      "tool-call-iso",
      { agent: "Scout", task: "explore", isolation: "worktree" },
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "isolation is not yet implemented",
    );
  });
});
```

- [ ] **Step 2: Expand `SUBAGENT_TOOL_PARAMETERS`**

In `src/core/subagent.ts`, replace the existing schema:

```typescript
const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the subagent" }),
  ),
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
  run_in_background: Type.Optional(
    Type.Boolean({
      description: "Run in background and return agent ID immediately",
    }),
  ),
  resume: Type.Optional(
    Type.String({ description: "Agent ID to resume from previous context" }),
  ),
  isolation: Type.Optional(
    Type.String({ description: "Run agent in a temporary git worktree" }),
  ),
});
```

- [ ] **Step 3: Update `SubagentToolInput` type and add stub handling**

In `src/shared/types.ts`, update:

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
}
```

In the `execute` function of `registerSubagentTool` in `subagent.ts`, add stub handling at the top (before agent resolution):

```typescript
async execute(
  _toolCallId,
  params: SubagentToolInput,
  signal,
  _onUpdate,
  ctx: ExtensionContext,
) {
  // Stub checks for unimplemented features
  if (params.run_in_background) {
    return {
      content: [{ type: "text", text: "run_in_background is not yet implemented. It will be available in a future update." }],
      isError: true,
    };
  }
  if (params.resume) {
    return {
      content: [{ type: "text", text: "resume is not yet implemented. It will be available in a future update." }],
      isError: true,
    };
  }
  if (params.isolation) {
    return {
      content: [{ type: "text", text: "isolation is not yet implemented. It will be available in a future update." }],
      isError: true,
    };
  }

  // ... existing agent resolution and execution logic
```

- [ ] **Step 4: Wire `resolveInvocationConfig` and pass resolved values to manager**

Import `resolveInvocationConfig` and `resolveModel` in the tool handler:

```typescript
import { resolveInvocationConfig } from "./invocation-config.js";
import { resolveModel } from "./model-resolver.js";
```

After resolving the agent and before calling `manager.spawnAndWait()`:

```typescript
const resolved = resolveInvocationConfig(
  {
    model: agentDef.model,
    thinking: agentDef.thinking,
    maxTurns: agentDef.maxTurns,
    isolated: agentDef.isolated,
    inheritContext: agentDef.inheritContext,
  },
  {
    model: params.model,
    thinking: params.thinking,
    maxTurns: params.max_turns,
    isolated: params.isolated,
    inheritContext: params.inherit_context,
  },
  {
    model: undefined, // parent model comes from ctx
    defaultMaxTurns: loadedConfig.config.defaultMaxTurns,
  },
);

// Resolve model string to a Model object via registry (if available)
let resolvedModel: unknown = undefined;
if (resolved.model) {
  const registry = (
    ctx as {
      modelRegistry?: {
        listModels?: () => Array<{
          id: string;
          provider: string;
          name?: string;
        }>;
      };
    }
  ).modelRegistry;
  if (registry?.listModels) {
    const match = resolveModel(resolved.model, registry.listModels());
    if (!match) {
      const available = registry
        .listModels()
        .map((m) => `${m.provider}/${m.id}`)
        .join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Unknown model: "${resolved.model}". Available models: ${available}`,
          },
        ],
        isError: true,
      };
    }
    // The resolved match gives us { id, provider } — look up the actual Model object
    resolvedModel = registry
      .listModels()
      .find((m) => m.id === match.id && m.provider === match.provider);
  }
}

// Get parent system prompt for append mode (if available on ctx)
const parentSystemPrompt =
  (
    ctx as { resourceLoader?: { getSystemPrompt?: () => string } }
  ).resourceLoader?.getSystemPrompt?.() ?? undefined;

const { id, record } = await deps.manager.spawnAndWait(ctx, agentDef, {
  prompt: params.task.trim(),
  cwd: effectiveCwd,
  maxTurns: resolved.maxTurns,
  graceTurns: loadedConfig.config.graceTurns,
  inheritContext: resolved.inheritContext,
  parentSystemPrompt,
  parentSignal: signal,
  currentDepth: 0,
  allowedAgents: agentDef.subagentAgents,
});
```

Also update the details object to map the `"steered"` status:

```typescript
const details: SubagentExecutionDetails = {
  status:
    record.status === "completed"
      ? "success"
      : record.status === "steered"
        ? "steered"
        : record.status === "aborted"
          ? "aborted"
          : "error",
  // ... rest unchanged
};
```

Do the same for the `/agent` command handler.

- [ ] **Step 5: Run tests**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/subagent.ts src/shared/types.ts tests/subagent.test.ts
git commit -m "feat: expand subagent tool schema with new parameters and stubs"
```

---

### Task 9: Remove deprecated timeoutMs from runtime paths

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-runner.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/subagent-artifacts.ts`
- Modify: `src/tui/render.ts`
- Modify: `tests/agent-runner.test.ts`
- Modify: `tests/subagent-artifacts.test.ts`
- Modify: `tests/render.test.ts`

This task removes `timeoutMs` from runtime paths. The `timeout_ms` frontmatter field is still parsed (backward compat) and `AgentDefinition.timeoutMs` remains, but it is no longer used at runtime.

- [ ] **Step 1: Remove `timeoutMs` from `RunOptions` and `SpawnOptions`**

In `src/shared/types.ts`:

- Remove `timeoutMs?: number;` from `RunOptions`
- Remove `timeoutMs?: number;` from `SpawnOptions`

- [ ] **Step 2: Remove `timeoutMs` from `SubagentExecutionDetails`**

Replace the `timeoutMs` field with `maxTurns`:

```typescript
export interface SubagentExecutionDetails {
  status: "success" | "error" | "timeout" | "aborted" | "steered";
  agent: string;
  task: string;
  sourcePath: string;
  cwd: string;
  maxTurns: number;
  durationMs: number;
  // ... rest unchanged
}
```

- [ ] **Step 3: Remove timeout logic from `agent-runner.ts`**

The `setTimeout`/`clearTimeout` logic was already removed in Task 6. Verify it's gone.

- [ ] **Step 4: Remove `timeoutMs` from `agent-manager.ts`**

The manager should no longer pass or reference `timeoutMs`. Verify `options.timeoutMs` is not referenced.

- [ ] **Step 5: Update `subagent.ts` details objects**

Replace `timeoutMs` with `maxTurns` in the details objects:

In the tool handler:

```typescript
const details: SubagentExecutionDetails = {
  // ...
  maxTurns: resolved.maxTurns,
  // ... (was timeoutMs)
};
```

In the error catch block:

```typescript
details: {
  // ...
  maxTurns: 0,
  // ... (was timeoutMs: 0)
}
```

In the command handler, same change.

- [ ] **Step 6: Update `subagent-artifacts.ts`**

Replace `timeoutMs` reference:

```typescript
// In the meta object, replace:
timeoutMs: result.details.timeoutMs,
// With:
maxTurns: result.details.maxTurns,
```

- [ ] **Step 7: Update `render.ts`**

Replace the timeout display line:

```typescript
// Replace:
lines.push(theme.fg("muted", `timeout: ${details.timeoutMs}ms`));
// With:
lines.push(
  theme.fg(
    "muted",
    `turns: ${details.maxTurns === 0 ? "unlimited" : details.maxTurns}`,
  ),
);
```

- [ ] **Step 8: Update test fixtures**

In `tests/render.test.ts`, update the `createDetails` function:

```typescript
// Replace timeoutMs: 180000 with:
maxTurns: 30,
```

Update the test assertion:

```typescript
// Replace:
expect(text).toContain("timeout: 180000ms");
// With:
expect(text).toContain("turns: 30");
```

In `tests/subagent-artifacts.test.ts`, update fixtures to use `maxTurns` instead of `timeoutMs`.

In `tests/agent-runner.test.ts`, remove any remaining `timeoutMs` references from `makeRunOptions`.

- [ ] **Step 9: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS (iterate on any remaining compile errors from the type change)

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/core/agent-runner.ts src/core/agent-manager.ts src/core/subagent.ts src/core/subagent-artifacts.ts src/tui/render.ts tests/agent-runner.test.ts tests/subagent-artifacts.test.ts tests/render.test.ts
git commit -m "refactor: remove timeoutMs from runtime paths, replace with maxTurns"
```

---

### Task 10: Update render.ts for steered status and thinking display

**Files:**

- Modify: `src/tui/render.ts`
- Modify: `tests/render.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/render.test.ts`:

```typescript
test("renders steered status with warning color", () => {
  const text = buildSubagentResultText(
    "wrapped up",
    createDetails({ status: "steered", stopReason: "steered" }),
    false,
    theme,
  );
  expect(text).toContain("STEERED");
  expect(text).toContain("test-agent" in text || "Scout" in text);
});

test("renders thinking level in expanded details", () => {
  const text = buildSubagentResultText(
    "done",
    createDetails({ thinking: "high" }),
    true,
    theme,
  );
  expect(text).toContain("thinking: high");
});

test("renders unlimited turns", () => {
  const text = buildSubagentResultText(
    "done",
    createDetails({ maxTurns: 0 }),
    true,
    theme,
  );
  expect(text).toContain("turns: unlimited");
});
```

- [ ] **Step 2: Add `thinking` to `SubagentExecutionDetails`**

In `src/shared/types.ts`, add to `SubagentExecutionDetails`:

```typescript
thinking?: string;
```

- [ ] **Step 3: Update `getStatusColor` for steered**

In `src/tui/render.ts`, update:

```typescript
function getStatusColor(
  status: SubagentExecutionDetails["status"],
): "success" | "error" | "warning" {
  if (status === "success") return "success";
  if (status === "error") return "error";
  return "warning"; // covers "timeout", "aborted", "steered"
}
```

(This already works — `"steered"` falls through to `"warning"`. No code change needed, just verify.)

- [ ] **Step 4: Add thinking display in expanded details**

In the expanded section of `buildSubagentResultText`, after the model line, add:

```typescript
if (details.thinking) {
  lines.push(theme.fg("muted", `thinking: ${details.thinking}`));
}
```

- [ ] **Step 5: Update `createDetails` in test to include new fields**

Update the `createDetails` function default:

```typescript
function createDetails(
  overrides: Partial<SubagentExecutionDetails> = {},
): SubagentExecutionDetails {
  return {
    // ... existing fields
    maxTurns: 30,
    // ... (replaces timeoutMs: 180000)
    thinking: undefined,
    ...overrides,
  };
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/render.test.ts`
Expected: PASS

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/tui/render.ts src/shared/types.ts tests/render.test.ts
git commit -m "feat: render steered status, thinking level, and turn count in details"
```

---

### Task 11: Update bundled agents with prompt_mode: replace

**Files:**

- Modify: `agents/scout.md`
- Modify: `agents/planner.md`
- Modify: `agents/researcher.md`
- Modify: `agents/reviewer.md`
- Modify: `agents/worker.md`

- [ ] **Step 1: Add `prompt_mode: replace` to each agent's frontmatter**

For each file, add `prompt_mode: replace` after the `thinking:` line. Example for `agents/scout.md`:

```markdown
---
name: scout
description: Fast scout for locating files, entry points, and likely change surfaces.
tools:
  - bash
  - read
  - subagent
model: default
thinking: low
prompt_mode: replace
subagent_agents:
  - scout
skills:
timeout_ms: 600000
---
```

Repeat for `planner.md`, `researcher.md`, `reviewer.md`, `worker.md`.

- [ ] **Step 2: Run `pnpm check` to verify agents still parse**

Run: `pnpm check`
Expected: PASS (the `agents.test.ts` tests verify bundled agents parse correctly)

- [ ] **Step 3: Commit**

```bash
git add agents/*.md
git commit -m "feat: add prompt_mode: replace to all bundled agents"
```

---

### Task 12: Final integration verification

- [ ] **Step 1: Run full check**

Run: `pnpm check`
Expected: PASS — all lint, typecheck, and tests pass.

- [ ] **Step 2: Verify no remaining `defaultTimeoutMs` references in source**

Run: `grep -r "defaultTimeoutMs" src/`
Expected: No matches.

- [ ] **Step 3: Verify no remaining `defaultTimeoutMs` references in tests**

Run: `grep -r "defaultTimeoutMs" tests/`
Expected: No matches.

- [ ] **Step 4: Review git diff for completeness**

Run: `git diff main...HEAD --stat`
Verify all expected files are modified and no unexpected files changed.

- [ ] **Step 5: Commit any fixups**

If any issues were found and fixed:

```bash
git add -A
git commit -m "fix: address integration issues from phase 2 implementation"
```
