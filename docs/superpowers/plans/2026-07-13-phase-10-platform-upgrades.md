# Phase 10: Platform Upgrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the batch `tsc --noEmit` invocation with a full LSP client (JSON-RPC over stdio) for per-file diagnostics, and implement per-tool blocking via the `tool_call` event.

**Architecture:** Task 1 creates a standalone LSP client module that manages a TypeScript language server lifecycle. Task 2 wires the existing `ToolBudgetConfig`/`ResolvedToolBudget` types into a `tool_call` event handler that tracks usage and blocks tools.

**Tech Stack:** TypeScript, Vitest, Node.js child_process (for LSP server spawn), JSON-RPC 2.0 over stdio, Pi SDK Extension API (`pi.on("tool_call", ...)`)

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: Full LSP Client | `src/core/lsp-client.ts` | `src/core/watchdog-lsp.ts`, `src/core/watchdog.ts` | `tests/core/lsp-client.test.ts` |
| 2: Per-Tool Blocking | `src/core/tool-budget-enforcer.ts` | `src/index.ts` | `tests/core/tool-budget-enforcer.test.ts` |

---

### Task 1: Full LSP Client

**Files:**
- Create: `src/core/lsp-client.ts`
- Modify: `src/core/watchdog-lsp.ts:64-106` (add LSP client path)
- Modify: `src/core/watchdog.ts:31-41` (extend LspConfig)
- Test: `tests/core/lsp-client.test.ts`

- [ ] **Step 1: Write the failing test for JSON-RPC framing**

Create `tests/core/lsp-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { encodeJsonRpcMessage, decodeJsonRpcMessages, type JsonRpcMessage } from "../src/core/lsp-client.js";

describe("JSON-RPC framing", () => {
  it("encodes a message with Content-Length header", () => {
    const msg: JsonRpcMessage = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    const encoded = encodeJsonRpcMessage(msg);
    const body = JSON.stringify(msg);
    expect(encoded.toString("utf-8")).toBe(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });

  it("decodes a single message from buffer", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
    const raw = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const { messages, remaining } = decodeJsonRpcMessages(Buffer.from(raw));
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(1);
    expect(remaining.length).toBe(0);
  });

  it("handles partial message (returns nothing, keeps buffer)", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const raw = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 5)}`;
    const { messages, remaining } = decodeJsonRpcMessages(Buffer.from(raw));
    expect(messages).toHaveLength(0);
    expect(remaining.length).toBeGreaterThan(0);
  });

  it("decodes multiple messages from single buffer", () => {
    const msg1 = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const msg2 = JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} });
    const raw = `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n${msg1}Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n${msg2}`;
    const { messages } = decodeJsonRpcMessages(Buffer.from(raw));
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(1);
    expect(messages[1].id).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JSON-RPC framing**

Create `src/core/lsp-client.ts`:

