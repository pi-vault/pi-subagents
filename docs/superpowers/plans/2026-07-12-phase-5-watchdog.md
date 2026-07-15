# Phase 5: Watchdog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adversarial edit reviewer that detects code changes at agent-end boundaries, runs an LLM review plus TSC diagnostics, and surfaces warnings to the parent.

**Architecture:** Two modules: `src/core/watchdog-lsp.ts` (TSC diagnostics) and `src/core/watchdog.ts` (change detection, review orchestration, warning dedup). The reviewer LLM runs via `createAgentSession` with a single `watchdog_warn` tool — warnings are collected via tool calls (not JSON parsing). Watchdog triggers at agent-end (session completion), not every turn.

**Scope:** Initial delivery surfaces warnings only. Auto-follow (auto-steering agents to fix issues) is deferred — the reference implementation (nicobailon) also marks it "not implemented".

**Tech Stack:** TypeScript, Vitest, TypeBox, Node.js `child_process`, `@earendil-works/pi-coding-agent`

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md` (Phase 5 section)

**Dependencies:** Phase 1 (safe-fs) for `resolveContained` in change detection path filtering.

**Key reference:** `nicobailon-pi-subagents/src/watchdog/` — 15-file production implementation. We take a simpler approach for MVP: 2 source files, no auto-follow, `tsc --noEmit` instead of full LSP client.

---

## File Map

| File                         | Action | Responsibility                                                              |
| ---------------------------- | ------ | --------------------------------------------------------------------------- |
| `src/core/watchdog-lsp.ts`   | Create | `collectLspDiagnostics` — run `tsc --noEmit`, parse output                  |
| `src/core/watchdog.ts`       | Create | `computeChangeSignature`, `WatchdogRuntime`, `createWatchdogWarnTool`, reviewer session, dedup |
| `tests/watchdog-lsp.test.ts` | Create | Unit tests for LSP diagnostics                                              |
| `tests/watchdog.test.ts`     | Create | Unit tests for watchdog runtime                                             |
| `src/core/settings.ts`       | Modify | Add `watchdog` to `SubagentsSettings`                                       |
| `src/shared/runtime-deps.ts` | Modify | Add `watchdog?: WatchdogRuntime`                                            |
| `src/index.ts`               | Modify | Create watchdog, hook into onComplete callback, register `/watchdog` command |

---

## Integration Design (critical context for Task 6)

The watchdog hooks into the **existing `AgentManager` `onComplete` callback** in `createRuntimeDeps()` (index.ts line ~135). This callback already fires for every agent completion. We add watchdog invocation there:

```typescript
// In the manager's onComplete callback (existing):
const manager = new AgentManager(3, (record) => {
  // ... existing lifecycle events, TUI cleanup, notifications ...

  // NEW: trigger watchdog review after agent completes
  if (deps.watchdog?.status() !== "disabled" && record.status !== "error") {
    const agentCwd = record.cwd ?? process.cwd();
    deps.watchdog.handleAgentEnd(record.id, agentCwd).catch(() => {});
  }
});
```

The reviewer LLM session uses the same `createAgentSession` pattern as `agent-runner.ts` but with:
- `SessionManager.inMemory()` (no persistence)
- Only `watchdog_warn` as a custom tool
- Empty `tools: []` (no built-in tools)
- `maxTurns: 1` equivalent (single prompt, no steering)
- Isolated (no extensions)

Warnings surface to the parent via:
```typescript
pi.sendMessage(
  { customType: "watchdog-warning", content: formattedWarning, display: true, details },
  { deliverAs: "followUp", triggerTurn: true },
);
```

---

### Task 1: Implement `collectLspDiagnostics`

**Files:**

- Create: `src/core/watchdog-lsp.ts`
- Create: `tests/watchdog-lsp.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
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

