# Phase 2: Tool Schema, Frontmatter, and Execution Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `subagent` tool with new parameters, parse new frontmatter fields, implement prompt modes (replace/append), turn-based limits, context forking, and extension loading policies.

**Architecture:** Add `resolveInvocationConfig()` for merging frontmatter + tool params + parent defaults. Add `resolveModel()` for fuzzy model matching. Parse new frontmatter fields in `agent-format.ts`. Implement `buildAgentPrompt()` with replace/append modes and `buildParentContext()` for context forking in `agent-runner.ts`. Expand `SUBAGENT_TOOL_PARAMETERS` with stubs for features not yet implemented (background, resume, isolation).

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, typebox, Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-1b-tool-schema-frontmatter-design.md`

**Prerequisite:** Phase 1 (Core Plumbing) must be complete.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/core/invocation-config.ts` | `resolveInvocationConfig()` merge logic |
| Create | `src/core/model-resolver.ts` | Model resolution with fuzzy matching |
| Create | `tests/invocation-config.test.ts` | Merge priority chain tests |
| Create | `tests/model-resolver.test.ts` | Exact/fuzzy/no match tests |
| Modify | `src/shared/types.ts` | Extend `AgentDefinition`, `AgentInvocation`, add `EnvInfo`, `PromptExtras`, update config |
| Modify | `src/core/agent-format.ts` | Parse new frontmatter fields |
| Modify | `src/core/agent-runner.ts` | `buildAgentPrompt()`, turn limits, context forking, extension loading |
| Modify | `src/core/agent-manager.ts` | Accept new `SpawnOptions`, resolve `maxTurns` chain |
| Modify | `src/core/subagent.ts` | Expand tool schema, stub handling, pass new fields |
| Modify | `src/core/config.ts` | Add `defaultMaxTurns`, `graceTurns`, remove `defaultTimeoutMs` |
| Modify | `agents/*.md` | Add `prompt_mode: replace` to all bundled agents |
| Modify | `tests/agent-format.test.ts` | New frontmatter field tests |
| Modify | `tests/agent-runner.test.ts` | Prompt modes, turn limits, extension loading tests |
| Modify | `tests/agent-manager.test.ts` | New options, `maxTurns` resolution tests |
| Modify | `tests/config.test.ts` | New defaults tests |

---

