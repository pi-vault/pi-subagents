# Phase 3: Background/Async Execution Implementation Plan

> **Implementation Status (2025-07):** COMPLETE. All tasks implemented.
> - `group-join-manager.ts`, `output-file.ts`, `worktree.ts`, `settings.ts` created.
> - Background spawn, resume, steer all functional.
> - `get_subagent_result` and `steer_subagent` tools registered.
> - `appendEntry()` removed from `output-file.ts` during dead-code cleanup (streaming uses `streamToOutputFile()` instead).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-blocking agent execution so agents can run in the background while the parent continues, with concurrency management, steering, resume, and completion notifications.

**Architecture:** Create standalone modules for settings, JSONL output, worktree management, and notification batching (GroupJoinManager). Extend `AgentManager` with `spawn()` (non-blocking), `resume()`, `steer()`, a FIFO concurrency queue, and a cleanup timer. Extend `AgentRunner` with `resumeAgent()`, `steerAgent()`, `getAgentConversation()`. Register `get_subagent_result` and `steer_subagent` tools. Remove stubs from `subagent.ts` and wire the real background path.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, typebox, Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-2-background-async-execution-design.md`

**Prerequisite:** Phase 2 (Tool Schema, Frontmatter, Execution Features) must be complete.

**Reference Implementation:** `tintinweb-pi-subagents` — the plan follows its proven patterns for background execution, notifications, worktree isolation, and settings persistence.

---

## API Reference (verified against pi-coding-agent source)

These are the **actual** APIs. Do not deviate.

```typescript
// Notifications — use sendMessage, NOT notify (ctx.ui.notify is a UI toast, not an LLM-visible message)
pi.sendMessage<T>({
  customType: string,
  content: string | (TextContent | ImageContent)[],
  display: boolean,
  details?: T,
}, { triggerTurn?: boolean, deliverAs?: "steer" | "followUp" | "nextTurn" }): void;

// Lifecycle events
pi.events.emit(channel: string, data: unknown): void;
pi.events.on(channel: string, handler: (data: unknown) => void): () => void; // returns unsub

// Session operations (all async)
session.prompt(text: string, options?: PromptOptions): Promise<void>;
session.steer(text: string, images?: ImageContent[]): Promise<void>;
session.messages: AgentMessage[];  // getter
session.sessionManager: SessionManager; // has getBranch(), getEntries()
session.subscribe(handler: (event: AgentSessionEvent) => void): () => void; // returns unsub

// Session persistence
pi.appendEntry<T>(customType: string, data?: T): void;

// Tool definition
pi.registerTool<TParams, TDetails, TState>(tool: ToolDefinition<TParams, TDetails, TState>): void;
// execute returns: Promise<AgentToolResult<TDetails>>
// AgentToolResult = { content: (TextContent | ImageContent)[], details: T, terminate?: boolean }

// Message renderer
pi.registerMessageRenderer<T>(customType: string, renderer: MessageRenderer<T>): void;
// MessageRenderer = (message: CustomMessage<T>, options: { expanded: boolean }, theme: Theme) => Component | undefined
```

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/core/settings.ts` | Settings load/save/apply (project+global merge, SettingsAppliers) |
| Create | `src/core/output-file.ts` | JSONL transcript streaming with session subscription |
| Create | `src/core/worktree.ts` | Git worktree create/cleanup (execFileSync, not execSync) |
| Create | `src/core/group-join-manager.ts` | Notification batching (group mode + straggler timeout) |
| Create | `tests/settings.test.ts` | Settings persistence tests |
| Create | `tests/output-file.test.ts` | JSONL writing tests |
| Create | `tests/worktree.test.ts` | Worktree lifecycle tests |
| Create | `tests/group-join-manager.test.ts` | Join mode tests |
| Modify | `src/shared/types.ts` | Background fields on `AgentRecord`, `JoinMode`, `NotificationDetails` |
| Modify | `src/core/agent-manager.ts` | `spawn()`, `resume()`, `steer()`, concurrency queue, worktree, cleanup |
| Modify | `src/core/agent-runner.ts` | `resumeAgent()`, `steerAgent()`, `getAgentConversation()` |
| Modify | `src/core/subagent.ts` | Remove stubs, wire background/resume paths |
| Modify | `src/index.ts` | Register `get_subagent_result`, `steer_subagent`, notification renderer, events |
| Modify | `src/tui/render.ts` | Background result rendering |
| Modify | `src/tui/agents-menu.ts` | Settings for `maxConcurrent`, `defaultJoinMode` |
| Modify | `src/core/config.ts` | Add `defaultJoinMode` default |

---

### Task 3.1: Extend types with background fields

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `JoinMode` type and `NotificationDetails` interface**

```typescript
export type JoinMode = "async" | "group" | "smart";

export interface NotificationDetails {
  id: string;
  description: string;
  status: string;
  toolUses: number;
  turnCount: number;
  maxTurns?: number;
  totalTokens: number;
  durationMs: number;
  outputFile?: string;
  error?: string;
  resultPreview: string;
  others?: NotificationDetails[];
}
```

- [ ] **Step 2: Extend `AgentRecord` with background fields**

Add `"queued"` and `"stopped"` to the status union. Add new optional fields:

```typescript
export interface AgentRecord {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  session?: unknown;
  abortController?: AbortController;
  lifetimeUsage: LifetimeUsage;
  invocation?: AgentInvocation;
  // Phase 3: background execution fields
  isBackground?: boolean;
  promise?: Promise<string>;
  groupId?: string;
  joinMode?: JoinMode;
  resultConsumed?: boolean;
  pendingSteers?: string[];
  worktree?: { path: string; branch: string; baseSha: string; workPath: string };
  worktreeResult?: { hasChanges: boolean; branch?: string };
  toolCallId?: string;
  outputFile?: string;
  outputCleanup?: () => void;
  compactionCount: number;
}
```

- [ ] **Step 3: Add `defaultJoinMode` to `SubagentsConfig`**

