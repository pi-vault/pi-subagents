import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  isSymlink,
  isUnsafeName,
  resolveContained,
  safeReadFile,
} from "../src/core/safe-fs.js";
import { discoverAgents } from "../src/core/agents.js";
import type { ResolvedPaths } from "../src/shared/types.js";

describe("isSymlink", () => {
  const tmp = mkdtempSync(join(tmpdir(), "safe-fs-"));
  const realFile = join(tmp, "real.txt");
  const link = join(tmp, "link.txt");

  writeFileSync(realFile, "hello");
  symlinkSync(realFile, link);

  it("returns false for a regular file", () => {
    expect(isSymlink(realFile)).toBe(false);
  });

  it("returns true for a symlink", () => {
    expect(isSymlink(link)).toBe(true);
  });

  it("returns false for a nonexistent path", () => {
    expect(isSymlink(join(tmp, "nope.txt"))).toBe(false);
  });

  it("returns false for a directory", () => {
    const dir = join(tmp, "subdir");
    mkdirSync(dir, { recursive: true });
    expect(isSymlink(dir)).toBe(false);
  });
});

describe("safeReadFile", () => {
  const tmp = mkdtempSync(join(tmpdir(), "safe-fs-read-"));
  const realFile = join(tmp, "content.txt");
  const linkToFile = join(tmp, "linked.txt");

  writeFileSync(realFile, "file content here");
  symlinkSync(realFile, linkToFile);

  it("reads a normal file", () => {
    expect(safeReadFile(realFile)).toBe("file content here");
  });

  it("returns undefined for a symlink", () => {
    expect(safeReadFile(linkToFile)).toBeUndefined();
  });

  it("returns undefined for a nonexistent file", () => {
    expect(safeReadFile(join(tmp, "missing.txt"))).toBeUndefined();
  });
});

describe("isUnsafeName", () => {
  it("allows simple alphanumeric names", () => {
    expect(isUnsafeName("scout")).toBe(false);
    expect(isUnsafeName("SecurityReviewer")).toBe(false);
    expect(isUnsafeName("agent01")).toBe(false);
  });

  it("allows dots, hyphens, underscores after first char", () => {
    expect(isUnsafeName("my-agent")).toBe(false);
    expect(isUnsafeName("my_agent")).toBe(false);
    expect(isUnsafeName("my.agent")).toBe(false);
    expect(isUnsafeName("a.b-c_d")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isUnsafeName("")).toBe(true);
  });

  it("rejects names longer than 128 chars", () => {
    expect(isUnsafeName("a".repeat(129))).toBe(true);
    expect(isUnsafeName("a".repeat(128))).toBe(false);
  });

  it("rejects names with NUL byte", () => {
    expect(isUnsafeName("foo\x00bar")).toBe(true);
  });

  it("rejects names starting with non-alphanumeric", () => {
    expect(isUnsafeName(".hidden")).toBe(true);
    expect(isUnsafeName("-dashed")).toBe(true);
    expect(isUnsafeName("_under")).toBe(true);
  });

  it("rejects dot and dot-dot", () => {
    expect(isUnsafeName(".")).toBe(true);
    expect(isUnsafeName("..")).toBe(true);
  });

  it("rejects path separators", () => {
    expect(isUnsafeName("foo/bar")).toBe(true);
    expect(isUnsafeName("foo\\bar")).toBe(true);
  });

  it("rejects spaces and special characters", () => {
    expect(isUnsafeName("foo bar")).toBe(true);
    expect(isUnsafeName("foo@bar")).toBe(true);
    expect(isUnsafeName("foo:bar")).toBe(true);
  });
});

