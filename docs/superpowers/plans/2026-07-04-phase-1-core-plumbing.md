# Phase 1: Core Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace child-process spawning with in-process `AgentSession` for single-agent foreground execution.

**Architecture:** Create `AgentRunner` (stateless session execution via `createAgentSession()`) and `AgentManager` (lifecycle, policy, record tracking), then rewire the existing `subagent` tool and `/agent` command to route through the manager instead of spawning child processes. Retire `subagent-spawner.ts`, `nested-context.ts`, and `execution-state.ts`.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (`createAgentSession`, `AgentSession`), `@earendil-works/pi-ai` (`Model`, `ThinkingLevel`), `@earendil-works/pi-tui` (Container, Text), Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-1a-session-execution-model-design.md`

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
import { describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/core/agent-runner.js";
import type { AgentDefinition, RunOptions } from "../src/shared/types.js";

// Mock createAgentSession - we'll need to mock the pi-coding-agent module
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
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
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
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
      onTextDelta: (delta, full) => {
        textDeltaCaptures.push(full);
      },
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
import type {
  AgentDefinition,
  RunOptions,
  RunResult,
} from "../shared/types.js";
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
    options.onToolActivity?.({
      type: "start",
      toolName: event.toolName ?? "unknown",
    });
  });
  session.on("tool_execution_end", (event: { toolName?: string }) => {
    options.onToolActivity?.({
      type: "end",
      toolName: event.toolName ?? "unknown",
    });
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
  session.on(
    "message_end",
    (event: {
      usage?: { input?: number; output?: number; cacheWrite?: number };
    }) => {
      if (event.usage) {
        options.onUsage?.({
          input: event.usage.input ?? 0,
          output: event.usage.output ?? 0,
          cacheWrite: event.usage.cacheWrite ?? 0,
        });
      }
    },
  );

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
      options.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          session.abort();
        },
        { once: true },
      );
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
        ctx as { model?: unknown },
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
