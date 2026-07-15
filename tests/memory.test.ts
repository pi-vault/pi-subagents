import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  buildMemoryInjection,
  checkLocalMemoryGitignore,
  parseMemoryConfig,
  readMemoryFile,
  resolveMemoryDir,
} from "../src/core/memory.js";

describe("parseMemoryConfig", () => {
  it("parses valid config with scope and path", () => {
    expect(
      parseMemoryConfig({ scope: "project", path: "security-reviewer" }),
    ).toEqual({ scope: "project", path: "security-reviewer" });
  });

  it("accepts all three scopes", () => {
    expect(parseMemoryConfig({ scope: "user", path: "a" })?.scope).toBe("user");
    expect(parseMemoryConfig({ scope: "project", path: "a" })?.scope).toBe(
      "project",
    );
    expect(parseMemoryConfig({ scope: "local", path: "a" })?.scope).toBe(
      "local",
    );
  });

  it("returns undefined for null/undefined", () => {
    expect(parseMemoryConfig(null)).toBeUndefined();
    expect(parseMemoryConfig(undefined)).toBeUndefined();
  });

  it("returns undefined for non-object", () => {
    expect(parseMemoryConfig("project")).toBeUndefined();
    expect(parseMemoryConfig(42)).toBeUndefined();
  });

  it("returns undefined for invalid scope", () => {
    expect(parseMemoryConfig({ scope: "global", path: "x" })).toBeUndefined();
  });

  it("returns undefined when path is missing or empty", () => {
    expect(parseMemoryConfig({ scope: "project" })).toBeUndefined();
    expect(parseMemoryConfig({ scope: "project", path: "" })).toBeUndefined();
  });

  it("parses a JSON string", () => {
    expect(
      parseMemoryConfig('{"scope": "project", "path": "reviewer"}'),
    ).toEqual({ scope: "project", path: "reviewer" });
  });

  it("returns undefined for invalid JSON string", () => {
    expect(parseMemoryConfig("{bad json}")).toBeUndefined();
    expect(parseMemoryConfig("just a string")).toBeUndefined();
  });

  it("returns undefined for path with unsafe characters", () => {
    expect(
      parseMemoryConfig({ scope: "project", path: "../escape" }),
    ).toBeUndefined();
    expect(
      parseMemoryConfig({ scope: "project", path: "foo/bar" }),
    ).toBeUndefined();
  });
});

describe("resolveMemoryDir", () => {
  const tmp = mkdtempSync(join(tmpdir(), "memory-resolve-"));

  it("resolves project scope to .pi/agent-memory/<path>/", () => {
    const result = resolveMemoryDir("project", "reviewer", tmp);
    expect(result).toEqual({
      dir: join(tmp, ".pi", "agent-memory", "reviewer"),
    });
  });

  it("resolves local scope to .pi/agent-memory-local/<path>/", () => {
    const result = resolveMemoryDir("local", "reviewer", tmp);
    expect(result).toEqual({
      dir: join(tmp, ".pi", "agent-memory-local", "reviewer"),
    });
  });

  it("resolves user scope to getAgentDir()/agent-memory/<path>/", () => {
    const result = resolveMemoryDir("user", "reviewer", tmp);
    expect(result).toEqual({
      dir: join(getAgentDir(), "agent-memory", "reviewer"),
    });
  });

  it("returns error for unsafe path", () => {
    const result = resolveMemoryDir("project", "../escape", tmp);
    expect(result).toHaveProperty("error");
  });

  it("returns error when .pi is a symlink", () => {
    const realDir = join(tmp, "real-pi");
    mkdirSync(join(realDir, "agent-memory"), { recursive: true });
    const symProject = join(tmp, "sym-project");
    mkdirSync(symProject, { recursive: true });
    symlinkSync(realDir, join(symProject, ".pi"));
    const result = resolveMemoryDir("project", "test", symProject);
    expect(result).toHaveProperty("error");
  });
});

