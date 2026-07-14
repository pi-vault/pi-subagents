import { describe, expect, it, afterEach } from "vitest";
import { computeChangeSignature, createWatchdogWarnTool } from "../src/core/watchdog.js";
import type { WatchdogWarning } from "../src/core/watchdog.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("computeChangeSignature", () => {
  const tmps: string[] = [];

  function makeTmp(prefix: string): string {
    const tmp = mkdtempSync(join(tmpdir(), prefix));
    tmps.push(tmp);
    return tmp;
  }

  afterEach(() => {
    for (const tmp of tmps.splice(0)) {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

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
