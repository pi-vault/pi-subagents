import { describe, expect, test } from "vitest";
import {
  buildSubagentCallText,
  buildSubagentResultText,
} from "../src/render.js";
import type { SubagentExecutionDetails } from "../src/types.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function createDetails(
  overrides: Partial<SubagentExecutionDetails> = {},
): SubagentExecutionDetails {
  return {
    status: "success",
    agent: "Scout",
    task: "Inspect repo structure and summarize findings",
    sourcePath: "/repo/agents/scout.md",
    cwd: "/repo",
    timeoutMs: 180000,
    durationMs: 321,
    childSessionDir: "/sessions/child/run-0",
    childSessionPath: "/sessions/child/run-0/session.jsonl",
    model: "openai/gpt-5",
    stopReason: "end",
    exitCode: 0,
    stderr: "",
    usage: {
      input: 12,
      output: 8,
      cacheRead: 0,
      cacheWrite: 0,
      contextTokens: 20,
      cost: 0.1,
      turns: 2,
    },
    recentToolActivity: [
      { label: "read start", preview: '{"path":"src/index.ts"}' },
      { label: "read done", preview: '{"content":[{"type":"text","text":"ok"}]}' },
      { label: "bash done", preview: '{"stdout":"done"}' },
      { label: "write done", preview: '{"path":"notes.md"}' },
      { label: "edit done", preview: '{"path":"src/subagent.ts"}' },
      { label: "find done", preview: '{"path":"src"}' },
    ],
    ...overrides,
  };
}

describe("subagent render helpers", () => {
  test("renderCall includes agent, task preview, and cwd when present", () => {
    const text = buildSubagentCallText(
      {
        agent: "Scout",
        task: "Inspect repo structure and summarize findings in a compact report.",
        cwd: "/repo/worktree",
      },
      theme,
    );

    expect(text).toContain("subagent Scout");
    expect(text).toContain("Inspect repo structure");
    expect(text).toContain("cwd: /repo/worktree");
  });

  test("renders collapsed results with summary metadata and only 5 activity labels", () => {
    const text = buildSubagentResultText("final answer", createDetails(), false, theme);

    expect(text).toContain("SUCCESS Scout openai/gpt-5");
    expect(text).toContain("duration 321ms");
    expect(text).toContain("usage 12/8 tok, 2 turns");
    expect(text).toContain("session /sessions/child/run-0/session.jsonl");
    expect(text).toContain("tools: read done, bash done, write done, edit done, find done");
    expect(text).not.toContain("read start");
    expect(text).not.toContain("final output:");
  });

  test("renders expanded results with task, diagnostics, recent tools, and final output", () => {
    const text = buildSubagentResultText(
      "final answer",
      createDetails({ status: "error", stopReason: "error", exitCode: 2, stderr: "child failed" }),
      true,
      theme,
    );

    expect(text).toContain("ERROR Scout openai/gpt-5");
    expect(text).toContain("task: Inspect repo structure and summarize findings");
    expect(text).toContain("cwd: /repo");
    expect(text).toContain("source: /repo/agents/scout.md");
    expect(text).toContain("timeout: 180000ms");
    expect(text).toContain("stop reason: error");
    expect(text).toContain("exit code: 2");
    expect(text).toContain("stderr:");
    expect(text).toContain("child failed");
    expect(text).toContain("recent tools:");
    expect(text).toContain("- read start:");
    expect(text).toContain("child session path: /sessions/child/run-0/session.jsonl");
    expect(text).toContain("final output:");
    expect(text).toContain("final answer");
  });
});