```typescript
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function encodeJsonRpcMessage(msg: JsonRpcMessage): Buffer {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  return Buffer.from(header + body);
}

export function decodeJsonRpcMessages(buffer: Buffer): { messages: JsonRpcMessage[]; remaining: Buffer } {
  const messages: JsonRpcMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n", offset);
    if (headerEnd === -1) break;

    const headerStr = buffer.subarray(offset, headerEnd).toString("utf-8");
    const match = headerStr.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (bodyStart + contentLength > buffer.length) break;

    const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf-8");
    try {
      messages.push(JSON.parse(body) as JsonRpcMessage);
    } catch { break; }

    offset = bodyStart + contentLength;
  }

  return { messages, remaining: buffer.subarray(offset) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Write the failing test for LspClient lifecycle**

Add to `tests/core/lsp-client.test.ts`:

```typescript
import { LspClient } from "../src/core/lsp-client.js";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("LspClient lifecycle", () => {
  it("starts, initializes, and shuts down", async () => {
    // This test requires tsserver to be available
    const tmpDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
    writeFileSync(join(tmpDir, "tsconfig.json"), '{"compilerOptions":{"strict":true}}');
    writeFileSync(join(tmpDir, "test.ts"), "const x: number = 'hello';");

    const client = new LspClient(tmpDir);
    const started = await client.start();
    if (!started) {
      // tsserver not available in test env — skip
      rmSync(tmpDir, { recursive: true, force: true });
      return;
    }

    const diagnostics = await client.getDiagnostics(join(tmpDir, "test.ts"));
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("Type");

    await client.shutdown();
    rmSync(tmpDir, { recursive: true, force: true });
  }, 30_000);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: FAIL — `LspClient` not exported

- [ ] **Step 7: Implement LspClient class**

Add to `src/core/lsp-client.ts`:

```typescript
export interface LspDiagnosticResult {
  file: string;
  line: number;
  character: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: string | number;
}

export class LspClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private readonly cwd: string;
  private initialized = false;

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
  }

  async start(): Promise<boolean> {
    const tsserverPath = this.findTsserver();
    if (!tsserverPath) return false;

    this.proc = spawn("node", [tsserverPath, "--stdio"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.on("exit", () => { this.proc = null; });

    // Send initialize request
    const result = await this.request("initialize", {
      processId: process.pid,
      rootUri: `file://${this.cwd}`,
      capabilities: {
        textDocument: { publishDiagnostics: { relatedInformation: true } },
      },
    });

    if (result) {
      await this.notify("initialized", {});
      this.initialized = true;
      return true;
    }
    return false;
  }

  async getDiagnostics(filePath: string): Promise<LspDiagnosticResult[]> {
    if (!this.initialized) return [];

    // Open file
    const uri = `file://${filePath}`;
    await this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "typescript", version: 1, text: "" },
    });

    // Request diagnostics (wait for response)
    const response = await this.request("textDocument/diagnostic", {
      textDocument: { uri },
    }) as { items?: Array<{ range: { start: { line: number; character: number } }; severity?: number; message: string; code?: unknown }> } | undefined;

    if (!response?.items) return [];

    return response.items.map((d) => ({
      file: filePath,
      line: d.range.start.line + 1,
      character: d.range.start.character,
      severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : d.severity === 3 ? "info" : "hint",
      message: d.message,
      code: d.code != null ? String(d.code) : undefined,
    }));
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    await this.request("shutdown", null);
    this.notify("exit", null);
    this.proc.kill();
    this.proc = null;
    this.initialized = false;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(msg);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request ${method} timed out`));
        }
      }, 30_000);
    });
  }

  private notify(method: string, params: unknown): void {
    const msg: JsonRpcMessage = { jsonrpc: "2.0", method, params };
    this.send(msg);
  }

  private send(msg: JsonRpcMessage): void {
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(encodeJsonRpcMessage(msg));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { messages, remaining } = decodeJsonRpcMessages(this.buffer);
    this.buffer = remaining;
    for (const msg of messages) {
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        resolve(msg.result);
      } else if (msg.method) {
        this.emit("notification", msg);
      }
    }
  }

  private findTsserver(): string | undefined {
    const { existsSync } = require("node:fs");
    const { join } = require("node:path");
    const local = join(this.cwd, "node_modules", "typescript", "lib", "tsserver.js");
    if (existsSync(local)) return local;
    try {
      const { execSync } = require("node:child_process");
      const globalPath = execSync("which tsserver", { encoding: "utf-8" }).trim();
      if (globalPath) return globalPath;
    } catch { /* not found */ }
    return undefined;
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: PASS (or skipped if tsserver not available)

- [ ] **Step 9: Wire LspClient into watchdog-lsp.ts as alternative path**

In `src/core/watchdog-lsp.ts`, add:

```typescript
import { LspClient } from "./lsp-client.js";

let persistentClient: LspClient | undefined;

/**
 * Collect diagnostics using persistent LSP client (preferred) or fallback to tsc --noEmit.
 */
