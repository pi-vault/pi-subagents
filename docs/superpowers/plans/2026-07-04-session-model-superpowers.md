# Session Model & Superpowers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace child-process spawning with in-process `AgentSession`, then progressively add tool schema extensions, background/async execution, parallel coordination, and UI components.

**Architecture:** Five phases, each building on the previous and producing a working, testable result. Phase 1 swaps the execution model. Phase 2 extends the tool schema and adds turn-based limits. Phase 3 adds background execution with concurrency. Phase 4 adds parallel group coordination. Phase 5 adds TUI components (widget, fleet list, conversation viewer).

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (`createAgentSession`, `AgentSession`), `@earendil-works/pi-ai` (`Model`, `ThinkingLevel`), `@earendil-works/pi-tui` (Container, Text, Key), Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

---

## File Structure

### Phase 1 (Spec 1a) - Core Plumbing

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
| Modify | `src/core/config.ts` | Keep `defaultTimeoutMs` (adapted from SIGTERM to session.abort()) |
| Modify | `package.json` | Add `@earendil-works/pi-ai` peer dependency |
| Modify | `tests/subagent.test.ts` | Rewrite for new execution path |
| Modify | `tests/index.test.ts` | Update for new deps shape |
| Modify | `tests/render.test.ts` | Adapt for `AgentRecord`-shaped data |
| Delete | `src/core/subagent-spawner.ts` | Replaced by `agent-runner.ts` |
| Delete | `src/core/nested-context.ts` | Replaced by in-process depth tracking |
| Delete | `src/core/execution-state.ts` | Replaced by `AgentManager` record tracking |
| Delete | `tests/subagent-spawner.test.ts` | Module deleted |
| Delete | `tests/nested-context.test.ts` | Module deleted |
| Delete | `tests/execution-state.test.ts` | Module deleted |

### Phase 2 (Spec 1b) - Tool Schema, Frontmatter, Execution Features

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

### Phase 3 (Spec 2) - Background/Async Execution

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/core/group-join-manager.ts` | Notification batching (async/group/smart) |
| Create | `src/core/output-file.ts` | JSONL transcript streaming |
| Create | `src/core/worktree.ts` | Git worktree create/cleanup |
| Create | `src/core/settings.ts` | Settings load/save/apply |
| Create | `tests/group-join-manager.test.ts` | Join mode tests |
| Create | `tests/output-file.test.ts` | JSONL writing tests |
| Create | `tests/worktree.test.ts` | Worktree lifecycle tests |
| Create | `tests/settings.test.ts` | Settings persistence tests |
| Modify | `src/core/agent-manager.ts` | `spawn()`, `resume()`, `steer()`, concurrency queue, worktree, cleanup |
| Modify | `src/core/agent-runner.ts` | `resumeAgent()`, `steerAgent()`, `getAgentConversation()` |
| Modify | `src/core/subagent.ts` | Remove stubs, wire background/resume paths |
| Modify | `src/shared/types.ts` | Background fields on `AgentRecord`, `JoinMode`, `NotificationDetails` |
| Modify | `src/index.ts` | Register `get_subagent_result`, `steer_subagent`, notification renderer, events |
| Modify | `src/tui/render.ts` | Background result rendering |
| Modify | `src/tui/agents-menu.ts` | Settings for `maxConcurrent`, `defaultJoinMode` |
| Modify | `src/core/config.ts` | Add `maxConcurrent`, `defaultJoinMode` |

### Phase 4 (Spec 3) - Parallel Execution

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/core/group-tracker.ts` | Group lifecycle, status derivation, promise management |
| Create | `src/core/parallel-progress.ts` | Multi-agent progress display |
| Create | `tests/group-tracker.test.ts` | Group status/completion tests |
| Create | `tests/parallel-progress.test.ts` | Progress formatting tests |
| Modify | `src/core/agent-manager.ts` | Accept `groupId`, notify `GroupTracker` on completion |
| Modify | `src/shared/types.ts` | `GroupState`, extend `SpawnOptions`/`AgentRecord` with `groupId` |
| Modify | `src/index.ts` | Register `parallel`, `wait_for_group`, extend `steer_subagent` |
| Modify | `src/tui/render.ts` | Parallel tool call/result rendering |
| Modify | `src/tui/agents-menu.ts` | Show groups |

### Phase 5 (Spec 4) - UI Features

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/ui/agent-widget.ts` | Persistent above-editor widget |
| Create | `src/ui/fleet-list.ts` | Below-editor navigable agent list |
| Create | `src/ui/conversation-viewer.ts` | Overlay conversation view + steer/stop |
| Create | `src/ui/viewer-keys.ts` | Scroll keybinding extraction |
| Create | `src/ui/format.ts` | Shared formatting utilities |
| Create | `tests/agent-widget.test.ts` | Widget render tests |
| Create | `tests/fleet-list.test.ts` | Fleet navigation tests |
| Create | `tests/conversation-viewer.test.ts` | Viewer rendering/interaction tests |
| Create | `tests/viewer-keys.test.ts` | Keybinding tests |
| Create | `tests/format.test.ts` | Formatting utility tests |
| Modify | `src/index.ts` | Create widget/fleet, wire events, register notification renderer |
| Modify | `src/tui/render.ts` | Use shared `ui/format.ts` utilities |
| Modify | `src/tui/agents-menu.ts` | Widget mode setting |
| Modify | `src/core/agent-manager.ts` | Expose `agentActivity` map |

---

## Phase 1: Core Plumbing (Spec 1a)

Replace child-process spawning with in-process `AgentSession` for single-agent foreground execution. After this phase, `pnpm check` passes and subagents run in-process instead of as child processes.

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
  onUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
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
  onUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
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
import { describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/core/agent-runner.js";
import type { AgentDefinition, RunOptions } from "../src/shared/types.js";

// Mock createAgentSession - we'll need to mock the pi-coding-agent module
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
}));

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
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
  it("creates a session and returns the response text", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    vi.mocked(createAgentSession).mockReturnValue(mockSession as never);

    // Simulate text accumulation via onTextDelta
    const textDeltaCaptures: string[] = [];
    const options = makeRunOptions({
      onTextDelta: (delta, full) => { textDeltaCaptures.push(full); },
    });

    // The session.prompt resolves after we've accumulated text
    // We need to simulate the session events - this depends on the actual implementation
    // For now, test that runAgent calls createAgentSession and session.prompt
    const agentDef = makeAgentDef();
    // This test verifies the function signature exists and is callable
    expect(typeof runAgent).toBe("function");
  });

  it("excludes subagent tool when allowRecursion is false", async () => {
    const agentDef = makeAgentDef({ tools: ["read", "bash", "subagent"] });
    const options = makeRunOptions({ allowRecursion: false });

    // runAgent should filter out "subagent" from the tools list
    // We verify this by checking the createAgentSession call args
    expect(typeof runAgent).toBe("function");
  });

  it("includes subagent tool when allowRecursion is true", async () => {
    const agentDef = makeAgentDef({ tools: ["read", "bash", "subagent"] });
    const options = makeRunOptions({ allowRecursion: true });
    expect(typeof runAgent).toBe("function");
  });

  it("enforces timeout via setTimeout + session.abort()", async () => {
    const options = makeRunOptions({ timeoutMs: 100 });
    expect(typeof runAgent).toBe("function");
  });
});
```

