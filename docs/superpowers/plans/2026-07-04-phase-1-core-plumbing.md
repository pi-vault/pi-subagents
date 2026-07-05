# Phase 1: Core Plumbing Implementation Plan

> **Implementation Status (2025-07):** COMPLETE. All tasks implemented.
> - `agent-runner.ts` and `agent-manager.ts` created.
> - Old files (`subagent-spawner.ts`, `nested-context.ts`, `execution-state.ts`) deleted.
> - `timeoutMs` fully removed from codebase (not just deprecated) — references in this plan are stale.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace child-process spawning with in-process `AgentSession` for single-agent foreground execution.

**Architecture:** Create `AgentRunner` (stateless session execution via `createAgentSession()`) and `AgentManager` (lifecycle, policy, record tracking), then rewire the existing `subagent` tool and `/agent` command to route through the manager instead of spawning child processes. Retire `subagent-spawner.ts`, `nested-context.ts`, and `execution-state.ts`.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (`createAgentSession`, `AgentSession`, `DefaultResourceLoader`, `SessionManager`, `SettingsManager`, `getAgentDir`), `@earendil-works/pi-ai` (`Model`, `ThinkingLevel`), `@earendil-works/pi-tui` (Container, Text), Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-1a-session-execution-model-design.md`

**Reference implementation:** `@tintinweb/pi-subagents` (v0.13.0) — uses the same session-based approach with `DefaultResourceLoader` + `createAgentSession()`.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/core/agent-runner.ts` | Stateless session execution via `createAgentSession()` |
| Create | `src/core/agent-manager.ts` | Lifecycle, policy, record tracking |
| Create | `tests/agent-runner.test.ts` | Runner unit tests |
| Create | `tests/agent-manager.test.ts` | Manager unit tests |
| Modify | `src/shared/types.ts` | Add `AgentRecord`, `AgentInvocation`, `LifetimeUsage`, `ToolActivity`, `RunOptions`, `RunResult`, `SpawnOptions` |
| Modify | `src/shared/runtime-deps.ts` | Replace `stateStore` with `manager` |
| Modify | `src/core/subagent.ts` | Thin orchestration: tool handler calls manager instead of spawning process |
| Modify | `src/index.ts` | Create `AgentManager`, wire lifecycle, pass to deps |
| Modify | `src/tui/render.ts` | Adapt rendering to `AgentRecord`-shaped details |
| Modify | `tests/subagent.test.ts` | Rewrite for new execution path |
| Modify | `tests/index.test.ts` | Update for new deps shape |
| Modify | `tests/render.test.ts` | Adapt for `AgentRecord`-shaped data |
| Delete | `src/core/subagent-spawner.ts` | Replaced by `agent-runner.ts` |
| Delete | `src/core/nested-context.ts` | Replaced by in-process depth tracking |
| Delete | `src/core/execution-state.ts` | Replaced by `AgentManager` record tracking |
| Delete | `tests/subagent-spawner.test.ts` | Module deleted |
| Delete | `tests/nested-context.test.ts` | Module deleted |
| Delete | `tests/execution-state.test.ts` | Module deleted |

---

## SDK API Reference

Key facts verified against `@earendil-works/pi-coding-agent@0.80.3`:

1. **`createAgentSession(options?)`** is async, returns `Promise<{ session: AgentSession; extensionsResult: LoadExtensionsResult; modelFallbackMessage?: string }>`.
2. **System prompt** is controlled via `DefaultResourceLoader` options:
   - `systemPromptOverride: (base) => string | undefined` — callback that replaces the base prompt
   - `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles` — disable discovery
3. **Event subscription** uses `session.subscribe((event: AgentSessionEvent) => { ... })` — a single listener discriminates by `event.type`.
4. **Text deltas** come from `event.type === "message_update"` where `event.assistantMessageEvent.type === "text_delta"` → `event.assistantMessageEvent.delta`.
5. **Usage** comes from `event.type === "message_end"` where `event.message.role === "assistant"` → `event.message.usage: { input, output, cacheWrite, ... }`.
6. **Tool events** are `tool_execution_start: { toolCallId, toolName, args }` and `tool_execution_end: { toolCallId, toolName, result, isError }`.
7. **Turn events** are `turn_end: { message, toolResults }`.
8. **`session.bindExtensions(bindings)`** must be called after creation — bindings are optional fields for UI context, error handling, etc.
9. **`session.abort()`** returns `Promise<void>`.
10. **`session.prompt(text, options?)`** returns `Promise<void>`.
11. **`session.messages`** getter returns `AgentMessage[]` (the conversation transcript).
12. **`SessionManager.inMemory(cwd)`** creates ephemeral sessions without file persistence.

