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
 * Accepts an object or a JSON string (frontmatter stores values as strings).
 * Returns undefined if invalid.
 */
export function parseMemoryConfig(raw: unknown): AgentMemoryConfig | undefined {
  if (!raw) return undefined;

  // Frontmatter gives us a string — try JSON.parse
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return undefined;
      return parseMemoryConfig(parsed);
    } catch {
      return undefined;
    }
  }

  if (typeof raw !== "object") return undefined;
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

/**
 * Build prompt injection block for agent memory.
 * Returns empty string if read-only mode and no MEMORY.md exists,
 * or if directory resolution fails.
 */
export function buildMemoryInjection(
  _agentName: string,
  config: AgentMemoryConfig,
  cwd: string,
  hasWriteTools: boolean,
): string {
  const dirResult = resolveMemoryDir(config.scope, config.path, cwd);
  if ("error" in dirResult) return "";

  const { dir } = dirResult;
  const fileResult = readMemoryFile(dir);

  // Read-only mode: skip entirely if no file or unsafe
  if (!hasWriteTools) {
    if (fileResult === null || fileResult === "unsafe") return "";
    const { contents, truncated } = fileResult;
    const truncNote = truncated ? "\n(truncated at 200 lines / 16KB)" : "";
    return [
      "# Persistent agent memory (read-only)",
      "",
      `Memory scope: ${config.scope}`,
      "You have read-only access to memory. You can reference existing memories but cannot create or modify them.",
      "",
      "## Current MEMORY.md",
      "---",
      contents + truncNote,
      "---",
    ].join("\n");
  }

  // Read-write mode
  let memorySection: string;
  if (fileResult === null) {
    memorySection =
      "No MEMORY.md exists yet. You may create it to begin accumulating notes.";
  } else if (fileResult === "unsafe") {
    memorySection = "(MEMORY.md exists but is unsafe — skipped)";
  } else {
    const { contents, truncated } = fileResult;
    const truncNote = truncated ? "\n(truncated at 200 lines / 16KB)" : "";
    memorySection = contents + truncNote;
  }

  return [
    "# Persistent agent memory",
    "",
    `You have a durable, role-specific memory at: ${dir}/MEMORY.md`,
    `Memory scope: ${config.scope}`,
    "",
    "Read this file at the start of a task to recall accumulated role notes.",
    "When you produce durable, reusable role knowledge, append a concise dated entry.",
    "Only persist generally reusable knowledge, not one-off task details or secrets.",
    "Keep MEMORY.md under 200 lines — store detailed content in separate files and link from the index.",
    "",
    "## Current MEMORY.md",
    "---",
    memorySection,
    "---",
  ].join("\n");
}