export async function collectLspDiagnosticsV2(
  cwd: string,
  changedPaths: string[],
  config: LspConfig,
): Promise<LspResult> {
  const tsFiles = changedPaths.filter((p) => TS_JS_EXTENSIONS.has(extname(p)));
  if (tsFiles.length === 0) return { status: "ok", diagnostics: [] };

  // Try persistent LSP client first
  if (!persistentClient) {
    persistentClient = new LspClient(cwd);
    const started = await persistentClient.start();
    if (!started) {
      persistentClient = undefined;
      // Fallback to batch tsc
      return collectLspDiagnostics(cwd, changedPaths, config);
    }
  }

  const allDiagnostics: LspDiagnostic[] = [];
  for (const file of tsFiles.slice(0, config.maxFiles)) {
    const fileDiags = await persistentClient.getDiagnostics(file);
    for (const d of fileDiags) {
      if (d.severity === "error" || d.severity === "warning") {
        allDiagnostics.push({
          file: d.file,
          line: d.line,
          severity: d.severity,
          message: d.message,
          code: d.code != null ? String(d.code) : undefined,
        });
      }
    }
    if (allDiagnostics.length >= config.maxDiagnostics) break;
  }

  return { status: "ok", diagnostics: allDiagnostics.slice(0, config.maxDiagnostics) };
}

export function disposeLspClient(): void {
  persistentClient?.shutdown().catch(() => {});
  persistentClient = undefined;
}
```

- [ ] **Step 10: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 11: Commit**

```bash
git add src/core/lsp-client.ts src/core/watchdog-lsp.ts tests/core/lsp-client.test.ts
git commit -m "feat(lsp): add full LSP client with JSON-RPC framing over stdio

Persistent server lifecycle with per-file diagnostics.
Falls back to batch tsc --noEmit if tsserver unavailable."
```

---

### Task 2: Per-Tool Blocking

**Files:**
- Create: `src/core/tool-budget-enforcer.ts`
- Modify: `src/index.ts:514-541` (add tool_call event handler)
- Test: `tests/core/tool-budget-enforcer.test.ts`

- [ ] **Step 1: Write the failing test for budget tracking**

Create `tests/core/tool-budget-enforcer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ToolBudgetEnforcer } from "../src/core/tool-budget-enforcer.js";
import type { ResolvedToolBudget } from "../src/shared/types.js";

