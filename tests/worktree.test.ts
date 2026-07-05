import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorktree, cleanupWorktree } from "../src/core/worktree.js";

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