---

### Task 1.1: Add types for the new execution model

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write failing type import test**

Create `tests/types-smoke.test.ts` that imports the new types:

```typescript
import { describe, expect, it } from "vitest";
import type {
  AgentRecord,
  AgentInvocation,
  LifetimeUsage,
  ToolActivity,
  RunOptions,
  RunResult,
  SpawnOptions,
} from "../src/shared/types.js";

describe("new execution model types", () => {
  it("AgentRecord can be constructed", () => {
    const record: AgentRecord = {
      id: "test-1",
      type: "scout",
      status: "running",
      toolUses: 0,
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    };
    expect(record.status).toBe("running");
  });

  it("RunResult has required fields", () => {
    const result: RunResult = {
      responseText: "done",
      session: {} as never,
      aborted: false,
    };
    expect(result.aborted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/types-smoke.test.ts`
Expected: FAIL with type import errors.

- [ ] **Step 3: Add new types to `src/shared/types.ts`**

Append the following types to the end of `src/shared/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Session execution model types (Spec 1a)
// ---------------------------------------------------------------------------

export interface LifetimeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
}

export interface ToolActivity {
  type: "start" | "end";
  toolName: string;
}

export interface AgentInvocation {
  agent: string;
  task: string;
  cwd?: string;
}

export interface AgentRecord {
  id: string;
  type: string;
  status: "running" | "completed" | "aborted" | "error";
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  session?: unknown; // AgentSession - typed as unknown to avoid import dependency
  abortController?: AbortController;
  lifetimeUsage: LifetimeUsage;
  invocation?: AgentInvocation;
}

export interface RunOptions {
  prompt: string;
  cwd: string;
  agentId: string;
  model?: unknown; // Model from pi-ai
  thinking?: string;
  timeoutMs?: number;
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

export interface RunResult {
  responseText: string;
  session: unknown; // AgentSession
  aborted: boolean;
}

export interface SpawnOptions {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/types-smoke.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/types-smoke.test.ts
git commit -m "feat: add session execution model types (Spec 1a)"
```

### Task 1.2: Create AgentRunner

**Files:**
- Create: `src/core/agent-runner.ts`
- Create: `tests/agent-runner.test.ts`

- [ ] **Step 1: Write failing tests for `runAgent()`**

Create `tests/agent-runner.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAgent } from "../src/core/agent-runner.js";
import type { AgentDefinition, RunOptions } from "../src/shared/types.js";

// Mock createAgentSession and DefaultResourceLoader
vi.mock("@earendil-works/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn(() => () => {}),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    messages: [],
  };
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: mockSession,
      extensionsResult: { extensions: [] },
    }),
    DefaultResourceLoader: vi.fn().mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    })),
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
        noExtensions: true,
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

  it("calls session.bindExtensions after creation", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
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

  it("returns RunResult with responseText and aborted flag", async () => {
    const agentDef = makeAgentDef();
    const result = await runAgent(agentDef, makeRunOptions(), {});

    expect(result).toHaveProperty("responseText");
    expect(result).toHaveProperty("session");
    expect(result).toHaveProperty("aborted");
    expect(result.aborted).toBe(false);
  });

  it("enforces timeout via setTimeout + session.abort()", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
      ),
      abort: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    const result = await runAgent(
      agentDef,
      makeRunOptions({ timeoutMs: 50 }),
      {},
    );

    expect(mockSession.abort).toHaveBeenCalled();
    expect(result.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/agent-runner.test.ts`
Expected: FAIL with "Cannot find module '../src/core/agent-runner.js'"

- [ ] **Step 3: Implement `agent-runner.ts`**

Create `src/core/agent-runner.ts`:

```typescript
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
  AgentDefinition,
  RunOptions,
  RunResult,
} from "../shared/types.js";
import { preloadSkills } from "./skill-loader.js";

/**
 * Stateless session execution. Creates an AgentSession, subscribes to events,
 * executes the prompt, and returns the result.
 *
 * Follows the pattern established by @tintinweb/pi-subagents:
 * - DefaultResourceLoader with systemPromptOverride for custom system prompt
 * - SessionManager.inMemory() for ephemeral child sessions
 * - session.subscribe() for unified event handling
 * - forwardAbortSignal pattern for cancellation
 */
export async function runAgent(
  agentDef: AgentDefinition,
  options: RunOptions,
  ctx: { model?: unknown; modelRegistry?: unknown },
): Promise<RunResult> {
  // 1. Resolve tools — exclude "subagent" unless recursion is allowed
  const allowedTools = options.allowRecursion
    ? agentDef.tools
    : agentDef.tools.filter((t) => t !== "subagent");

  // 2. Build system prompt
  const systemPrompt = buildReplacePrompt(agentDef, options.cwd);

  // 3. Create ResourceLoader with overrides
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  // 4. Resolve model
  const model = (options.model ?? ctx.model) as Parameters<
    typeof createAgentSession
  >[0] extends { model?: infer M } ? M : never;

  // 5. Create session
  const settingsManager = SettingsManager.create(options.cwd, agentDir);
  const sessionManager = SessionManager.inMemory(options.cwd);

  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir,
    sessionManager,
    settingsManager,
    model,
    tools: allowedTools,
    resourceLoader: loader,
    ...(agentDef.thinking ? { thinkingLevel: agentDef.thinking as never } : {}),
  });

  // 6. Bind extensions (required even when empty)
  await session.bindExtensions({});
  options.onSessionCreated?.(session);

  // 7. Subscribe to events
  let responseText = "";
  let turnCount = 0;
  let aborted = false;

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
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = (event.message as { usage?: { input?: number; output?: number; cacheWrite?: number } }).usage;
      if (usage) {
        options.onUsage?.({
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
        });
      }
    }
  });

  // 8. Set up timeout
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs) {
    timeoutHandle = setTimeout(() => {
      aborted = true;
      session.abort();
    }, options.timeoutMs);
  }

  // 9. Wire parent abort signal
  const cleanupAbort = forwardAbortSignal(session, options.signal);

  // 10. Execute prompt
  try {
    await session.prompt(options.prompt);
  } catch (error) {
    if (!aborted && !(options.signal?.aborted)) throw error;
    aborted = true;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    unsubscribe();
    cleanupAbort();
  }

  // 11. Fallback: get text from session messages if streaming didn't capture it
  if (!responseText.trim()) {
    responseText = getLastAssistantText(session);
  }

  return { responseText, session: session as unknown, aborted };
}

function buildReplacePrompt(agentDef: AgentDefinition, cwd: string): string {
  const parts: string[] = [
    `<active_agent name="${agentDef.name}"/>`,
    "",
    `Environment: cwd=${cwd}, platform=${process.platform}`,
  ];

  if (agentDef.systemPrompt.trim()) {
    parts.push("", agentDef.systemPrompt.trim());
  }

  // Preload skills into prompt if configured
  if (Array.isArray(agentDef.skills) && agentDef.skills.length > 0) {
    const preloaded = preloadSkills(agentDef.skills, cwd);
    for (const skill of preloaded) {
      parts.push("", `<skill name="${skill.name}">\n${skill.content}\n</skill>`);
    }
  }

  return parts.join("\n");
}

/** Wire an AbortSignal to abort a session. Returns cleanup function. */
function forwardAbortSignal(session: AgentSession, signal?: AbortSignal): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    session.abort();
    return () => {};
  }
  const onAbort = () => session.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

/** Get last assistant text from session transcript (fallback when streaming missed it). */
function getLastAssistantText(session: AgentSession): string {
  const messages = session.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = (msg as { content?: Array<{ type: string; text?: string }> }).content;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/agent-runner.test.ts`
Expected: PASS (adjust mocks if needed for exact `DefaultResourceLoader` constructor shape)

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Fix any type errors. The key risk areas:
- `AgentSessionEvent` type discrimination (verify `event.assistantMessageEvent` exists on `message_update`)
- `session.messages` getter type
- `SettingsManager.create()` signature
- `DefaultResourceLoader` options typing (`appendSystemPromptOverride`)

If `appendSystemPromptOverride` doesn't exist on the installed version, remove it (it was added in 0.80.x; verify against installed types).

