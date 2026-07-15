# Phase 10: Platform Upgrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the batch `tsc --noEmit` invocation with a proper LSP client (JSON-RPC over stdio via `typescript-language-server`) for per-file diagnostics, and add parent-session tool interception via the `tool_call` event using correct Pi SDK APIs.

**Architecture:** Task 1 creates a JSON-RPC LSP client that spawns `typescript-language-server --stdio` (NOT raw tsserver — which uses a non-LSP protocol) and collects diagnostics via push-based `textDocument/publishDiagnostics` notifications. Task 2 wires a `pi.on("tool_call")` handler for the parent session using the existing `evaluateToolCall()` function from `tool-budget.ts`, with the correct return-value blocking API (`{ block: true, reason }`, not a callback).

**Reference:** nicobailon-pi-subagents `src/watchdog/lsp-diagnostics.ts` (LSP client), `src/runs/shared/subagent-prompt-runtime.ts` (tool_call handler).

**Key differences from subagent budget enforcement:** Subagent tool budgets are already enforced in `agent-runner.ts` via `session.subscribe("tool_execution_start")`. Task 2 adds a *separate* parent-session layer using `pi.on("tool_call")` — these are complementary, not redundant.

**Tech Stack:** TypeScript, Vitest, Node.js child_process (for LSP server spawn), JSON-RPC 2.0 over stdio, Pi SDK Extension API (`pi.on("tool_call", ...)`)

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: LSP Client | `src/core/lsp-client.ts` | `src/core/watchdog-lsp.ts` | `tests/core/lsp-client.test.ts` |
| 2: Parent Tool Interception | — | `src/index.ts` | `tests/core/tool-budget.test.ts` (extend) |

---

### Task 1: LSP Client for Per-File Diagnostics

**What:** Replace `execFileSync(tsc, ["--noEmit"])` with a proper LSP client that speaks JSON-RPC 2.0 over stdio to `typescript-language-server`. Diagnostics come via push notifications (`textDocument/publishDiagnostics`), not pull requests.

**Why raw tsserver won't work:** `tsserver.js` uses its own protocol (newline-delimited JSON with sequence numbers), NOT standard LSP with Content-Length framing. The `typescript-language-server` npm package wraps tsserver and speaks proper LSP.

**Files:**
- Create: `src/core/lsp-client.ts`
- Modify: `src/core/watchdog-lsp.ts` (add LSP client path alongside existing tsc fallback)
- Test: `tests/core/lsp-client.test.ts`

- [ ] **Step 1: Write the failing test for JSON-RPC framing**

Create `tests/core/lsp-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { encodeJsonRpc, decodeJsonRpcMessages, type JsonRpcMessage } from "../src/core/lsp-client.js";

describe("JSON-RPC framing", () => {
  it("encodes a message with Content-Length header", () => {
    const msg: JsonRpcMessage = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    const encoded = encodeJsonRpc(msg);
    const body = JSON.stringify(msg);
    expect(encoded).toBe(`Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`);
  });

  it("decodes a single message from buffer", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
    const raw = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    const { messages, remaining } = decodeJsonRpcMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(1);
    expect(remaining.length).toBe(0);
  });

  it("handles partial message (returns nothing, keeps buffer)", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const raw = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 5)}`);
    const { messages, remaining } = decodeJsonRpcMessages(raw);
    expect(messages).toHaveLength(0);
    expect(remaining.length).toBeGreaterThan(0);
  });

  it("decodes multiple messages from single buffer", () => {
    const msg1 = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const msg2 = JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} });
    const raw = Buffer.from(
      `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n${msg1}` +
      `Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n${msg2}`,
    );
    const { messages } = decodeJsonRpcMessages(raw);
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(1);
    expect(messages[1].id).toBe(2);
  });

  it("skips headers without Content-Length", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const raw = Buffer.from(
      `X-Custom: foo\r\n\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
    const { messages } = decodeJsonRpcMessages(raw);
    expect(messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JSON-RPC framing + LspClient**

Create `src/core/lsp-client.ts`:

```typescript
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

// ─── JSON-RPC framing ────────────────────────────────────────────────────────

export type JsonRpcId = number | string;

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number };
}