### Task 2.1: Add invocation config merge logic

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
      { model: undefined },
    );
    expect(result.model).toBe("anthropic/claude-sonnet-4");
  });

  it("tool param model used when frontmatter omits it", () => {
    const result = resolveInvocationConfig(
      { model: undefined },
      { model: "anthropic/claude-haiku-4-5" },
      { model: undefined },
    );
    expect(result.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("parent model used as fallback", () => {
    const result = resolveInvocationConfig(
      { model: undefined },
      { model: undefined },
      { model: "anthropic/claude-sonnet-4" },
    );
    expect(result.model).toBe("anthropic/claude-sonnet-4");
  });

  it("frontmatter max_turns takes priority", () => {
    const result = resolveInvocationConfig(
      { maxTurns: 10 },
      { maxTurns: 20 },
      { defaultMaxTurns: 30 },
    );
    expect(result.maxTurns).toBe(10);
  });

  it("tool param isolated used when frontmatter omits it", () => {
    const result = resolveInvocationConfig(
      { isolated: undefined },
      { isolated: true },
      {},
    );
    expect(result.isolated).toBe(true);
  });

  it("defaults to false for isolated when both undefined", () => {
    const result = resolveInvocationConfig(
      { isolated: undefined },
      { isolated: undefined },
      {},
    );
    expect(result.isolated).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/invocation-config.test.ts`
Expected: FAIL

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

### Task 2.2: Add model resolver

**Files:**
- Create: `src/core/model-resolver.ts`
- Create: `tests/model-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/model-resolver.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveModel } from "../src/core/model-resolver.js";

const mockModels = [
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
  it("exact id match", () => {
    const result = resolveModel(
      "anthropic/claude-sonnet-4-20250514",
      mockModels,
    );
    expect(result).toEqual({
      id: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });
  });

  it("fuzzy match on 'sonnet'", () => {
    const result = resolveModel("sonnet", mockModels);
    expect(result).toBeTruthy();
    expect(result?.provider).toBe("anthropic");
  });

  it("fuzzy match on 'haiku'", () => {
    const result = resolveModel("haiku", mockModels);
    expect(result).toBeTruthy();
    expect(result?.provider).toBe("anthropic");
  });

  it("returns undefined for no match", () => {
    const result = resolveModel("nonexistent-model", mockModels);
    expect(result).toBeUndefined();
  });

  it("provider/id format exact match", () => {
    const result = resolveModel("openai/gpt-4o", mockModels);
    expect(result).toEqual({ id: "gpt-4o", provider: "openai" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/model-resolver.test.ts`
Expected: FAIL

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
    const [provider, id] = q.split("/", 2);
    const match = models.find(
      (m) =>
        m.provider.toLowerCase() === provider && m.id.toLowerCase() === id,
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
  const parts = q.split(/[\s-_]+/).filter(Boolean);
  if (parts.length > 1) {
    const partsMatch = models.find((m) => {
      const haystack = `${m.id} ${m.name ?? ""}`.toLowerCase();
      return parts.every((p) => haystack.includes(p));
    });
    if (partsMatch)
      return { id: partsMatch.id, provider: partsMatch.provider };
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

### Task 2.3: Parse new frontmatter fields

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-format.ts`
- Modify: `tests/agent-format.test.ts`

- [ ] **Step 1: Extend `AgentDefinition` in `types.ts`**

Add new fields to `AgentDefinition`:

```typescript
export interface AgentDefinition {
  // ... existing fields
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

- [ ] **Step 2: Write failing tests for new frontmatter fields**

Add to `tests/agent-format.test.ts`:

```typescript
describe("new frontmatter fields", () => {
  it("parses prompt_mode: replace", () => {
    const content = `---\nname: test\ndescription: A test\ntools:\nprompt_mode: replace\n---\nPrompt`;
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.promptMode).toBe("replace");
  });

  it("parses prompt_mode: append", () => {
    const content = `---\nname: test\ndescription: A test\ntools:\nprompt_mode: append\n---\nPrompt`;
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.promptMode).toBe("append");
  });

  it("defaults prompt_mode to replace for invalid value", () => {
    const content = `---\nname: test\ndescription: A test\ntools:\nprompt_mode: invalid\n---\nPrompt`;
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.promptMode).toBe("replace");
  });

  it("parses max_turns as number", () => {
    const content = `---\nname: test\ndescription: A test\ntools:\nmax_turns: 30\n---\nPrompt`;
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.maxTurns).toBe(30);
  });

  it("parses isolated: true", () => {
    const content = `---\nname: test\ndescription: A test\ntools:\nisolated: true\n---\nPrompt`;
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.isolated).toBe(true);
  });

  it("parses disallowed_tools as CSV", () => {
    const content = `---\nname: test\ndescription: A test\ntools:\ndisallowed_tools: bash, write\n---\nPrompt`;
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.agent.disallowedTools).toEqual(["bash", "write"]);
  });

  it("parses extensions: false", () => {
    const content = `---\nname: test\ndescription: A test\ntools:\nextensions: false\n---\nPrompt`;
    const result = parseAgentContent("/test.md", content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.extensions).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/agent-format.test.ts`
Expected: FAIL (new fields not parsed yet)

- [ ] **Step 4: Add parsing logic to `agent-format.ts`**

In the `parseAgentContent` function, after the existing field parsing, add:

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
if (frontmatter.extensions !== undefined) {
  if (typeof frontmatter.extensions === "string") {
    const ext = frontmatter.extensions.trim().toLowerCase();
    if (ext === "false" || ext === "none") {
      extensions = false;
    } else if (ext === "true" || ext === "") {
      extensions = true;
    } else {
      extensions = frontmatter.extensions
        .split(",")
        .map((e: string) => e.trim())
        .filter(Boolean);
    }
  }
}

// disallowed_tools
const disallowedToolsResult = parseStringArray(
  frontmatter.disallowed_tools,
  "disallowed_tools",
);
const disallowedTools = disallowedToolsResult.ok
  ? disallowedToolsResult.value
  : [];
```

Add these to the returned `AgentDefinition` object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/agent-format.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/core/agent-format.ts tests/agent-format.test.ts
git commit -m "feat: parse new frontmatter fields (prompt_mode, max_turns, isolated, etc.)"
```

### Task 2.4: Implement prompt modes and turn-based limits in AgentRunner

**Files:**
- Modify: `src/core/agent-runner.ts`
- Modify: `tests/agent-runner.test.ts`

- [ ] **Step 1: Write failing tests for append prompt mode**

Add to `tests/agent-runner.test.ts`:

```typescript
import { buildAgentPrompt } from "../src/core/agent-runner.js";

describe("buildAgentPrompt", () => {
  it("replace mode ignores parent system prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "replace",
        systemPrompt: "I am a specialist.",
      }),
      "/tmp",
      { isGitRepo: false, branch: "", platform: "linux" },
      "Parent system prompt content",
    );
    expect(prompt).toContain("I am a specialist.");
    expect(prompt).not.toContain("Parent system prompt content");
  });

  it("append mode layers on top of parent system prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "append",
        systemPrompt: "Focus on security.",
      }),
      "/tmp",
      { isGitRepo: false, branch: "", platform: "linux" },
      "Parent system prompt content",
    );
    expect(prompt).toContain("Parent system prompt content");
    expect(prompt).toContain("Focus on security.");
    expect(prompt).toContain("<sub_agent_context>");
  });

  it("append mode uses fallback when no parent prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "append",
        systemPrompt: "Focus on security.",
      }),
      "/tmp",
      { isGitRepo: false, branch: "", platform: "linux" },
    );
    expect(prompt).toContain("general-purpose coding agent");
    expect(prompt).toContain("Focus on security.");
  });
});
```

- [ ] **Step 2: Write failing tests for turn-based limits**

```typescript
describe("turn-based limits", () => {
  it("steers at maxTurns and aborts at maxTurns + graceTurns", () => {
    // This requires integration-level testing with mocked session
    // Test that the turn_end handler calls session.steer and session.abort
    expect(true).toBe(true); // placeholder - implement with real session mock
  });
});
```

- [ ] **Step 3: Implement `buildAgentPrompt()` with both modes**

Export `buildAgentPrompt` from `agent-runner.ts`:

```typescript
export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}

