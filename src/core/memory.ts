import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  isSymlink,
  isUnsafeName,
  resolveContained,
  safeReadFile,
} from "./safe-fs.js";
import type { AgentMemoryConfig, MemoryScope } from "../shared/types.js";

const VALID_SCOPES: ReadonlySet<string> = new Set(["user", "project", "local"]);

/**
 * Parse memory config from agent frontmatter.
 * Returns undefined if invalid.
 */
export function parseMemoryConfig(raw: unknown): AgentMemoryConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  if (typeof r.scope !== "string" || !VALID_SCOPES.has(r.scope))
    return undefined;
  if (typeof r.path !== "string" || !r.path) return undefined;
  if (isUnsafeName(r.path)) return undefined;

  return { scope: r.scope as MemoryScope, path: r.path };
}

/**
 * Resolve memory directory with security checks.
 * Returns { dir } on success or { error } on failure.
 */
export function resolveMemoryDir(
  scope: MemoryScope,
  scopedPath: string,
  cwd: string,
): { dir: string } | { error: string } {
  if (isUnsafeName(scopedPath)) {
    return { error: `Unsafe memory path: "${scopedPath}"` };
  }

  let rootDir: string;
  switch (scope) {
    case "user":
      rootDir = join(getAgentDir(), "agent-memory");
      break;
    case "project":
      rootDir = join(cwd, ".pi", "agent-memory");
      break;
    case "local":
      rootDir = join(cwd, ".pi", "agent-memory-local");
      break;
  }

  // Reject symlinked .pi directory (project/local scopes only)
  if (scope !== "user") {
    const piDir = join(cwd, ".pi");
    if (existsSync(piDir) && isSymlink(piDir)) {
      return { error: `.pi directory is a symlink — refusing memory access` };
    }
  }

  const resolved = resolveContained(rootDir, scopedPath);
  if (!resolved) {
    return { error: `Memory path "${scopedPath}" escapes root directory` };
  }

  return { dir: resolved };
}

export type MemoryFileResult =
  | { contents: string; truncated: boolean }
  | "unsafe"
  | null;

const MAX_LINES = 200;
const MAX_BYTES = 16_384;

/**
 * Read MEMORY.md safely (symlink rejection, line/byte limit).
 */
export function readMemoryFile(memoryDir: string): MemoryFileResult {
  const filePath = join(memoryDir, "MEMORY.md");

  if (!existsSync(filePath)) return null;

  const contents = safeReadFile(filePath);
  if (contents === undefined) return "unsafe";

  // Apply limits
  let truncated = false;
  let result = contents;

  // Byte limit first
  if (result.length > MAX_BYTES) {
    result = result.slice(0, MAX_BYTES);
    truncated = true;
  }

  // Line limit
  const lines = result.split("\n");
  if (lines.length > MAX_LINES) {
    result = lines.slice(0, MAX_LINES).join("\n");
    truncated = true;
  }

  return { contents: result, truncated };
}