/** Encode a JSON-RPC message with Content-Length header for LSP stdio transport. */
export function encodeJsonRpc(msg: JsonRpcMessage): string {
  const body = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;
}

/** Decode zero or more JSON-RPC messages from a buffer. Returns parsed messages and leftover bytes. */
export function decodeJsonRpcMessages(buffer: Buffer): { messages: JsonRpcMessage[]; remaining: Buffer } {
  const messages: JsonRpcMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n", offset);
    if (headerEnd === -1) break;

    const header = buffer.subarray(offset, headerEnd).toString("utf-8");
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      // Skip unrecognized header block
      offset = headerEnd + 4;
      continue;
    }

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) break; // incomplete body

    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf-8");
    offset = bodyEnd;

    try {
      messages.push(JSON.parse(body) as JsonRpcMessage);
    } catch {
      // malformed JSON — skip this message
    }
  }

  return { messages, remaining: buffer.subarray(offset) };
}

// ─── LSP Client ──────────────────────────────────────────────────────────────

const PROVIDER_NAME = "typescript-language-server";
const SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_STDERR_LENGTH = 4096;

interface LspCommand {
  command: string;
  args: string[];
  label: string;
}

export interface LspDiagnosticEntry {
  file: string;
  line: number;
  severity: "error" | "warning";
  message: string;
  code?: string;
}

export interface LspCollectResult {
  status: "ok" | "unavailable" | "timeout" | "failed";
  provider?: string;
  diagnostics: LspDiagnosticEntry[];
  message?: string;
}

/** Resolve typescript-language-server binary: project-local first, then PATH. */
export function resolveLanguageServer(root: string): LspCommand | undefined {
  // Check project-local node_modules/.bin
  const local = join(root, "node_modules", ".bin", PROVIDER_NAME);
  if (existsSync(local)) {
    return { command: local, args: ["--stdio"], label: `${PROVIDER_NAME} (project)` };
  }
  // Check PATH
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(dir, PROVIDER_NAME);
    if (existsSync(candidate)) {
      return { command: candidate, args: ["--stdio"], label: PROVIDER_NAME };
    }
  }
  return undefined;
}

/**
 * Low-level JSON-RPC client over stdio.
 * Handles Content-Length framing, request/response correlation, and notification dispatch.
 */
export class JsonRpcLspClient {
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private readonly pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** Diagnostics received via textDocument/publishDiagnostics, keyed by URI. */
  readonly diagnostics = new Map<string, unknown[]>();
  private readonly child: ChildProcessWithoutNullStreams;
  private stderr = "";
  private exited = false;
  private readonly exitWaiters: Array<() => void> = [];

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf-8")}`.slice(-MAX_STDERR_LENGTH);
    });
    child.on("error", (error) => {
      this.exited = true;
      this.rejectPending(error);
      this.resolveExitWaiters();
    });
    child.on("exit", (_code, _signal) => {
      this.exited = true;
      this.rejectPending(new Error("language server exited"));
      this.resolveExitWaiters();
    });
  }

  /** Send an LSP request and wait for the response. */
  request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
    return withTimeout(promise, timeoutMs, `${method} timed out`, signal);
  }

  /** Send an LSP notification (no response expected). */
  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Graceful shutdown: send shutdown request, then exit notification. */
  async shutdown(): Promise<void> {
    if (this.exited) return;
    try {
      await this.request("shutdown", null, SHUTDOWN_TIMEOUT_MS);
      this.notify("exit", null);
    } catch {
      this.child.kill("SIGTERM");
    }
    await this.waitForExit(SHUTDOWN_TIMEOUT_MS);
  }

  kill(): void {
    if (!this.exited) this.child.kill("SIGTERM");
  }

  stderrTail(): string {
    return this.stderr.trim();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private send(payload: JsonRpcMessage): void {
    if (this.exited) throw new Error("language server already exited");
    this.child.stdin.write(encodeJsonRpc(payload));
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = this.stdoutBuffer.subarray(0, headerEnd).toString("utf-8");
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        this.stdoutBuffer = this.stdoutBuffer.subarray(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.stdoutBuffer.length < bodyEnd) return;

      const body = this.stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf-8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyEnd);

      try {
        this.handleMessage(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // malformed response — skip
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    // Handle push diagnostics
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: unknown; diagnostics?: unknown } | undefined;
      if (typeof params?.uri === "string" && Array.isArray(params.diagnostics)) {
        this.diagnostics.set(params.uri, params.diagnostics);
      }
      return;
    }

    // Handle request responses
    if (message.id != null && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message ?? `LSP error ${message.error.code}`));
      } else {
        resolve(message.result);
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const [, { reject }] of this.pending) reject(error);
    this.pending.clear();
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.exitWaiters.push(resolve);
      setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, timeoutMs);
    });
  }

  private resolveExitWaiters(): void {
    for (const waiter of this.exitWaiters) waiter();
    this.exitWaiters.length = 0;
  }
}

