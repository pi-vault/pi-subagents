import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
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
export function decodeJsonRpcMessages(buffer: Buffer): {
  messages: JsonRpcMessage[];
  remaining: Buffer;
} {
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

export interface LspCommand {
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
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
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
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
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
  request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
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
    if (message.id != null) {
      const handler = this.pending.get(message.id);
      if (!handler) return;
      const { resolve, reject } = handler;
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

function buildTargets(
  root: string,
  changedPaths: string[],
  maxFiles: number,
): { targets: TargetFile[]; skippedPaths: string[] } {
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

function severityLabel(sev: number | undefined): "error" | "warning" {
  return sev === 1 ? "error" : "warning";
}

function convertDiagnostics(target: TargetFile, raw: unknown[]): LspDiagnosticEntry[] {
  const entries: LspDiagnosticEntry[] = [];
  for (const d of raw) {
    const diag = d as {
      range?: { start?: { line?: number } };
      severity?: number;
      message?: string;
      code?: unknown;
    };
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

async function waitForDiagnostics(
  client: JsonRpcLspClient,
  targets: TargetFile[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const started = Date.now();
  while (!signal?.aborted && Date.now() - started < timeoutMs) {
    if (targets.every((t) => client.diagnostics.has(t.uri))) return true;
    await new Promise((r) =>
      setTimeout(r, Math.min(50, Math.max(1, timeoutMs - (Date.now() - started)))),
    );
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
  const { targets, skippedPaths: _skippedPaths } = buildTargets(
    root,
    changedPaths,
    config.maxFiles,
  );
  if (targets.length === 0) return { status: "ok", diagnostics: [] };

  const command = resolveLanguageServer(root);
  if (!command) return { status: "unavailable", diagnostics: [] };

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

    for (const target of targets) {
      let text: string;
      try {
        text = readFileSync(target.absPath, "utf-8");
      } catch {
        continue;
      }
      client.notify("textDocument/didOpen", {
        textDocument: { uri: target.uri, languageId: target.languageId, version: 1, text },
      });
      client.notify("textDocument/didSave", {
        textDocument: { uri: target.uri },
        text,
      });
    }

    const complete = await waitForDiagnostics(client, targets, remaining(), signal);

    const diagnostics = targets
      .flatMap((target) =>
        convertDiagnostics(target, (client.diagnostics.get(target.uri) as unknown[]) ?? []),
      )
      .slice(0, config.maxDiagnostics);

    return {
      status: complete ? "ok" : "timeout",
      provider: command.label,
      diagnostics,
      ...(complete
        ? {}
        : { message: `Timed out waiting ${config.timeoutMs}ms for LSP diagnostics.` }),
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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    const onAbort = () => reject(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
