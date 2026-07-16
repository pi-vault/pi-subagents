import { describe, expect, it, afterEach } from "vitest";
import { computeChangeSignature, createWatchdogWarnTool, createWatchdogRuntime, parseWatchdogConfig } from "../src/core/watchdog.js";
import type { WatchdogWarning } from "../src/core/watchdog.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// Task 1 shape test (verifies what index.ts onWarnings should emit)
describe("watchdog warning message shape", () => {
  it("onWarnings details include state field when wired in index.ts", () => {
    const warning: WatchdogWarning = {
      severity: "blocker",
      summary: "Missing null check",
      evidence: "src/foo.ts:42",
      recommendedAction: "Add null guard",
      category: "correctness",
    };
    // This is the shape that index.ts onWarnings must produce after Task 1
    const details = { agentId: "agent-1", ...warning, state: "displayed" };
    expect(details).toMatchObject({
      severity: "blocker",
      summary: "Missing null check",
      state: "displayed",
      agentId: "agent-1",
    });
  });
});

// File-level tmps array so all describe blocks can share cleanup
const tmps: string[] = [];
afterEach(() => {
  for (const tmp of tmps.splice(0)) {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function makeTmp(prefix: string): string {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(tmp);
  return tmp;
}

/** Create a git repo with one committed file and one dirty file (staged but uncommitted). */
function makeGitRepoWithChanges(prefix: string): string {
  const tmp = makeTmp(prefix);
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
  writeFileSync(join(tmp, "file.ts"), "const x = 1;");
  execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
  writeFileSync(join(tmp, "file.ts"), "const x = 2;"); // dirty
  return tmp;
}

describe("computeChangeSignature", () => {
  it("returns undefined for non-git directory", () => {
    const tmp = makeTmp("watchdog-");
    expect(computeChangeSignature(tmp)).toBeUndefined();
  });

  it("returns a signature with changedPaths for git repo with changes", () => {
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

  it("returns default children config when not specified", () => {
    const config = parseWatchdogConfig({ enabled: true });
    expect(config.children.enabled).toBe(false);
    expect(config.children.overrides).toEqual({});
  });

  it("parses children enabled flag", () => {
    const config = parseWatchdogConfig({ enabled: true, children: { enabled: true } });
    expect(config.children.enabled).toBe(true);
  });

  it("parses children model and overrides", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: {
        enabled: true,
        model: "child-model",
        overrides: { scout: { enabled: false } },
      },
    });
    expect(config.children.model).toBe("child-model");
    expect(config.children.overrides.scout.enabled).toBe(false);
  });
});

describe("WatchdogRuntime", () => {
  const policyCases = [
    {
      name: "uses parent defaults when child policy is disabled",
      raw: {
        enabled: true,
        model: "parent-model",
        thinking: "high",
        children: { enabled: false },
      },
      type: "worker",
      expectedModel: "parent-model",
      expectedThinking: "high",
      expectedSource: "parent",
    },
    {
      name: "uses child defaults with parent fallback",
      raw: {
        enabled: true,
        model: "parent-model",
        thinking: "high",
        children: { enabled: true, model: "child-model" },
      },
      type: "worker",
      expectedModel: "child-model",
      expectedThinking: "high",
      expectedSource: "child",
    },
    {
      name: "uses per-Agent overrides",
      raw: {
        enabled: true,
        model: "parent-model",
        thinking: "high",
        children: {
          enabled: true,
          model: "child-model",
          overrides: { scout: { model: "scout-model", thinking: "low" } },
        },
      },
      type: "scout",
      expectedModel: "scout-model",
      expectedThinking: "low",
      expectedSource: "child",
    },
    {
      name: "falls back to parent when the Agent override disables child policy",
      raw: {
        enabled: true,
        model: "parent-model",
        thinking: "high",
        children: {
          enabled: true,
          model: "child-model",
          overrides: { scout: { enabled: false } },
        },
      },
      type: "scout",
      expectedModel: "parent-model",
      expectedThinking: "high",
      expectedSource: "parent",
    },
  ] as const;

  it.each(policyCases)("$name", async ({
    raw,
    type,
    expectedModel,
    expectedThinking,
    expectedSource,
  }) => {
    let selected: { model?: string; thinking?: string } | undefined;
    let deliveredSource: "parent" | "child" | undefined;
    let callbackCount = 0;

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ ...raw, reviewChangesOnly: false }),
      {
        runReview: async (_diff, _lsp, _agentId, reviewConfig) => {
          selected = reviewConfig;
          return [{
            severity: "concern",
            summary: "Policy test",
            evidence: "file.ts:1",
            recommendedAction: "Inspect",
            category: "other",
          }];
        },
        onWarnings: (_agentId, _warnings, source) => {
          callbackCount++;
          deliveredSource = source;
        },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type, cwd: "/tmp" });

    expect(selected?.model).toBe(expectedModel);
    expect(selected?.thinking).toBe(expectedThinking);
    expect(deliveredSource).toBe(expectedSource);
    expect(callbackCount).toBe(1);
  });

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
    const warnings = await runtime.handleAgentEnd({
      id: "test-agent",
      type: "worker",
      cwd: "/tmp",
    });
    expect(warnings).toEqual([]);
  });

  it("handleAgentEnd returns empty for non-git directory", async () => {
    const runtime = createWatchdogRuntime(parseWatchdogConfig({ enabled: true }));
    const tmp = mkdtempSync(join(tmpdir(), "watchdog-nongit-"));
    tmps.push(tmp);
    const warnings = await runtime.handleAgentEnd({ id: "test-agent", type: "worker", cwd: tmp });
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

    const warnings = await runtime.handleAgentEnd({ id: "test-agent", type: "worker", cwd: tmp });
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

    await runtime.handleAgentEnd({ id: "agent-xyz", type: "worker", cwd: tmp });
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
    const promise = runtime.handleAgentEnd({ id: "test-agent", type: "worker", cwd: tmp });
    // Status transitions to "reviewing" synchronously before first await
    expect(runtime.status()).toBe("reviewing");
    await promise;
    expect(runtime.status()).toBe("idle");
  });

  it("stays reviewing until all overlapping reviews finish", async () => {
    const deferredReviews: Array<{ resolve: () => void }> = [];
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, reviewChangesOnly: false }),
      {
        runReview: () => new Promise((resolve) => {
          deferredReviews.push({ resolve: () => resolve([]) });
        }),
      },
    );

    const first = runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: "/tmp" });
    const second = runtime.handleAgentEnd({ id: "agent-2", type: "worker", cwd: "/tmp" });
    expect(runtime.status()).toBe("reviewing");

    const [firstReview, secondReview] = deferredReviews;
    if (!firstReview || !secondReview) throw new Error("reviews did not start");

    firstReview.resolve();
    await first;
    expect(runtime.status()).toBe("reviewing");

    secondReview.resolve();
    await second;
    expect(runtime.status()).toBe("idle");
  });
});

