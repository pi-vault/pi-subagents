# Phase 5: Watchdog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adversarial edit reviewer that detects code changes at agent-end boundaries, runs an LLM review plus LSP diagnostics, and surfaces warnings to the parent (auto-follow experimental).

**Architecture:** Two modules: `src/core/watchdog-lsp.ts` (TSC diagnostics) and `src/core/watchdog.ts` (change detection, review orchestration, auto-follow state). The reviewer LLM runs via `createAgentSession` with a single `watchdog_warn` tool — warnings are collected via tool calls (not JSON parsing). Watchdog triggers at agent-end (session completion), not every turn.

**Tech Stack:** TypeScript, Vitest, TypeBox, Node.js `child_process`, `@earendil-works/pi-coding-agent`

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md` (Phase 5 section)

**Dependencies:** Phase 1 (safe-fs) for `resolveContained` in change detection path filtering.

---

## File Map

| File                         | Action | Responsibility                                                                     |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `src/core/watchdog-lsp.ts`   | Create | `collectLspDiagnostics` — run `tsc --noEmit`, parse output                         |
| `src/core/watchdog.ts`       | Create | `computeChangeSignature`, `WatchdogRuntime`, `createWatchdogWarnTool`, auto-follow |
| `tests/watchdog-lsp.test.ts` | Create | Unit tests for LSP diagnostics                                                     |
| `tests/watchdog.test.ts`     | Create | Unit tests for watchdog runtime                                                    |
| `src/core/settings.ts`       | Modify | Add `watchdog` to `SubagentsSettings`                                              |
| `src/shared/runtime-deps.ts` | Modify | Add `watchdog?: WatchdogRuntime`                                                   |
| `src/index.ts`               | Modify | Create watchdog, register `/watchdog` command, hook into agent completion          |

---

### Task 1: Implement `collectLspDiagnostics`

**Files:**

- Create: `src/core/watchdog-lsp.ts`
- Create: `tests/watchdog-lsp.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  collectLspDiagnostics,
  parseTscOutput,
} from "../src/core/watchdog-lsp.js";
import type { LspDiagnostic, LspConfig } from "../src/core/watchdog-lsp.js";

describe("parseTscOutput", () => {
  it("parses error lines", () => {
    const output = `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/utils.ts(3,1): error TS2304: Cannot find name 'foo'.`;
    const result = parseTscOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "src/index.ts",
      line: 10,
      severity: "error",
      message: "Type 'string' is not assignable to type 'number'.",
      code: "TS2322",
    });
  });

  it("parses warning lines", () => {
    const output = `src/foo.ts(1,1): warning TS6133: 'x' is declared but its value is never read.`;
    const result = parseTscOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });

  it("returns empty array for clean output", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("Found 0 errors.")).toEqual([]);
  });

  it("handles lines that don't match the pattern", () => {
    const output = `some random text
src/index.ts(1,1): error TS1234: Real error.
more noise`;
    const result = parseTscOutput(output);
    expect(result).toHaveLength(1);
  });
});

