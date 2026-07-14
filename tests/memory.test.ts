import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  buildMemoryInjection,
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