```typescript
export interface SubagentsConfig {
  maxConcurrency: number;
  maxRecursiveLevel: number;
  defaultMaxTurns: number;
  graceTurns: number;
  defaultJoinMode: JoinMode;
}
```

- [ ] **Step 4: Update config.ts DEFAULT_CONFIG**

Add `defaultJoinMode: "smart"` to `DEFAULT_CONFIG`.

- [ ] **Step 5: Fix any existing test/code that assumes the old `AgentRecord.status` union or lacks `compactionCount`**

Initialize `compactionCount: 0` wherever records are created (agent-manager.ts).

- [ ] **Step 6: Run `pnpm check`, fix issues, commit**

```bash
git add src/shared/types.ts src/core/config.ts tests/
git commit -m "feat: extend types with background execution fields, JoinMode, NotificationDetails"
```

---

### Task 3.2: Create settings module

**Files:**
- Create: `src/core/settings.ts`
- Create: `tests/settings.test.ts`

Settings is separate from config.ts: config handles agent-level execution defaults, settings handles operational/runtime preferences with global+project merge (matching tintinweb's pattern).

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSettings, saveSettings, applySettings } from "../src/core/settings.js";
import type { SubagentsSettings, SettingsAppliers } from "../src/core/settings.js";

describe("settings", () => {
  const testDir = join(tmpdir(), `pi-subagents-settings-test-${Date.now()}`);
  const projectDir = join(testDir, "project");
  const piDir = join(projectDir, ".pi");

  beforeEach(() => {
    mkdirSync(piDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty settings when no file exists", () => {
    const settings = loadSettings(join(testDir, "nonexistent"));
    expect(settings).toEqual({});
  });

  it("reads project settings", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxConcurrent: 8 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxConcurrent).toBe(8);
  });

  it("sanitizes invalid values", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
      maxConcurrent: -1,
      defaultJoinMode: "invalid",
    }));
    const settings = loadSettings(projectDir);
    expect(settings.maxConcurrent).toBeUndefined();
    expect(settings.defaultJoinMode).toBeUndefined();
  });

  it("saves project settings", () => {
    const result = saveSettings({ maxConcurrent: 6 }, projectDir);
    expect(result).toBe(true);
    const raw = JSON.parse(readFileSync(join(piDir, "subagents.json"), "utf-8"));
    expect(raw.maxConcurrent).toBe(6);
  });

  it("applySettings calls setters for present fields", () => {
    let maxConcurrent = 0;
    let joinMode = "";
    const appliers: SettingsAppliers = {
      setMaxConcurrent: (n) => { maxConcurrent = n; },
      setDefaultJoinMode: (m) => { joinMode = m; },
    };
    applySettings({ maxConcurrent: 10, defaultJoinMode: "group" }, appliers);
    expect(maxConcurrent).toBe(10);
    expect(joinMode).toBe("group");
  });

  it("applySettings skips missing fields", () => {
    let called = false;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => { called = true; },
      setDefaultJoinMode: () => { called = true; },
    };
    applySettings({}, appliers);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Implement settings module**

Model after tintinweb's `settings.ts`: project (`<cwd>/.pi/subagents.json`) overrides global (`<agentDir>/subagents.json`). Use `sanitize()` to drop invalid fields silently. Provide `SettingsAppliers` interface for runtime application.

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { JoinMode } from "../shared/types.js";

export interface SubagentsSettings {
  maxConcurrent?: number;
  defaultJoinMode?: JoinMode;
}

export interface SettingsAppliers {
  setMaxConcurrent: (n: number) => void;
  setDefaultJoinMode: (mode: JoinMode) => void;
}

const MAX_CONCURRENT_CEILING = 1024;
const VALID_JOIN_MODES: ReadonlySet<string> = new Set(["async", "group", "smart"]);

function sanitize(raw: unknown): SubagentsSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: SubagentsSettings = {};
  if (Number.isInteger(r.maxConcurrent) && (r.maxConcurrent as number) >= 1 && (r.maxConcurrent as number) <= MAX_CONCURRENT_CEILING) {
    out.maxConcurrent = r.maxConcurrent as number;
  }
  if (typeof r.defaultJoinMode === "string" && VALID_JOIN_MODES.has(r.defaultJoinMode)) {
    out.defaultJoinMode = r.defaultJoinMode as JoinMode;
  }
  return out;
}

function globalPath(): string {
  return join(getAgentDir(), "subagents.json");
}

function projectPath(cwd: string): string {
  return join(cwd, ".pi", "subagents.json");
}