// ─── High-level collect function ─────────────────────────────────────────────

const TS_JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

interface TargetFile {
  absPath: string;
  relPath: string;
  uri: string;
  languageId: string;
}

function languageIdForExt(ext: string): string {
  if (ext === ".tsx" || ext === ".jsx") return "typescriptreact";
  if (ext === ".js" || ext === ".mjs") return "javascript";
  return "typescript";
}

function buildTargets(root: string, changedPaths: string[], maxFiles: number): { targets: TargetFile[]; skippedPaths: string[] } {
  const tsFiles = changedPaths.filter((p) => TS_JS_EXTENSIONS.has(extname(p)));
  const targets = tsFiles.slice(0, maxFiles).map((relPath) => {
    const absPath = join(root, relPath);
    return {
      absPath,
      relPath,
      uri: pathToFileURL(absPath).href,
      languageId: languageIdForExt(extname(relPath)),
    };
  });
  return { targets, skippedPaths: tsFiles.slice(maxFiles) };
}

function initializeParams(rootUri: string) {
  return {
    processId: process.pid,
    rootUri,
    capabilities: {
      textDocument: {
        publishDiagnostics: { relatedInformation: true },
      },
    },
    workspaceFolders: [{ uri: rootUri, name: "workspace" }],
  };
}

/** Severity number from LSP spec → string label. */
function severityLabel(sev: number | undefined): "error" | "warning" {
  return sev === 1 ? "error" : "warning";
}

/**
 * Convert raw LSP diagnostics for one file into structured entries.
 * Filters to errors and warnings only.
 */
function convertDiagnostics(target: TargetFile, raw: unknown[]): LspDiagnosticEntry[] {
  const entries: LspDiagnosticEntry[] = [];
  for (const d of raw) {
    const diag = d as { range?: { start?: { line?: number } }; severity?: number; message?: string; code?: unknown };
    const sev = diag.severity;
    if (sev !== undefined && sev > 2) continue; // skip info/hint
    entries.push({
      file: target.relPath,
      line: (diag.range?.start?.line ?? 0) + 1,
      severity: severityLabel(sev),
      message: diag.message ?? "",
      code: diag.code != null ? String(diag.code) : undefined,
    });
  }
  return entries;
}