describe("resolveContained", () => {
  const tmp = mkdtempSync(join(tmpdir(), "safe-fs-resolve-"));
  const nested = join(tmp, "sub", "deep");
  mkdirSync(nested, { recursive: true });

  it("returns normalized root when no segments provided", () => {
    const result = resolveContained(tmp);
    expect(result).toBe(resolve(tmp));
  });

  it("resolves a simple relative path within root", () => {
    const result = resolveContained(tmp, "sub", "deep");
    expect(result).toBe(join(tmp, "sub", "deep"));
  });

  it("resolves a single segment", () => {
    const result = resolveContained(tmp, "sub");
    expect(result).toBe(join(tmp, "sub"));
  });

  it("returns undefined when segments contain ..", () => {
    expect(resolveContained(tmp, "sub", "..", "..", "etc")).toBeUndefined();
  });

  it("returns undefined for absolute segment", () => {
    expect(resolveContained(tmp, "/etc/passwd")).toBeUndefined();
  });

  it("returns undefined for segment with colon", () => {
    expect(resolveContained(tmp, "C:foo")).toBeUndefined();
  });

  it("returns undefined when segment is ..", () => {
    expect(resolveContained(tmp, "..", "other")).toBeUndefined();
  });

  it("returns undefined when segment is .", () => {
    expect(resolveContained(tmp, ".", "other")).toBeUndefined();
  });

  it("returns undefined for segment with embedded separator", () => {
    expect(resolveContained(tmp, "sub/../etc")).toBeUndefined();
    expect(resolveContained(tmp, "sub\\..\\etc")).toBeUndefined();
  });

  it("returns undefined for segment with NUL byte", () => {
    expect(resolveContained(tmp, "foo\x00bar")).toBeUndefined();
  });

  it("allows names containing consecutive dots (not traversal)", () => {
    const result = resolveContained(tmp, "foo..bar");
    expect(result).toBe(join(tmp, "foo..bar"));
  });

  it("returns undefined when intermediate is a symlink", () => {
    const realDir = join(tmp, "real-dir");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "target.txt"), "ok");
    const symlinkDir = join(tmp, "sym-dir");
    symlinkSync(realDir, symlinkDir);
    expect(resolveContained(tmp, "sym-dir", "target.txt")).toBeUndefined();
  });

  it("allows non-existent paths that don't escape root", () => {
    const result = resolveContained(tmp, "new-dir", "new-file.md");
    expect(result).toBe(join(tmp, "new-dir", "new-file.md"));
  });
});

function createPaths(rootDir: string): ResolvedPaths {
  return {
    agentDir: join(rootDir, "agent"),
    configPath: join(rootDir, "agent", "extensions", "subagents.json"),
    userAgentsDir: join(rootDir, "agent", "agents"),
    bundledAgentsDir: join(rootDir, "bundled-agents"),
    sessionsDir: join(rootDir, "agent", "sessions"),
    userChainsDir: join(rootDir, "agent", "chains"),
    bundledChainsDir: join(rootDir, "bundled-chains"),
    userPromptsDir: join(rootDir, "agent", "prompts"),
    bundledPromptsDir: join(rootDir, "bundled-prompts"),
  };
}

describe("integration: discovery ignores unsafe files", () => {
  it("discoverAgents skips symlinked .md files with diagnostic", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "safe-fs-integration-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.bundledAgentsDir, "worker.md"),
      "---\nname: worker\ndescription: Does work\ntools: read\n---\nDo work\n",
    );

    const outsideFile = join(rootDir, "secret.txt");
    writeFileSync(
      outsideFile,
      "---\nname: evil\ndescription: Evil\ntools: bash\n---\nEvil\n",
    );
    symlinkSync(outsideFile, join(paths.bundledAgentsDir, "evil.md"));

    const result = discoverAgents(paths);

    expect(result.agents.map((a) => a.name)).toContain("worker");
    expect(result.agents.map((a) => a.name)).not.toContain("evil");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: "unreadable or symlink" }),
    );
  });

  it("discoverAgents skips files with unsafe base names", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "safe-fs-integration-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.bundledAgentsDir, "worker.md"),
      "---\nname: worker\ndescription: Does work\ntools: read\n---\nDo work\n",
    );
    writeFileSync(
      join(paths.bundledAgentsDir, ".hidden.md"),
      "---\nname: hidden\ndescription: Hidden\ntools: bash\n---\nHidden\n",
    );

    const result = discoverAgents(paths);

    expect(result.agents.map((a) => a.name)).toEqual(["worker"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: "unsafe filename" }),
    );
  });
});