const TS_JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

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
    const ext = p.slice(p.lastIndexOf("."));
    return TS_JS_EXTENSIONS.has(ext);
  });

  if (tsFiles.length === 0) {
    return { status: "ok", diagnostics: [], checkedPaths: [] };
  }

  const checkedPaths = tsFiles.slice(0, config.maxFiles);

  const tsc = findTsc(cwd);
  if (!tsc) {
    return { status: "unavailable", diagnostics: [], checkedPaths };
  }

  try {
    execSync(`${tsc} --noEmit --pretty false`, {
      cwd,
      stdio: "pipe",
      timeout: config.timeoutMs,
      encoding: "utf-8",
    });
    return { status: "ok", diagnostics: [], checkedPaths };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    if (e.killed || e.signal === "SIGTERM") {
      return { status: "timeout", diagnostics: [], checkedPaths };
    }
    const output = (e.stdout ?? "") + (e.stderr ?? "");
    const diagnostics = parseTscOutput(output).slice(0, config.maxDiagnostics);
    return { status: "ok", diagnostics, checkedPaths };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/watchdog-lsp.test.ts`
Expected: PASS (parseTscOutput tests pass; collectLspDiagnostics may return "unavailable" in test env which is acceptable)

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog-lsp.ts tests/watchdog-lsp.test.ts
git commit -m "feat(watchdog): add watchdog-lsp with tsc --noEmit diagnostics"
```

---

### Task 2: Implement `computeChangeSignature` and core types

**Files:**

- Create: `src/core/watchdog.ts`
- Create: `tests/watchdog.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
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
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeDefined();
    expect(sig!.changedPaths).toContain("file.ts");
    expect(sig!.key).toBeTruthy();
  });

  it("returns undefined when no changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-clean-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "clean");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeUndefined();
  });

  it("filters out .pi/ and node_modules/ paths", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-filter-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "real.ts"), "code");
    mkdirSync(join(tmp, ".pi"), { recursive: true });
    writeFileSync(join(tmp, ".pi", "settings.json"), "{}");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    writeFileSync(join(tmp, ".pi", "settings.json"), '{"x":1}');
    const sig = computeChangeSignature(tmp);
    expect(sig).toBeUndefined();
  });

  it("produces different keys for different content changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-keys-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "original");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    writeFileSync(join(tmp, "file.ts"), "change-a");
    const sig1 = computeChangeSignature(tmp);

    writeFileSync(join(tmp, "file.ts"), "change-b");
    const sig2 = computeChangeSignature(tmp);

    expect(sig1!.key).not.toBe(sig2!.key);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement core types and `computeChangeSignature`**

Create `src/core/watchdog.ts`:

```typescript
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
    const filePath = entry.slice(3); // skip "XY " status chars + space
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add types and computeChangeSignature"
```

---

### Task 3: Implement `createWatchdogWarnTool` and warning dedup

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
    const seen = new Set<string>();
    const tool = createWatchdogWarnTool(collected, seen);

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
      {} as never,
    );

    expect(collected).toHaveLength(1);
    expect(collected[0].severity).toBe("blocker");
    expect(collected[0].summary).toBe("Null pointer");
  });

  it("deduplicates warnings by summary", async () => {
    const collected: WatchdogWarning[] = [];
    const seen = new Set<string>();
    const tool = createWatchdogWarnTool(collected, seen);

    const params = {
      severity: "concern" as const,
      summary: "Missing test",
      evidence: "src/bar.ts",
      recommendedAction: "Add unit test",
      category: "test-gap" as const,
    };

    await tool.execute("tc-1", params, undefined, undefined, {} as never);
    await tool.execute("tc-2", params, undefined, undefined, {} as never);

    expect(collected).toHaveLength(1);
  });

  it("returns confirmation text", async () => {
    const collected: WatchdogWarning[] = [];
    const seen = new Set<string>();
    const tool = createWatchdogWarnTool(collected, seen);
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
      {} as never,
    );

    expect(result.content[0].text).toContain("recorded");
  });

  it("returns duplicate notice for repeated warnings", async () => {
    const collected: WatchdogWarning[] = [];
    const seen = new Set(["missing test"]); // pre-populate
    const tool = createWatchdogWarnTool(collected, seen);
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
      {} as never,
    );

    expect(collected).toHaveLength(0);
    expect(result.content[0].text).toContain("duplicate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: FAIL — `createWatchdogWarnTool` not exported

- [ ] **Step 3: Implement the tool and dedup**

Add to `src/core/watchdog.ts`:

```typescript
import { Type } from "typebox";

/**
 * Create the watchdog_warn tool that the reviewer LLM calls to emit warnings.
 * Deduplicates by normalized summary. Collected warnings are pushed into the array.
 */
export function createWatchdogWarnTool(
  collected: WatchdogWarning[],
  seen: Set<string>,
) {
  return {
    name: "watchdog_warn",
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
        return { content: [{ type: "text" as const, text: "Warning duplicate — already recorded." }] };
      }
      seen.add(key);
      collected.push(params);
      return { content: [{ type: "text" as const, text: "Warning recorded." }] };
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
git commit -m "feat(watchdog): add watchdog_warn tool with dedup guard"
```

---

### Task 4: Implement `WatchdogRuntime` with reviewer session

**Files:**

- Modify: `src/core/watchdog.ts`
- Modify: `tests/watchdog.test.ts`

This is the core orchestration task. The runtime:
1. Computes change signature
2. Gets git diff
3. Collects LSP diagnostics (optional)
4. Spawns a reviewer LLM session with `createAgentSession`
5. Collects warnings via `watchdog_warn` tool calls
6. Returns warnings to caller

- [ ] **Step 1: Write failing tests for config parsing and runtime lifecycle**

Add to `tests/watchdog.test.ts`:

```typescript
import { createWatchdogRuntime, parseWatchdogConfig } from "../src/core/watchdog.js";
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
    expect(config.autoFollow.concerns).toBe(false);
    expect(config.autoFollow.stalemateRepeats).toBe(3);
  });

  it("parses lsp config", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      lsp: { enabled: false, timeoutMs: 5000 },
    });
    expect(config.lsp.enabled).toBe(false);
    expect(config.lsp.timeoutMs).toBe(5000);
    expect(config.lsp.maxFiles).toBe(20); // default preserved
  });

  it("parses model and thinking", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "anthropic/claude-sonnet-4",
      thinking: "high",
    });
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.thinking).toBe("high");
  });
});

