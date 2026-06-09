import { describe, expect, test } from "vitest";
import {
  finalizeSlashLiveRequest,
  startSlashLiveRequest,
  updateSlashLiveRequest,
} from "../src/core/slash-live-state.js";
import {
  buildSubagentCallText,
  buildSubagentResultText,
  renderSubagentMessage,
  toSubagentCommandMessage,
} from "../src/tui/render.js";
import type {
  SlashLiveDetails,
  SubagentExecutionDetails,
} from "../src/shared/types.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function createTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

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
    artifactPaths: {
      input: "/sessions/subagent-artifacts/run-123_Scout_0_input.md",
      output: "/sessions/subagent-artifacts/run-123_Scout_0_output.md",
      meta: "/sessions/subagent-artifacts/run-123_Scout_0_meta.json",
    },
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

function createSlashLiveDetails(
  overrides: Partial<SlashLiveDetails> = {},
): SlashLiveDetails {
  return {
    kind: "slash-live",
    requestId: "req-1",
    status: "running",
    agent: "Scout",
    task: "explore this repo",
    cwd: "/repo",
    durationMs: 42,
    recentToolActivity: [
      { label: "read package", preview: '{"path":"package.json"}' },
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
    expect(text).toContain(
      "artifact input: /sessions/subagent-artifacts/run-123_Scout_0_input.md",
    );
    expect(text).toContain(
      "artifact output: /sessions/subagent-artifacts/run-123_Scout_0_output.md",
    );
    expect(text).toContain(
      "artifact meta: /sessions/subagent-artifacts/run-123_Scout_0_meta.json",
    );
    expect(text).toContain("final output:");
    expect(text).toContain("final answer");
  });

  test("renders running slash card with agent, task, cwd, and recent activity", () => {
    const text = buildSubagentResultText("", createSlashLiveDetails(), false, theme);

    expect(text).toContain("RUNNING");
    expect(text).toContain("Scout");
    expect(text).toContain("explore this repo");
    expect(text).toContain("cwd: /repo");
    expect(text).toContain("tools: read package");
  });

  test("renderSubagentMessage resolves slash details from the latest snapshot", () => {
    const details = startSlashLiveRequest({
      requestId: "req-1",
      agent: "Scout",
      task: "inspect this repo",
      cwd: "/repo",
    });

    updateSlashLiveRequest("req-1", {
      durationMs: 10,
      activity: { label: "read done", preview: '{"path":"package.json"}' },
    });

    const text = renderSubagentMessage(
      {
        content: "",
        details,
      },
      { expanded: false } as never,
      createTheme() as never,
    ).render(120).join("\n");

    expect(text).toContain("read done");
  });

  test("slash live message component refreshes when snapshot changes", () => {
    const details = startSlashLiveRequest({
      requestId: "req-live",
      agent: "Scout",
      task: "inspect this repo",
      cwd: "/repo",
    });

    const component = renderSubagentMessage(
      {
        content: "",
        details,
      },
      { expanded: false } as never,
      createTheme() as never,
    );

    const initial = component.render(120).join("\n");
    expect(initial).toContain("RUNNING");
    expect(initial).not.toContain("read done");

    updateSlashLiveRequest("req-live", {
      durationMs: 10,
      activity: { label: "read done", preview: '{"path":"package.json"}' },
    });

    const updated = component.render(120).join("\n");
    expect(updated).toContain("read done");
  });

  test("renderSubagentMessage shows final output after slash snapshot finalizes", () => {
    const details = startSlashLiveRequest({
      requestId: "req-final",
      agent: "Scout",
      task: "inspect this repo",
      cwd: "/repo",
    });

    finalizeSlashLiveRequest("req-final", {
      content: "final answer",
      isError: false,
      details: createDetails(),
    });

    const text = renderSubagentMessage(
      {
        content: "",
        details,
      },
      { expanded: true } as never,
      createTheme() as never,
    ).render(120).join("\n");

    expect(text).toContain("final output:");
    expect(text).toContain("final answer");
  });

  test("expanded running slash card shows detailed recent tool activity", () => {
    const text = buildSubagentResultText(
      "",
      createSlashLiveDetails({
        recentToolActivity: [
          { label: "read start", preview: '{"path":"package.json"}' },
          { label: "read done", preview: '{"content":[{"type":"text","text":"ok"}]}' },
        ],
      }),
      true,
      theme,
    );

    expect(text).toContain("recent tools:");
    expect(text).toContain("- read start:");
    expect(text).toContain("- read done:");
  });

  test("toSubagentCommandMessage keeps live slash details when provided", () => {
    const message = toSubagentCommandMessage({
      content: "",
      isError: false,
      details: createSlashLiveDetails(),
    });

    expect(message.details).toMatchObject({
      kind: "slash-live",
      requestId: "req-1",
      status: "running",
    });
  });
});
