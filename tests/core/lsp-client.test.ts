import { describe, it, expect } from "vitest";
import {
  encodeJsonRpc,
  decodeJsonRpcMessages,
  type JsonRpcMessage,
  resolveLanguageServer,
  collectWithLanguageServer,
} from "../../src/core/lsp-client.js";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

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
    const raw = Buffer.from(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 5)}`,
    );
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
      `X-Custom: foo\r\n\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
    const { messages } = decodeJsonRpcMessages(raw);
    expect(messages).toHaveLength(1);
  });
});

describe("collectWithLanguageServer", () => {
  it("returns unavailable when no language server found", async () => {
    const result = await collectWithLanguageServer("/nonexistent-path-xyz", ["foo.ts"], {
      timeoutMs: 5_000,
      maxFiles: 10,
      maxDiagnostics: 50,
    });
    expect(result.status).toBe("unavailable");
  });

  it("returns ok with empty diagnostics for non-TS files", async () => {
    const result = await collectWithLanguageServer(process.cwd(), ["README.md"], {
      timeoutMs: 5_000,
      maxFiles: 10,
      maxDiagnostics: 50,
    });
    expect(result.status).toBe("ok");
    expect(result.diagnostics).toHaveLength(0);
  });

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

      const result = await collectWithLanguageServer(tmpDir, ["bad.ts"], {
        timeoutMs: 30_000,
        maxFiles: 10,
        maxDiagnostics: 50,
      });

      expect(result.status).toBe("ok");
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
      expect(result.diagnostics[0].file).toBe("bad.ts");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("returns ok with empty diagnostics for a clean file", async () => {
    const command = resolveLanguageServer(process.cwd());
    if (!command) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
    try {
      writeFileSync(join(tmpDir, "tsconfig.json"), '{"compilerOptions":{"strict":true}}');
      writeFileSync(join(tmpDir, "good.ts"), "const x: number = 42;");

      const result = await collectWithLanguageServer(tmpDir, ["good.ts"], {
        timeoutMs: 30_000,
        maxFiles: 10,
        maxDiagnostics: 50,
      });

      expect(result.status).toBe("ok");
      expect(result.diagnostics).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