describe("WatchdogRuntime", () => {
  it("status returns disabled when not enabled", () => {
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: false }),
    );
    expect(runtime.status()).toBe("disabled");
  });

  it("status returns idle when enabled", () => {
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true }),
    );
    expect(runtime.status()).toBe("idle");
  });

  it("dispose is idempotent", () => {
    const runtime = createWatchdogRuntime(parseWatchdogConfig({ enabled: true }));
    expect(() => {
      runtime.dispose();
      runtime.dispose();
    }).not.toThrow();
    expect(runtime.status()).toBe("disabled");
  });

  it("handleAgentEnd returns empty when disabled", async () => {
    const runtime = createWatchdogRuntime(parseWatchdogConfig({ enabled: false }));
    const warnings = await runtime.handleAgentEnd("test-agent", "/tmp");
    expect(warnings).toEqual([]);
  });

  it("handleAgentEnd returns empty for non-git directory", async () => {
    const runtime = createWatchdogRuntime(parseWatchdogConfig({ enabled: true }));
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-nongit-"));
    const warnings = await runtime.handleAgentEnd("test-agent", tmp);
    expect(warnings).toEqual([]);
  });

  it("handleAgentEnd invokes runReview when changes detected", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-review-"));
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    let reviewCalled = false;
    const runtime = createWatchdogRuntime(parseWatchdogConfig({ enabled: true }), {
      runReview: async () => {
        reviewCalled = true;
        return [{ severity: "concern", summary: "Test issue", evidence: "file.ts:1", recommendedAction: "Fix it", category: "other" }];
      },
    });

    const warnings = await runtime.handleAgentEnd("test-agent", tmp);
    expect(reviewCalled).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].summary).toBe("Test issue");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: FAIL — `createWatchdogRuntime`, `parseWatchdogConfig` not exported

- [ ] **Step 3: Implement config parsing and WatchdogRuntime**

Add to `src/core/watchdog.ts`:

```typescript
// ─── Config ───────────────────────────────────────────────────────────────────

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

  const config: WatchdogConfig = {
    ...DEFAULT_WATCHDOG_CONFIG,
    autoFollow: { ...DEFAULT_WATCHDOG_CONFIG.autoFollow },
    lsp: { ...DEFAULT_WATCHDOG_CONFIG.lsp },
    children: { ...DEFAULT_WATCHDOG_CONFIG.children },
  };

  if (typeof r.enabled === "boolean") config.enabled = r.enabled;
  if (typeof r.model === "string") config.model = r.model;
  if (typeof r.thinking === "string") config.thinking = r.thinking;

  if (r.autoFollow && typeof r.autoFollow === "object") {
    const af = r.autoFollow as Record<string, unknown>;
    if (typeof af.blockers === "boolean") config.autoFollow.blockers = af.blockers;
    if (typeof af.concerns === "boolean") config.autoFollow.concerns = af.concerns;
    if (typeof af.maxAttempts === "number") config.autoFollow.maxAttempts = af.maxAttempts;
    if (typeof af.stalemateRepeats === "number") config.autoFollow.stalemateRepeats = af.stalemateRepeats;
  }

  if (r.lsp && typeof r.lsp === "object") {
    const lsp = r.lsp as Record<string, unknown>;
    if (typeof lsp.enabled === "boolean") config.lsp.enabled = lsp.enabled;
    if (typeof lsp.timeoutMs === "number") config.lsp.timeoutMs = lsp.timeoutMs;
    if (typeof lsp.maxFiles === "number") config.lsp.maxFiles = lsp.maxFiles;
    if (typeof lsp.maxDiagnostics === "number") config.lsp.maxDiagnostics = lsp.maxDiagnostics;
  }

  if (r.children && typeof r.children === "object") {
    const ch = r.children as Record<string, unknown>;
    if (typeof ch.enabled === "boolean") config.children.enabled = ch.enabled;
    if (ch.overrides && typeof ch.overrides === "object") {
      config.children.overrides = ch.overrides as Record<string, Partial<WatchdogConfig>>;
    }
  }

  return config;
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

export function buildReviewPrompt(
  diff: string,
  lspOutput: string,
  agentId: string,
): string {
  return `## Git Diff\n${diff}\n\n## LSP Diagnostics\n${lspOutput}\n\n## Agent Context\nAgent: ${agentId}`;
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

export interface WatchdogRuntimeOptions {
  /** Override reviewer execution for testing or custom implementations. */
  runReview?: (diff: string, lspOutput: string, agentId: string) => Promise<WatchdogWarning[]>;
  /** Called when warnings are produced. */
  onWarnings?: (agentId: string, warnings: WatchdogWarning[]) => void;
}

/**
 * Create a WatchdogRuntime instance.
 *
 * When `runReview` is not provided, the runtime uses `createAgentSession` to
 * spawn a focused reviewer LLM. For testing, inject a mock `runReview`.
 */