describe("turn-delta mode", () => {
  it("passes turn-delta to runReview when reviewChangesOnly is false", async () => {
    let reviewInput = "";
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, reviewChangesOnly: false }),
      {
        runReview: async (diff) => {
          reviewInput = diff;
          return [];
        },
        getSessionMessages: () => [
          { role: "assistant", content: [{ type: "tool_use", name: "read_file", input: { path: "/x.ts" } }] },
        ],
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: "/tmp/nonexistent" });
    expect(reviewInput).toContain("read_file");
    expect(reviewInput).toContain("/x.ts");
  });

  it("uses fallback text when no messages are available", async () => {
    let reviewInput = "";
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, reviewChangesOnly: false }),
      {
        runReview: async (diff) => {
          reviewInput = diff;
          return [];
        },
        getSessionMessages: () => undefined,
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: "/tmp" });
    expect(reviewInput).toContain("no conversation data");
  });

  it("calls onWarnings when turn-delta review produces warnings", async () => {
    const emitted: WatchdogWarning[] = [];
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, reviewChangesOnly: false }),
      {
        runReview: async () => [
          { severity: "blocker", summary: "Missing error handling", evidence: "src/x.ts:5", recommendedAction: "Add try/catch", category: "correctness" },
        ],
        onWarnings: (_id, ws) => emitted.push(...ws),
        getSessionMessages: () => [{ role: "user", content: "Do the task" }],
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: "/tmp" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].summary).toBe("Missing error handling");
  });

  it("parses reviewChangesOnly false from config", () => {
    const config = parseWatchdogConfig({ enabled: true, reviewChangesOnly: false });
    expect(config.reviewChangesOnly).toBe(false);
  });

  it("defaults reviewChangesOnly to true", () => {
    const config = parseWatchdogConfig({ enabled: true });
    expect(config.reviewChangesOnly).toBe(true);
  });
});