describe("readMemoryFile", () => {
  const tmp = mkdtempSync(join(tmpdir(), "memory-read-"));

  it("returns null when MEMORY.md does not exist", () => {
    const result = readMemoryFile(join(tmp, "nonexistent"));
    expect(result).toBeNull();
  });

  it("reads a normal MEMORY.md file", () => {
    const dir = join(tmp, "agent1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "MEMORY.md"), "# Notes\n- item 1\n- item 2\n");
    const result = readMemoryFile(dir);
    expect(result).toEqual({
      contents: "# Notes\n- item 1\n- item 2\n",
      truncated: false,
    });
  });

  it("returns 'unsafe' when MEMORY.md is a symlink", () => {
    const dir = join(tmp, "agent2");
    mkdirSync(dir, { recursive: true });
    const realFile = join(tmp, "real-memory.md");
    writeFileSync(realFile, "secret");
    symlinkSync(realFile, join(dir, "MEMORY.md"));
    const result = readMemoryFile(dir);
    expect(result).toBe("unsafe");
  });

  it("truncates at 200 lines", () => {
    const dir = join(tmp, "agent3");
    mkdirSync(dir, { recursive: true });
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(dir, "MEMORY.md"), lines.join("\n"));
    const result = readMemoryFile(dir) as {
      contents: string;
      truncated: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.contents.split("\n").length).toBeLessThanOrEqual(200);
  });

  it("truncates at 16KB", () => {
    const dir = join(tmp, "agent4");
    mkdirSync(dir, { recursive: true });
    // Write 20KB of content in <200 lines (long lines)
    const longLine = "x".repeat(1000);
    const lines = Array.from({ length: 50 }, () => longLine);
    writeFileSync(join(dir, "MEMORY.md"), lines.join("\n"));
    const result = readMemoryFile(dir) as {
      contents: string;
      truncated: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.contents.length).toBeLessThanOrEqual(16_384);
  });
});

describe("buildMemoryInjection", () => {
  const tmp = mkdtempSync(join(tmpdir(), "memory-inject-"));

  it("returns read-write block when hasWriteTools is true", () => {
    mkdirSync(join(tmp, ".pi", "agent-memory", "rw-agent"), {
      recursive: true,
    });
    writeFileSync(
      join(tmp, ".pi", "agent-memory", "rw-agent", "MEMORY.md"),
      "# My notes\n- thing 1\n",
    );

    const result = buildMemoryInjection(
      { scope: "project", path: "rw-agent" },
      tmp,
      true,
    );
    expect(result).toContain("# Persistent agent memory");
    expect(result).toContain("# My notes");
    expect(result).toContain("append a concise dated entry");
    expect(result).not.toContain("read-only");
  });

  it("returns read-only block when hasWriteTools is false and file exists", () => {
    mkdirSync(join(tmp, ".pi", "agent-memory", "ro-agent"), {
      recursive: true,
    });
    writeFileSync(
      join(tmp, ".pi", "agent-memory", "ro-agent", "MEMORY.md"),
      "# Existing\n",
    );

    const result = buildMemoryInjection(
      { scope: "project", path: "ro-agent" },
      tmp,
      false,
    );
    expect(result).toContain("read-only");
    expect(result).toContain("# Existing");
  });

  it("returns empty string when read-only and no MEMORY.md exists", () => {
    const result = buildMemoryInjection(
      { scope: "project", path: "no-file-agent" },
      tmp,
      false,
    );
    expect(result).toBe("");
  });

  it("returns create-prompt when read-write and no MEMORY.md exists", () => {
    const result = buildMemoryInjection(
      { scope: "project", path: "new-agent" },
      tmp,
      true,
    );
    expect(result).toContain("No MEMORY.md exists yet");
    expect(result).toContain("create it");
  });

  it("renders unsafe note in read-write mode when MEMORY.md is a symlink", () => {
    const dir = join(tmp, ".pi", "agent-memory", "unsafe-agent");
    mkdirSync(dir, { recursive: true });
    const realFile = join(tmp, "decoy.md");
    writeFileSync(realFile, "secret data");
    symlinkSync(realFile, join(dir, "MEMORY.md"));

    const result = buildMemoryInjection(
      { scope: "project", path: "unsafe-agent" },
      tmp,
      true,
    );
    expect(result).toContain("# Persistent agent memory");
    expect(result).toContain("unsafe");
  });

  it("returns empty string when path resolution fails", () => {
    const result = buildMemoryInjection(
      { scope: "project", path: "../escape" },
      tmp,
      true,
    );
    expect(result).toBe("");
  });

  it("notes truncation when file is large", () => {
    mkdirSync(join(tmp, ".pi", "agent-memory", "big-agent"), {
      recursive: true,
    });
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    writeFileSync(
      join(tmp, ".pi", "agent-memory", "big-agent", "MEMORY.md"),
      lines.join("\n"),
    );

    const result = buildMemoryInjection(
      { scope: "project", path: "big-agent" },
      tmp,
      true,
    );
    expect(result).toContain("truncated");
  });
});

describe("checkLocalMemoryGitignore", () => {
  it("returns warning when local dir exists and is not gitignored", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toContain(".pi/agent-memory-local");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when local dir is gitignored", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });
    writeFileSync(join(tmpDir, ".gitignore"), ".pi/agent-memory-local/\n");

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when local dir does not exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when not in a git repo", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mem-gi-"));
    mkdirSync(join(tmpDir, ".pi", "agent-memory-local"), { recursive: true });

    const result = checkLocalMemoryGitignore(tmpDir);
    expect(result).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
