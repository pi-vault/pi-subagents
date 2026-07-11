import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildArtifactInputMarkdown,
  buildArtifactOutputMarkdown,
  writeExecutionArtifacts,
  type ArtifactWriteInput,
} from "../src/core/subagent-artifacts.js";
import type {
  ResolvedPaths,
  SubagentExecutionResult,
} from "../src/shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createArtifactInput(overrides: Partial<ArtifactWriteInput> = {}): ArtifactWriteInput {
  return {
    requestedAgent: "Scout",
    resolvedAgentName: "Scout",
    task: "Find the bug",
    cwd: "/repo",
    runId: "run-abc",
    sourcePath: "/agents/scout.md",
    parentSessionFile: "/sessions/parent.jsonl",
    parentSessionDir: "/sessions",
    ...overrides,
  };
}

function createResult(overrides: Partial<SubagentExecutionResult> = {}): SubagentExecutionResult {
  return {
    content: "Found the bug in main.ts",
    isError: false,
    details: {
      status: "success",
      agent: "Scout",
      task: "Find the bug",
      sourcePath: "/agents/scout.md",
      cwd: "/repo",
      maxTurns: 30,
      durationMs: 1200,
      childSessionDir: "/sessions/child",
      childSessionPath: "/sessions/child/session.jsonl",
      model: "openai/gpt-5",
      stopReason: "end",
      exitCode: 0,
      stderr: "",
      usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, contextTokens: 200, cost: 0.05, turns: 2 },
      recentToolActivity: [{ label: "read done", preview: "main.ts" }],
    },
    ...overrides,
  };
}

function createPaths(rootDir: string): ResolvedPaths {
  return {
    agentDir: join(rootDir, "agent"),
    configPath: join(rootDir, "agent", "extensions", "subagents.json"),
    userAgentsDir: join(rootDir, "agent", "agents"),
    bundledAgentsDir: join(rootDir, "bundled-agents"),
    sessionsDir: join(rootDir, "agent", "sessions"),
    userChainsDir: join(rootDir, "agent", "chains"),
    bundledChainsDir: join(rootDir, "bundled-chains"),
  };
}

// ---------------------------------------------------------------------------
// buildArtifactInputMarkdown
// ---------------------------------------------------------------------------

describe("buildArtifactInputMarkdown", () => {
  test("generates markdown with all fields", () => {
    const md = buildArtifactInputMarkdown(createArtifactInput());

    expect(md).toContain("# Subagent Input");
    expect(md).toContain("- requested agent: Scout");
    expect(md).toContain("- resolved agent: Scout");
    expect(md).toContain("- run id: run-abc");
    expect(md).toContain("- cwd: /repo");
    expect(md).toContain("- source: /agents/scout.md");
    expect(md).toContain("- parent session file: /sessions/parent.jsonl");
    expect(md).toContain("- parent session dir: /sessions");
    expect(md).toContain("## Task");
    expect(md).toContain("Find the bug");
  });

  test("uses dashes for missing optional fields", () => {
    const md = buildArtifactInputMarkdown(createArtifactInput({
      resolvedAgentName: undefined,
      sourcePath: undefined,
      parentSessionFile: undefined,
      parentSessionDir: undefined,
    }));

    expect(md).toContain("- resolved agent: -");
    expect(md).toContain("- source: -");
    expect(md).toContain("- parent session file: -");
    expect(md).toContain("- parent session dir: -");
  });

  test("shows (empty task) when task is empty string", () => {
    const md = buildArtifactInputMarkdown(createArtifactInput({ task: "" }));
    expect(md).toContain("(empty task)");
  });
});

// ---------------------------------------------------------------------------
// buildArtifactOutputMarkdown
// ---------------------------------------------------------------------------

describe("buildArtifactOutputMarkdown", () => {
  test("generates markdown for successful result", () => {
    const md = buildArtifactOutputMarkdown(createResult());

    expect(md).toContain("# Subagent Output");
    expect(md).toContain("- status: success");
    expect(md).toContain("- stop reason: end");
    expect(md).toContain("- exit code: 0");
    expect(md).toContain("- model: openai/gpt-5");
    expect(md).toContain("## Output");
    expect(md).toContain("Found the bug in main.ts");
  });

  test("generates markdown for error result", () => {
    const md = buildArtifactOutputMarkdown(createResult({
      content: "Agent timed out",
      isError: true,
      details: {
        ...createResult().details,
        status: "timeout",
        stopReason: "timeout",
        exitCode: null,
        model: undefined,
      },
    }));

    expect(md).toContain("- status: timeout");
    expect(md).toContain("- stop reason: timeout");
    expect(md).toContain("- exit code: -");
    expect(md).toContain("- model: -");
    expect(md).toContain("Agent timed out");
  });

  test("shows (no output) when content is empty", () => {
    const md = buildArtifactOutputMarkdown(createResult({ content: "" }));
    expect(md).toContain("(no output)");
  });
});

// ---------------------------------------------------------------------------
// writeExecutionArtifacts
// ---------------------------------------------------------------------------

describe("writeExecutionArtifacts", () => {
  test("writes input, output, and meta files to correct paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "artifacts-test-"));
    try {
      const paths = createPaths(tmpDir);
      const sessionDir = join(tmpDir, "sessions");
      const input = createArtifactInput({
        parentSessionFile: join(sessionDir, "parent.jsonl"),
        parentSessionDir: sessionDir,
      });
      const result = createResult();

      const artifactPaths = writeExecutionArtifacts(paths, input, result);

      expect(existsSync(artifactPaths.input)).toBe(true);
      expect(existsSync(artifactPaths.output)).toBe(true);
      expect(existsSync(artifactPaths.meta)).toBe(true);

      const inputContent = readFileSync(artifactPaths.input, "utf8");
      expect(inputContent).toContain("# Subagent Input");

      const outputContent = readFileSync(artifactPaths.output, "utf8");
      expect(outputContent).toContain("# Subagent Output");

      const meta = JSON.parse(readFileSync(artifactPaths.meta, "utf8"));
      expect(meta.runId).toBe("run-abc");
      expect(meta.agent).toBe("Scout");
      expect(meta.status).toBe("success");
      expect(meta.durationMs).toBe(1200);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("writes error field in meta when result is an error", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "artifacts-test-"));
    try {
      const paths = createPaths(tmpDir);
      const sessionDir = join(tmpDir, "sessions");
      const input = createArtifactInput({
        parentSessionFile: join(sessionDir, "parent.jsonl"),
        parentSessionDir: sessionDir,
      });
      const result = createResult({
        content: "something went wrong",
        isError: true,
        details: { ...createResult().details, status: "error" },
      });

      const artifactPaths = writeExecutionArtifacts(paths, input, result);
      const meta = JSON.parse(readFileSync(artifactPaths.meta, "utf8"));
      expect(meta.error).toBe("something went wrong");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});


