import { execFileSync, execSync } from "node:child_process";
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
  changedPaths: string[];
}

export interface WatchdogChildOverride {
  enabled?: boolean;
  model?: string;
  thinking?: string;
}

export interface WatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
  /** When true (default), review git diff. When false, review the agent's conversation. */
  reviewChangesOnly: boolean;
  children: {
    enabled: boolean;
    model?: string;
    thinking?: string;
    overrides: Record<string, WatchdogChildOverride>;
  };
  autoFollow: {
    /** Resume agent to fix blockers. Default: false. */
    blockers: boolean;
    /** Resume agent to fix concerns. Default: false. */
    concerns: boolean;
    /** Maximum steering attempts before giving up. Default: 2. */
    maxAttempts: number;
    /** Stop if the same warning key repeats this many times. Default: 2. */
    stalemateRepeats: number;
  };
  lsp: {
    enabled: boolean;
    timeoutMs: number;
    maxFiles: number;
    maxDiagnostics: number;
  };
}

export interface WatchdogSubject {
  id: string;
  type: string;
  cwd: string;
}

export interface WatchdogRuntime {
  handleAgentEnd(subject: WatchdogSubject): Promise<WatchdogWarning[]>;
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

  return { root, changedPaths };
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

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  reviewChangesOnly: true,
  children: { enabled: false, overrides: {} },
  autoFollow: { blockers: false, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
  lsp: {
    enabled: true,
    timeoutMs: 3_000,
    maxFiles: 20,
    maxDiagnostics: 50,
  },
};

function freshDefault(): WatchdogConfig {
  return {
    ...DEFAULT_WATCHDOG_CONFIG,
    children: { ...DEFAULT_WATCHDOG_CONFIG.children, overrides: {} },
    autoFollow: { ...DEFAULT_WATCHDOG_CONFIG.autoFollow },
    lsp: { ...DEFAULT_WATCHDOG_CONFIG.lsp },
  };
}

/**
 * Parse watchdog config from settings, merging with defaults.
 */
export function parseWatchdogConfig(raw: unknown): WatchdogConfig {
  if (!raw || typeof raw !== "object") return freshDefault();
  const r = raw as Record<string, unknown>;
  const config = freshDefault();

  if (typeof r.enabled === "boolean") config.enabled = r.enabled;
  if (typeof r.model === "string") config.model = r.model;
  if (typeof r.thinking === "string") config.thinking = r.thinking;
  if (typeof r.reviewChangesOnly === "boolean") config.reviewChangesOnly = r.reviewChangesOnly;

  if (r.autoFollow && typeof r.autoFollow === "object") {
    const af = r.autoFollow as Record<string, unknown>;
    if (typeof af.blockers === "boolean") config.autoFollow.blockers = af.blockers;
    if (typeof af.concerns === "boolean") config.autoFollow.concerns = af.concerns;
    if (typeof af.maxAttempts === "number") config.autoFollow.maxAttempts = af.maxAttempts;
    if (typeof af.stalemateRepeats === "number") config.autoFollow.stalemateRepeats = af.stalemateRepeats;
  }

  if (r.children && typeof r.children === "object") {
    const ch = r.children as Record<string, unknown>;
    if (typeof ch.enabled === "boolean") config.children.enabled = ch.enabled;
    if (typeof ch.model === "string") config.children.model = ch.model;
    if (typeof ch.thinking === "string") config.children.thinking = ch.thinking;
    if (ch.overrides && typeof ch.overrides === "object") {
      config.children.overrides = ch.overrides as typeof config.children.overrides;
    }
  }

  if (r.lsp && typeof r.lsp === "object") {
    const lsp = r.lsp as Record<string, unknown>;
    if (typeof lsp.enabled === "boolean") config.lsp.enabled = lsp.enabled;
    if (typeof lsp.timeoutMs === "number") config.lsp.timeoutMs = lsp.timeoutMs;
    if (typeof lsp.maxFiles === "number") config.lsp.maxFiles = lsp.maxFiles;
    if (typeof lsp.maxDiagnostics === "number") config.lsp.maxDiagnostics = lsp.maxDiagnostics;
  }

  return config;
}

function selectReviewPolicy(
  config: WatchdogConfig,
  agentType: string,
): { reviewConfig: WatchdogConfig; source: "parent" | "child" } {
  const override = config.children.overrides[agentType];
  if (!config.children.enabled || override?.enabled === false) {
    return { reviewConfig: config, source: "parent" };
  }

  const model = override?.model ?? config.children.model ?? config.model;
  const thinking = override?.thinking ?? config.children.thinking ?? config.thinking;
  return {
    reviewConfig: {
      ...config,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
    },
    source: "child",
  };
}

// ─── Reviewer Prompt ──────────────────────────────────────────────────────────

const REVIEWER_SYSTEM_PROMPT = `You are a code watchdog. Review the following changes for defects.

For each issue found, call the watchdog_warn tool once per issue.
If no issues found, call no tools.

Rules:
- "blocker": likely bug, security issue, or constraint violation that must be fixed
- "concern": style issue, potential problem, or suggestion that can be deferred
- Only report real issues with concrete evidence
- Do NOT report style preferences, formatting, or naming opinions
- Be specific: cite file:line and explain the actual problem`;

// ─── Runtime ──────────────────────────────────────────────────────────────────

export interface WatchdogRuntimeOptions {
  /** Override reviewer execution for testing or custom implementations. */
  runReview?: (
    diff: string,
    lspOutput: string,
    agentId: string,
    reviewConfig: WatchdogConfig,
  ) => Promise<WatchdogWarning[]>;
  /** Called when warnings are produced. */
  onWarnings?: (
    agentId: string,
    warnings: WatchdogWarning[],
    source: "parent" | "child",
  ) => void;
  /** Return session messages for turn-delta mode (reviewChangesOnly: false). */
  getSessionMessages?: (agentId: string) => unknown[] | undefined;
  /** Resume a completed agent with a steering message. Used by auto-follow. */
  resumeAgent?: (agentId: string, message: string) => Promise<void>;
}

/**
 * Create a WatchdogRuntime instance.
 *
 * When `runReview` is not provided, uses `createAgentSession` to
 * spawn a focused reviewer LLM. For testing, inject a mock `runReview`.
 */
export function createWatchdogRuntime(
  config: WatchdogConfig,
  options?: WatchdogRuntimeOptions,
): WatchdogRuntime {
  let currentStatus: "idle" | "reviewing" | "disabled" = config.enabled ? "idle" : "disabled";
  let disposed = false;
  const globalSeen = new Set<string>();

  /** Compute a stable key for a warning set to detect stalemates. */
  function warningKey(warnings: WatchdogWarning[]): string {
    return warnings.map((w) => w.summary.toLowerCase().trim()).sort().join("|");
  }

  /** Should auto-follow run given these warnings? */
  function shouldAutoFollow(
    warnings: WatchdogWarning[],
    source: "parent" | "child",
  ): boolean {
    if (source === "child" || !options?.resumeAgent) return false;
    const hasBlockers = warnings.some((w) => w.severity === "blocker");
    const hasConcerns = warnings.some((w) => w.severity === "concern");
    return (config.autoFollow.blockers && hasBlockers) || (config.autoFollow.concerns && hasConcerns);
  }

  /** Run steering loop after initial review. Returns final warnings (empty = all fixed). */
  async function attemptAutoFollow(
    agentId: string,
    initialWarnings: WatchdogWarning[],
    reReview: () => Promise<WatchdogWarning[]>,
    source: "parent" | "child",
  ): Promise<WatchdogWarning[]> {
    if (!shouldAutoFollow(initialWarnings, source)) return initialWarnings;

    let warnings = initialWarnings;
    let lastKey = warningKey(warnings);
    let repeatCount = 0;

    for (let attempt = 0; attempt < config.autoFollow.maxAttempts; attempt++) {
      const steerMsg = [
        "Watchdog found issues that need fixing:",
        ...warnings.map((w) => `- [${w.severity}] ${w.summary}: ${w.recommendedAction}`),
        "",
        "Please address these issues.",
      ].join("\n");

      await options!.resumeAgent!(agentId, steerMsg);

      const newWarnings = await reReview();
      if (newWarnings.length === 0) return [];

      const newKey = warningKey(newWarnings);
      if (newKey === lastKey) {
        repeatCount++;
        if (repeatCount >= config.autoFollow.stalemateRepeats) return newWarnings;
      } else {
        repeatCount = 0;
        lastKey = newKey;
      }
      warnings = newWarnings;
    }

    return warnings;
  }

  async function handleAgentEnd(subject: WatchdogSubject): Promise<WatchdogWarning[]> {
    if (!config.enabled || disposed) return [];
    const { id: agentId, cwd } = subject;
    const { reviewConfig, source } = selectReviewPolicy(config, subject.type);

    // Turn-delta mode: review conversation instead of git diff
    if (!config.reviewChangesOnly) {
      currentStatus = "reviewing";
      try {
        // Re-fetches messages on each call (agent may have new conversation after resume)
        const runReview = async () => {
          let turnDelta = "(no conversation data available)";
          if (options?.getSessionMessages) {
            const messages = options.getSessionMessages(agentId);
            if (messages && messages.length > 0) {
              const { formatWatchdogTurnDelta } = await import("./watchdog-turn-delta.js");
              turnDelta = formatWatchdogTurnDelta(messages, 10);
            }
          }
          if (options?.runReview) {
            return options.runReview(
              turnDelta,
              "N/A (turn-delta mode)",
              agentId,
              reviewConfig,
            );
          }
          const localSeen = new Set<string>();
          return runDefaultReview(
            reviewConfig,
            turnDelta,
            "N/A (turn-delta mode)",
            agentId,
            localSeen,
          );
        };

        let warnings = await runReview();
        warnings = await attemptAutoFollow(agentId, warnings, runReview, source);

        // Add final warnings to globalSeen for cross-agent dedup
        for (const w of warnings) globalSeen.add(w.summary.toLowerCase().trim());

        if (warnings.length > 0) options?.onWarnings?.(agentId, warnings, source);
        return warnings;
      } finally {
        currentStatus = config.enabled && !disposed ? "idle" : "disabled";
      }
    }

    const signature = computeChangeSignature(cwd);
    if (!signature) return [];

    currentStatus = "reviewing";
    try {
      // Recomputes diff + LSP on each call (required for auto-follow re-reviews)
      const getFreshDiffAndLsp = async (): Promise<{ diff: string; lspOutput: string }> => {
        let diff: string;
        try {
          diff = execFileSync("git", ["diff", "--stat", "--patch", "--", ...signature.changedPaths], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 10_000, maxBuffer: 256 * 1024 });
          if (diff.length > 8192) diff = diff.slice(0, 8192) + "\n... (truncated)";
        } catch {
          diff = "(unable to get diff)";
        }

        let lspOutput = "No LSP issues found";
        if (reviewConfig.lsp.enabled) {
          try {
            const { collectDiagnostics } = await import("./watchdog-lsp.js");
            const lspResult = await collectDiagnostics(
              cwd,
              signature.changedPaths,
              reviewConfig.lsp,
            );
            if (lspResult.diagnostics.length > 0) {
              lspOutput = lspResult.diagnostics
                .map((d) => `${d.file}:${d.line} ${d.severity} ${d.code ?? ""}: ${d.message}`)
                .join("\n");
            }
          } catch {
            lspOutput = "LSP diagnostics unavailable";
          }
        }
        return { diff, lspOutput };
      };

      const runReview = async () => {
        const { diff, lspOutput } = await getFreshDiffAndLsp();
        if (options?.runReview) {
          return options.runReview(diff, lspOutput, agentId, reviewConfig);
        }
        // Use a local seen set so re-reviews don't deduplicate against previous rounds
        const localSeen = new Set<string>();
        return runDefaultReview(reviewConfig, diff, lspOutput, agentId, localSeen);
      };

      let warnings = await runReview();
      warnings = await attemptAutoFollow(agentId, warnings, runReview, source);

      // After auto-follow completes, add final warnings to globalSeen for cross-agent dedup
      for (const w of warnings) globalSeen.add(w.summary.toLowerCase().trim());

      if (warnings.length > 0) {
        options?.onWarnings?.(agentId, warnings, source);
      }

      return warnings;
    } finally {
      currentStatus = config.enabled && !disposed ? "idle" : "disabled";
    }
  }