export function createWatchdogRuntime(
  config: WatchdogConfig,
  options?: WatchdogRuntimeOptions,
): WatchdogRuntime {
  let currentStatus: "idle" | "reviewing" | "disabled" = config.enabled ? "idle" : "disabled";
  let disposed = false;
  // Cross-review dedup: track seen warning summaries across all reviews in this session
  const globalSeen = new Set<string>();

  async function handleAgentEnd(agentId: string, cwd: string): Promise<WatchdogWarning[]> {
    if (!config.enabled || disposed) return [];

    const signature = computeChangeSignature(cwd);
    if (!signature) return [];

    currentStatus = "reviewing";
    try {
      // Get git diff (truncated to 8KB)
      let diff: string;
      try {
        diff = execSync("git diff --stat --patch", { cwd, stdio: "pipe", encoding: "utf-8" });
        if (diff.length > 8192) diff = diff.slice(0, 8192) + "\n... (truncated)";
      } catch {
        diff = "(unable to get diff)";
      }

      // Collect LSP diagnostics
      let lspOutput = "No LSP issues found";
      if (config.lsp.enabled) {
        const { collectLspDiagnostics } = await import("./watchdog-lsp.js");
        const lspResult = await collectLspDiagnostics(cwd, signature.changedPaths, config.lsp);
        if (lspResult.diagnostics.length > 0) {
          lspOutput = lspResult.diagnostics
            .map((d) => `${d.file}:${d.line} ${d.severity} ${d.code ?? ""}: ${d.message}`)
            .join("\n");
        }
      }

      // Run review
      let warnings: WatchdogWarning[];
      if (options?.runReview) {
        warnings = await options.runReview(diff, lspOutput, agentId);
      } else {
        warnings = await runDefaultReview(config, diff, lspOutput, agentId, globalSeen);
      }

      if (warnings.length > 0) {
        options?.onWarnings?.(agentId, warnings);
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

// ─── Default Review Implementation ───────────────────────────────────────────

/**
 * Spawn a reviewer LLM via createAgentSession. Uses the same pattern as
 * agent-runner.ts but with minimal config: in-memory session, no extensions,
 * only watchdog_warn tool, single turn.
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

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    settingsManager,
    model: config.model as never,
    tools: [],
    resourceLoader: loader,
    customTools: [warnTool as never],
    ...(config.thinking ? { thinkingLevel: config.thinking as never } : { thinkingLevel: "medium" as never }),
  });

  await session.bindExtensions({});

  const prompt = buildReviewPrompt(diff, lspOutput, agentId);

  try {
    await session.prompt(prompt);
  } catch {
    // Reviewer failure is non-fatal
  }

  return collected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/watchdog.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add WatchdogRuntime with reviewer session and config parsing"
```

---

### Task 5: Add watchdog to settings and RuntimeDeps

**Files:**

- Modify: `src/core/settings.ts`
- Modify: `src/shared/runtime-deps.ts`

- [ ] **Step 1: Add watchdog to SubagentsSettings**

In `src/core/settings.ts`, add the import and field:

```typescript
import { parseWatchdogConfig, type WatchdogConfig } from "./watchdog.js";
```

Add to `SubagentsSettings`:
```typescript
watchdog?: WatchdogConfig;
```

Add to `sanitize()` function (inside the function body, after the `modelScope` block):
```typescript
if (r.watchdog !== undefined) {
  out.watchdog = parseWatchdogConfig(r.watchdog);
}
```

- [ ] **Step 2: Add watchdog to RuntimeDeps**

In `src/shared/runtime-deps.ts`, add the import:
```typescript
import type { WatchdogRuntime } from "../core/watchdog.js";
```

Add to `RuntimeDeps` interface:
```typescript
watchdog?: WatchdogRuntime;
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

### Task 6: Wire watchdog into index.ts

**Files:**

- Modify: `src/index.ts`

This task wires the watchdog into the extension lifecycle. Three integration points:

1. **Create runtime** in `createRuntimeDeps()` and add to deps object
2. **Hook into agent completion** in the `AgentManager` onComplete callback
3. **Register `/watchdog` slash command**
4. **Dispose on shutdown**

- [ ] **Step 1: Add imports**

At the top of `src/index.ts`, add:
```typescript
import { createWatchdogRuntime, parseWatchdogConfig, type WatchdogWarning } from "./core/watchdog.js";
```

- [ ] **Step 2: Create watchdog runtime in `createRuntimeDeps`**

Inside `createRuntimeDeps()`, after the `intercom` creation (~line 133) and before the `manager` creation (~line 135), add:

```typescript
// Watchdog: adversarial reviewer at agent-end boundaries
const watchdogSettings = loadSettings(process.cwd());
const watchdogConfig = watchdogSettings.watchdog ?? parseWatchdogConfig(undefined);
const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => {
    for (const w of warnings) {
      const content = `[${w.severity}] ${w.summary}\nEvidence: ${w.evidence}\nAction: ${w.recommendedAction}`;
      (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
        {
          customType: "watchdog-warning",
          content,
          display: true,
          details: { agentId, ...w },
        } as unknown as Parameters<typeof pi.sendMessage>[0],
        { deliverAs: "followUp", triggerTurn: true },
      );
    }
  },
});
```

- [ ] **Step 3: Hook into the AgentManager onComplete callback**

In the existing `new AgentManager(3, (record) => { ... })` callback, after the intercom cleanup line (`intercom.cancelForAgent(record.id);`), add:

```typescript
// Trigger watchdog review (non-blocking)
if (watchdog.status() !== "disabled" && record.status === "completed") {
  const agentCwd = (record as { cwd?: string }).cwd ?? process.cwd();
  watchdog.handleAgentEnd(record.id, agentCwd).catch(() => {});
}
```

- [ ] **Step 4: Add watchdog to deps object**

In the `deps` assignment object (~line 232), add:
```typescript
watchdog,
```

- [ ] **Step 5: Register `/watchdog` slash command**

In `registerSubagentsExtension()`, after the existing `registerPromptWorkflowCommands(pi, deps)` call (~line 302), add:

```typescript
// Watchdog slash command
pi.registerCommand("watchdog", {
  description: "Watchdog control: status, on, off",
  handler: async (args) => {
    const subcmd = args.trim().toLowerCase();
    if (subcmd === "on") {
      // Cannot dynamically re-enable after dispose — inform user
      pi.sendMessage({
        customType: "notification",
        content: "Watchdog is enabled via settings. Use /watchdog status to check.",
        display: true,
      } as Parameters<typeof pi.sendMessage>[0]);
    } else if (subcmd === "off") {
      deps.watchdog?.dispose();
      pi.sendMessage({
        customType: "notification",
        content: "Watchdog disabled for this session.",
        display: true,
      } as Parameters<typeof pi.sendMessage>[0]);
    } else {
      const status = deps.watchdog?.status() ?? "not initialized";
      pi.sendMessage({
        customType: "notification",
        content: `Watchdog status: ${status}`,
        display: true,
      } as Parameters<typeof pi.sendMessage>[0]);
    }
  },
});
```

- [ ] **Step 6: Add dispose to session_shutdown**

In the `pi.on("session_shutdown", ...)` handler (~line 466), add before `deps.manager.abortAll()`:
```typescript
deps.watchdog?.dispose();
```

- [ ] **Step 7: Run typecheck and test**

Run: `pnpm typecheck && pnpm test`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/index.ts
git commit -m "feat(watchdog): wire runtime into extension lifecycle and slash command"
```

---

### Task 7: Add `cwd` tracking to AgentManager records

The watchdog needs to know the agent's working directory to detect changes. Currently `AgentRecord` may not track `cwd`. Check if it does; if not, add it.

- [ ] **Step 1: Check AgentRecord type for cwd field**

Look at `src/shared/types.ts` `AgentRecord` type. If `cwd` is already there, skip this task.

- [ ] **Step 2: If missing, add `cwd?: string` to AgentRecord**

- [ ] **Step 3: Pass cwd when spawning**

In the spawn path (wherever `AgentRecord` is created), ensure `cwd` is stored from the spawn options.

- [ ] **Step 4: Commit (if changes needed)**

```bash
git add -A
git commit -m "feat(watchdog): track cwd in AgentRecord for change detection"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors (or only auto-fixable)

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 5: Fix any issues found, commit**

```bash
git add -A
git commit -m "chore: fix lint/type issues from watchdog integration"
```

---

## Deferred Work (follow-up issues)

These items are explicitly out of scope for this initial implementation:

1. **Auto-follow steering** — When watchdog finds blockers, automatically steer the agent to fix them. Requires stalemate detection state machine. Neither reference implementation has shipped this.
2. **Child watchdog** — Per-child-agent watchdog instances with config overrides. Adds complexity to spawn path.
3. **Watchdog message renderer** — Custom TUI rendering for watchdog warnings (severity icon, colors). Currently uses plain text via `customType`.
4. **Turn-delta mode** — Review based on conversation turn deltas rather than git changes. Useful for non-code tasks.
5. **Full LSP client** — Replace `tsc --noEmit` with JSON-RPC LSP client for richer diagnostics.
6. **Model recommendation** — Suggest a complementary strong model for watchdog reviews.