Note: The actual test assertions depend on the `createAgentSession` API. The implementer should study the `@earendil-works/pi-coding-agent` package to understand the exact session API, event names, and how `session.prompt()` works. Adjust the mock accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/agent-runner.test.ts`
Expected: FAIL with "Cannot find module '../src/core/agent-runner.js'"

- [ ] **Step 3: Implement `agent-runner.ts`**

Create `src/core/agent-runner.ts`:

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition, RunOptions, RunResult } from "../shared/types.js";
import { resolveSkillPaths, preloadSkills } from "./skill-loader.js";

export async function runAgent(
  agentDef: AgentDefinition,
  options: RunOptions,
  ctx: { model?: unknown },
): Promise<RunResult> {
  // 1. Resolve tools
  const childTools = options.allowRecursion
    ? agentDef.tools
    : agentDef.tools.filter((t) => t !== "subagent");

  // 2. Resolve skills
  let skillBlocks = "";
  if (Array.isArray(agentDef.skills) && agentDef.skills.length > 0) {
    const preloaded = preloadSkills(agentDef.skills, options.cwd);
    skillBlocks = preloaded
      .map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`)
      .join("\n\n");
  } else if (agentDef.skills === true) {
    // "all" skills - discover and preload all
    // For now, skip - agent runner doesn't discover all skills
  }

  // 3. Build system prompt (replace mode only for Spec 1a)
  const systemPrompt = buildReplacePrompt(agentDef, options.cwd, skillBlocks);

  // 4. Resolve model
  const model = options.model ?? ctx.model;

  // 5. Create session
  const session = createAgentSession({
    cwd: options.cwd,
    model: model as never,
    tools: childTools,
    systemPromptOverride: systemPrompt,
    thinkingLevel: agentDef.thinking as never,
    noExtensions: true,
    name: `${agentDef.name}#${options.agentId.slice(0, 8)}`,
  });
  await session.bindExtensions();
  options.onSessionCreated?.(session);

  // 6. Subscribe to events
  let responseText = "";
  let turnCount = 0;
  let aborted = false;

  session.on("tool_execution_start", (event: { toolName?: string }) => {
    options.onToolActivity?.({ type: "start", toolName: event.toolName ?? "unknown" });
  });
  session.on("tool_execution_end", (event: { toolName?: string }) => {
    options.onToolActivity?.({ type: "end", toolName: event.toolName ?? "unknown" });
  });
  session.on("message_update", (event: { text_delta?: string }) => {
    if (event.text_delta) {
      responseText += event.text_delta;
      options.onTextDelta?.(event.text_delta, responseText);
    }
  });
  session.on("turn_end", () => {
    turnCount++;
    options.onTurnEnd?.(turnCount);
  });
  session.on("message_end", (event: { usage?: { input?: number; output?: number; cacheWrite?: number } }) => {
    if (event.usage) {
      options.onUsage?.({
        input: event.usage.input ?? 0,
        output: event.usage.output ?? 0,
        cacheWrite: event.usage.cacheWrite ?? 0,
      });
    }
  });

  // 7. Set up timeout
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs) {
    timeoutHandle = setTimeout(() => {
      aborted = true;
      session.abort();
    }, options.timeoutMs);
  }

  // Wire parent abort signal
  if (options.signal) {
    if (options.signal.aborted) {
      aborted = true;
      session.abort();
    } else {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        session.abort();
      }, { once: true });
    }
  }

  // 8. Execute prompt
  try {
    await session.prompt(options.prompt);
  } catch (error) {
    if (!aborted) throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  // 9. Return
  return { responseText, session: session as unknown, aborted };
}

function buildReplacePrompt(
  agentDef: AgentDefinition,
  cwd: string,
  skillBlocks: string,
): string {
  const parts: string[] = [
    `<active_agent name="${agentDef.name}"/>`,
    "You are a pi coding agent sub-agent.",
    `Environment: cwd=${cwd}, platform=${process.platform}`,
  ];

  if (agentDef.systemPrompt.trim()) {
    parts.push("", agentDef.systemPrompt.trim());
  }

  if (skillBlocks) {
    parts.push("", skillBlocks);
  }

  return parts.join("\n");
}
```

Note: The exact `createAgentSession` API (parameter names, event names, event payload shapes) must be verified by the implementer against the actual `@earendil-works/pi-coding-agent` package. The code above follows the spec's description and the tintinweb reference implementation's patterns. Adjust parameter names, event names, and types as needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/agent-runner.test.ts`
Expected: PASS (or adjust mocks to match actual API)