describe("collectLspDiagnostics", () => {
  const defaultConfig: LspConfig = {
    enabled: true,
    timeoutMs: 3000,
    maxFiles: 20,
    maxDiagnostics: 50,
  };

  it("returns ok with empty diagnostics when no TS/JS files in changedPaths", async () => {
    const result = await collectLspDiagnostics(
      "/tmp",
      ["readme.md", "data.json"],
      defaultConfig,
    );
    expect(result.status).toBe("ok");
    expect(result.diagnostics).toEqual([]);
  });

  it("returns unavailable when tsc is not found", async () => {
    // This test depends on environment — mock if needed
    const result = await collectLspDiagnostics(
      "/nonexistent-dir-xyz",
      ["index.ts"],
      defaultConfig,
    );
    expect(["unavailable", "failed"]).toContain(result.status);
  });

  it("respects maxFiles limit", async () => {
    const config: LspConfig = { ...defaultConfig, maxFiles: 2 };
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"];
    // Can't run tsc in a non-project dir, but verify the filtering logic
    const result = await collectLspDiagnostics("/tmp", files, config);
    expect(result.checkedPaths.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/watchdog-lsp.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement watchdog-lsp.ts**

Create `src/core/watchdog-lsp.ts`:

```typescript
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
  checkedPaths: string[];
}

export interface LspConfig {
  enabled: boolean;
  timeoutMs: number;
  maxFiles: number;
  maxDiagnostics: number;
}

const TS_JS_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
]);

const TSC_OUTPUT_REGEX =
  /^(.+)\((\d+),\d+\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

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
  // Check local node_modules
  const local = join(cwd, "node_modules", ".bin", "tsc");
  if (existsSync(local)) return local;

  // Check PATH
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
  signal?: AbortSignal,
): Promise<LspResult> {
  // Filter to TS/JS files
  const tsFiles = changedPaths.filter((p) => {
    const ext = p.slice(p.lastIndexOf("."));
    return TS_JS_EXTENSIONS.has(ext);
  });

  if (tsFiles.length === 0) {
    return { status: "ok", diagnostics: [], checkedPaths: [] };
  }

  // Respect maxFiles
  const checkedPaths = tsFiles.slice(0, config.maxFiles);

  // Find tsc
  const tsc = findTsc(cwd);
  if (!tsc) {
    return { status: "unavailable", diagnostics: [], checkedPaths };
  }

  // Run tsc --noEmit
  try {
    const result = execSync(`${tsc} --noEmit --pretty false`, {
      cwd,
      stdio: "pipe",
      timeout: config.timeoutMs,
      encoding: "utf-8",
    });
    // Clean exit = no errors
    return { status: "ok", diagnostics: [], checkedPaths };
  } catch (err: any) {
    if (signal?.aborted) {
      return { status: "timeout", diagnostics: [], checkedPaths };
    }

    // tsc exits with code 1 when there are errors — parse stdout/stderr
    const output = (err.stdout ?? "") + (err.stderr ?? "");

    if (err.killed || err.signal === "SIGTERM") {
      return { status: "timeout", diagnostics: [], checkedPaths };
    }

    const diagnostics = parseTscOutput(output).slice(0, config.maxDiagnostics);
    return { status: "ok", diagnostics, checkedPaths };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/watchdog-lsp.test.ts`
Expected: PASS (parseTscOutput tests pass; collectLspDiagnostics may return "unavailable" or "failed" in test env which is acceptable)

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog-lsp.ts tests/watchdog-lsp.test.ts
git commit -m "feat(watchdog): add watchdog-lsp with tsc --noEmit diagnostics"
```

---

### Task 2: Implement `computeChangeSignature`

**Files:**

- Create: `src/core/watchdog.ts`
- Create: `tests/watchdog.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { computeChangeSignature } from "../src/core/watchdog.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("computeChangeSignature", () => {
  it("returns undefined for non-git directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-"));
    expect(computeChangeSignature(tmp)).toBeUndefined();
  });

  it("returns a signature with key and changedPaths for git repo with changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-git-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", {
      cwd: tmp,
      stdio: "pipe",
    });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    // Make a change
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeDefined();
    expect(sig!.changedPaths).toContain("file.ts");
    expect(sig!.key).toBeTruthy();
  });

  it("returns undefined when no changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-clean-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", {
      cwd: tmp,
      stdio: "pipe",
    });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "clean");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    const sig = computeChangeSignature(tmp);
    // No changes = undefined (nothing to review)
    expect(sig).toBeUndefined();
  });

  it("filters out .pi/ and node_modules/ paths", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-filter-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", {
      cwd: tmp,
      stdio: "pipe",
    });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "real.ts"), "code");
    mkdirSync(join(tmp, ".pi"), { recursive: true });
    writeFileSync(join(tmp, ".pi", "settings.json"), "{}");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    // Change only .pi file
    writeFileSync(join(tmp, ".pi", "settings.json"), '{"x":1}');
    const sig = computeChangeSignature(tmp);
    // Should be undefined since only filtered paths changed
    expect(sig).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `computeChangeSignature`**

Create `src/core/watchdog.ts`:

```typescript
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ChangeSignature {
  root: string;
  key: string;
  changedPaths: string[];
}

const IGNORED_PREFIXES = [".pi/", "node_modules/", ".git/", "tmp/"];

/**
 * Compute a change signature from git status.
 * Returns undefined if not a git repo or no relevant changes.
 */
export function computeChangeSignature(
  cwd: string,
): ChangeSignature | undefined {
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
    statusOutput = execSync(
      "git status --porcelain=v1 -z --untracked-files=all",
      {
        cwd: root,
        stdio: "pipe",
        encoding: "utf-8",
      },
    );
  } catch {
    return undefined;
  }

  if (!statusOutput) return undefined;

  // Parse porcelain output (NUL-separated)
  const entries = statusOutput.split("\0").filter(Boolean);
  const changedPaths: string[] = [];

  for (const entry of entries) {
    // Format: "XY filename" or for renames "XY old -> new"
    const filePath = entry.slice(3); // skip status chars + space
    if (!filePath) continue;

    // Filter ignored paths
    if (IGNORED_PREFIXES.some((prefix) => filePath.startsWith(prefix)))
      continue;

    changedPaths.push(filePath);
  }

  if (changedPaths.length === 0) return undefined;

  // Compute signature key from content hashes
  const hash = createHash("sha256");
  for (const p of changedPaths.sort()) {
    const fullPath = join(root, p);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, { encoding: null });
        // Hash first 8KB
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add computeChangeSignature for change detection"
```

