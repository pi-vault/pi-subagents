import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";

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

// ─── Warning Tool ─────────────────────────────────────────────────────────────

/**
 * Create the watchdog_warn tool that the reviewer LLM calls to emit warnings.
 * Deduplicates by normalized summary. Collected warnings are pushed into the array.
 */
export function createWatchdogWarnTool(
  collected: WatchdogWarning[],
  seen: Set<string>,
) {
  return {
    name: "watchdog_warn" as const,
    label: "Watchdog Warning",
    description: "Emit a warning about a code issue found during review.",
    parameters: Type.Object({
      severity: Type.Union([Type.Literal("blocker"), Type.Literal("concern")]),
      summary: Type.String({ description: "One-line description" }),
      evidence: Type.String({ description: "file:line or relevant code snippet" }),
      recommendedAction: Type.String({ description: "Specific fix instruction" }),
      category: Type.Union([
        Type.Literal("correctness"),
        Type.Literal("missed-constraint"),
        Type.Literal("test-gap"),
        Type.Literal("unsafe-change"),
        Type.Literal("scope-drift"),
        Type.Literal("loop-risk"),
        Type.Literal("other"),
      ]),
    }),
    async execute(
      _toolCallId: string,
      params: WatchdogWarning,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const key = params.summary.toLowerCase().trim();
      if (seen.has(key)) {
        return {
          content: [{ type: "text" as const, text: "Warning duplicate — already recorded." }],
        };
      }
      seen.add(key);
      collected.push(params);
      return { content: [{ type: "text" as const, text: "Warning recorded." }] };
    },
  };
}