- [ ] **Step 6: Commit**

```bash
git add src/core/agent-runner.ts tests/agent-runner.test.ts
git commit -m "feat: add AgentRunner with in-process session execution"
```

### Task 1.3: Create AgentManager

**Files:**
- Create: `src/core/agent-manager.ts`
- Create: `tests/agent-manager.test.ts`

- [ ] **Step 1: Write failing tests for AgentManager**

Create `tests/agent-manager.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import type { AgentDefinition } from "../src/shared/types.js";

// Mock the runner
vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: {},
    aborted: false,
  }),
}));

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

describe("AgentManager", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager(3);
  });

  it("rejects spawn when depth exceeds maxDepth", async () => {
    const agentDef = makeAgentDef();
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 3,
      }),
    ).rejects.toThrow(/nesting limit/i);
  });

  it("rejects spawn when agent not in allowlist", async () => {
    const agentDef = makeAgentDef({ name: "worker" });
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        allowedAgents: ["scout", "reviewer"],
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it("allows spawn when agent is in allowlist (case-insensitive)", async () => {
    const agentDef = makeAgentDef({ name: "scout" });
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      allowedAgents: ["Scout"],
    });
    expect(record.status).toBe("completed");
  });

  it("allows spawn when allowedAgents is empty (no restriction)", async () => {
    const agentDef = makeAgentDef({ name: "anything" });
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(record.status).toBe("completed");
  });

  it("tracks agent records", () => {
    expect(manager.listAgents()).toEqual([]);
  });

  it("records are tracked after spawn", async () => {
    const agentDef = makeAgentDef();
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(manager.listAgents()).toHaveLength(1);
    expect(manager.listAgents()[0].status).toBe("completed");
  });

  it("can abort a running agent (returns false for nonexistent)", () => {
    expect(manager.abort("nonexistent")).toBe(false);
  });

  it("setMaxDepth updates the limit", async () => {
    manager.setMaxDepth(5);
    const agentDef = makeAgentDef();
    // Depth 4 should work
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 4,
    });
    expect(record.status).toBe("completed");
    // Depth 5 should fail
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 5,
      }),
    ).rejects.toThrow(/nesting limit/i);
  });

  it("clearCompleted removes finished agents", async () => {
    const agentDef = makeAgentDef();
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(manager.listAgents()).toHaveLength(1);
    manager.clearCompleted();
    expect(manager.listAgents()).toEqual([]);
  });

  it("computes allowRecursion correctly", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const agentDef = makeAgentDef({ subagentAgents: ["helper"] });
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 0,
    });
    // With subagentAgents and depth+1 < maxDepth, allowRecursion should be true
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({ allowRecursion: true }),
      expect.anything(),
    );
  });

  it("sets allowRecursion to false when depth would exceed limit", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const agentDef = makeAgentDef({ subagentAgents: ["helper"] });
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 2, // maxDepth is 3, so depth+1=3 is NOT < 3
    });
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({ allowRecursion: false }),
      expect.anything(),
    );
  });

  it("records error status when runAgent throws", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockRejectedValueOnce(new Error("session failed"));
    const agentDef = makeAgentDef();
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(record.status).toBe("error");
    expect(record.error).toBe("session failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/agent-manager.test.ts`
Expected: FAIL with "Cannot find module '../src/core/agent-manager.js'"

- [ ] **Step 3: Implement `agent-manager.ts`**

Create `src/core/agent-manager.ts`:

