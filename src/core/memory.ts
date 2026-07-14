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