function readSettingsFile(path: string): SubagentsSettings {
  if (!existsSync(path)) return {};
  try {
    return sanitize(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return {};
  }
}

export function loadSettings(cwd: string = process.cwd()): SubagentsSettings {
  return { ...readSettingsFile(globalPath()), ...readSettingsFile(projectPath(cwd)) };
}

export function saveSettings(s: SubagentsSettings, cwd: string = process.cwd()): boolean {
  const path = projectPath(cwd);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(s, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function applySettings(s: SubagentsSettings, appliers: SettingsAppliers): void {
  if (typeof s.maxConcurrent === "number") appliers.setMaxConcurrent(s.maxConcurrent);
  if (s.defaultJoinMode) appliers.setDefaultJoinMode(s.defaultJoinMode);
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/settings.ts tests/settings.test.ts
git commit -m "feat: add settings module with project+global merge and SettingsAppliers"
```

---

### Task 3.3: Create JSONL output file streaming

**Files:**
- Create: `src/core/output-file.ts`
- Create: `tests/output-file.test.ts`

This module handles BOTH file I/O primitives AND the session streaming subscription (matching tintinweb's `output-file.ts` exactly).

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeInitialEntry, appendEntry, encodeCwd, createOutputFilePath } from "../src/core/output-file.js";

describe("output-file", () => {
  const testDir = join(tmpdir(), `pi-subagents-test-output-${Date.now()}`);
  const testFile = join(testDir, "test.output");

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
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
    expect(parsed.message.content).toBe("Do something");
  });

  it("appendEntry adds JSONL lines", () => {
    mkdirSync(testDir, { recursive: true });
    writeInitialEntry(testFile, "agent-1", "Do something", "/tmp/cwd");
    appendEntry(testFile, "agent-1", "assistant", "I did it", "/tmp/cwd");
    const lines = readFileSync(testFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const second = JSON.parse(lines[1]);
    expect(second.type).toBe("assistant");
  });

  it("encodeCwd strips separators and drive prefix", () => {
    expect(encodeCwd("/home/user/project")).toBe("home-user-project");
    expect(encodeCwd("C:\\Users\\foo")).toBe("Users-foo");
  });

  it("createOutputFilePath returns expected path structure", () => {
    const path = createOutputFilePath("/tmp/test", "agent-1", "session-abc");
    expect(path).toContain("agent-1.output");
    expect(path).toContain("session-abc");
  });
});
```

- [ ] **Step 2: Implement output-file module**

Include `encodeCwd`, `createOutputFilePath`, `writeInitialEntry`, `appendEntry`, and `streamToOutputFile`. The `streamToOutputFile` function subscribes to `session.subscribe()` for `turn_end` events, flushing new messages to the file on each turn. Returns a cleanup function.

```typescript
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export function encodeCwd(cwd: string): string {
  return cwd
    .replace(/[/\\]/g, "-")
    .replace(/^[A-Za-z]:-/, "")
    .replace(/^-+/, "");
}

export function createOutputFilePath(cwd: string, agentId: string, sessionId: string): string {
  const encoded = encodeCwd(cwd);
  const root = join(tmpdir(), `pi-subagents-${process.getuid?.() ?? 0}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try { chmodSync(root, 0o700); } catch (err) {
    if (process.platform !== "win32") throw err;
  }
  const dir = join(root, encoded, sessionId, "tasks");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${agentId}.output`);
}

export function writeInitialEntry(path: string, agentId: string, prompt: string, cwd: string): void {
  const entry = {
    isSidechain: true,
    agentId,
    type: "user",
    message: { role: "user", content: prompt },
    timestamp: new Date().toISOString(),
    cwd,
  };
  writeFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
}

export function appendEntry(
  path: string,
  agentId: string,
  type: "assistant" | "user" | "toolResult",
  message: unknown,
  cwd: string,
): void {
  const entry = {
    isSidechain: true,
    agentId,
    type,
    message,
    timestamp: new Date().toISOString(),
    cwd,
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Subscribe to session events and flush new messages to the output file on each turn_end.
 * Returns a cleanup function that does a final flush and unsubscribes.
 */
export function streamToOutputFile(
  session: AgentSession,
  path: string,
  agentId: string,
  cwd: string,
): () => void {
  let writtenCount = 1; // initial user prompt already written

  const flush = () => {
    const messages = session.messages;
    while (writtenCount < messages.length) {
      const msg = messages[writtenCount];
      const entry = {
        isSidechain: true,
        agentId,
        type: msg.role === "assistant" ? "assistant" : msg.role === "user" ? "user" : "toolResult",
        message: msg,
        timestamp: new Date().toISOString(),
        cwd,
      };
      try { appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8"); } catch { /* ignore */ }
      writtenCount++;
    }
  };

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "turn_end") flush();
  });

  return () => {
    flush();
    unsubscribe();
  };
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/output-file.ts tests/output-file.test.ts
git commit -m "feat: add JSONL output file streaming with session subscription"
```

---

### Task 3.4: Create worktree module

**Files:**
- Create: `src/core/worktree.ts`
- Create: `tests/worktree.test.ts`

Use `execFileSync` (NOT `execSync`) to avoid shell injection. Match tintinweb's pattern: return `undefined` on failure (not throw), include `workPath` for subdirectory scoping, create branch on cleanup.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorktree, cleanupWorktree, pruneWorktrees } from "../src/core/worktree.js";

describe("worktree", () => {
  const testDir = join(tmpdir(), `pi-worktree-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: testDir, stdio: "pipe" });
    writeFileSync(join(testDir, "file.txt"), "hello");
    execFileSync("git", ["add", "-A"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: testDir, stdio: "pipe" });
  });

  afterEach(() => {
    // Clean up worktrees before removing the repo
    try { execFileSync("git", ["worktree", "prune"], { cwd: testDir, stdio: "pipe" }); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates a worktree in a valid git repo", () => {
    const wt = createWorktree(testDir, "test-agent");
    expect(wt).toBeDefined();
    expect(wt!.baseSha).toBeTruthy();
    expect(wt!.branch).toContain("test-agent");
    // Clean up
    cleanupWorktree(testDir, wt!, "test");
  });

  it("returns undefined for non-git directory", () => {
    const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
    mkdirSync(nonGitDir, { recursive: true });
    const wt = createWorktree(nonGitDir, "test-agent");
    expect(wt).toBeUndefined();
    rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("cleanup with no changes removes worktree", () => {
    const wt = createWorktree(testDir, "clean-agent");
    expect(wt).toBeDefined();
    const result = cleanupWorktree(testDir, wt!, "test");
    expect(result.hasChanges).toBe(false);
  });

  it("cleanup with changes creates branch", () => {
    const wt = createWorktree(testDir, "dirty-agent");
    expect(wt).toBeDefined();
    writeFileSync(join(wt!.path, "new-file.txt"), "new content");
    const result = cleanupWorktree(testDir, wt!, "test changes");
    expect(result.hasChanges).toBe(true);
    expect(result.branch).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement worktree module**

Follow tintinweb's `worktree.ts` exactly:
- `createWorktree(cwd, agentId)` returns `WorktreeInfo | undefined`
- `cleanupWorktree(cwd, worktree, agentDescription)` returns `WorktreeCleanupResult`
- `pruneWorktrees(cwd)` for crash recovery
- All git commands use `execFileSync` with timeouts
- Include `workPath` calculation using `realpath` + `relative`

```typescript
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseSha: string;
  workPath: string;
}

export interface WorktreeCleanupResult {
  hasChanges: boolean;
  branch?: string;
}

export function createWorktree(cwd: string, agentId: string): WorktreeInfo | undefined {
  let baseSha: string;
  let subdir: string;
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "pipe", timeout: 5000 });
    baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, stdio: "pipe", timeout: 5000 }).toString().trim();
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, stdio: "pipe", timeout: 5000 }).toString().trim();
    subdir = relative(realpathSync(topLevel), realpathSync(cwd));
  } catch {
    return undefined;
  }

  const branch = `pi-agent-${agentId}`;
  const suffix = randomUUID().slice(0, 8);
  const worktreePath = join(tmpdir(), `pi-agent-${agentId}-${suffix}`);

  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], { cwd, stdio: "pipe", timeout: 30000 });
    return { path: worktreePath, branch, baseSha, workPath: subdir ? join(worktreePath, subdir) : worktreePath };
  } catch {
    return undefined;
  }
}

