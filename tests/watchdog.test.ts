import { describe, expect, it, afterEach } from "vitest";
import { computeChangeSignature, createWatchdogWarnTool, createWatchdogRuntime, parseWatchdogConfig } from "../src/core/watchdog.js";
import type { WatchdogWarning } from "../src/core/watchdog.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// File-level tmps array so all describe blocks can share cleanup
const tmps: string[] = [];
afterEach(() => {
  for (const tmp of tmps.splice(0)) {
    rmSync(tmp, { recursive: true, force: true });
  }
});

describe("computeChangeSignature", () => {
  function makeTmp(prefix: string): string {
    const tmp = mkdtempSync(join(tmpdir(), prefix));
    tmps.push(tmp);
    return tmp;
  }

  it("returns undefined for non-git directory", () => {
    const tmp = makeTmp("watchdog-");
    expect(computeChangeSignature(tmp)).toBeUndefined();
  });

  it("returns a signature with key and changedPaths for git repo with changes", () => {
    const tmp = makeTmp("watchdog-git-");
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
    const tmp = makeTmp("watchdog-clean-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "clean");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeUndefined();
  });

  it("filters out .pi/ and node_modules/ paths", () => {
    const tmp = makeTmp("watchdog-filter-");
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
    const tmp = makeTmp("watchdog-keys-");
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

  it("handles renamed files — includes new path, excludes source path corruption", () => {
    const tmp = makeTmp("watchdog-rename-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "old.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    // Rename the file
    execSync("git mv old.ts new.ts", { cwd: tmp, stdio: "pipe" });

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeDefined();
    // Should include the new path
    expect(sig!.changedPaths).toContain("new.ts");
    // Should NOT include corrupted source path (no paths like ".ts", "d.ts", etc.)
    for (const p of sig!.changedPaths) {
      expect(p).not.toBe(".ts");
      expect(p).not.toBe("d.ts");
      expect(p.startsWith(".")).toBe(false);
    }
  });

  it("handles deleted files in the signature", () => {
    const tmp = makeTmp("watchdog-deleted-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });

    execSync("git rm file.ts", { cwd: tmp, stdio: "pipe" });

    const sig = computeChangeSignature(tmp);
    expect(sig).toBeDefined();
    expect(sig!.changedPaths).toContain("file.ts");
    expect(sig!.key).toBeTruthy();
  });
});

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
  function makeTmp(prefix: string): string {
    const tmp = mkdtempSync(join(tmpdir(), prefix));
    tmps.push(tmp);
    return tmp;
  }

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
    tmps.push(tmp);
    const warnings = await runtime.handleAgentEnd("test-agent", tmp);
    expect(warnings).toEqual([]);
  });

  it("handleAgentEnd invokes runReview when changes detected", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-review-"));
    tmps.push(tmp);
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

  it("onWarnings callback is invoked with produced warnings", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-cb-"));
    tmps.push(tmp);
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    let callbackAgentId = "";
    let callbackWarnings: WatchdogWarning[] = [];
    const runtime = createWatchdogRuntime(parseWatchdogConfig({ enabled: true }), {
      runReview: async () => [{ severity: "blocker", summary: "CB test", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" }],
      onWarnings: (agentId, warnings) => {
        callbackAgentId = agentId;
        callbackWarnings = warnings;
      },
    });

    await runtime.handleAgentEnd("agent-xyz", tmp);
    expect(callbackAgentId).toBe("agent-xyz");
    expect(callbackWarnings).toHaveLength(1);
  });

  it("status transitions idle -> reviewing -> idle during handleAgentEnd", async () => {
    const tmp = makeTmp("watchdog-status-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const runtime = createWatchdogRuntime(parseWatchdogConfig({ enabled: true }), {
      runReview: async () => [],
    });

    expect(runtime.status()).toBe("idle");
    const promise = runtime.handleAgentEnd("test-agent", tmp);
    // Status transitions to "reviewing" synchronously before first await
    expect(runtime.status()).toBe("reviewing");
    await promise;
    expect(runtime.status()).toBe("idle");
  });
});