```typescript
import { runAgent } from "./agent-runner.js";
import type {
  AgentDefinition,
  AgentRecord,
  LifetimeUsage,
  SpawnOptions,
  ToolActivity,
} from "../shared/types.js";

let idCounter = 0;
function generateId(): string {
  return `agent-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export class AgentManager {
  private agents = new Map<string, AgentRecord>();
  private maxDepth: number;

  constructor(maxDepth = 3) {
    this.maxDepth = maxDepth;
  }

  async spawnAndWait(
    ctx: unknown,
    agentDef: AgentDefinition,
    options: SpawnOptions,
  ): Promise<{ id: string; record: AgentRecord }> {
    const currentDepth = options.currentDepth ?? 0;

    // Validate depth
    if (currentDepth >= this.maxDepth) {
      throw new Error(
        `Nested delegation blocked: current depth ${currentDepth} reached the nesting limit of ${this.maxDepth}.`,
      );
    }

    // Validate allowlist
    if (options.allowedAgents && options.allowedAgents.length > 0) {
      const allowedKeys = new Set(
        options.allowedAgents.map((a) => a.trim().toLowerCase()),
      );
      if (!allowedKeys.has(agentDef.name.trim().toLowerCase())) {
        throw new Error(
          `Agent "${agentDef.name}" is not allowed. Allowed agents: ${options.allowedAgents.join(", ")}`,
        );
      }
    }

    // Create record
    const id = generateId();
    const record: AgentRecord = {
      id,
      type: agentDef.name,
      status: "running",
      toolUses: 0,
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      invocation: {
        agent: agentDef.name,
        task: options.prompt,
        cwd: options.cwd,
      },
    };
    this.agents.set(id, record);

    // Create AbortController
    const abortController = new AbortController();
    record.abortController = abortController;
    if (options.parentSignal) {
      if (options.parentSignal.aborted) {
        abortController.abort();
      } else {
        options.parentSignal.addEventListener(
          "abort",
          () => abortController.abort(),
          { once: true },
        );
      }
    }

    // Compute allowRecursion: true if agent has subagentAgents AND depth+1 < maxDepth
    const allowRecursion =
      agentDef.subagentAgents.length > 0 && currentDepth + 1 < this.maxDepth;

    try {
      const result = await runAgent(
        agentDef,
        {
          prompt: options.prompt,
          cwd: options.cwd,
          agentId: id,
          timeoutMs: options.timeoutMs,
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

      record.status = result.aborted ? "aborted" : "completed";
      record.result = result.responseText;
      record.session = result.session;
    } catch (error) {
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
    }

    return { id, record };
  }

  getRecord(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record || record.status !== "running") return false;
    record.abortController?.abort();
    return true;
  }

  clearCompleted(): void {
    for (const [id, record] of this.agents) {
      if (record.status !== "running") {
        this.agents.delete(id);
      }
    }
  }

  dispose(): void {
    for (const record of this.agents.values()) {
      if (record.status === "running") {
        record.abortController?.abort();
      }
    }
    this.agents.clear();
  }

  setMaxDepth(n: number): void {
    this.maxDepth = n;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/agent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-manager.ts tests/agent-manager.test.ts
git commit -m "feat: add AgentManager for lifecycle and policy enforcement"
```

### Task 1.4: Update RuntimeDeps and index.ts

**Files:**
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update `runtime-deps.ts` to use AgentManager instead of ExecutionStateStore**

Replace the entire file:

```typescript
import type { AgentManager } from "../core/agent-manager.js";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
  SubagentsConfig,
} from "./types.js";

export interface RuntimeDeps {
  resolvePaths: () => ResolvedPaths;
  loadConfig: (paths: ResolvedPaths) => LoadedConfig;
  discoverAgents: (paths: ResolvedPaths) => AgentDiscoveryResult;
  discoverToolNames: () => string[];
  createAgentFile: (
    paths: ResolvedPaths,
    input: AgentCreationInput,
    discovery: AgentDiscoveryResult,
    toolNames: string[],
  ) => AgentDefinition;
  exportAgentToUserScope: (
    paths: ResolvedPaths,
    discovery: AgentDiscoveryResult,
    agentName: string,
  ) => AgentDefinition;
  disableAgentInUserScope: (
    paths: ResolvedPaths,
    discovery: AgentDiscoveryResult,
    agentName: string,
  ) => AgentDefinition;
  deleteUserAgentOverride: (paths: ResolvedPaths, agentName: string) => void;
  saveConfig: (paths: ResolvedPaths, config: SubagentsConfig) => void;
  manager: AgentManager;
}
```

- [ ] **Step 2: Update `index.ts` to create AgentManager and pass to deps**

Replace the entire file:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAgentFile,
  deleteUserAgentOverride,
  disableAgentInUserScope,
  discoverAgents,
  discoverToolNames,
  exportAgentToUserScope,
} from "./core/agents.js";
import { AgentManager } from "./core/agent-manager.js";
import { loadConfig, saveConfig } from "./core/config.js";
import { resolvePaths } from "./core/paths.js";
import {
  registerAgentCommand,
  registerSubagentTool,
} from "./core/subagent.js";
import type { RuntimeDeps } from "./shared/runtime-deps.js";
import { showAgentsMenu } from "./tui/agents-menu.js";
import { renderSubagentMessage } from "./tui/render.js";

export function createRuntimeDeps(pi: ExtensionAPI): RuntimeDeps {
  const manager = new AgentManager();
  return {
    resolvePaths,
    loadConfig,
    discoverAgents,
    discoverToolNames: () =>
      discoverToolNames(pi.getAllTools().map((tool) => tool.name)),
    createAgentFile,
    exportAgentToUserScope,
    disableAgentInUserScope,
    deleteUserAgentOverride,
    saveConfig,
    manager,
  };
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(pi),
): void {
  pi.registerMessageRenderer("pi-subagent-result", (msg, opts, theme) =>
    renderSubagentMessage(
      msg as Parameters<typeof renderSubagentMessage>[0],
      opts,
      theme,
    ),
  );
  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps);

  pi.registerCommand("agents", {
    description: "Open the interactive pi-subagents agents menu",
    handler: async (_args, ctx) => {
      await showAgentsMenu(ctx, deps);
    },
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
```

- [ ] **Step 3: Run typecheck to verify compilation**

Run: `pnpm typecheck`
Expected: May have errors from modules still referencing old imports. Fix cascading issues.

- [ ] **Step 4: Commit**

```bash
git add src/shared/runtime-deps.ts src/index.ts
git commit -m "refactor: wire AgentManager into RuntimeDeps and index"
```

### Task 1.5: Rewrite subagent.ts as thin orchestration

**Files:**
- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Rewrite `subagent.ts`**

Replace the entire file. Strip all child-process spawning, deferred request bridge, nested context code. Keep: tool registration (same schema), input parsing, `findAgentByName()`, `parseAgentCommandArgs()`, artifact writing. Route execution through `manager.spawnAndWait()`.

```typescript
import { resolve } from "node:path";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  SubagentToolInput,
} from "../shared/types.js";
import {
  renderSubagentCall,
  renderSubagentResult,
} from "../tui/render.js";
import {
  writeExecutionArtifacts,
  withArtifacts,
} from "./subagent-artifacts.js";

const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the subagent" }),
  ),
});

export function findAgentByName(
  discovery: AgentDiscoveryResult,
  requestedName: string,
): AgentDefinition | undefined {
  const normalized = requestedName.trim().toLowerCase();
  return discovery.agents.find(
    (agent) => agent.name.trim().toLowerCase() === normalized,
  );
}

function listAvailableAgents(discovery: AgentDiscoveryResult): string {
  return discovery.agents.length > 0
    ? discovery.agents.map((agent) => agent.name).join(", ")
    : "none";
}

export function parseAgentCommandArgs(args: string): SubagentToolInput {
  const trimmed = args.trim();
  if (!trimmed) return { agent: "", task: "" };

  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return { agent: trimmed, task: "" };

  return {
    agent: trimmed.slice(0, firstSpace),
    task: trimmed.slice(firstSpace).trim(),
  };
}

function parseAndResolveAgent(
  discovery: AgentDiscoveryResult,
  input: SubagentToolInput,
): AgentDefinition {
  const requestedAgent = input.agent.trim();
  if (!requestedAgent) {
    throw new Error(
      `Missing agent. Available agents: ${listAvailableAgents(discovery)}`,
    );
  }
  if (!input.task.trim()) {
    throw new Error(
      `Missing task for agent "${requestedAgent}". Available agents: ${listAvailableAgents(discovery)}`,
    );
  }
  const agent = findAgentByName(discovery, requestedAgent);
  if (!agent) {
    throw new Error(
      `Unknown agent: "${requestedAgent}". Available agents: ${listAvailableAgents(discovery)}`,
    );
  }
  return agent;
}

export function registerSubagentTool(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Delegate a task to a discovered agent.",
    parameters: SUBAGENT_TOOL_PARAMETERS,
    renderCall: renderSubagentCall,
    renderResult: (result, options, theme) =>
      renderSubagentResult(result, options, theme),
    async execute(
      _toolCallId,
      params: SubagentToolInput,
      signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);
      const effectiveCwd = resolve(params.cwd ?? ctx.cwd);

      try {
        const agentDef = parseAndResolveAgent(discovery, params);
        const timeoutMs =
          agentDef.timeoutMs ?? loadedConfig.config.defaultTimeoutMs;

        const { id, record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          prompt: params.task.trim(),
          cwd: effectiveCwd,
          timeoutMs,
          parentSignal: signal,
        });

        // Write artifacts
        const artifactPaths = writeExecutionArtifacts(
          paths,
          {
            requestedAgent: params.agent,
            resolvedAgentName: agentDef.name,
            task: params.task,
            cwd: effectiveCwd,
            runId: id,
            sourcePath: agentDef.sourcePath,
          },
          {
            content: record.result ?? "(no output)",
            isError: record.status === "error",
            details: {
              status:
                record.status === "completed"
                  ? "success"
                  : record.status === "aborted"
                    ? "aborted"
                    : "error",
              agent: agentDef.name,
              task: params.task,
              sourcePath: agentDef.sourcePath,
              cwd: effectiveCwd,
              timeoutMs,
              durationMs: record.durationMs ?? 0,
              childSessionDir: "",
              childSessionPath: "",
              model: agentDef.model,
              stopReason: record.status,
              exitCode: null,
              stderr: record.error ?? "",
              usage: {
                input: record.lifetimeUsage.inputTokens,
                output: record.lifetimeUsage.outputTokens,
                cacheRead: 0,
                cacheWrite: record.lifetimeUsage.cacheWriteTokens,
                contextTokens: 0,
                cost: 0,
                turns: 0,
              },
              recentToolActivity: [],
            },
          },
        );

        return {
          content: [{ type: "text", text: record.result ?? "(no output)" }],
          isError: record.status === "error",
          details: {
            status:
              record.status === "completed"
                ? "success"
                : record.status === "aborted"
                  ? "aborted"
                  : "error",
            agent: agentDef.name,
            task: params.task,
            sourcePath: agentDef.sourcePath,
            cwd: effectiveCwd,
            timeoutMs,
            durationMs: record.durationMs ?? 0,
            childSessionDir: "",
            childSessionPath: "",
            artifactPaths,
            model: agentDef.model,
            stopReason: record.status,
            exitCode: null,
            stderr: record.error ?? "",
            usage: {
              input: record.lifetimeUsage.inputTokens,
              output: record.lifetimeUsage.outputTokens,
              cacheRead: 0,
              cacheWrite: record.lifetimeUsage.cacheWriteTokens,
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
        };
      }
    },
  });
}

export function registerAgentCommand(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  pi.registerCommand("agent", {
    description: "Run a discovered pi-subagents agent in the foreground",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const input = parseAgentCommandArgs(args);
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);

      try {
        const agentDef = parseAndResolveAgent(discovery, input);
        const timeoutMs =
          agentDef.timeoutMs ?? loadedConfig.config.defaultTimeoutMs;

        const { record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          prompt: input.task.trim(),
          cwd: ctx.cwd,
          timeoutMs,
        });

        pi.sendMessage({
          customType: "pi-subagent-result",
          content: record.result ?? "(no output)",
          display: true,
          details: {
            status: record.status === "completed" ? "success" : "error",
            agent: agentDef.name,
            task: input.task,
            sourcePath: agentDef.sourcePath,
            cwd: ctx.cwd,
            timeoutMs,
            durationMs: record.durationMs ?? 0,
            childSessionDir: "",
            childSessionPath: "",
            model: agentDef.model,
            stopReason: record.status,
            exitCode: null,
            stderr: record.error ?? "",
            usage: {
              input: record.lifetimeUsage.inputTokens,
              output: record.lifetimeUsage.outputTokens,
              cacheRead: 0,
              cacheWrite: record.lifetimeUsage.cacheWriteTokens,
              contextTokens: 0,
              cost: 0,
              turns: 0,
            },
            recentToolActivity: [],
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pi.sendMessage({
          customType: "pi-subagent-result",
          content: message,
          display: true,
        });
      }
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: Should compile. Fix any remaining type issues.

- [ ] **Step 3: Commit**

```bash
git add src/core/subagent.ts
git commit -m "refactor: rewrite subagent.ts as thin orchestration over AgentManager"
```

### Task 1.6: Update TUI render to not depend on ExecutionStateStore

**Files:**
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Remove `ExecutionStateStore` dependency from render functions**

The renderer currently depends on `ExecutionStateStore` for:
- `renderSubagentResult` takes a `store` parameter for live details
- `renderSubagentMessage` takes a `store` parameter for live rendering
- `createSlashLiveMessageComponent` uses store for real-time updates

Since we're removing the deferred request pattern entirely:
1. Remove `store: ExecutionStateStore` parameter from `renderSubagentResult`
2. Remove `store: ExecutionStateStore` parameter from `renderSubagentMessage`
3. Remove `isSlashLiveDetails` check and `buildSlashLiveText` function
4. Remove `createSlashLiveMessageComponent` function
5. Remove `SlashLiveDetails` import
6. Simplify `renderSubagentMessage` to always render as `SubagentExecutionDetails`

The resulting file should contain:
- `buildSubagentCallText` (unchanged)
- `buildSubagentResultText` (simplified: only handles `SubagentExecutionDetails`, no `SlashLiveDetails`)
- `renderSubagentCall` (unchanged)
- `renderSubagentResult` (remove store param, remove live details branch)
- `renderSubagentMessage` (remove store param, remove live component branch)
- `toSubagentCommandMessage` (unchanged)

- [ ] **Step 2: Update all callers in `index.ts` and `subagent.ts`**

Remove the `deps.stateStore` argument from renderer calls. (Already done in Task 1.4 and 1.5 rewrites.)

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: Should compile after removing dead references.

- [ ] **Step 4: Commit**

```bash
git add src/tui/render.ts
git commit -m "refactor: remove ExecutionStateStore dependency from renderer"
```

### Task 1.7: Delete retired modules and update tests

**Files:**
- Delete: `src/core/subagent-spawner.ts`
- Delete: `src/core/nested-context.ts`
- Delete: `src/core/execution-state.ts`
- Delete: `tests/subagent-spawner.test.ts`
- Delete: `tests/nested-context.test.ts`
- Delete: `tests/execution-state.test.ts`
- Modify: `tests/subagent.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/render.test.ts`

- [ ] **Step 1: Delete retired source modules**

```bash
rm src/core/subagent-spawner.ts src/core/nested-context.ts src/core/execution-state.ts
```

- [ ] **Step 2: Delete corresponding test files**

```bash
rm tests/subagent-spawner.test.ts tests/nested-context.test.ts tests/execution-state.test.ts
```

- [ ] **Step 3: Update `tests/subagent.test.ts`**

Rewrite to test the new thin orchestration: tool registration, input validation, manager integration. Mock `AgentManager.spawnAndWait()`. Test `findAgentByName()`, `parseAgentCommandArgs()`, error handling paths.

- [ ] **Step 4: Update `tests/index.test.ts`**

Update to reflect the new `RuntimeDeps` shape (uses `manager` instead of `stateStore`). Test that `createRuntimeDeps` returns an object with a `manager` field that is an `AgentManager` instance.

- [ ] **Step 5: Update `tests/render.test.ts`**

Remove tests for `SlashLiveDetails`, `createSlashLiveMessageComponent`. Update `renderSubagentResult` calls to remove the `store` parameter.

- [ ] **Step 6: Remove `SlashLiveDetails` and deferred request types from `types.ts`**

Remove: `SlashLiveDetails`, `SlashSnapshot`, `SlashSubagentRequestPayload`, `PersistedDeferredSlashRequest`, `DeferredSlashRuntimeState`, `DEFERRED_SLASH_REQUEST_ENTRY`, `DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY`, `SubagentCommandMessage`, `SubagentMessageDetails` (union type). Keep: `SubagentExecutionDetails`, `SubagentExecutionResult`, `SubagentToolInput`, `SubagentUsage`, `SubagentToolActivity`.

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: delete retired modules (spawner, nested-context, execution-state)"
```

### Task 1.8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full check suite**

Run: `pnpm check`
Expected: All linting, type checking, and tests pass.

- [ ] **Step 2: Verify no stale references**

```bash
grep -r "ExecutionStateStore\|stateStore\|nested-context\|subagent-spawner\|SlashLiveDetails\|SlashSnapshot\|registerSlashAgentBridge" src/ tests/
```

Expected: No matches (all old references removed).

- [ ] **Step 3: Verify pi-ai peer dependency**

Confirm `@earendil-works/pi-ai` is already in `peerDependencies` (it already is in current `package.json`). No action needed.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A
git commit -m "chore: final Phase 1 cleanup"
```