export function cleanupWorktree(cwd: string, worktree: WorktreeInfo, agentDescription: string): WorktreeCleanupResult {
  if (!existsSync(worktree.path)) return { hasChanges: false };

  try {
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: worktree.path, stdio: "pipe", timeout: 10000 }).toString().trim();

    if (status) {
      execFileSync("git", ["add", "-A"], { cwd: worktree.path, stdio: "pipe", timeout: 10000 });
      const commitMsg = `pi-agent: ${agentDescription.slice(0, 200)}`;
      execFileSync("git", ["commit", "--no-verify", "-m", commitMsg], { cwd: worktree.path, stdio: "pipe", timeout: 10000 });
    } else {
      const currentSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree.path, stdio: "pipe", timeout: 5000 }).toString().trim();
      if (currentSha === worktree.baseSha) {
        removeWorktree(cwd, worktree.path);
        return { hasChanges: false };
      }
    }

    let branchName = worktree.branch;
    try {
      execFileSync("git", ["branch", branchName], { cwd: worktree.path, stdio: "pipe", timeout: 5000 });
    } catch {
      branchName = `${worktree.branch}-${Date.now()}`;
      execFileSync("git", ["branch", branchName], { cwd: worktree.path, stdio: "pipe", timeout: 5000 });
    }
    worktree.branch = branchName;

    removeWorktree(cwd, worktree.path);
    return { hasChanges: true, branch: worktree.branch };
  } catch {
    try { removeWorktree(cwd, worktree.path); } catch {}
    return { hasChanges: false };
  }
}

function removeWorktree(cwd: string, worktreePath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], { cwd, stdio: "pipe", timeout: 10000 });
  } catch {
    try { execFileSync("git", ["worktree", "prune"], { cwd, stdio: "pipe", timeout: 5000 }); } catch {}
  }
}