export function detectEnv(cwd: string): EnvInfo {
  let isGitRepo = false;
  let branch = "";
  try {
    const { execSync } = require("node:child_process");
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    isGitRepo = true;
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {}
  return { isGitRepo, branch, platform: process.platform };
}

export function buildAgentPrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  skillBlocks?: string,
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
  skillBlocks?: string,
): string {
  const parts: string[] = [
    `<active_agent name="${agentDef.name}"/>`,
    "You are a pi coding agent sub-agent.",
    `Environment: cwd=${cwd}${env.isGitRepo ? `, git branch=${env.branch}` : ""}, platform=${env.platform}`,
  ];
  if (agentDef.systemPrompt.trim()) {
    parts.push("", agentDef.systemPrompt.trim());
  }
  if (skillBlocks) {
    parts.push("", skillBlocks);
  }
  return parts.join("\n");
}

function buildAppendPrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  skillBlocks?: string,
): string {
  const base =
    parentSystemPrompt?.trim() || "You are a general-purpose coding agent.";
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
    `Environment: cwd=${cwd}${env.isGitRepo ? `, git branch=${env.branch}` : ""}, platform=${env.platform}`,
  ];
  if (agentDef.systemPrompt.trim()) {
    parts.push(
      "",
      "<agent_instructions>",
      agentDef.systemPrompt.trim(),
      "</agent_instructions>",
    );
  }
  if (skillBlocks) {
    parts.push("", skillBlocks);
  }
  return parts.join("\n");
}
```

- [ ] **Step 4: Add turn-based limits to the runner**

Replace the `setTimeout` timeout mechanism with turn counting:

```typescript
// In runAgent(), replace the timeout setup with:
let turnCount = 0;
let softLimitHit = false;

session.on("turn_end", () => {
  turnCount++;
  options.onTurnEnd?.(turnCount);

  if (
    options.maxTurns &&
    options.maxTurns > 0 &&
    turnCount === options.maxTurns
  ) {
    session.steer(
      "You have reached the turn limit. Wrap up your work immediately and return your final result.",
    );
    softLimitHit = true;
  }

  if (
    options.maxTurns &&
    options.maxTurns > 0 &&
    options.graceTurns !== undefined &&
    turnCount >= options.maxTurns + options.graceTurns
  ) {
    session.abort();
  }
});
```

Add `maxTurns` and `graceTurns` to `RunOptions`.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/agent-runner.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/agent-runner.ts tests/agent-runner.test.ts
git commit -m "feat: add prompt modes (replace/append) and turn-based limits"
```

### Task 2.5: Expand tool schema with new parameters

**Files:**
- Modify: `src/core/subagent.ts`
- Modify: `tests/subagent.test.ts`

- [ ] **Step 1: Expand `SUBAGENT_TOOL_PARAMETERS`**

