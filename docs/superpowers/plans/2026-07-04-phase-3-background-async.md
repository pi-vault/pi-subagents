# Phase 3: Background/Async Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-blocking agent execution so agents can run in the background while the parent continues, with concurrency management, steering, resume, and completion notifications.

**Architecture:** Create standalone modules for settings, JSONL output, worktree management, and notification batching (GroupJoinManager). Extend `AgentManager` with `spawn()` (non-blocking), `resume()`, `steer()`, a FIFO concurrency queue, and a cleanup timer. Extend `AgentRunner` with `resumeAgent()`, `steerAgent()`, `getAgentConversation()`. Register `get_subagent_result` and `steer_subagent` tools. Remove stubs from `subagent.ts` and wire the real background path.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, typebox, Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-2-background-async-execution-design.md`

**Prerequisite:** Phase 2 (Tool Schema, Frontmatter, Execution Features) must be complete.

---

## File Structure

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

---

### Task 3.1: Create settings module

**Files:**
- Create: `src/core/settings.ts`
- Create: `tests/settings.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  loadSettings,
  saveSettings,
  type Settings,
} from "../src/core/settings.js";

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
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    return {
      maxConcurrent:
        typeof raw.maxConcurrent === "number" && raw.maxConcurrent > 0
          ? raw.maxConcurrent
          : DEFAULTS.maxConcurrent,
      defaultJoinMode: ["async", "group", "smart"].includes(
        raw.defaultJoinMode as string,
      )
        ? (raw.defaultJoinMode as JoinMode)
        : DEFAULTS.defaultJoinMode,
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
    try {
      unlinkSync(testFile);
    } catch {}
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
  writeFileSync(filePath, `${JSON.stringify(entry)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
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

  const baseSha = execSync("git rev-parse HEAD", { cwd, stdio: "pipe" })
    .toString()
    .trim();
  const branch = `subagent/${agentId}`;
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-worktree-"));

  execSync(`git worktree add --detach "${tmpDir}" HEAD`, {
    cwd,
    stdio: "pipe",
  });
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
      const status = execSync("git status --porcelain", {
        cwd: worktree.path,
        stdio: "pipe",
      })
        .toString()
        .trim();
      if (status) {
        execSync("git add -A", { cwd: worktree.path, stdio: "pipe" });
        execSync('git commit -m "subagent: auto-commit changes"', {
          cwd: worktree.path,
          stdio: "pipe",
        });
        hasChanges = true;
      }
    } catch {}

    try {
      execSync(`git worktree remove "${worktree.path}"`, {
        cwd: parentCwd,
        stdio: "pipe",
      });
    } catch {
      try {
        execSync(`git worktree remove --force "${worktree.path}"`, {
          cwd: parentCwd,
          stdio: "pipe",
        });
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
    wait: Type.Optional(
      Type.Boolean({ description: "Wait for completion. Default: false." }),
    ),
    verbose: Type.Optional(
      Type.Boolean({
        description: "Include full conversation. Default: false.",
      }),
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const record = deps.manager.getRecord(params.agent_id);
    if (!record) {
      return {
        content: [{ type: "text", text: "Agent not found." }],
        isError: true,
      };
    }
    if (params.wait && record.status === "running") {
      // await record.promise
    }
    record.resultConsumed = true;
    const statusLine = `Agent [${record.id}]: ${record.status}`;
    const resultLine = record.result ? `Result: ${record.result}` : "";
    const statsLine = `Duration: ${record.durationMs ?? 0}ms | Tool uses: ${record.toolUses}`;
    return {
      content: [
        {
          type: "text",
          text: [statusLine, resultLine, statsLine].filter(Boolean).join("\n"),
        },
      ],
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
      return {
        content: [{ type: "text", text: "Agent not found or not running." }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Steer message sent to agent ${params.agent_id}.`,
        },
      ],
      isError: false,
    };
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
manager.on("created", (payload) =>
  pi.events?.emit("subagents:created", payload),
);
manager.on("completed", (payload) =>
  pi.events?.emit("subagents:completed", payload),
);
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