describe("ToolBudgetEnforcer", () => {
  it("allows tools below hard limit", () => {
    const budget: ResolvedToolBudget = { hard: 10, block: [] };
    const enforcer = new ToolBudgetEnforcer(budget);
    const result = enforcer.check("read_file");
    expect(result.allowed).toBe(true);
  });

  it("blocks at hard limit", () => {
    const budget: ResolvedToolBudget = { hard: 2, block: [] };
    const enforcer = new ToolBudgetEnforcer(budget);
    enforcer.recordUse("read_file");
    enforcer.recordUse("read_file");
    const result = enforcer.check("read_file");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("hard limit");
  });

  it("warns at soft limit", () => {
    const budget: ResolvedToolBudget = { soft: 2, hard: 5, block: [] };
    const enforcer = new ToolBudgetEnforcer(budget);
    enforcer.recordUse("read_file");
    enforcer.recordUse("read_file");
    const result = enforcer.check("read_file");
    expect(result.allowed).toBe(true);
    expect(result.warning).toContain("soft limit");
  });

  it("blocks specific tools from block list", () => {
    const budget: ResolvedToolBudget = { hard: 100, block: ["exec_command", "write_file"] };
    const enforcer = new ToolBudgetEnforcer(budget);
    expect(enforcer.check("exec_command").allowed).toBe(false);
    expect(enforcer.check("read_file").allowed).toBe(true);
  });

  it("blocks all tools when block is '*'", () => {
    const budget: ResolvedToolBudget = { hard: 100, block: "*" };
    const enforcer = new ToolBudgetEnforcer(budget);
    expect(enforcer.check("read_file").allowed).toBe(false);
    expect(enforcer.check("exec_command").allowed).toBe(false);
  });

  it("tracks usage count", () => {
    const budget: ResolvedToolBudget = { hard: 10, block: [] };
    const enforcer = new ToolBudgetEnforcer(budget);
    enforcer.recordUse("read_file");
    enforcer.recordUse("write_file");
    enforcer.recordUse("read_file");
    expect(enforcer.usage).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/tool-budget-enforcer.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ToolBudgetEnforcer**

Create `src/core/tool-budget-enforcer.ts`:

```typescript
import type { ResolvedToolBudget } from "../shared/types.js";

export interface ToolCheckResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
}

export class ToolBudgetEnforcer {
  private readonly budget: ResolvedToolBudget;
  private _usage = 0;

  constructor(budget: ResolvedToolBudget) {
    this.budget = budget;
  }

  get usage(): number {
    return this._usage;
  }

  /**
   * Check if a tool call should be allowed.
   */
  check(toolName: string): ToolCheckResult {
    // Check block list first
    if (this.budget.block === "*") {
      return { allowed: false, reason: `Tool "${toolName}" is blocked (all tools blocked by budget)` };
    }
    if (Array.isArray(this.budget.block) && this.budget.block.includes(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is explicitly blocked by budget` };
    }

    // Check hard limit
    if (this._usage >= this.budget.hard) {
      return { allowed: false, reason: `Tool budget hard limit reached (${this._usage}/${this.budget.hard})` };
    }

    // Check soft limit (warn but allow)
    if (this.budget.soft !== undefined && this._usage >= this.budget.soft) {
      return { allowed: true, warning: `Tool budget soft limit reached (${this._usage}/${this.budget.soft}). Consider wrapping up.` };
    }

    return { allowed: true };
  }

  /**
   * Record a tool use.
   */
  recordUse(toolName: string): void {
    this._usage++;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/tool-budget-enforcer.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Wire tool_call event handler in index.ts**

In `src/index.ts`, after the `tool_execution_start` event handler (around line 520), add:

```typescript
// Per-tool budget enforcement
const agentEnforcers = new Map<string, ToolBudgetEnforcer>();

pi.on("tool_call", (event, block) => {
  const agentId = (event as { agentId?: string }).agentId;
  if (!agentId) return; // Only enforce for subagents

  const record = deps.manager.getAgents().get(agentId);
  if (!record?.invocation) return;

  // Lazily create enforcer from the record's tool budget
  if (!agentEnforcers.has(agentId)) {
    const budget = (record as { toolBudget?: ResolvedToolBudget }).toolBudget;
    if (!budget) return;
    const { ToolBudgetEnforcer } = require("./core/tool-budget-enforcer.js");
    agentEnforcers.set(agentId, new ToolBudgetEnforcer(budget));
  }

  const enforcer = agentEnforcers.get(agentId);
  if (!enforcer) return;

  const toolName = (event as { toolName?: string }).toolName ?? "";
  const result = enforcer.check(toolName);

  if (!result.allowed) {
    block(result.reason ?? "Tool budget exceeded");
    return;
  }

  if (result.warning) {
    // Emit warning as steering message
    deps.manager.steer(agentId, `[budget warning] ${result.warning}`);
  }

  enforcer.recordUse(toolName);
});
```

Add import at top of `src/index.ts`:

```typescript
import { ToolBudgetEnforcer } from "./core/tool-budget-enforcer.js";
```

- [ ] **Step 6: Clean up enforcer when agent completes**

In the agent completion handler (around line 189):

```typescript
agentEnforcers.delete(record.id);
```

- [ ] **Step 7: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/tool-budget-enforcer.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/core/tool-budget-enforcer.ts src/index.ts tests/core/tool-budget-enforcer.test.ts
git commit -m "feat: add per-tool blocking via tool_call event with budget enforcement

Tracks tool usage per agent, blocks when hard limit reached,
warns at soft limit. Supports explicit block lists and wildcard."
```

---

### Task 3: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npx eslint src/ tests/ --ext .ts`
Expected: No new errors