```typescript
const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory override" }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Model override (provider/modelId or fuzzy name)",
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
      description: "If true, agent gets no extension/MCP tools",
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

- [ ] **Step 2: Add stub handling in execute()**

Before the main execution logic:

```typescript
if (params.run_in_background) {
  return {
    content: [
      {
        type: "text",
        text: "run_in_background is not yet implemented. It will be available in a future update.",
      },
    ],
    isError: true,
  };
}
if (params.resume) {
  return {
    content: [
      {
        type: "text",
        text: "resume is not yet implemented. It will be available in a future update.",
      },
    ],
    isError: true,
  };
}
if (params.isolation) {
  return {
    content: [
      {
        type: "text",
        text: "isolation is not yet implemented. It will be available in a future update.",
      },
    ],
    isError: true,
  };
}
```

- [ ] **Step 3: Wire `resolveInvocationConfig` and pass to manager**

Import and use `resolveInvocationConfig` in the tool handler to merge frontmatter + tool params + defaults, then pass the resolved config to `manager.spawnAndWait()`.

- [ ] **Step 4: Write tests for stub responses**

Add to `tests/subagent.test.ts`:

```typescript
it("returns error for run_in_background stub", async () => {
  // Test that calling with run_in_background: true returns the stub message
});

it("returns error for resume stub", async () => {
  // Test that calling with resume: "some-id" returns the stub message
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/subagent.ts tests/subagent.test.ts
git commit -m "feat: expand subagent tool schema with new parameters and stubs"
```

### Task 2.6: Update config and bundled agents

**Files:**
- Modify: `src/core/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `agents/scout.md`
- Modify: `agents/planner.md`
- Modify: `agents/researcher.md`
- Modify: `agents/reviewer.md`
- Modify: `agents/worker.md`

- [ ] **Step 1: Update config defaults**

In `src/core/config.ts`, update `DEFAULT_CONFIG`:

```typescript
export const DEFAULT_CONFIG: SubagentsConfig = {
  maxConcurrency: 3,
  maxRecursiveLevel: 3,
  defaultMaxTurns: 0,
  graceTurns: 5,
};
```

Remove `defaultTimeoutMs` from `SubagentsConfig` type and all references.

- [ ] **Step 2: Update config tests**

Verify new defaults and that `defaultTimeoutMs` is no longer present.

- [ ] **Step 3: Add `prompt_mode: replace` to all bundled agents**

For each agent file in `agents/`, add `prompt_mode: replace` to the frontmatter. Example for `scout.md`:

```
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

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/config.test.ts agents/*.md
git commit -m "feat: update config defaults and add prompt_mode to bundled agents"
```

### Task 2.7: Implement context forking and extension loading

**Files:**
- Modify: `src/core/agent-runner.ts`
- Modify: `tests/agent-runner.test.ts`

- [ ] **Step 1: Write failing test for `buildParentContext()`**

```typescript
describe("buildParentContext", () => {
  it("formats conversation history", () => {
    const mockCtx = {
      sessionManager: {
        getBranch: () => [
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
        ],
      },
    };
    const context = buildParentContext(mockCtx as never);
    expect(context).toContain("[User]: Hello");
    expect(context).toContain("[Assistant]: Hi there");
    expect(context).toContain("<parent_conversation>");
  });
});
```

- [ ] **Step 2: Implement `buildParentContext()`**

```typescript
export function buildParentContext(ctx: {
  sessionManager: { getBranch: () => unknown[] };
}): string {
  const entries = ctx.sessionManager.getBranch();
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
```

- [ ] **Step 3: Wire `inheritContext` in `runAgent()`**

When `options.inheritContext` is true, call `buildParentContext(ctx)` and prepend to the prompt.

- [ ] **Step 4: Write test for `disallowed_tools` filtering**

```typescript
it("filters out disallowed tools", () => {
  const agentDef = makeAgentDef({
    tools: ["read", "bash", "write"],
    disallowedTools: ["bash"],
  });
  // Verify createAgentSession is called without "bash" in tools
});
```

- [ ] **Step 5: Implement `disallowed_tools` filtering in runner**

```typescript
const childTools = (
  options.allowRecursion
    ? agentDef.tools
    : agentDef.tools.filter((t) => t !== "subagent")
).filter((t) => !(agentDef.disallowedTools ?? []).includes(t));
```

- [ ] **Step 6: Run tests**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/agent-runner.ts tests/agent-runner.test.ts
git commit -m "feat: add context forking, disallowed_tools, extension loading policies"
```