  return {
    handleAgentEnd,
    status: () => currentStatus,
    dispose: () => {
      disposed = true;
      currentStatus = "disabled";
    },
  };
}

// ─── Default Review Implementation ────────────────────────────────────────────

/**
 * Spawn a reviewer LLM via createAgentSession with in-memory session,
 * no extensions, only watchdog_warn tool, single turn.
 */
async function runDefaultReview(
  config: WatchdogConfig,
  diff: string,
  lspOutput: string,
  agentId: string,
  seen: Set<string>,
): Promise<WatchdogWarning[]> {
  const {
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    getAgentDir,
  } = await import("@earendil-works/pi-coding-agent");

  const collected: WatchdogWarning[] = [];
  const warnTool = createWatchdogWarnTool(collected, seen);

  const agentDir = getAgentDir();
  const cwd = process.cwd();

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => REVIEWER_SYSTEM_PROMPT,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const sessionManager = SessionManager.inMemory(cwd);
  const settingsManager = SettingsManager.create(cwd, agentDir);

  const model = (config.model ?? undefined) as never;
  const thinkingLevel = (config.thinking ?? "medium") as never;

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    settingsManager,
    model,
    tools: [],
    resourceLoader: loader,
    thinkingLevel,
    customTools: [warnTool as never],
  });

  await session.bindExtensions({});

  const prompt = `## Git Diff\n${diff}\n\n## LSP Diagnostics\n${lspOutput}\n\n## Agent Context\nAgent: ${agentId}`;

  try {
    await session.prompt(prompt);
  } catch (err) {
    // Reviewer failure is non-fatal
    console.error("[watchdog] Reviewer session failed:", err);
  }

  return collected;
}
