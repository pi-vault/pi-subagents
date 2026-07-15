import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorktree, cleanupWorktree, findWorktreeTaskCwdConflict } from "../src/core/worktree.js";

describe("worktree", () => {
  const testDir = join(tmpdir(), `pi-worktree-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: testDir, stdio: "pipe" });
    writeFileSync(join(testDir, "file.txt"), "hello");
    execFileSync("git", ["add", "-A"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: testDir, stdio: "pipe" });
  });

  afterEach(() => {
    // Clean up worktrees before removing the repo
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: testDir, stdio: "pipe" });
    } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates a worktree in a valid git repo", () => {
    const wt = createWorktree(testDir, "test-agent");
    if (!wt) throw new Error("Expected wt to be defined");
    expect(wt.baseSha).toBeTruthy();
    expect(wt.branch).toContain("test-agent");
    // Clean up
    cleanupWorktree(testDir, wt, "test");
  });

  it("returns undefined for non-git directory", () => {
    const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
    mkdirSync(nonGitDir, { recursive: true });
    const wt = createWorktree(nonGitDir, "test-agent");
    expect(wt).toBeUndefined();
    rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("cleanup with no changes removes worktree", () => {
    const wt = createWorktree(testDir, "clean-agent");
    if (!wt) throw new Error("Expected wt to be defined");
    const result = cleanupWorktree(testDir, wt, "test");
    expect(result.hasChanges).toBe(false);
  });

  it("cleanup with changes creates branch", () => {
    const wt = createWorktree(testDir, "dirty-agent");
    if (!wt) throw new Error("Expected wt to be defined");
    writeFileSync(join(wt.path, "new-file.txt"), "new content");
    const result = cleanupWorktree(testDir, wt, "test changes");
    expect(result.hasChanges).toBe(true);
    expect(result.branch).toBeTruthy();
  });
});

describe("worktree — node_modules linking", () => {
  const testDir = join(tmpdir(), `pi-wt-link-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: testDir, stdio: "pipe" });
    writeFileSync(join(testDir, "file.txt"), "hello");
    execFileSync("git", ["add", "-A"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: testDir, stdio: "pipe" });
  });

  afterEach(() => {
    try { execFileSync("git", ["worktree", "prune"], { cwd: testDir, stdio: "pipe" }); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  it("symlinks node_modules into worktree when present in repo root", () => {
    mkdirSync(join(testDir, "node_modules", "foo"), { recursive: true });
    const wt = createWorktree(testDir, "link-test");
    if (!wt) throw new Error("Expected wt");
    expect(existsSync(join(wt.path, "node_modules"))).toBe(true);
    expect(wt.syntheticPaths).toContain("node_modules");
    cleanupWorktree(testDir, wt, "test");
  });

  it("does not create symlink when no node_modules in repo", () => {
    const wt = createWorktree(testDir, "no-nm-test");
    if (!wt) throw new Error("Expected wt");
    expect(existsSync(join(wt.path, "node_modules"))).toBe(false);
    expect(wt.syntheticPaths ?? []).not.toContain("node_modules");
    cleanupWorktree(testDir, wt, "test");
  });
});

describe("worktree — setup hook", () => {
  const testDir = join(tmpdir(), `pi-wt-hook-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: testDir, stdio: "pipe" });
    writeFileSync(join(testDir, "file.txt"), "hello");
    execFileSync("git", ["add", "-A"], { cwd: testDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: testDir, stdio: "pipe" });
  });

  afterEach(() => {
    try { execFileSync("git", ["worktree", "prune"], { cwd: testDir, stdio: "pipe" }); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  it("runs .pi/worktree-setup.sh and captures syntheticPaths from stdout", () => {
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    // Hook reads JSON from stdin, outputs JSON with syntheticPaths to stdout
    writeFileSync(
      join(testDir, ".pi", "worktree-setup.sh"),
      '#!/bin/sh\ncat > /dev/null\necho \'{"syntheticPaths":["dist/","build/"]}\'',
      { mode: 0o755 },
    );
    const wt = createWorktree(testDir, "hook-test");
    if (!wt) throw new Error("Expected wt");
    expect(wt.syntheticPaths).toContain("dist/");
    expect(wt.syntheticPaths).toContain("build/");
    cleanupWorktree(testDir, wt, "test");
  });

  it("ignores hook errors gracefully", () => {
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    writeFileSync(
      join(testDir, ".pi", "worktree-setup.sh"),
      "#!/bin/sh\nexit 1",
      { mode: 0o755 },
    );
    const wt = createWorktree(testDir, "hook-fail-test");
    // Should still succeed — hook failure is non-fatal
    expect(wt).toBeDefined();
    if (wt) cleanupWorktree(testDir, wt, "test");
  });

  it("skips hook when .pi/worktree-setup.sh does not exist", () => {
    const wt = createWorktree(testDir, "no-hook-test");
    expect(wt).toBeDefined();
    if (wt) {
      expect(wt.syntheticPaths ?? []).toEqual([]);
      cleanupWorktree(testDir, wt, "test");
    }
  });
});

describe("findWorktreeTaskCwdConflict", () => {
  it("returns undefined when no task has a cwd override", () => {
    const result = findWorktreeTaskCwdConflict(
      [{ agent: "a" }, { agent: "b" }],
      "/project",
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when task cwd matches shared cwd", () => {
    const result = findWorktreeTaskCwdConflict(
      [{ agent: "a", cwd: "/project" }, { agent: "b" }],
      "/project",
    );
    expect(result).toBeUndefined();
  });

  it("returns the first conflicting task", () => {
    const result = findWorktreeTaskCwdConflict(
      [
        { agent: "a" },
        { agent: "b", cwd: "/other/dir" },
        { agent: "c", cwd: "/another" },
      ],
      "/project",
    );
    expect(result).toEqual({ index: 1, agent: "b", cwd: "/other/dir" });
  });
});