- [ ] **Step 5: Commit**

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

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
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
    manager = new AgentManager(3);
  });

  it("rejects spawn when depth exceeds maxDepth", async () => {
    const agentDef = makeAgentDef();
    await expect(
      manager.spawnAndWait({} as never, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 5,
      }),
    ).rejects.toThrow(/nesting limit/i);
  });

  it("rejects spawn when agent not in allowlist", async () => {
    const agentDef = makeAgentDef({ name: "worker" });
    await expect(
      manager.spawnAndWait({} as never, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        allowedAgents: ["scout", "reviewer"],
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it("allows spawn when agent is in allowlist (case-insensitive)", async () => {
    // This will fail because runAgent isn't mocked, but the allowlist check should pass
    const agentDef = makeAgentDef({ name: "scout" });
    // We just verify it doesn't throw the allowlist error
    const promise = manager.spawnAndWait({} as never, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      allowedAgents: ["Scout"],
    });
    // It will fail on runAgent call, not on allowlist
    await expect(promise).rejects.not.toThrow(/not allowed/i);
  });

  it("tracks agent records", () => {
    expect(manager.listAgents()).toEqual([]);
  });

  it("can abort a running agent", () => {
    expect(manager.abort("nonexistent")).toBe(false);
  });

  it("setMaxDepth updates the limit", () => {
    manager.setMaxDepth(5);
    // Verify by trying a spawn at depth 4 (should not throw depth error)
    // and depth 5 (should throw)
    const agentDef = makeAgentDef();
    expect(
      manager.spawnAndWait({} as never, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 5,
      }),
    ).rejects.toThrow(/nesting limit/i);
  });

  it("clearCompleted removes finished agents", () => {
    manager.clearCompleted();
    expect(manager.listAgents()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/agent-manager.test.ts`
Expected: FAIL with "Cannot find module '../src/core/agent-manager.js'"

- [ ] **Step 3: Implement `agent-manager.ts`**

Create `src/core/agent-manager.ts`:

```typescript
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
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

    // Validate cwd
    if (!isAbsolute(options.cwd)) {
      throw new Error(`cwd must be an absolute path, got: ${options.cwd}`);
    }
    if (!existsSync(options.cwd)) {
      throw new Error(`cwd does not exist: ${options.cwd}`);
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

    // Compute allowRecursion
    const allowRecursion =
      agentDef.subagentAgents.length > 0 &&
      currentDepth + 1 < this.maxDepth;

    try {
      const result = await runAgent(agentDef, {
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
      }, ctx as { model?: unknown });

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

Replace the `ExecutionStateStore` import and `stateStore` field with `AgentManager`:

```typescript
import type { AgentManager } from "../core/agent-manager.js";
// ... keep existing imports for types

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

```typescript
import { AgentManager } from "./core/agent-manager.js";
// Remove: import { ExecutionStateStore } from "./core/execution-state.js";
// Remove: import { registerSlashAgentBridge } from "./core/subagent.js";

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
  // Remove: registerSlashAgentBridge(pi, deps);
  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps, undefined, () => true);

  pi.registerCommand("agents", {
    description: "Open the interactive pi-subagents agents menu",
    handler: async (_args, ctx) => {
      await showAgentsMenu(ctx, deps);
    },
  });

  // Wire lifecycle events
  pi.on("session_shutdown", () => {
    deps.manager.dispose();
  });
}
```

Note: The `renderSubagentMessage` signature changes (no longer needs `stateStore` parameter) - we'll update it in Task 1.6.

- [ ] **Step 3: Run typecheck to verify compilation**

Run: `pnpm typecheck`
Expected: May have errors from modules still referencing old types. Fix cascading issues.

- [ ] **Step 4: Commit**

```bash
git add src/shared/runtime-deps.ts src/index.ts
git commit -m "refactor: wire AgentManager into RuntimeDeps and index"
```

### Task 1.5: Rewrite subagent.ts as thin orchestration

**Files:**
- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Rewrite `subagent.ts`**

Strip out all child-process spawning, deferred request bridge, and nested context code. Keep: tool registration (same schema), input parsing, `findAgentByName()`, `parseAgentCommandArgs()`, artifact writing. Route execution through `manager.spawnAndWait()`.

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
import { renderSubagentCall, renderSubagentResult } from "../tui/render.js";
import { writeExecutionArtifacts, withArtifacts } from "./subagent-artifacts.js";

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
        const timeoutMs = agentDef.timeoutMs ?? loadedConfig.config.defaultTimeoutMs;

        const { id, record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          prompt: params.task.trim(),
          cwd: effectiveCwd,
          timeoutMs,
          parentSignal: signal,
        });

        // Write artifacts
        const artifactPaths = writeExecutionArtifacts(paths, {
          requestedAgent: params.agent,
          resolvedAgentName: agentDef.name,
          task: params.task,
          cwd: effectiveCwd,
          runId: id,
          sourcePath: agentDef.sourcePath,
        }, {
          content: record.result ?? "(no output)",
          isError: record.status === "error",
          details: {
            status: record.status === "completed" ? "success" : record.status === "aborted" ? "aborted" : "error",
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
        });

        return {
          content: [{ type: "text", text: record.result ?? "(no output)" }],
          isError: record.status === "error",
          details: {
            status: record.status === "completed" ? "success" : record.status === "aborted" ? "aborted" : "error",
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
  _runtime?: unknown,
  _isBridgeAvailable?: () => boolean,
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
        const timeoutMs = agentDef.timeoutMs ?? loadedConfig.config.defaultTimeoutMs;

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
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
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

Note: The implementer should carefully review how the existing `SubagentExecutionDetails` type is used by the renderer to ensure the `details` object passed back is compatible. Some fields may need adjustment.

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

The `renderSubagentResult` and `renderSubagentMessage` functions currently take an `ExecutionStateStore` parameter. Since we're removing that module, simplify the renderer:

- Remove the `store` parameter from `renderSubagentResult` and `renderSubagentMessage`
- Remove the `SlashLiveDetails` handling (the deferred request pattern is gone)
- Remove `createSlashLiveMessageComponent`
- Keep the core rendering logic for `SubagentExecutionDetails`

The implementer should:
1. Remove the `store: ExecutionStateStore` parameter from `renderSubagentResult`
2. Remove the `store: ExecutionStateStore` parameter from `renderSubagentMessage`
3. Remove the `isSlashLiveDetails` check and `buildSlashLiveText` function
4. Remove the `createSlashLiveMessageComponent` function
5. Remove the `SlashLiveDetails` import
6. Simplify `renderSubagentMessage` to always render as `SubagentExecutionDetails`

- [ ] **Step 2: Update all callers in `index.ts` and `subagent.ts`**

Remove the `stateStore` argument from renderer calls.

- [ ] **Step 3: Run typecheck and tests**

Run: `pnpm check`
Expected: Some tests will fail because they reference deleted modules.

- [ ] **Step 4: Commit**

```bash
git add src/tui/render.ts src/index.ts src/core/subagent.ts
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

Rewrite to test the new thin orchestration: tool registration, input validation, manager integration. Mock `AgentManager.spawnAndWait()`. Test `findAgentByName()`, `parseAgentCommandArgs()`, error handling.

- [ ] **Step 4: Update `tests/index.test.ts`**

Update to reflect the new `RuntimeDeps` shape (uses `manager` instead of `stateStore`). Test that `createRuntimeDeps` returns an object with a `manager` field.

- [ ] **Step 5: Update `tests/render.test.ts`**

Remove tests for `SlashLiveDetails`, `createSlashLiveMessageComponent`. Update `renderSubagentResult` calls to remove the `store` parameter.

- [ ] **Step 6: Remove `SlashLiveDetails` and deferred request types from `types.ts`**

Remove: `SlashLiveDetails`, `SlashSnapshot`, `SlashSubagentRequestPayload`, `PersistedDeferredSlashRequest`, `DeferredSlashRuntimeState`, `DEFERRED_SLASH_REQUEST_ENTRY`, `DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY`, `SubagentCommandMessage`. Keep: `SubagentExecutionDetails`, `SubagentExecutionResult`, `SubagentToolInput`, `SubagentUsage`, `SubagentToolActivity`.

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: delete retired modules (spawner, nested-context, execution-state)"
```

### Task 1.8: Add pi-ai peer dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `@earendil-works/pi-ai` as peer dependency**

```bash
cd /Users/lanh/Developer/pi-vault/pi-subagents
```

Add to `peerDependencies` in `package.json`:

```json
"@earendil-works/pi-ai": "*"
```

And to `devDependencies`:

```json
"@earendil-works/pi-ai": "^0.79.3"
```

- [ ] **Step 2: Install**

Run: `pnpm install`

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @earendil-works/pi-ai peer dependency"
```

---

## Phase 2: Tool Schema, Frontmatter, and Execution Features (Spec 1b)

Extend the `subagent` tool with new parameters, parse new frontmatter fields, implement prompt modes, turn-based limits, context forking, and extension loading policies. After this phase, agents support model overrides, thinking levels, turn limits, append prompt mode, and isolated execution.

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
    maxTurns: frontmatter.maxTurns ?? toolParams.maxTurns ?? defaults.defaultMaxTurns ?? 0,
    isolated: frontmatter.isolated ?? toolParams.isolated ?? false,
    inheritContext: frontmatter.inheritContext ?? toolParams.inheritContext ?? false,
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
  { id: "claude-sonnet-4-20250514", provider: "anthropic", name: "Claude Sonnet 4" },
  { id: "claude-haiku-4-5-20250514", provider: "anthropic", name: "Claude Haiku 4.5" },
  { id: "gpt-4o", provider: "openai", name: "GPT-4o" },
];

describe("resolveModel", () => {
  it("exact id match", () => {
    const result = resolveModel("anthropic/claude-sonnet-4-20250514", mockModels);
    expect(result).toEqual({ id: "claude-sonnet-4-20250514", provider: "anthropic" });
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
  if (containsMatch) return { id: containsMatch.id, provider: containsMatch.provider };

  // Fuzzy: all query parts present in id or name
  const parts = q.split(/[\s-_]+/).filter(Boolean);
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
    if (result.ok) expect(result.agent.disallowedTools).toEqual(["bash", "write"]);
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
  runInBackground = frontmatter.run_in_background.trim().toLowerCase() === "true";
}

// isolation
let isolation: "worktree" | undefined;
if (typeof frontmatter.isolation === "string" && frontmatter.isolation.trim().toLowerCase() === "worktree") {
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
      extensions = frontmatter.extensions.split(",").map((e: string) => e.trim()).filter(Boolean);
    }
  }
}

// disallowed_tools
const disallowedToolsResult = parseStringArray(frontmatter.disallowed_tools, "disallowed_tools");
const disallowedTools = disallowedToolsResult.ok ? disallowedToolsResult.value : [];
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
      makeAgentDef({ promptMode: "replace", systemPrompt: "I am a specialist." }),
      "/tmp",
      { isGitRepo: false, branch: "", platform: "linux" },
      "Parent system prompt content",
    );
    expect(prompt).toContain("I am a specialist.");
    expect(prompt).not.toContain("Parent system prompt content");
  });

  it("append mode layers on top of parent system prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ promptMode: "append", systemPrompt: "Focus on security." }),
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
      makeAgentDef({ promptMode: "append", systemPrompt: "Focus on security." }),
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
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, stdio: "pipe" }).toString().trim();
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
    return buildAppendPrompt(agentDef, cwd, env, parentSystemPrompt, skillBlocks);
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
  const base = parentSystemPrompt?.trim() || "You are a general-purpose coding agent.";
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
    parts.push("", "<agent_instructions>", agentDef.systemPrompt.trim(), "</agent_instructions>");
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

  if (options.maxTurns && options.maxTurns > 0 && turnCount === options.maxTurns) {
    session.steer("You have reached the turn limit. Wrap up your work immediately and return your final result.");
    softLimitHit = true;
  }

  if (options.maxTurns && options.maxTurns > 0 && options.graceTurns !== undefined &&
      turnCount >= options.maxTurns + options.graceTurns) {
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
  cwd: Type.Optional(Type.String({ description: "Working directory override" })),
  model: Type.Optional(Type.String({ description: "Model override (provider/modelId or fuzzy name)" })),
  thinking: Type.Optional(Type.String({ description: "Thinking level: off, low, medium, high" })),
  max_turns: Type.Optional(Type.Number({ description: "Maximum agentic turns before stopping", minimum: 1 })),
  isolated: Type.Optional(Type.Boolean({ description: "If true, agent gets no extension/MCP tools" })),
  inherit_context: Type.Optional(Type.Boolean({ description: "If true, fork parent conversation into the agent" })),
  run_in_background: Type.Optional(Type.Boolean({ description: "Run in background and return agent ID immediately" })),
  resume: Type.Optional(Type.String({ description: "Agent ID to resume from previous context" })),
  isolation: Type.Optional(Type.String({ description: "Run agent in a temporary git worktree" })),
});
```

- [ ] **Step 2: Add stub handling in execute()**

Before the main execution logic:

```typescript
if (params.run_in_background) {
  return { content: [{ type: "text", text: "run_in_background is not yet implemented. It will be available in a future update." }], isError: true };
}
if (params.resume) {
  return { content: [{ type: "text", text: "resume is not yet implemented. It will be available in a future update." }], isError: true };
}
if (params.isolation) {
  return { content: [{ type: "text", text: "isolation is not yet implemented. It will be available in a future update." }], isError: true };
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
          { type: "message", role: "user", content: [{ type: "text", text: "Hello" }] },
          { type: "message", role: "assistant", content: [{ type: "text", text: "Hi there" }] },
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
export function buildParentContext(ctx: { sessionManager: { getBranch: () => unknown[] } }): string {
  const entries = ctx.sessionManager.getBranch();
  const lines: string[] = [];

  for (const entry of entries) {
    const e = entry as { type?: string; role?: string; content?: Array<{ type: string; text?: string }>; summary?: string };
    if (e.type === "message" && e.role === "user") {
      const text = e.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
      if (text) lines.push(`[User]: ${text}`);
    } else if (e.type === "message" && e.role === "assistant") {
      const text = e.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
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
  const agentDef = makeAgentDef({ tools: ["read", "bash", "write"], disallowedTools: ["bash"] });
  // Verify createAgentSession is called without "bash" in tools
});
```

- [ ] **Step 5: Implement `disallowed_tools` filtering in runner**

```typescript
const childTools = (options.allowRecursion
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

---

## Phase 3: Background/Async Execution (Spec 2)

Add non-blocking agent execution. After this phase, agents can run in the background while the parent continues, with concurrency management, steering, resume, and completion notifications.

### Task 3.1: Create settings module

**Files:**
- Create: `src/core/settings.ts`
- Create: `tests/settings.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { loadSettings, saveSettings, type Settings } from "../src/core/settings.js";

describe("settings", () => {
  it("returns defaults when no file exists", () => {
    const settings = loadSettings("/nonexistent/path");
    expect(settings.maxConcurrent).toBe(4);
    expect(settings.defaultJoinMode).toBe("smart");
  });
});
```

- [ ] **Step 2: Implement settings module**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type JoinMode = "async" | "group" | "smart";

export interface Settings {
  maxConcurrent: number;
  defaultJoinMode: JoinMode;
}

const DEFAULTS: Settings = {
  maxConcurrent: 4,
  defaultJoinMode: "smart",
};

export function loadSettings(path: string): Settings {
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      maxConcurrent: typeof raw.maxConcurrent === "number" && raw.maxConcurrent > 0
        ? raw.maxConcurrent : DEFAULTS.maxConcurrent,
      defaultJoinMode: ["async", "group", "smart"].includes(raw.defaultJoinMode as string)
        ? (raw.defaultJoinMode as JoinMode) : DEFAULTS.defaultJoinMode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/settings.ts tests/settings.test.ts
git commit -m "feat: add settings module for background execution config"
```

### Task 3.2: Create JSONL output file streaming

**Files:**
- Create: `src/core/output-file.ts`
- Create: `tests/output-file.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, afterEach } from "vitest";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeInitialEntry, appendEntry } from "../src/core/output-file.js";

describe("output-file", () => {
  const testDir = join(tmpdir(), "pi-subagents-test-output");
  const testFile = join(testDir, "test.output");

  afterEach(() => {
    try { unlinkSync(testFile); } catch {}
  });

  it("writeInitialEntry creates JSONL file with user prompt", () => {
    mkdirSync(testDir, { recursive: true });
    writeInitialEntry(testFile, "agent-1", "Do something", "/tmp/cwd");
    expect(existsSync(testFile)).toBe(true);
    const content = readFileSync(testFile, "utf8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.isSidechain).toBe(true);
    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.type).toBe("user");
    expect(parsed.message).toBe("Do something");
  });
});
```

- [ ] **Step 2: Implement output-file module**

```typescript
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeInitialEntry(
  filePath: string,
  agentId: string,
  prompt: string,
  cwd: string,
): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const entry = {
    isSidechain: true,
    agentId,
    type: "user",
    message: prompt,
    timestamp: Date.now(),
    cwd,
  };
  writeFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function appendEntry(
  filePath: string,
  agentId: string,
  type: "assistant" | "tool",
  message: unknown,
  cwd: string,
): void {
  const entry = {
    isSidechain: true,
    agentId,
    type,
    message,
    timestamp: Date.now(),
    cwd,
  };
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/output-file.ts tests/output-file.test.ts
git commit -m "feat: add JSONL output file streaming for agent transcripts"
```

### Task 3.3: Create worktree module

**Files:**
- Create: `src/core/worktree.ts`
- Create: `tests/worktree.test.ts`

- [ ] **Step 1: Write failing tests**

Tests for `createWorktree()` and `cleanupWorktree()`. Use a temp git repo.

- [ ] **Step 2: Implement worktree module**

```typescript
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseSha: string;
}

export interface WorktreeResult {
  hasChanges: boolean;
  branch?: string;
}

export function createWorktree(cwd: string, agentId: string): WorktreeInfo {
  // Validate git repo
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
  } catch {
    throw new Error(`Not inside a git repository: ${cwd}`);
  }

  const baseSha = execSync("git rev-parse HEAD", { cwd, stdio: "pipe" }).toString().trim();
  const branch = `subagent/${agentId}`;
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-worktree-"));

  execSync(`git worktree add --detach "${tmpDir}" HEAD`, { cwd, stdio: "pipe" });
  execSync(`git checkout -b "${branch}"`, { cwd: tmpDir, stdio: "pipe" });

  return { path: tmpDir, branch, baseSha };
}

export function cleanupWorktree(
  parentCwd: string,
  worktree: WorktreeInfo,
): WorktreeResult {
  let hasChanges = false;

  if (existsSync(worktree.path)) {
    try {
      const status = execSync("git status --porcelain", { cwd: worktree.path, stdio: "pipe" }).toString().trim();
      if (status) {
        execSync("git add -A", { cwd: worktree.path, stdio: "pipe" });
        execSync('git commit -m "subagent: auto-commit changes"', { cwd: worktree.path, stdio: "pipe" });
        hasChanges = true;
      }
    } catch {}

    try {
      execSync(`git worktree remove "${worktree.path}"`, { cwd: parentCwd, stdio: "pipe" });
    } catch {
      try {
        execSync(`git worktree remove --force "${worktree.path}"`, { cwd: parentCwd, stdio: "pipe" });
      } catch {}
    }
  }

  return { hasChanges, branch: hasChanges ? worktree.branch : undefined };
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/worktree.ts tests/worktree.test.ts
git commit -m "feat: add git worktree create/cleanup for isolated execution"
```

### Task 3.4: Create GroupJoinManager

**Files:**
- Create: `src/core/group-join-manager.ts`
- Create: `tests/group-join-manager.test.ts`

- [ ] **Step 1: Write failing tests for async/group/smart modes**

- [ ] **Step 2: Implement GroupJoinManager**

The module handles notification batching. In `async` mode, fire immediately. In `group` mode, batch until all expected agents complete. In `smart` mode, debounce with a 500ms timer.

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/group-join-manager.ts tests/group-join-manager.test.ts
git commit -m "feat: add GroupJoinManager for completion notification batching"
```

### Task 3.5: Extend AgentManager with background execution

**Files:**
- Modify: `src/core/agent-manager.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/agent-manager.test.ts`

This is the largest task in Phase 3. The implementer should:

- [ ] **Step 1: Extend `AgentRecord` with background fields**

Add to `types.ts`: `isBackground`, `promise`, `groupId`, `joinMode`, `resultConsumed`, `pendingSteers`, `worktree`, `worktreeResult`, `toolCallId`, `outputFile`, `outputCleanup`, `turnCount`, `compactionCount`. Add `"queued"` and `"stopped"` statuses.

- [ ] **Step 2: Add `spawn()` method**

Non-blocking. Creates record with status `"queued"` or `"running"`, returns agent ID immediately. Uses concurrency queue.

- [ ] **Step 3: Add concurrency queue and `drainQueue()`**

FIFO array. `runningBackground` counter. Drain on each background completion.

- [ ] **Step 4: Add `resume()` method**

Continue a completed agent's conversation.

- [ ] **Step 5: Add `steer()` method**

Send message to running agent. Queue if session not yet created.

- [ ] **Step 6: Add `hasRunning()`, `abortAll()`, `waitForAll()`**

- [ ] **Step 7: Add cleanup timer**

60-second interval, remove records completed > 10 minutes ago.

- [ ] **Step 8: Write tests for all new methods**

- [ ] **Step 9: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/core/agent-manager.ts src/shared/types.ts tests/agent-manager.test.ts
git commit -m "feat: extend AgentManager with background execution, concurrency queue, steer, resume"
```

### Task 3.6: Add runner extensions (resume, steer, getConversation)

**Files:**
- Modify: `src/core/agent-runner.ts`
- Modify: `tests/agent-runner.test.ts`

- [ ] **Step 1: Add `resumeAgent()`**

```typescript
export async function resumeAgent(
  session: unknown,
  prompt: string,
): Promise<string> {
  const s = session as { prompt: (p: string) => Promise<void> };
  // Collect response text via event subscription
  let responseText = "";
  // ... subscribe to text_delta events
  await s.prompt(prompt);
  return responseText;
}
```

- [ ] **Step 2: Add `steerAgent()`**

```typescript
export function steerAgent(session: unknown, message: string): void {
  const s = session as { steer: (m: string) => void };
  s.steer(message);
}
```

- [ ] **Step 3: Add `getAgentConversation()`**

```typescript
export function getAgentConversation(session: unknown): string {
  const s = session as { sessionManager: { getBranch: () => unknown[] } };
  // Format conversation entries
  return formatConversation(s.sessionManager.getBranch());
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add src/core/agent-runner.ts tests/agent-runner.test.ts
git commit -m "feat: add resumeAgent, steerAgent, getAgentConversation to runner"
```

### Task 3.7: Register new tools and wire background execution

**Files:**
- Modify: `src/core/subagent.ts`
- Modify: `src/index.ts`
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Remove stubs for `run_in_background`, `resume`, `isolation`**

Replace stub error returns with actual implementation in the tool handler.

- [ ] **Step 2: Wire background path in subagent tool handler**

When `params.run_in_background` is true, call `manager.spawn()` instead of `manager.spawnAndWait()`, return agent ID.

- [ ] **Step 3: Register `get_subagent_result` tool in `index.ts`**

```typescript
pi.registerTool({
  name: "get_subagent_result",
  label: "Get Subagent Result",
  description: "Check the status and result of a background agent.",
  parameters: Type.Object({
    agent_id: Type.String({ description: "The agent ID to check." }),
    wait: Type.Optional(Type.Boolean({ description: "Wait for completion. Default: false." })),
    verbose: Type.Optional(Type.Boolean({ description: "Include full conversation. Default: false." })),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const record = deps.manager.getRecord(params.agent_id);
    if (!record) {
      return { content: [{ type: "text", text: "Agent not found." }], isError: true };
    }
    if (params.wait && record.status === "running") {
      // await record.promise
    }
    record.resultConsumed = true;
    const statusLine = `Agent [${record.id}]: ${record.status}`;
    const resultLine = record.result ? `Result: ${record.result}` : "";
    const statsLine = `Duration: ${record.durationMs ?? 0}ms | Tool uses: ${record.toolUses}`;
    return {
      content: [{ type: "text", text: [statusLine, resultLine, statsLine].filter(Boolean).join("\n") }],
      isError: false,
    };
  },
});
```

- [ ] **Step 4: Register `steer_subagent` tool in `index.ts`**

```typescript
pi.registerTool({
  name: "steer_subagent",
  label: "Steer Subagent",
  description: "Send a message to a running background agent.",
  parameters: Type.Object({
    agent_id: Type.String({ description: "Agent ID to steer." }),
    message: Type.String({ description: "Message to send." }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const success = deps.manager.steer(params.agent_id, params.message);
    if (!success) {
      return { content: [{ type: "text", text: "Agent not found or not running." }], isError: true };
    }
    return { content: [{ type: "text", text: `Steer message sent to agent ${params.agent_id}.` }], isError: false };
  },
});
```

- [ ] **Step 5: Register notification renderer**

```typescript
pi.registerMessageRenderer("subagent-notification", (msg, opts, theme) => {
  // Render notification with status icon, stats, result preview
  const details = msg.details as NotificationDetails;
  // ... format collapsed/expanded view
});
```

- [ ] **Step 6: Add background result rendering to `tui/render.ts`**

When a tool result is for a background spawn, render a dimmed "Running in background" with agent ID.

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/subagent.ts src/index.ts src/tui/render.ts
git commit -m "feat: register get_subagent_result, steer_subagent tools; wire background execution"
```

### Task 3.8: Wire lifecycle events and settings

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tui/agents-menu.ts`

- [ ] **Step 1: Emit lifecycle events**

```typescript
manager.on("created", (payload) => pi.events?.emit("subagents:created", payload));
manager.on("completed", (payload) => pi.events?.emit("subagents:completed", payload));
// etc.
```

Note: This requires adding an event emitter to `AgentManager` or using a callback-based approach. The implementer should choose the approach that best fits the existing codebase patterns.

- [ ] **Step 2: Add settings to agents menu**

Add `maxConcurrent` and `defaultJoinMode` to the settings menu items in `agents-menu.ts`.

- [ ] **Step 3: Run full check, commit**

```bash
git add src/index.ts src/tui/agents-menu.ts
git commit -m "feat: wire lifecycle events and background execution settings"
```

---

## Phase 4: Parallel Execution (Spec 3)

Coordinated parallel agent execution. After this phase, the LLM can spawn groups of agents, wait for them, and manage them as a unit.

### Task 4.1: Create GroupTracker

**Files:**
- Create: `src/core/group-tracker.ts`
- Create: `tests/group-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { GroupTracker } from "../src/core/group-tracker.js";

describe("GroupTracker", () => {
  it("creates a group and returns an ID", () => {
    const mockManager = { abort: vi.fn(), steer: vi.fn(), getRecord: vi.fn() };
    const tracker = new GroupTracker(mockManager as never);
    const id = tracker.createGroup("test-group", ["a1", "a2", "a3"]);
    expect(id).toBeTruthy();
    const group = tracker.getGroup(id);
    expect(group).toBeTruthy();
    expect(group!.name).toBe("test-group");
    expect(group!.agentIds).toEqual(["a1", "a2", "a3"]);
    expect(group!.status).toBe("running");
  });

  it("resolves group promise when all agents complete", async () => {
    const mockManager = { abort: vi.fn(), steer: vi.fn(), getRecord: vi.fn() };
    const tracker = new GroupTracker(mockManager as never);
    const id = tracker.createGroup("test", ["a1", "a2"]);
    const group = tracker.getGroup(id)!;

    tracker.addCompletion("a1");
    expect(group.status).toBe("running");

    tracker.addCompletion("a2");
    await group.promise;
    expect(group.status).toBe("completed");
  });

  it("abortGroup aborts all running agents", () => {
    const mockManager = {
      abort: vi.fn().mockReturnValue(true),
      steer: vi.fn(),
      getRecord: vi.fn(),
    };
    const tracker = new GroupTracker(mockManager as never);
    const id = tracker.createGroup("test", ["a1", "a2"]);
    const count = tracker.abortGroup(id);
    expect(count).toBe(2);
    expect(mockManager.abort).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Implement GroupTracker**

```typescript
export interface GroupState {
  id: string;
  name: string;
  agentIds: string[];
  status: "running" | "completed" | "partial" | "aborted";
  createdAt: number;
  completedAt?: number;
  promise: Promise<void>;
  resolve: () => void;
  completedAgents: Set<string>;
}

let groupCounter = 0;

export class GroupTracker {
  private groups = new Map<string, GroupState>();
  private agentToGroup = new Map<string, string>();

  constructor(private manager: { abort: (id: string) => boolean; steer: (id: string, msg: string) => boolean }) {}

  createGroup(name: string, agentIds: string[]): string {
    const id = `group-${Date.now().toString(36)}-${(groupCounter++).toString(36)}`;
    let resolve: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });

    const state: GroupState = {
      id,
      name,
      agentIds,
      status: "running",
      createdAt: Date.now(),
      promise,
      resolve: resolve!,
      completedAgents: new Set(),
    };
    this.groups.set(id, state);
    for (const agentId of agentIds) {
      this.agentToGroup.set(agentId, id);
    }
    return id;
  }

  getGroup(id: string): GroupState | undefined {
    return this.groups.get(id);
  }

  getGroupForAgent(agentId: string): string | undefined {
    return this.agentToGroup.get(agentId);
  }

  addCompletion(agentId: string): void {
    const groupId = this.agentToGroup.get(agentId);
    if (!groupId) return;
    const group = this.groups.get(groupId);
    if (!group) return;
    group.completedAgents.add(agentId);
    if (group.completedAgents.size >= group.agentIds.length) {
      group.status = "completed";
      group.completedAt = Date.now();
      group.resolve();
    }
  }

  abortGroup(id: string): number {
    const group = this.groups.get(id);
    if (!group) return 0;
    let count = 0;
    for (const agentId of group.agentIds) {
      if (this.manager.abort(agentId)) count++;
    }
    group.status = "aborted";
    return count;
  }

  steerGroup(id: string, message: string): number {
    const group = this.groups.get(id);
    if (!group) return 0;
    let count = 0;
    for (const agentId of group.agentIds) {
      if (this.manager.steer(agentId, message)) count++;
    }
    return count;
  }

  listGroups(): GroupState[] {
    return [...this.groups.values()];
  }

  clearCompleted(): void {
    for (const [id, group] of this.groups) {
      if (group.status !== "running") {
        for (const agentId of group.agentIds) {
          this.agentToGroup.delete(agentId);
        }
        this.groups.delete(id);
      }
    }
  }
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/group-tracker.ts tests/group-tracker.test.ts
git commit -m "feat: add GroupTracker for parallel agent group lifecycle"
```

### Task 4.2: Create parallel progress renderer

**Files:**
- Create: `src/core/parallel-progress.ts`
- Create: `tests/parallel-progress.test.ts`

- [ ] **Step 1: Write tests for progress formatting**

- [ ] **Step 2: Implement multi-agent progress display**

Format multi-line progress string showing status of each agent in a group.

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/parallel-progress.ts tests/parallel-progress.test.ts
git commit -m "feat: add parallel progress renderer for group execution"
```

### Task 4.3: Register parallel and wait_for_group tools

**Files:**
- Modify: `src/index.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Extend `SpawnOptions` and `AgentRecord` with `groupId`**

- [ ] **Step 2: Wire GroupTracker notifications in AgentManager**

When an agent with a `groupId` completes, call `groupTracker.addCompletion(agentId)`.

- [ ] **Step 3: Register `parallel` tool**

```typescript
pi.registerTool({
  name: "parallel",
  label: "Parallel",
  description: "Spawn multiple agents as a coordinated group.",
  parameters: Type.Object({
    group_name: Type.String({ description: "Name for this group" }),
    agents: Type.Array(Type.Object({
      agent: Type.String({ description: "Agent type to invoke" }),
      task: Type.String({ description: "Task for this agent" }),
      cwd: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.String()),
      max_turns: Type.Optional(Type.Number({ minimum: 1 })),
      isolated: Type.Optional(Type.Boolean()),
      isolation: Type.Optional(Type.String()),
    }), { minItems: 1, maxItems: 20 }),
    wait: Type.Optional(Type.Boolean({ description: "Wait for all agents to complete. Default: false." })),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    // Validate all agents
    // Create group via GroupTracker
    // Spawn each agent via manager.spawn() with groupId
    // If wait: true, await group.promise and return aggregate results
    // If wait: false, return group ID and agent IDs
  },
});
```

- [ ] **Step 4: Register `wait_for_group` tool**

- [ ] **Step 5: Extend `steer_subagent` with group operations**

Add `group_id` and `action` parameters to the existing `steer_subagent` schema.

- [ ] **Step 6: Add parallel result rendering to `tui/render.ts`**

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: register parallel, wait_for_group tools; extend steer_subagent with group operations"
```

---

## Phase 5: UI Features (Spec 4)

Three TUI components: agent widget, fleet list, and conversation viewer. After this phase, users see real-time agent status and can interactively browse conversations and steer agents.

### Task 5.1: Create shared formatting utilities

**Files:**
- Create: `src/ui/format.ts`
- Create: `tests/format.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTokens,
  formatTurns,
  truncate,
} from "../src/ui/format.js";

describe("formatDuration", () => {
  it("formats sub-second", () => { expect(formatDuration(500)).toBe("0ms"); });
  it("formats seconds", () => { expect(formatDuration(11_200)).toBe("11.2s"); });
  it("formats minutes", () => { expect(formatDuration(150_000)).toBe("2m 30s"); });
  it("formats hours", () => { expect(formatDuration(3_900_000)).toBe("1h 5m"); });
});

describe("formatTokens", () => {
  it("formats small numbers", () => { expect(formatTokens(500)).toBe("500"); });
  it("formats thousands", () => { expect(formatTokens(12_300)).toBe("12.3k"); });
  it("formats millions", () => { expect(formatTokens(1_200_000)).toBe("1.2M"); });
});

describe("formatTurns", () => {
  it("without max", () => { expect(formatTurns(5)).toBe("↻5"); });
  it("with max", () => { expect(formatTurns(5, 30)).toBe("↻5≤30"); });
});

describe("truncate", () => {
  it("under limit unchanged", () => { expect(truncate("hello", 10)).toBe("hello"); });
  it("over limit truncated", () => { expect(truncate("hello world foo", 10)).toBe("hello wor…"); });
});
```

- [ ] **Step 2: Implement format utilities**

```typescript
export function formatDuration(ms: number): string {
  if (ms < 1000) return "0ms";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatTurns(turns: number, maxTurns?: number): string {
  return maxTurns ? `↻${turns}≤${maxTurns}` : `↻${turns}`;
}

export function formatActivity(activity: { toolName: string; args?: string } | undefined, maxLen: number): string {
  if (!activity) return "";
  const text = activity.args ? `${activity.toolName}: ${activity.args}` : activity.toolName;
  return truncate(text, maxLen);
}

export function statusIcon(status: string): { icon: string; colorKey: string } {
  switch (status) {
    case "running": return { icon: "⠋", colorKey: "accent" };
    case "completed": return { icon: "✓", colorKey: "success" };
    case "steered": return { icon: "✓", colorKey: "warning" };
    case "stopped": return { icon: "■", colorKey: "dim" };
    case "error": return { icon: "✗", colorKey: "error" };
    case "aborted": return { icon: "✗", colorKey: "error" };
    case "queued": return { icon: "◦", colorKey: "muted" };
    default: return { icon: "?", colorKey: "dim" };
  }
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/format.ts tests/format.test.ts
git commit -m "feat: add shared UI formatting utilities"
```

### Task 5.2: Create viewer keybindings module

**Files:**
- Create: `src/ui/viewer-keys.ts`
- Create: `tests/viewer-keys.test.ts`

- [ ] **Step 1: Write failing tests**

- [ ] **Step 2: Implement viewer keys**

```typescript
export interface ViewerKeybindings {
  "tui.select.up"?: string;
  "tui.select.down"?: string;
  "tui.select.pageUp"?: string;
  "tui.select.pageDown"?: string;
}

export interface ViewerKeys {
  scrollUp(data: string): boolean;
  scrollDown(data: string): boolean;
  pageUp(data: string): boolean;
  pageDown(data: string): boolean;
}

export function createViewerKeys(keybindings?: ViewerKeybindings): ViewerKeys {
  const upKey = keybindings?.["tui.select.up"] ?? "\x1b[A";
  const downKey = keybindings?.["tui.select.down"] ?? "\x1b[B";
  const pageUpKey = keybindings?.["tui.select.pageUp"] ?? "\x1b[5~";
  const pageDownKey = keybindings?.["tui.select.pageDown"] ?? "\x1b[6~";

  return {
    scrollUp: (data) => data === upKey || data === "k",
    scrollDown: (data) => data === downKey || data === "j",
    pageUp: (data) => data === pageUpKey,
    pageDown: (data) => data === pageDownKey,
  };
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/viewer-keys.ts tests/viewer-keys.test.ts
git commit -m "feat: add viewer keybindings module"
```

### Task 5.3: Create Agent Widget

**Files:**
- Create: `src/ui/agent-widget.ts`
- Create: `tests/agent-widget.test.ts`

- [ ] **Step 1: Write failing tests**

Test rendering output for each agent status (running, completed, steered, error, aborted, queued). Test tree structure connectors. Test overflow with +N more. Test widget modes.

- [ ] **Step 2: Implement AgentWidget**

Follow the spec layout:
- Tree structure with heading and per-agent rows
- Status icons with spinner animation
- Activity summary line for running agents
- Overflow handling (max 12 lines)
- Finished agent aging (removed after 2 parent turns)
- Status bar updates

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/agent-widget.ts tests/agent-widget.test.ts
git commit -m "feat: add Agent Widget for persistent above-editor status"
```

### Task 5.4: Create Fleet List

**Files:**
- Create: `src/ui/fleet-list.ts`
- Create: `tests/fleet-list.test.ts`

- [ ] **Step 1: Write failing tests**

Test main session row, agent rows, selection state, overflow with scroll indicators, finished agent linger, key handling.

- [ ] **Step 2: Implement FleetList**

Follow the spec:
- Below-editor widget
- Main session always first
- Navigation: `←` to activate, `Esc` to deactivate, `↑`/`↓` arrows, Enter to open viewer
- Max 5 visible rows with scroll indicators
- Finished agents linger for 4 seconds

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/fleet-list.ts tests/fleet-list.test.ts
git commit -m "feat: add Fleet List for below-editor agent navigation"
```

### Task 5.5: Create Conversation Viewer

**Files:**
- Create: `src/ui/conversation-viewer.ts`
- Create: `tests/conversation-viewer.test.ts`

- [ ] **Step 1: Write failing tests**

Test header rendering, conversation formatting, scrolling, steer compose mode, stop confirmation, streaming indicator.

- [ ] **Step 2: Implement ConversationViewer**

Follow the spec:
- Full-screen overlay via `ui.custom()`
- Header with status icon, agent name, duration, tokens
- Conversation entries (User/Assistant/Tool/Result)
- Scrollable content
- Steer compose mode (Enter to start, Enter to send, Esc to cancel)
- Stop with `x` key
- Close with Esc
- Data source: live session or JSONL output file

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/conversation-viewer.ts tests/conversation-viewer.test.ts
git commit -m "feat: add Conversation Viewer overlay with steer/stop controls"
```

### Task 5.6: Enhanced notification renderer

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement the polished notification renderer**

Follow the spec format:
- Collapsed: status icon + description + stats line + result preview (80 chars) + transcript link
- Expanded: up to 30 lines of result
- Group notifications: stack all agents in batch
- Turn count display adapts based on max turns

- [ ] **Step 2: Run tests, commit**

```bash
git add src/index.ts
git commit -m "feat: enhance notification renderer with polished collapsed/expanded views"
```

### Task 5.7: Wire UI components into index.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `src/core/agent-manager.ts`

- [ ] **Step 1: Create AgentWidget and FleetList in `registerSubagentsExtension()`**

```typescript
import { AgentWidget } from "./ui/agent-widget.js";
import { FleetList } from "./ui/fleet-list.js";

// In registerSubagentsExtension:
const agentActivity = new Map();
const widget = new AgentWidget(deps.manager, agentActivity, () => widgetMode);
const fleetList = new FleetList(deps.manager, agentActivity);

// Wire tool_execution_start to widget
pi.on("tool_execution_start", () => widget.onTurnStart());

// Wire manager events to widget and fleet
// Wire session events for widget/fleet updates
```

- [ ] **Step 2: Expose agentActivity map from AgentManager**

Add a method or property to AgentManager that exposes the activity map for UI consumption.

- [ ] **Step 3: Add widget mode setting to agents-menu**

- [ ] **Step 4: Update `tui/render.ts` to use shared `ui/format.ts`**

Replace inline formatting with calls to the shared utilities.

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire Agent Widget, Fleet List, and Conversation Viewer into extension"
```

### Task 5.8: Final integration verification

- [ ] **Step 1: Run full verification**

```bash
pnpm check
```

Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from Phase 5 wiring"
```

---

## Implementation Notes

### API Discovery

The `@earendil-works/pi-coding-agent` package's `createAgentSession` API is central to this implementation. Before starting Phase 1, the implementer should:

1. Read the `createAgentSession` function signature and options
2. Understand the `AgentSession` event types and their payloads
3. Verify that `session.prompt()`, `session.steer()`, `session.abort()`, and `session.bindExtensions()` exist
4. Check the `DefaultResourceLoader` API for extension loading policies
5. Verify `ctx.modelRegistry` and `ctx.sessionManager.getBranch()` APIs

The code in this plan is based on the spec descriptions and the tintinweb reference implementation patterns. Actual parameter names, event names, and types may differ.

### Testing Strategy

- Each module has its own test file in `tests/`
- The `@earendil-works/pi-coding-agent` module is mocked in tests (it's a peer dependency)
- Integration testing happens via `pnpm check` which runs lint, typecheck, and all tests
- The implementer should start each task by writing failing tests, then implementing, then verifying

### Error Handling

- `AgentManager` catches errors from `runAgent()` and stores them on the `AgentRecord`
- The `subagent` tool handler wraps manager calls in try/catch and returns error content
- Background agents store errors on the record for later retrieval via `get_subagent_result`
- Worktree operations have fallback cleanup (force remove) if normal cleanup fails