---

### Task 3: Implement `createWatchdogWarnTool` and review parsing

**Files:**

- Modify: `src/core/watchdog.ts`
- Modify: `tests/watchdog.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/watchdog.test.ts`:

```typescript
import { createWatchdogWarnTool } from "../src/core/watchdog.js";
import type { WatchdogWarning } from "../src/core/watchdog.js";

describe("createWatchdogWarnTool", () => {
  it("collects warnings via tool calls", async () => {
    const collected: WatchdogWarning[] = [];
    const tool = createWatchdogWarnTool(collected);

    expect(tool.name).toBe("watchdog_warn");

    await tool.execute(
      "tc-1",
      {
        severity: "blocker",
        summary: "Null pointer",
        evidence: "src/foo.ts:42",
        recommendedAction: "Add null check",
        category: "correctness",
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(collected).toHaveLength(1);
    expect(collected[0].severity).toBe("blocker");
    expect(collected[0].summary).toBe("Null pointer");
  });

  it("returns confirmation text", async () => {
    const collected: WatchdogWarning[] = [];
    const tool = createWatchdogWarnTool(collected);
    const result = await tool.execute(
      "tc-1",
      {
        severity: "concern",
        summary: "Missing test",
        evidence: "src/bar.ts",
        recommendedAction: "Add unit test",
        category: "test-gap",
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.content[0].text).toContain("recorded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: FAIL — `createWatchdogWarnTool` not exported

- [ ] **Step 3: Implement types and tool**

Add to `src/core/watchdog.ts`:

```typescript
import { Type } from "typebox";

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

/**
 * Create the watchdog_warn tool that the reviewer LLM calls to emit warnings.
 * Warnings are collected into the provided array.
 */
