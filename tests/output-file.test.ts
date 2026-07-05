import { describe, expect, it, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeInitialEntry, appendEntry, encodeCwd, createOutputFilePath } from "../src/core/output-file.js";

describe("output-file", () => {
  const testDir = join(tmpdir(), `pi-subagents-test-output-${Date.now()}`);
  const testFile = join(testDir, "test.output");

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it("writeInitialEntry creates JSONL file with user prompt", () => {
    mkdirSync(testDir, { recursive: true });
    writeInitialEntry(testFile, "agent-1", "Do something", "/tmp/cwd");
    expect(existsSync(testFile)).toBe(true);
    const content = readFileSync(testFile, "utf8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.isSidechain).toBe(true);
    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.type).toBe("user");
    expect(parsed.message.content).toBe("Do something");
  });

  it("appendEntry adds JSONL lines", () => {
    mkdirSync(testDir, { recursive: true });
    writeInitialEntry(testFile, "agent-1", "Do something", "/tmp/cwd");
    appendEntry(testFile, "agent-1", "assistant", "I did it", "/tmp/cwd");
    const lines = readFileSync(testFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const second = JSON.parse(lines[1]);
    expect(second.type).toBe("assistant");
  });

  it("encodeCwd strips separators and drive prefix", () => {
    expect(encodeCwd("/home/user/project")).toBe("home-user-project");
    expect(encodeCwd("C:\\Users\\foo")).toBe("Users-foo");
  });

  it("createOutputFilePath returns expected path structure", () => {
    const path = createOutputFilePath("/tmp/test", "agent-1", "session-abc");
    expect(path).toContain("agent-1.output");
    expect(path).toContain("session-abc");
  });
});