/** Poll until all target URIs have received publishDiagnostics. */
async function waitForDiagnostics(
  client: JsonRpcLspClient,
  targets: TargetFile[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const started = Date.now();
  while (!signal?.aborted && Date.now() - started < timeoutMs) {
    if (targets.every((t) => client.diagnostics.has(t.uri))) return true;
    await new Promise((r) => setTimeout(r, Math.min(50, Math.max(1, timeoutMs - (Date.now() - started)))));
  }
  return targets.every((t) => client.diagnostics.has(t.uri));
}

export interface LspCollectConfig {
  timeoutMs: number;
  maxFiles: number;
  maxDiagnostics: number;
}

/**
 * Collect TypeScript diagnostics using typescript-language-server.
 *
 * Lifecycle: spawn → initialize → didOpen+didSave per file → wait for
 * publishDiagnostics → collect → shutdown.
 */
export async function collectWithLanguageServer(
  root: string,
  changedPaths: string[],
  config: LspCollectConfig,
  signal?: AbortSignal,
): Promise<LspCollectResult> {
  const command = resolveLanguageServer(root);
  if (!command) return { status: "unavailable", diagnostics: [] };

  const { targets, skippedPaths } = buildTargets(root, changedPaths, config.maxFiles);
  if (targets.length === 0) return { status: "ok", diagnostics: [] };

  const started = Date.now();
  const remaining = () => Math.max(1, config.timeoutMs - (Date.now() - started));

  const child = spawn(command.command, command.args, {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const client = new JsonRpcLspClient(child);
  const abort = () => client.kill();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const rootUri = pathToFileURL(root).href;
    await client.request("initialize", initializeParams(rootUri), remaining(), signal);
    client.notify("initialized", {});

    // Open and save each target file so the server analyzes them
    for (const target of targets) {
      let text: string;
      try {
        text = readFileSync(target.absPath, "utf-8");
      } catch {
        continue; // file may have been deleted between diff and now
      }
      client.notify("textDocument/didOpen", {
        textDocument: { uri: target.uri, languageId: target.languageId, version: 1, text },
      });
      client.notify("textDocument/didSave", {
        textDocument: { uri: target.uri },
        text,
      });
    }

    // Wait for server to push diagnostics for all opened files
    const complete = await waitForDiagnostics(client, targets, remaining(), signal);

    const diagnostics = targets
      .flatMap((target) => convertDiagnostics(target, (client.diagnostics.get(target.uri) as unknown[]) ?? []))
      .slice(0, config.maxDiagnostics);

    return {
      status: complete ? "ok" : "timeout",
      provider: command.label,
      diagnostics,
      ...(complete ? {} : { message: `Timed out waiting ${config.timeoutMs}ms for LSP diagnostics.` }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = message.includes("timed out") || message === "aborted";
    const stderr = client.stderrTail();
    return {
      status: timedOut ? "timeout" : "failed",
      provider: command.label,
      diagnostics: [],
      message: stderr ? `${message}; ${stderr}` : message,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    await client.shutdown();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    const onAbort = () => reject(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}
```

- [ ] **Step 4: Run test to verify framing passes**

Run: `npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: PASS (framing tests are pure logic, no server needed)

- [ ] **Step 5: Write integration test for LSP lifecycle**

Add to `tests/core/lsp-client.test.ts`:

```typescript
import { resolveLanguageServer, collectWithLanguageServer } from "../src/core/lsp-client.js";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("collectWithLanguageServer", () => {
  it("collects diagnostics from a file with a type error", async () => {
    const command = resolveLanguageServer(process.cwd());
    if (!command) {
      console.log("typescript-language-server not found, skipping");
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
    try {
      writeFileSync(join(tmpDir, "tsconfig.json"), '{"compilerOptions":{"strict":true}}');
      writeFileSync(join(tmpDir, "bad.ts"), "const x: number = 'hello';");

      const result = await collectWithLanguageServer(
        tmpDir,
        ["bad.ts"],
        { timeoutMs: 30_000, maxFiles: 10, maxDiagnostics: 50 },
      );

      expect(result.status).toBe("ok");
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
      expect(result.diagnostics[0].file).toBe("bad.ts");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("returns unavailable when no language server found", async () => {
    const result = await collectWithLanguageServer(
      "/nonexistent",
      ["foo.ts"],
      { timeoutMs: 5_000, maxFiles: 10, maxDiagnostics: 50 },
    );
    expect(result.status).toBe("unavailable");
  });

  it("returns ok with empty diagnostics for clean files", async () => {
    const command = resolveLanguageServer(process.cwd());
    if (!command) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
    try {
      writeFileSync(join(tmpDir, "tsconfig.json"), '{"compilerOptions":{"strict":true}}');
      writeFileSync(join(tmpDir, "good.ts"), "const x: number = 42;");

      const result = await collectWithLanguageServer(
        tmpDir,
        ["good.ts"],
        { timeoutMs: 30_000, maxFiles: 10, maxDiagnostics: 50 },
      );

      expect(result.status).toBe("ok");
      expect(result.diagnostics).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
```

- [ ] **Step 6: Run full test suite for lsp-client**

Run: `npx vitest run tests/core/lsp-client.test.ts --reporter=verbose`
Expected: PASS (integration tests skip gracefully if typescript-language-server not available)

- [ ] **Step 7: Wire LSP client into watchdog-lsp.ts as preferred path**

In `src/core/watchdog-lsp.ts`, add the new `collectWithLanguageServer` as the preferred path, falling back to batch `tsc --noEmit` when `typescript-language-server` is not available.

Add import and new function after the existing `collectLspDiagnostics`:

```typescript
import { collectWithLanguageServer, type LspCollectResult as LspClientResult } from "./lsp-client.js";

/**
 * Collect diagnostics using typescript-language-server (preferred) or tsc --noEmit (fallback).
 *
 * The LSP path gives per-file incremental diagnostics without a full project recompile.
 * Falls back to batch tsc when typescript-language-server is unavailable.
 */
export async function collectDiagnostics(
  cwd: string,
  changedPaths: string[],
  config: LspConfig,
): Promise<LspResult> {
  // Try LSP client first
  const lspResult = await collectWithLanguageServer(cwd, changedPaths, {
    timeoutMs: config.timeoutMs,
    maxFiles: config.maxFiles,
    maxDiagnostics: config.maxDiagnostics,
  });

  if (lspResult.status !== "unavailable") {
    return {
      status: lspResult.status,
      diagnostics: lspResult.diagnostics.map((d) => ({
        file: d.file,
        line: d.line,
        severity: d.severity,
        message: d.message,
        code: d.code,
      })),
    };
  }

  // Fallback to batch tsc --noEmit
  return collectLspDiagnostics(cwd, changedPaths, config);
}
```

- [ ] **Step 8: Update watchdog.ts to use new entry point**

In `src/core/watchdog.ts`, change the dynamic import (around line 387) from:

```typescript
const { collectLspDiagnostics } = await import("./watchdog-lsp.js");
const lspResult = await collectLspDiagnostics(cwd, signature.changedPaths, config.lsp);
```

to:

```typescript
const { collectDiagnostics } = await import("./watchdog-lsp.js");
const lspResult = await collectDiagnostics(cwd, signature.changedPaths, config.lsp);
```

- [ ] **Step 9: Run typecheck and full tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 10: Commit**

```bash
git add src/core/lsp-client.ts src/core/watchdog-lsp.ts src/core/watchdog.ts tests/core/lsp-client.test.ts
git commit -m "feat(lsp): add LSP client via typescript-language-server for per-file diagnostics

JSON-RPC 2.0 over stdio with Content-Length framing.
Diagnostics via push-based textDocument/publishDiagnostics.
Falls back to batch tsc --noEmit when language server unavailable."
```

---

### Task 2: Parent-Session Tool Interception via `tool_call` Event

**What:** Register a `pi.on("tool_call")` handler for the parent session that can intercept and block tool calls before execution. This uses the Pi SDK's return-value blocking API (return `{ block: true, reason }` to block, or `undefined`/void to allow).

**Why not a new class:** The existing `evaluateToolCall()` in `tool-budget.ts` already has the evaluation logic. We reuse it directly — no new `ToolBudgetEnforcer` class needed.

**Scope clarification:** `pi.on("tool_call")` fires for the parent session only, NOT for child subagent sessions created via `createAgentSession()`. Subagent tool budgets are enforced separately in `agent-runner.ts` via `session.subscribe("tool_execution_start")`. This task adds a complementary parent-level layer.

**Pi SDK API (verified from `@earendil-works/pi-coding-agent` types):**
```typescript
// Handler signature:
pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) =>
  ToolCallEventResult | void | Promise<ToolCallEventResult | void>);

// ToolCallEvent: { type: "tool_call", toolCallId: string, toolName: string, input: ... }
// ToolCallEventResult: { block?: boolean, reason?: string }
```

**Files:**
- Modify: `src/index.ts` (add `tool_call` handler)
- Extend: `tests/core/tool-budget.test.ts` (if exists, otherwise ensure existing tests cover evaluateToolCall)

- [ ] **Step 1: Verify evaluateToolCall tests exist**

Check that `tests/core/tool-budget.test.ts` exists and covers the evaluation logic.
If not, write tests for `evaluateToolCall` matching the existing API:

```typescript
import { describe, it, expect } from "vitest";
import { evaluateToolCall } from "../src/core/tool-budget.js";
import type { ResolvedToolBudget } from "../src/shared/types.js";

describe("evaluateToolCall", () => {
  it("returns within-budget below limits", () => {
    const budget: ResolvedToolBudget = { hard: 10, block: ["read"] };
    expect(evaluateToolCall(budget, 5, "read").outcome).toBe("within-budget");
  });

  it("returns soft-reached at soft limit", () => {
    const budget: ResolvedToolBudget = { soft: 3, hard: 10, block: ["read"] };
    const result = evaluateToolCall(budget, 3, "read");
    expect(result.outcome).toBe("soft-reached");
    expect(result.message).toBeDefined();
  });

  it("returns hard-blocked for blocked tool past hard limit", () => {
    const budget: ResolvedToolBudget = { hard: 5, block: ["read"] };
    const result = evaluateToolCall(budget, 6, "read");
    expect(result.outcome).toBe("hard-blocked");
    expect(result.message).toContain("read");
  });

  it("allows non-blocked tools past hard limit", () => {
    const budget: ResolvedToolBudget = { hard: 5, block: ["read"] };
    const result = evaluateToolCall(budget, 6, "bash");
    expect(result.outcome).not.toBe("hard-blocked");
  });

  it("blocks all tools when block is '*'", () => {
    const budget: ResolvedToolBudget = { hard: 5, block: "*" };
    const result = evaluateToolCall(budget, 6, "bash");
    expect(result.outcome).toBe("hard-blocked");
  });
});
```

- [ ] **Step 2: Run test to verify**

Run: `npx vitest run tests/core/tool-budget.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Wire `tool_call` handler in index.ts**

In `src/index.ts`, after the `tool_execution_start` handler (after line 622), add the `tool_call` handler. This provides parent-session budget enforcement that can truly block tools before execution (as opposed to the steer+abort approach used for subagents).

```typescript
// Parent-session tool interception: block tools when a session-level budget is configured.
// This is complementary to subagent budgets in agent-runner.ts — it covers the parent agent.
let parentToolCount = 0;
let parentSoftNudged = false;
const parentBudget = deps.config?.toolBudget as ResolvedToolBudget | undefined;

if (parentBudget) {
  pi.on("tool_call", (event, _ctx) => {
    const toolName = event.toolName;
    parentToolCount++;

    const result = evaluateToolCall(parentBudget, parentToolCount, toolName);

    if (result.outcome === "hard-blocked") {
      return { block: true, reason: result.message ?? "Tool budget hard limit reached." };
    }

    if (result.outcome === "soft-reached" && !parentSoftNudged) {
      parentSoftNudged = true;
      // Soft nudge via steer — tool still executes
      try {
        (pi as { sendUserMessage?: (content: string, options: { deliverAs: "steer" }) => unknown })
          .sendUserMessage?.(result.message ?? "Tool budget soft limit reached.", { deliverAs: "steer" });
      } catch {
        // Advisory — don't fail the tool call
      }
    }

    return undefined; // allow
  });
}
```

Add import at top of `src/index.ts`:

```typescript
import { evaluateToolCall } from "./core/tool-budget.js";
import type { ResolvedToolBudget } from "./shared/types.js";
```

Note: `deps.config?.toolBudget` — verify where the parent budget config lives. If no parent budget config exists yet, add it to the extension config schema. The handler is only registered when a budget is configured.

- [ ] **Step 4: Reset parent budget on session switch**

In the `session_before_switch` handler (around line 640), reset the parent budget counter:

```typescript
parentToolCount = 0;
parentSoftNudged = false;
```

- [ ] **Step 5: Run typecheck and full tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/core/tool-budget.test.ts
git commit -m "feat: add parent-session tool interception via pi.on('tool_call')

Uses evaluateToolCall() to block tools at hard limit and steer
at soft limit. Complements existing subagent budget enforcement
in agent-runner.ts."
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

Run: `npx biome lint .`
Expected: No new errors