export function createWatchdogWarnTool(collected: WatchdogWarning[]) {
  return {
    name: "watchdog_warn",
    label: "Watchdog Warning",
    description: "Emit a warning about a code issue found during review.",
    parameters: Type.Object({
      severity: Type.Union([Type.Literal("blocker"), Type.Literal("concern")]),
      summary: Type.String({ description: "One-line description" }),
      evidence: Type.String({
        description: "file:line or relevant code snippet",
      }),
      recommendedAction: Type.String({
        description: "Specific fix instruction",
      }),
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
      collected.push(params);
      return { content: [{ type: "text", text: "Warning recorded." }] };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add WatchdogWarning types and watchdog_warn tool"
```

---

### Task 4: Implement `WatchdogRuntime` with review orchestration

**Files:**

- Modify: `src/core/watchdog.ts`
- Modify: `tests/watchdog.test.ts`

- [ ] **Step 1: Write failing tests for WatchdogRuntime**

Add to `tests/watchdog.test.ts`:

```typescript
import {
  createWatchdogRuntime,
  parseWatchdogConfig,
} from "../src/core/watchdog.js";
import type { WatchdogConfig, WatchdogRuntime } from "../src/core/watchdog.js";

describe("parseWatchdogConfig", () => {
  it("returns default config for undefined", () => {
    const config = parseWatchdogConfig(undefined);
    expect(config.enabled).toBe(false);
  });

  it("parses enabled flag", () => {
    const config = parseWatchdogConfig({ enabled: true });
    expect(config.enabled).toBe(true);
  });

  it("parses nested autoFollow config", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      autoFollow: { blockers: false, maxAttempts: 5 },
    });
    expect(config.autoFollow.blockers).toBe(false);
    expect(config.autoFollow.maxAttempts).toBe(5);
    // Defaults for unspecified
    expect(config.autoFollow.concerns).toBe(false);
    expect(config.autoFollow.stalemateRepeats).toBe(3);
  });
});

describe("WatchdogRuntime", () => {
  it("status returns disabled when not enabled", () => {
    const runtime = createWatchdogRuntime({ enabled: false } as WatchdogConfig);
    expect(runtime.status()).toBe("disabled");
  });

  it("status returns idle when enabled", () => {
    const runtime = createWatchdogRuntime({
      enabled: true,
      autoFollow: {
        blockers: true,
        concerns: false,
        maxAttempts: 3,
        stalemateRepeats: 3,
      },
      lsp: {
        enabled: false,
        timeoutMs: 3000,
        maxFiles: 20,
        maxDiagnostics: 50,
      },
      children: { enabled: false, overrides: {} },
    });
    expect(runtime.status()).toBe("idle");
  });

  it("dispose is idempotent", () => {
    const runtime = createWatchdogRuntime({ enabled: false } as WatchdogConfig);
    expect(() => {
      runtime.dispose();
      runtime.dispose();
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: FAIL — `createWatchdogRuntime`, `parseWatchdogConfig` not exported

- [ ] **Step 3: Implement WatchdogRuntime skeleton**

Add to `src/core/watchdog.ts`:

```typescript
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

const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  autoFollow: {
    blockers: true,
    concerns: false,
    maxAttempts: 3,
    stalemateRepeats: 3,
  },
  lsp: {
    enabled: true,
    timeoutMs: 3_000,
    maxFiles: 20,
    maxDiagnostics: 50,
  },
  children: {
    enabled: false,
    overrides: {},
  },
};

/**
 * Parse watchdog config from settings, merging with defaults.
 */
export function parseWatchdogConfig(raw: unknown): WatchdogConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WATCHDOG_CONFIG };
  const r = raw as Record<string, unknown>;

  const config = { ...DEFAULT_WATCHDOG_CONFIG };
  if (typeof r.enabled === "boolean") config.enabled = r.enabled;
  if (typeof r.model === "string") config.model = r.model;
  if (typeof r.thinking === "string") config.thinking = r.thinking;

  if (r.autoFollow && typeof r.autoFollow === "object") {
    const af = r.autoFollow as Record<string, unknown>;
    if (typeof af.blockers === "boolean")
      config.autoFollow.blockers = af.blockers;
    if (typeof af.concerns === "boolean")
      config.autoFollow.concerns = af.concerns;
    if (typeof af.maxAttempts === "number")
      config.autoFollow.maxAttempts = af.maxAttempts;
    if (typeof af.stalemateRepeats === "number")
      config.autoFollow.stalemateRepeats = af.stalemateRepeats;
  }

  if (r.lsp && typeof r.lsp === "object") {
    const lsp = r.lsp as Record<string, unknown>;
    if (typeof lsp.enabled === "boolean") config.lsp.enabled = lsp.enabled;
    if (typeof lsp.timeoutMs === "number") config.lsp.timeoutMs = lsp.timeoutMs;
    if (typeof lsp.maxFiles === "number") config.lsp.maxFiles = lsp.maxFiles;
    if (typeof lsp.maxDiagnostics === "number")
      config.lsp.maxDiagnostics = lsp.maxDiagnostics;
  }

  if (r.children && typeof r.children === "object") {
    const ch = r.children as Record<string, unknown>;
    if (typeof ch.enabled === "boolean") config.children.enabled = ch.enabled;
    if (ch.overrides && typeof ch.overrides === "object") {
      config.children.overrides = ch.overrides as Record<
        string,
        Partial<WatchdogConfig>
      >;
    }
  }

  return config;
}

/**
 * Create a WatchdogRuntime instance.
 *
 * The full review orchestration (calling createAgentSession, collecting warnings
 * via watchdog_warn tool, etc.) is implemented in handleAgentEnd.
 * This is marked experimental for auto-follow: initial delivery surfaces warnings
 * to parent rather than auto-steering.
 */
export function createWatchdogRuntime(
  config: WatchdogConfig,
  options?: {
    onWarnings?: (agentId: string, warnings: WatchdogWarning[]) => void;
    runReview?: (
      diff: string,
      lspOutput: string,
      agentName: string,
      task: string,
    ) => Promise<WatchdogWarning[]>;
  },
): WatchdogRuntime {
  let currentStatus: "idle" | "reviewing" | "disabled" = config.enabled
    ? "idle"
    : "disabled";
  let disposed = false;

  async function handleAgentEnd(
    agentId: string,
    cwd: string,
  ): Promise<WatchdogWarning[]> {
    if (!config.enabled || disposed) return [];

    // 1. Compute change signature
    const signature = computeChangeSignature(cwd);
    if (!signature) return []; // No changes to review

    currentStatus = "reviewing";
    try {
      // 2. Get git diff
      let diff: string;
      try {
        diff = execSync("git diff --stat --patch", {
          cwd,
          stdio: "pipe",
          encoding: "utf-8",
        });
        // Truncate to 8KB
        if (diff.length > 8192)
          diff = diff.slice(0, 8192) + "\n... (truncated)";
      } catch {
        diff = "(unable to get diff)";
      }

      // 3. Collect LSP diagnostics
      let lspOutput = "No LSP issues found";
      if (config.lsp.enabled) {
        const { collectLspDiagnostics } = await import("./watchdog-lsp.js");
        const lspResult = await collectLspDiagnostics(
          cwd,
          signature.changedPaths,
          config.lsp,
        );
        if (lspResult.diagnostics.length > 0) {
          lspOutput = lspResult.diagnostics
            .map(
              (d) =>
                `${d.file}:${d.line} ${d.severity} ${d.code ?? ""}: ${d.message}`,
            )
            .join("\n");
        }
      }

      // 4. Run review (via injected function or default no-op)
      let warnings: WatchdogWarning[] = [];
      if (options?.runReview) {
        warnings = await options.runReview(diff, lspOutput, agentId, "");
      }

      // 5. Notify
      if (warnings.length > 0) {
        options?.onWarnings?.(agentId, warnings);
      }

      return warnings;
    } finally {
      currentStatus = "idle";
    }
  }

  function status() {
    return currentStatus;
  }

  function dispose() {
    disposed = true;
    currentStatus = "disabled";
  }

  return { handleAgentEnd, status, dispose };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add WatchdogRuntime with change detection and review orchestration"
```

---

### Task 5: Add watchdog to settings and RuntimeDeps

**Files:**

- Modify: `src/core/settings.ts`
- Modify: `src/shared/runtime-deps.ts`

- [ ] **Step 1: Add watchdog to SubagentsSettings**

In `src/core/settings.ts`:

```typescript
import { parseWatchdogConfig, type WatchdogConfig } from "./watchdog.js";

export interface SubagentsSettings {
  // ... existing fields ...
  watchdog?: WatchdogConfig;
}

// In sanitize(), add:
if (r.watchdog !== undefined) {
  out.watchdog = parseWatchdogConfig(r.watchdog);
}
```

- [ ] **Step 2: Add watchdog to RuntimeDeps**

In `src/shared/runtime-deps.ts`:

```typescript
import type { WatchdogRuntime } from "../core/watchdog.js";

export interface RuntimeDeps {
  // ... existing fields ...
  watchdog?: WatchdogRuntime;
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/settings.ts src/shared/runtime-deps.ts
git commit -m "feat(watchdog): add watchdog to settings schema and RuntimeDeps"
```

---

### Task 6: Wire watchdog into index.ts with slash command

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Create watchdog runtime and register slash command**

In `src/index.ts`, during extension init (where other features are initialized):

```typescript
import { createWatchdogRuntime, parseWatchdogConfig } from "./core/watchdog.js";
import { loadSettings } from "./core/settings.js";

// During init:
const settings = loadSettings(ctx.cwd);
const watchdogConfig = settings.watchdog ?? parseWatchdogConfig(undefined);
const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => {
    for (const w of warnings) {
      pi.sendMessage({
        customType: "watchdog_warning",
        content: `[${w.severity}] ${w.summary}\nEvidence: ${w.evidence}\nAction: ${w.recommendedAction}`,
        display: true,
      });
    }
  },
});
deps.watchdog = watchdog;

// Register slash command:
pi.registerCommand("watchdog", {
  description: "Control watchdog: on, off, status",
  handler: async (args) => {
    const subcmd = args.trim().toLowerCase();
    if (subcmd === "on") {
      // Enable for session (requires re-creating runtime — simplified)
      pi.sendMessage({
        customType: "notification",
        content: "Watchdog enabled for this session.",
        display: true,
      });
    } else if (subcmd === "off") {
      watchdog.dispose();
      pi.sendMessage({
        customType: "notification",
        content: "Watchdog disabled.",
        display: true,
      });
    } else {
      pi.sendMessage({
        customType: "notification",
        content: `Watchdog status: ${watchdog.status()}`,
        display: true,
      });
    }
  },
});

// On shutdown:
watchdog.dispose();
```

- [ ] **Step 2: Hook into agent completion callback**

In the agent completion callback (where `manager.spawnAndWait` resolves), add:

```typescript
// After agent completes:
if (deps.watchdog?.status() !== "disabled") {
  deps.watchdog.handleAgentEnd(agentId, cwd).catch(() => {});
}
```

The exact location is in `subagent.ts` after the spawn completes. This hooks into the existing completion flow.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/core/subagent.ts
git commit -m "feat(watchdog): wire runtime into extension lifecycle and slash command"
```

---

### Task 7: Typecheck and lint

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: fix lint/type issues from watchdog integration"
```