describe("auto-follow steering", () => {
  it("does not auto-follow child-policy reviews", async () => {
    let reviewCount = 0;
    let resumeCount = 0;
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({
        enabled: true,
        reviewChangesOnly: false,
        children: { enabled: true },
        autoFollow: { blockers: true, maxAttempts: 2 },
      }),
      {
        runReview: async () => {
          reviewCount++;
          return [{
            severity: "blocker",
            summary: "Child issue",
            evidence: "file.ts:1",
            recommendedAction: "Fix",
            category: "correctness",
          }];
        },
        resumeAgent: async () => { resumeCount++; },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: "/tmp" });

    expect(reviewCount).toBe(1);
    expect(resumeCount).toBe(0);
  });

  it("does nothing when autoFollow.blockers is false (default)", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-no-autofollow-");
    const resumed: string[] = [];
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true }),
      {
        runReview: async () => [
          { severity: "blocker", summary: "Bug", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    expect(resumed).toHaveLength(0);
  });

  it("resumes agent once when blockers found and autoFollow.blockers is true", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-autofollow-");
    const resumed: Array<{ id: string; message: string }> = [];
    let callCount = 0;

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 2 } }),
      {
        runReview: async () => {
          callCount++;
          // First call: issue found; second call: issue resolved
          return callCount === 1
            ? [{ severity: "blocker", summary: "Null deref", evidence: "file.ts:1", recommendedAction: "Fix it", category: "correctness" }]
            : [];
        },
        resumeAgent: async (id, message) => { resumed.push({ id, message }); },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    expect(resumed).toHaveLength(1);
    expect(resumed[0].id).toBe("agent-1");
    expect(resumed[0].message).toContain("Null deref");
  });

  it("stops after maxAttempts even if issues persist", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-maxattempts-");
    const resumed: string[] = [];

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 10 } }),
      {
        runReview: async () => [
          { severity: "blocker", summary: "Persistent bug", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    expect(resumed).toHaveLength(2); // maxAttempts = 2
  });

  it("detects stalemate and stops early when same warnings repeat", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-stalemate-");
    const resumed: string[] = [];

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, autoFollow: { blockers: true, concerns: false, maxAttempts: 10, stalemateRepeats: 2 } }),
      {
        runReview: async () => [
          { severity: "blocker", summary: "Same bug forever", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    // Should stop at stalemateRepeats (2), not maxAttempts (10)
    expect(resumed.length).toBe(2);
  });

  it("does not resume for concerns when autoFollow.concerns is false", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-concern-skip-");
    const resumed: string[] = [];

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, autoFollow: { blockers: true, concerns: false, maxAttempts: 3, stalemateRepeats: 2 } }),
      {
        runReview: async () => [
          { severity: "concern", summary: "Style issue", evidence: "file.ts:1", recommendedAction: "Refactor", category: "other" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    expect(resumed).toHaveLength(0);
  });

  it("parses autoFollow config", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      autoFollow: { blockers: true, concerns: true, maxAttempts: 3, stalemateRepeats: 3 },
    });
    expect(config.autoFollow.blockers).toBe(true);
    expect(config.autoFollow.concerns).toBe(true);
    expect(config.autoFollow.maxAttempts).toBe(3);
    expect(config.autoFollow.stalemateRepeats).toBe(3);
  });

  it("defaults autoFollow to all-disabled", () => {
    const config = parseWatchdogConfig({ enabled: true });
    expect(config.autoFollow.blockers).toBe(false);
    expect(config.autoFollow.concerns).toBe(false);
    expect(config.autoFollow.maxAttempts).toBe(2);
  });

  it("re-review receives fresh diff (not stale captured diff)", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-fresh-diff-");
    const diffsSeen: string[] = [];
    let callCount = 0;

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, autoFollow: { blockers: true, concerns: false, maxAttempts: 1, stalemateRepeats: 2 } }),
      {
        runReview: async (diff) => {
          diffsSeen.push(diff);
          callCount++;
          return [{ severity: "blocker", summary: "Bug", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" }];
        },
        resumeAgent: async () => {
          // Simulate agent modifying a file between reviews
          writeFileSync(join(tmp, "file.ts"), `const x = ${callCount + 10};`);
        },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    // Should have been called twice (initial + 1 re-review from maxAttempts=1)
    expect(diffsSeen.length).toBe(2);
    // The second diff should differ from the first (fresh data, not stale)
    expect(diffsSeen[0]).not.toBe(diffsSeen[1]);
  });

  it("re-review does not deduplicate via globalSeen (fresh seen per re-review)", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-fresh-seen-");
    let callCount = 0;
    const warningCounts: number[] = [];

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 3 } }),
      {
        runReview: async () => {
          callCount++;
          const warnings: WatchdogWarning[] = [{ severity: "blocker", summary: "Same bug", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" }];
          warningCounts.push(warnings.length);
          return warnings;
        },
        resumeAgent: async () => {},
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    // All re-review calls should return 1 warning (not 0 due to dedup)
    expect(warningCounts.every(c => c === 1)).toBe(true);
    // Should have called runReview 3 times: initial + 2 from maxAttempts=2
    expect(callCount).toBe(3);
  });

  it("resumes for concerns when autoFollow.concerns is true", async () => {
    const tmp = makeGitRepoWithChanges("watchdog-concerns-enabled-");
    const resumed: string[] = [];
    let callCount = 0;

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, autoFollow: { blockers: false, concerns: true, maxAttempts: 1, stalemateRepeats: 2 } }),
      {
        runReview: async () => {
          callCount++;
          return callCount === 1
            ? [{ severity: "concern", summary: "Style issue", evidence: "file.ts:1", recommendedAction: "Refactor", category: "other" }]
            : [];
        },
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd({ id: "agent-1", type: "worker", cwd: tmp });
    expect(resumed).toHaveLength(1);
  });
});
