import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WatchdogSeverity = "blocker" | "concern";

export type WatchdogCategory =
  | "correctness"
  | "missed-constraint"
  | "test-gap"
  | "unsafe-change"
  | "scope-drift"
  | "loop-risk"
  | "other";

export interface WatchdogWarning {
  severity: WatchdogSeverity;
  summary: string;
  evidence: string;
  recommendedAction: string;
  category: WatchdogCategory;
}

export interface ChangeSignature {
  root: string;
  key: string;
  changedPaths: string[];
}

export interface WatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
  autoFollow: {
    blockers: boolean;
    concerns: boolean;
    maxAttempts: number;
    stalemateRepeats: number;
  };
  lsp: {
    enabled: boolean;
    timeoutMs: number;
    maxFiles: number;
    maxDiagnostics: number;
  };
  children: {
    enabled: boolean;
    overrides: Record<string, Partial<WatchdogConfig>>;
  };
}

export interface WatchdogRuntime {
  handleAgentEnd(agentId: string, cwd: string): Promise<WatchdogWarning[]>;
  status(): "idle" | "reviewing" | "disabled";
  dispose(): void;
}

// ─── Change Detection ─────────────────────────────────────────────────────────

const IGNORED_PREFIXES = [".pi/", "node_modules/", ".git/", "tmp/"];

/**
 * Compute a change signature from git status.
 * Returns undefined if not a git repo or no relevant changes.
 */
export function computeChangeSignature(cwd: string): ChangeSignature | undefined {
  let root: string;
  try {
    root = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
  } catch {
    return undefined;
  }

  let statusOutput: string;
  try {
    statusOutput = execSync("git status --porcelain=v1 -z --untracked-files=all", {
      cwd: root,
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch {
    return undefined;
  }

  if (!statusOutput) return undefined;

  const entries = statusOutput.split("\0").filter(Boolean);
  const changedPaths: string[] = [];

  for (const entry of entries) {
    // Valid porcelain entries are "XY path" where the 3rd char is a space.
    // Rename/copy source paths have no status prefix — skip them.
    if (entry.length < 3 || entry[2] !== " ") continue;
    const filePath = entry.slice(3);
    if (!filePath) continue;
    if (IGNORED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) continue;
    changedPaths.push(filePath);
  }

  if (changedPaths.length === 0) return undefined;

  const hash = createHash("sha256");
  for (const p of changedPaths.sort()) {
    const fullPath = join(root, p);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, { encoding: null });
        hash.update(p);
        hash.update(content.subarray(0, 8192));
      } catch {
        hash.update(p);
      }
    } else {
      hash.update(p + ":deleted");
    }
  }

  return { root, key: hash.digest("hex"), changedPaths };
}
