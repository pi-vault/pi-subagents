import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseSha: string;
  workPath: string;
  syntheticPaths?: string[];
}

export interface WorktreeCleanupResult {
  hasChanges: boolean;
  branch?: string;
}

export interface WorktreeTaskCwdConflict {
  index: number;
  agent: string;
  cwd: string;
}

/**
 * Detect per-task cwd overrides that conflict with worktree isolation.
 * Worktree agents share a single working directory (the worktree root or subdirectory).
 * Per-task cwd overrides break this isolation — return the first conflict found.
 */
export function findWorktreeTaskCwdConflict(
  tasks: ReadonlyArray<{ agent: string; cwd?: string }>,
  sharedCwd: string,
): WorktreeTaskCwdConflict | undefined {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    if (task.cwd && task.cwd !== sharedCwd) {
      return { index: i, agent: task.agent, cwd: task.cwd };
    }
  }
  return undefined;
}

export function createWorktree(cwd: string, agentId: string): WorktreeInfo | undefined {
  let baseSha: string;
  let subdir: string;
  let topLevel: string;
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "pipe", timeout: 5000 });
    baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, stdio: "pipe", timeout: 5000 })
      .toString()
      .trim();
    topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    })
      .toString()
      .trim();
    subdir = relative(realpathSync(topLevel), realpathSync(cwd));
  } catch {
    return undefined;
  }

  const branch = `pi-agent-${agentId}`;
  const suffix = randomUUID().slice(0, 8);
  const worktreePath = join(tmpdir(), `pi-agent-${agentId}-${suffix}`);

  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
      cwd,
      stdio: "pipe",
      timeout: 30000,
    });

    // Symlink node_modules if present in repo root
    const syntheticPaths: string[] = [];
    const realTopLevel = realpathSync(topLevel);
    const repoNodeModules = join(realTopLevel, "node_modules");
    const wtNodeModules = join(worktreePath, "node_modules");
    if (existsSync(repoNodeModules) && !existsSync(wtNodeModules)) {
      try {
        symlinkSync(repoNodeModules, wtNodeModules);
        syntheticPaths.push("node_modules");
      } catch {
        // Non-fatal: worktree works without node_modules link
      }
    }

    // Run setup hook if .pi/worktree-setup.sh exists
    const setupHook = join(realTopLevel, ".pi", "worktree-setup.sh");
    if (existsSync(setupHook)) {
      try {
        const hookInput = JSON.stringify({
          version: 1,
          repoRoot: realTopLevel,
          worktreePath,
          agentCwd: subdir ? join(worktreePath, subdir) : worktreePath,
          branch,
          index: 0,
          runId: agentId,
          baseCommit: baseSha,
        });
        const hookOutput = execFileSync(setupHook, [], {
          cwd: worktreePath,
          input: hookInput,
          encoding: "utf-8",
          timeout: 30_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        try {
          const parsed = JSON.parse(hookOutput.trim()) as {
            syntheticPaths?: string[];
          };
          if (Array.isArray(parsed.syntheticPaths)) {
            for (const p of parsed.syntheticPaths) {
              if (
                typeof p === "string" &&
                p &&
                !p.startsWith("/") &&
                !p.includes("..")
              ) {
                syntheticPaths.push(p);
              }
            }
          }
        } catch {
          /* ignore JSON parse errors from hook */
        }
      } catch {
        /* hook failure is non-fatal */
      }
    }

    return {
      path: worktreePath,
      branch,
      baseSha,
      workPath: subdir ? join(worktreePath, subdir) : worktreePath,
      syntheticPaths: syntheticPaths.length > 0 ? syntheticPaths : undefined,
    };
  } catch {
    return undefined;
  }
}

export function cleanupWorktree(
  cwd: string,
  worktree: WorktreeInfo,
  agentDescription: string,
): WorktreeCleanupResult {
  if (!existsSync(worktree.path)) return { hasChanges: false };

  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktree.path,
      stdio: "pipe",
      timeout: 10000,
    })
      .toString()
      .trim();

    if (status) {
      execFileSync("git", ["add", "-A"], { cwd: worktree.path, stdio: "pipe", timeout: 10000 });
      const commitMsg = `pi-agent: ${agentDescription.slice(0, 200)}`;
      execFileSync("git", ["commit", "--no-verify", "-m", commitMsg], {
        cwd: worktree.path,
        stdio: "pipe",
        timeout: 10000,
      });
    } else {
      const currentSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: worktree.path,
        stdio: "pipe",
        timeout: 5000,
      })
        .toString()
        .trim();
      if (currentSha === worktree.baseSha) {
        removeWorktree(cwd, worktree.path);
        return { hasChanges: false };
      }
    }

    let branchName = worktree.branch;
    try {
      execFileSync("git", ["branch", branchName], {
        cwd: worktree.path,
        stdio: "pipe",
        timeout: 5000,
      });
    } catch {
      branchName = `${worktree.branch}-${Date.now()}`;
      execFileSync("git", ["branch", branchName], {
        cwd: worktree.path,
        stdio: "pipe",
        timeout: 5000,
      });
    }
    worktree.branch = branchName;

    removeWorktree(cwd, worktree.path);
    return { hasChanges: true, branch: worktree.branch };
  } catch {
    try {
      removeWorktree(cwd, worktree.path);
    } catch {}
    return { hasChanges: false };
  }
}

function removeWorktree(cwd: string, worktreePath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd,
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    try {
      execFileSync("git", ["worktree", "prune"], { cwd, stdio: "pipe", timeout: 5000 });
    } catch {}
  }
}

export function pruneWorktrees(cwd: string): void {
  try {
    execFileSync("git", ["worktree", "prune"], { cwd, stdio: "pipe", timeout: 5000 });
  } catch {}
}
