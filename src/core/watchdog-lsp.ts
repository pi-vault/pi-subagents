import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { collectWithLanguageServer } from "./lsp-client.js";

export interface LspDiagnostic {
  file: string;
  line: number;
  severity: "error" | "warning";
  message: string;
  code?: string;
}

export interface LspResult {
  status: "ok" | "unavailable" | "timeout" | "failed";
  diagnostics: LspDiagnostic[];
}

export interface LspConfig {
  enabled: boolean;
  timeoutMs: number;
  maxFiles: number;
  maxDiagnostics: number;
}

const TS_JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

const TSC_OUTPUT_REGEX = /^(.+)\((\d+),\d+\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

/**
 * Parse tsc --noEmit output into structured diagnostics.
 */
export function parseTscOutput(output: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(TSC_OUTPUT_REGEX);
    if (match) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2], 10),
        severity: match[3] as "error" | "warning",
        message: match[5],
        code: match[4],
      });
    }
  }
  return diagnostics;
}

function findTsc(cwd: string): string | undefined {
  const local = join(cwd, "node_modules", ".bin", "tsc");
  if (existsSync(local)) return local;
  try {
    execSync("which tsc", { cwd, stdio: "pipe" });
    return "tsc";
  } catch {
    return undefined;
  }
}

/**
 * Collect TypeScript diagnostics for changed files using tsc --noEmit.
 */
export async function collectLspDiagnostics(
  cwd: string,
  changedPaths: string[],
  config: LspConfig,
): Promise<LspResult> {
  const tsFiles = changedPaths.filter((p) => {
    const ext = extname(p);
    return TS_JS_EXTENSIONS.has(ext);
  });

  if (tsFiles.length === 0) {
    return { status: "ok", diagnostics: [] };
  }

  const tsc = findTsc(cwd);
  if (!tsc) {
    return { status: "unavailable", diagnostics: [] };
  }

  try {
    execFileSync(tsc, ["--noEmit", "--pretty", "false"], {
      cwd,
      stdio: "pipe",
      timeout: config.timeoutMs,
      encoding: "utf-8",
    });
    return { status: "ok", diagnostics: [] };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
      status?: number | null;
    };
    // Timeout or signal kill → unavailable
    if (e.killed || e.signal === "SIGTERM") {
      return { status: "timeout", diagnostics: [] };
    }
    const output = (e.stdout ?? "") + (e.stderr ?? "");
    const diagnostics = parseTscOutput(output).slice(0, config.maxDiagnostics);
    // tsc exits non-zero when it finds errors — that's expected and we parsed them above.
    // If we got no parseable diagnostics from a non-zero exit, treat as a real failure.
    if (diagnostics.length === 0) {
      return { status: "failed", diagnostics: [] };
    }
    return { status: "ok", diagnostics };
  }
}

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