export function pruneWorktrees(cwd: string): void {
  try { execFileSync("git", ["worktree", "prune"], { cwd, stdio: "pipe", timeout: 5000 }); } catch {}
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/worktree.ts tests/worktree.test.ts
git commit -m "feat: add git worktree create/cleanup for isolated execution"
```

---

### Task 3.5: Create GroupJoinManager

**Files:**
- Create: `src/core/group-join-manager.ts`
- Create: `tests/group-join-manager.test.ts`

Match tintinweb's `group-join.ts` exactly: groups track agent IDs, hold notifications until all complete or a timeout fires. Straggler support for partial delivery.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GroupJoinManager } from "../src/core/group-join-manager.js";
import type { AgentRecord } from "../src/shared/types.js";

function makeRecord(id: string, status: AgentRecord["status"] = "completed"): AgentRecord {
  return {
    id,
    type: "test",
    status,
    toolUses: 0,
    startedAt: Date.now(),
    lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    compactionCount: 0,
  };
}

describe("GroupJoinManager", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns 'pass' for ungrouped agents", () => {
    const deliverCb = vi.fn();
    const manager = new GroupJoinManager(deliverCb);
    const result = manager.onAgentComplete(makeRecord("agent-1"));
    expect(result).toBe("pass");
    expect(deliverCb).not.toHaveBeenCalled();
  });

  it("holds until all agents complete, then delivers", () => {
    const deliverCb = vi.fn();
    const manager = new GroupJoinManager(deliverCb);
    manager.registerGroup("g1", ["a1", "a2"]);

    expect(manager.onAgentComplete(makeRecord("a1"))).toBe("held");
    expect(deliverCb).not.toHaveBeenCalled();

    expect(manager.onAgentComplete(makeRecord("a2"))).toBe("delivered");
    expect(deliverCb).toHaveBeenCalledOnce();
    expect(deliverCb.mock.calls[0][0]).toHaveLength(2);
    expect(deliverCb.mock.calls[0][1]).toBe(false); // not partial
  });

  it("delivers partial on timeout", () => {
    const deliverCb = vi.fn();
    const manager = new GroupJoinManager(deliverCb, 5000);
    manager.registerGroup("g1", ["a1", "a2"]);

    manager.onAgentComplete(makeRecord("a1"));
    expect(deliverCb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(deliverCb).toHaveBeenCalledOnce();
    expect(deliverCb.mock.calls[0][0]).toHaveLength(1);
    expect(deliverCb.mock.calls[0][1]).toBe(true); // partial
  });

  it("isGrouped returns true for registered agents", () => {
    const manager = new GroupJoinManager(vi.fn());
    manager.registerGroup("g1", ["a1", "a2"]);
    expect(manager.isGrouped("a1")).toBe(true);
    expect(manager.isGrouped("a3")).toBe(false);
  });

  it("dispose clears timeouts and state", () => {
    const manager = new GroupJoinManager(vi.fn(), 5000);
    manager.registerGroup("g1", ["a1"]);
    manager.dispose();
    expect(manager.isGrouped("a1")).toBe(false);
  });
});
```

- [ ] **Step 2: Implement GroupJoinManager**

```typescript
import type { AgentRecord } from "../shared/types.js";

export type DeliveryCallback = (records: AgentRecord[], partial: boolean) => void;

interface AgentGroup {
  groupId: string;
  agentIds: Set<string>;
  completedRecords: Map<string, AgentRecord>;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  delivered: boolean;
  isStraggler: boolean;
}

const DEFAULT_TIMEOUT = 30_000;
const STRAGGLER_TIMEOUT = 15_000;

export class GroupJoinManager {
  private groups = new Map<string, AgentGroup>();
  private agentToGroup = new Map<string, string>();

  constructor(
    private deliverCb: DeliveryCallback,
    private groupTimeout = DEFAULT_TIMEOUT,
  ) {}

  registerGroup(groupId: string, agentIds: string[]): void {
    const group: AgentGroup = {
      groupId,
      agentIds: new Set(agentIds),
      completedRecords: new Map(),
      delivered: false,
      isStraggler: false,
    };
    this.groups.set(groupId, group);
    for (const id of agentIds) {
      this.agentToGroup.set(id, groupId);
    }
  }

  onAgentComplete(record: AgentRecord): "delivered" | "held" | "pass" {
    const groupId = this.agentToGroup.get(record.id);
    if (!groupId) return "pass";

    const group = this.groups.get(groupId);
    if (!group || group.delivered) return "pass";

    group.completedRecords.set(record.id, record);

    if (group.completedRecords.size >= group.agentIds.size) {
      this.deliver(group, false);
      return "delivered";
    }

    if (!group.timeoutHandle) {
      const timeout = group.isStraggler ? STRAGGLER_TIMEOUT : this.groupTimeout;
      group.timeoutHandle = setTimeout(() => this.onTimeout(group), timeout);
    }

    return "held";
  }

  private onTimeout(group: AgentGroup): void {
    if (group.delivered) return;
    group.timeoutHandle = undefined;

    const remaining = new Set<string>();
    for (const id of group.agentIds) {
      if (!group.completedRecords.has(id)) remaining.add(id);
    }

    for (const id of group.completedRecords.keys()) {
      this.agentToGroup.delete(id);
    }

    this.deliverCb([...group.completedRecords.values()], true);

    group.completedRecords.clear();
    group.agentIds = remaining;
    group.isStraggler = true;
  }

  private deliver(group: AgentGroup, partial: boolean): void {
    if (group.timeoutHandle) {
      clearTimeout(group.timeoutHandle);
      group.timeoutHandle = undefined;
    }
    group.delivered = true;
    this.deliverCb([...group.completedRecords.values()], partial);
    this.cleanupGroup(group.groupId);
  }

  private cleanupGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    for (const id of group.agentIds) {
      this.agentToGroup.delete(id);
    }
    this.groups.delete(groupId);
  }

  isGrouped(agentId: string): boolean {
    return this.agentToGroup.has(agentId);
  }

  dispose(): void {
    for (const group of this.groups.values()) {
      if (group.timeoutHandle) clearTimeout(group.timeoutHandle);
    }
    this.groups.clear();
    this.agentToGroup.clear();
  }
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/core/group-join-manager.ts tests/group-join-manager.test.ts
git commit -m "feat: add GroupJoinManager for completion notification batching"
```

---

### Task 3.6: Add runner extensions (resume, steer, getConversation)

**Files:**
- Modify: `src/core/agent-runner.ts`
- Modify: `tests/agent-runner.test.ts`

- [ ] **Step 1: Add `resumeAgent()`**

Reuse the existing `forwardAbortSignal` and `getLastAssistantText` helpers. Collect response text via `session.subscribe()`. Call `session.prompt()` on the existing session.

```typescript
export async function resumeAgent(
  session: AgentSession,
  prompt: string,
  options: {
    onToolActivity?: (activity: ToolActivity) => void;
    onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  let responseText = "";
  const cleanupAbort = forwardAbortSignal(session, options.signal);

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_start") responseText = "";
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      responseText += event.assistantMessageEvent.delta;
    }
    if (event.type === "tool_execution_start") {
      options.onToolActivity?.({ type: "start", toolName: event.toolName });
    }
    if (event.type === "tool_execution_end") {
      options.onToolActivity?.({ type: "end", toolName: event.toolName });
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = (event.message as { usage?: { input?: number; output?: number; cacheWrite?: number } }).usage;
      if (usage) {
        options.onAssistantUsage?.({
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
        });
      }
    }
  });

  try {
    await session.prompt(prompt);
  } finally {
    unsubscribe();
    cleanupAbort();
  }

  return responseText.trim() || getLastAssistantText(session);
}
```

- [ ] **Step 2: Add `steerAgent()`**

Async wrapper around `session.steer()`:

```typescript
export async function steerAgent(session: AgentSession, message: string): Promise<void> {
  await session.steer(message);
}
```

- [ ] **Step 3: Add `getAgentConversation()`**

Extract conversation from session for verbose output:

```typescript
export function getAgentConversation(session: unknown): string {
  const s = session as { messages?: Array<{ role: string; content?: unknown }> };
  if (!s.messages) return "";

  const lines: string[] = [];
  for (const msg of s.messages) {
    if (msg.role === "assistant") {
      const content = msg.content as Array<{ type: string; text?: string }> | undefined;
      if (content) {
        const text = content.filter(b => b.type === "text").map(b => b.text ?? "").join("");
        if (text.trim()) lines.push(`[assistant] ${text.trim()}`);
      }
    } else if (msg.role === "user") {
      const content = msg.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? (content as Array<{ type: string; text?: string }>).filter(b => b.type === "text").map(b => b.text ?? "").join("")
        : "";
      if (text.trim()) lines.push(`[user] ${text.trim()}`);
    }
  }
  return lines.join("\n\n");
}
```

- [ ] **Step 4: Export `ToolActivity` type from agent-runner if not already exported**

The `ToolActivity` type is currently in `types.ts`. Ensure `resumeAgent`, `steerAgent`, `getAgentConversation` are exported from agent-runner.

- [ ] **Step 5: Write tests, run, commit**

Test `resumeAgent` with a mock session that returns from `prompt()`. Test `getAgentConversation` with mock messages. Test `steerAgent` calls `session.steer()`.

```bash
git add src/core/agent-runner.ts tests/agent-runner.test.ts
git commit -m "feat: add resumeAgent, steerAgent, getAgentConversation to runner"
```

---

### Task 3.7: Extend AgentManager with background execution

**Files:**
- Modify: `src/core/agent-manager.ts`
- Modify: `tests/agent-manager.test.ts`

This is the largest task. The `AgentManager` class gains constructor callbacks, a concurrency queue, and new methods.

- [ ] **Step 1: Add constructor callbacks and queue fields**

Change the constructor to accept `onComplete`, `onStart` callbacks:

```typescript
export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;

const DEFAULT_MAX_CONCURRENT = 4;

export class AgentManager {
  private agents = new Map<string, AgentRecord>();
  private maxDepth: number;
  private maxConcurrent: number;
  private queue: { id: string; args: SpawnArgs }[] = [];
  private runningBackground = 0;
  private cleanupInterval: ReturnType<typeof setInterval>;
  private onComplete?: OnAgentComplete;
  private onStart?: OnAgentStart;

  constructor(
    maxDepth = 3,
    onComplete?: OnAgentComplete,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    onStart?: OnAgentStart,
  ) {
    this.maxDepth = maxDepth;
    this.onComplete = onComplete;
    this.onStart = onStart;
    this.maxConcurrent = maxConcurrent;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }
  // ...
}
```

Define a private `SpawnArgs` interface to capture the arguments needed for deferred queue execution.

- [ ] **Step 2: Add `spawn()` method**

Non-blocking. Returns agent ID immediately. If `isBackground` and at concurrency limit, queue with status `"queued"`. Otherwise call `startAgent()`.

```typescript
spawn(
  ctx: unknown,
  agentDef: AgentDefinition,
  options: SpawnOptions & { isBackground?: boolean; isolation?: string },
): string {
  // Same validation as spawnAndWait (depth, cwd, allowlist)
  // Create record with status: options.isBackground ? "queued" : "running"
  // Set isBackground, compactionCount: 0
  // If at limit: push to queue, return id
  // Otherwise: startAgent(id, record, args)
  // Return id
}
```

- [ ] **Step 3: Add `startAgent()` private method**

Shared between `spawn()` and `drainQueue()`. Handles worktree creation, status update to `"running"`, `runningBackground++`, `runAgent()` fire-and-forget promise, pending steer flush, and completion cleanup (worktree, output file, `runningBackground--`, `drainQueue()`).

Key pattern from tintinweb:
- On session created: store session on record, flush `pendingSteers` via `session.steer(msg).catch(() => {})`
- On completion: update status, store result, cleanup worktree, flush output file, fire `onComplete`, `drainQueue()`
- On error: same cleanup but set status `"error"`
- Store `record.promise = promise` for `waitForAll()`

- [ ] **Step 4: Add `drainQueue()` private method**

```typescript
private drainQueue(): void {
  while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
    const next = this.queue.shift()!;
    const record = this.agents.get(next.id);
    if (!record || record.status !== "queued") continue;
    try {
      this.startAgent(next.id, record, next.args);
    } catch (err) {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
      record.completedAt = Date.now();
      this.onComplete?.(record);
    }
  }
}
```

- [ ] **Step 5: Refactor `spawnAndWait()` to use `spawn()`**

Like tintinweb: `spawnAndWait` calls `spawn()` with `isBackground: false`, then awaits `record.promise`.

- [ ] **Step 6: Add `resume()` method**

```typescript
async resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined> {
  const record = this.agents.get(id);
  if (!record?.session) return undefined;

  record.status = "running";
  record.startedAt = Date.now();
  record.completedAt = undefined;
  record.result = undefined;
  record.error = undefined;

  try {
    const responseText = await resumeAgent(record.session as AgentSession, prompt, {
      onToolActivity: (activity) => { if (activity.type === "end") record.toolUses++; },
      onAssistantUsage: (usage) => {
        record.lifetimeUsage.inputTokens += usage.input;
        record.lifetimeUsage.outputTokens += usage.output;
        record.lifetimeUsage.cacheWriteTokens += usage.cacheWrite;
      },
      signal,
    });
    record.status = "completed";
    record.result = responseText;
    record.completedAt = Date.now();
  } catch (err) {
    record.status = "error";
    record.error = err instanceof Error ? err.message : String(err);
    record.completedAt = Date.now();
  }

  return record;
}
```

- [ ] **Step 7: Add `steer()` method**

Fire-and-forget with `.catch(() => {})` for async steer:

```typescript
steer(id: string, message: string): boolean {
  const record = this.agents.get(id);
  if (!record) return false;
  if (record.status !== "running" && record.status !== "queued") return false;
  if (record.session) {
    (record.session as AgentSession).steer(message).catch(() => {});
  } else {
    if (!record.pendingSteers) record.pendingSteers = [];
    record.pendingSteers.push(message);
  }
  return true;
}
```

- [ ] **Step 8: Add `hasRunning()`, `abortAll()`, `waitForAll()`, `setMaxConcurrent()`, `getMaxConcurrent()`**

Follow tintinweb patterns:
- `abort()` must handle both queued (remove from queue, set `"stopped"`) and running (abort, set `"stopped"`)
- `abortAll()` clears queue then aborts running
- `waitForAll()` loops: drain, collect promises, `Promise.allSettled`, repeat until empty

- [ ] **Step 9: Add `cleanup()` timer**

60-second interval, remove records completed > 10 minutes ago. Dispose session before removal. Called in the cleanup interval set in constructor.

- [ ] **Step 10: Update `dispose()` to clear cleanup interval and prune worktrees**

- [ ] **Step 11: Write tests for all new methods**

- [ ] **Step 12: Run `pnpm check`, fix issues, commit**

```bash
git add src/core/agent-manager.ts tests/agent-manager.test.ts
git commit -m "feat: extend AgentManager with background execution, concurrency queue, steer, resume"
```

---

### Task 3.8: Register new tools and wire background execution

**Files:**
- Modify: `src/core/subagent.ts`
- Modify: `src/index.ts`
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Remove stubs for `run_in_background`, `resume`, `isolation`**

Delete the three stub `if` blocks (lines ~142-211 in `subagent.ts`).

- [ ] **Step 2: Wire background path in subagent tool handler**

When `params.run_in_background` is true:
1. Call `manager.spawn()` instead of `manager.spawnAndWait()`
2. Set up output file: `createOutputFilePath()`, `writeInitialEntry()`
3. Wire `streamToOutputFile` via the `onSessionCreated` callback
4. Return immediately with agent ID and status

```typescript
if (runInBackground) {
  const id = deps.manager.spawn(ctx, agentDef, {
    ...spawnOptions,
    isBackground: true,
    isolation: params.isolation as "worktree" | undefined,
  });

  const record = deps.manager.getRecord(id);
  // Set up output file, joinMode, toolCallId on the record
  // ...

  return {
    content: [{ type: "text", text:
      `Agent ${record?.status === "queued" ? "queued" : "started"} in background.\n` +
      `Agent ID: ${id}\n` +
      `You will be notified when this agent completes.\n` +
      `Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.`
    }],
    isError: false,
    details: { ...detailBase, status: "background" as const, agentId: id },
  };
}
```

- [ ] **Step 3: Wire resume path**

When `params.resume` is set:
1. Call `manager.resume(params.resume, params.task)`
2. Return the result

- [ ] **Step 4: Wire isolation path**

When `params.isolation === "worktree"`:
1. Pass `isolation: "worktree"` through to `spawn()`/`spawnAndWait()`
2. `startAgent()` in the manager handles worktree creation

- [ ] **Step 5: Register `get_subagent_result` tool in `index.ts`**

Use `pi.registerTool()` with the correct `ToolDefinition` interface:

```typescript
pi.registerTool({
  name: "get_subagent_result",
  label: "Get Agent Result",
  description: "Check status and retrieve results from a background agent.",
  promptSnippet: "Check status and retrieve results from a background agent",
  parameters: Type.Object({
    agent_id: Type.String({ description: "The agent ID to check." }),
    wait: Type.Optional(Type.Boolean({ description: "If true, wait for completion. Default: false." })),
    verbose: Type.Optional(Type.Boolean({ description: "If true, include full conversation. Default: false." })),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const record = deps.manager.getRecord(params.agent_id);
    if (!record) {
      return { content: [{ type: "text", text: `Agent not found: "${params.agent_id}".` }], details: undefined };
    }

    if (params.wait && record.status === "running" && record.promise) {
      record.resultConsumed = true;
      await record.promise;
    }

    // Build status output with stats
    let output = `Agent: ${record.id}\nStatus: ${record.status}\n`;
    if (record.status === "running") {
      output += "Agent is still running. Use wait: true or check back later.";
    } else if (record.status === "error") {
      output += `Error: ${record.error}`;
    } else {
      output += record.result?.trim() || "No output.";
    }

    if (record.status !== "running" && record.status !== "queued") {
      record.resultConsumed = true;
    }

    if (params.verbose && record.session) {
      const conversation = getAgentConversation(record.session);
      if (conversation) output += `\n\n--- Agent Conversation ---\n${conversation}`;
    }

    return { content: [{ type: "text", text: output }], details: undefined };
  },
});
```

- [ ] **Step 6: Register `steer_subagent` tool in `index.ts`**

```typescript
pi.registerTool({
  name: "steer_subagent",
  label: "Steer Agent",
  description: "Send a steering message to a running background agent.",
  promptSnippet: "Send a steering message to redirect a running background agent",
  parameters: Type.Object({
    agent_id: Type.String({ description: "Agent ID to steer." }),
    message: Type.String({ description: "Message to send." }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const record = deps.manager.getRecord(params.agent_id);
    if (!record) {
      return { content: [{ type: "text", text: `Agent not found: "${params.agent_id}".` }], details: undefined };
    }
    if (record.status !== "running" && record.status !== "queued") {
      return { content: [{ type: "text", text: `Agent is not running (status: ${record.status}).` }], details: undefined };
    }

    const success = deps.manager.steer(params.agent_id, params.message);
    if (!success) {
      return { content: [{ type: "text", text: "Failed to steer agent." }], details: undefined };
    }

    pi.events.emit("subagents:steered", { id: record.id, message: params.message });
    return { content: [{ type: "text", text: `Steering message sent to agent ${record.id}.` }], details: undefined };
  },
});
```

- [ ] **Step 7: Register notification renderer**

Use `pi.registerMessageRenderer()` for `"subagent-notification"`:

```typescript
pi.registerMessageRenderer<NotificationDetails>("subagent-notification", (msg, opts, theme) => {
  // Render with status icon, stats, result preview
  // Use theme.fg() for colors, theme.bold() for emphasis
  // Return Text component or undefined
});
```

- [ ] **Step 8: Wire completion callback on AgentManager**

The `onComplete` callback passed to the `AgentManager` constructor should:
1. Skip if `record.resultConsumed` (result already read via `get_subagent_result`)
2. Check `GroupJoinManager.onAgentComplete()` — if `"pass"`, send individual notification
3. Format notification using XML tags (matches tintinweb pattern)
4. Call `pi.sendMessage()` with `{ deliverAs: "followUp", triggerTurn: true }`
5. Emit `pi.events.emit("subagents:completed", ...)` or `"subagents:failed"`
6. Persist record via `pi.appendEntry("subagents:record", ...)`

```typescript
// In index.ts, when creating AgentManager:
const manager = new AgentManager(maxDepth, (record) => {
  const isError = record.status === "error" || record.status === "stopped" || record.status === "aborted";
  pi.events.emit(isError ? "subagents:failed" : "subagents:completed", {
    id: record.id, type: record.type, status: record.status, result: record.result, error: record.error,
  });

  pi.appendEntry("subagents:record", {
    id: record.id, type: record.type, status: record.status, result: record.result,
    startedAt: record.startedAt, completedAt: record.completedAt,
  });

  if (record.resultConsumed) return;

  const joinResult = groupJoin.onAgentComplete(record);
  if (joinResult === "pass") {
    // Send individual notification after 200ms hold (allows get_subagent_result to cancel)
    scheduleNudge(record.id, () => {
      if (record.resultConsumed) return;
      const notification = formatTaskNotification(record);
      pi.sendMessage<NotificationDetails>({
        customType: "subagent-notification",
        content: notification,
        display: true,
        details: buildNotificationDetails(record),
      }, { deliverAs: "followUp", triggerTurn: true });
    });
  }
}, maxConcurrent, (record) => {
  pi.events.emit("subagents:started", { id: record.id, type: record.type });
});
```

- [ ] **Step 9: Add background result rendering to `tui/render.ts`**

When a tool result is for a background spawn, render dimmed "Running in background" with agent ID.

- [ ] **Step 10: Run `pnpm check`, fix issues, commit**

```bash
git add src/core/subagent.ts src/index.ts src/tui/render.ts
git commit -m "feat: register get_subagent_result, steer_subagent tools; wire background execution and notifications"
```

---

### Task 3.9: Wire settings and agents menu

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `src/shared/runtime-deps.ts`

- [ ] **Step 1: Load and apply settings on extension init**

In `registerSubagentsExtension()`:

```typescript
import { loadSettings, applySettings, saveSettings } from "./core/settings.js";

// After creating manager:
let defaultJoinMode: JoinMode = "smart";

const settings = loadSettings(/* cwd from ctx if available, otherwise process.cwd() */);
applySettings(settings, {
  setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
  setDefaultJoinMode: (mode) => { defaultJoinMode = mode; },
});
```

- [ ] **Step 2: Add settings items to agents menu**

Add `maxConcurrent` and `defaultJoinMode` to `SETTINGS_MENU_ITEMS` in `agents-menu.ts`:

```typescript
{
  key: "maxConcurrent",
  promptTitle: "Max Concurrent Background Agents",
  formatValue: (config) => String(manager.getMaxConcurrent()),
  parse: (raw) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? { value: n } : { diagnostic: { reason: "Must be a positive integer" } };
  },
  apply: (value) => { manager.setMaxConcurrent(value as number); },
},
{
  key: "defaultJoinMode",
  promptTitle: "Default Join Mode (async, group, smart)",
  formatValue: () => defaultJoinMode,
  parse: (raw) => {
    const valid = ["async", "group", "smart"];
    return valid.includes(raw) ? { value: raw } : { diagnostic: { reason: "Must be async, group, or smart" } };
  },
  apply: (value) => { defaultJoinMode = value as JoinMode; },
},
```

- [ ] **Step 3: Wire `session_before_switch` event**

Clear completed agents on session switch (but keep running ones):

```typescript
pi.on("session_before_switch", () => {
  manager.clearCompleted();
});
```

- [ ] **Step 4: Update `session_shutdown` to abort running + clear all**

```typescript
pi.on("session_shutdown", () => {
  manager.abortAll();
  manager.dispose();
  groupJoin.dispose();
});
```

- [ ] **Step 5: Run `pnpm check`, fix issues, commit**

```bash
git add src/index.ts src/tui/agents-menu.ts src/shared/runtime-deps.ts
git commit -m "feat: wire settings, lifecycle events, and agents menu for background execution"
```

---

## Notification Format

The notification sent to the parent LLM uses XML tags for structured parsing (matching tintinweb):

```xml
<task-notification>
<task-id>agent-abc123</task-id>
<status>completed</status>
<summary>Agent "scout" completed</summary>
<result>Found 3 files matching the pattern...</result>
<usage><total_tokens>15200</total_tokens><tool_uses>8</tool_uses><duration_ms>45000</duration_ms></usage>
</task-notification>
```

This is sent via:
```typescript
pi.sendMessage<NotificationDetails>({
  customType: "subagent-notification",
  content: notificationXml,
  display: true,
  details: notificationDetails,
}, { deliverAs: "followUp", triggerTurn: true });
```

The `deliverAs: "followUp"` means it waits until the current agent turn completes before delivering. `triggerTurn: true` ensures the parent LLM sees and processes it.

---

## Nudge Scheduling

To prevent duplicate notifications when `get_subagent_result` is called right after completion, use a 200ms hold:

```typescript
const pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();
const NUDGE_HOLD_MS = 200;

function scheduleNudge(key: string, send: () => void) {
  cancelNudge(key);
  pendingNudges.set(key, setTimeout(() => {
    pendingNudges.delete(key);
    try { send(); } catch {}
  }, NUDGE_HOLD_MS));
}

function cancelNudge(key: string) {
  const timer = pendingNudges.get(key);
  if (timer != null) {
    clearTimeout(timer);
    pendingNudges.delete(key);
  }
}
```

In `get_subagent_result`: call `cancelNudge(params.agent_id)` before returning.

---

## Smart Batch Finalization

When multiple agents are spawned in the same tool turn, batch their notifications:

```typescript
let currentBatchAgents: { id: string; joinMode: JoinMode }[] = [];
let batchFinalizeTimer: ReturnType<typeof setTimeout> | undefined;
let batchCounter = 0;

// After each background spawn:
if (joinMode !== "async") {
  currentBatchAgents.push({ id, joinMode });
  if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
  batchFinalizeTimer = setTimeout(finalizeBatch, 100);
}

function finalizeBatch() {
  batchFinalizeTimer = undefined;
  const batch = [...currentBatchAgents];
  currentBatchAgents = [];

  const groupable = batch.filter(a => a.joinMode === "smart" || a.joinMode === "group");
  if (groupable.length >= 2) {
    const groupId = `batch-${++batchCounter}`;
    groupJoin.registerGroup(groupId, groupable.map(a => a.id));
    // Set groupId on each record, check for already-completed agents
  } else {
    // Send individual nudges for any already-completed
  }
}
```

The 100ms debounce captures all agents spawned in a single tool turn (parallel tool calls complete within microseconds).
