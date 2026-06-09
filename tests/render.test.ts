import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearSlashLiveRequest,
  finalizeSlashLiveRequest,
  startSlashLiveRequest,
  tickSlashLiveRequest,
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
    startedAt: 0,
    recentToolActivity: [
      { label: "read package", preview: '{"path":"package.json"}' },
    ],
    ...overrides,
  };
}

describe("slash live state", () => {
  afterEach(() => {
    clearSlashLiveRequest("req-widget");
    clearSlashLiveRequest("req-tick");
    vi.useRealTimers();
  });

  test("tickSlashLiveRequest refreshes duration from elapsed time", () => {
    const details = startSlashLiveRequest({
      requestId: "req-widget",
      agent: "Scout",
      task: "inspect this repo",
      cwd: "/repo",
      startedAtMs: 1_000,
    });

    tickSlashLiveRequest("req-widget", 1_450);

    expect(details.durationMs).toBe(450);
  });
});

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

  test("slash-live duration keeps advancing across renders while request is running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));

    const details = startSlashLiveRequest({
      requestId: "req-live-1",
      agent: "Scout",
      task: "inspect repo",
      cwd: "/repo",
      model: "gpt-5",
    });

    const component = renderSubagentMessage(
      {
        customType: "pi-subagent-result",
        content: "",
        display: true,
        details,
      } as never,
      { expanded: false } as never,
      createTheme() as never,
    );

    expect(component.render(80).join("\n")).toContain("0ms");
    vi.advanceTimersByTime(2400);
    expect(component.render(80).join("\n")).toContain("2400ms");

    vi.useRealTimers();
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

  test("slash live render shows updated duration after a tick", () => {
    startSlashLiveRequest({
      requestId: "req-tick",
      agent: "Scout",
      task: "inspect this repo",
      cwd: "/repo",
      startedAtMs: 1_000,
    });

    tickSlashLiveRequest("req-tick", 1_250);

    const text = buildSubagentResultText(
      "",
      createSlashLiveDetails({ requestId: "req-tick", durationMs: 0 }),
      false,
      theme,
    );

    expect(text).toContain("duration: 250ms");
  });

  test("running inline slash card does not freeze at a stale duration across quiet renders", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));

    const details = startSlashLiveRequest({
      requestId: "req-freeze-check",
      agent: "scout",
      task: "explore this repo",
      cwd: "/repo",
    });

    const component = renderSubagentMessage(
      { content: "", details },
      { expanded: false } as never,
      createTheme() as never,
    );

    const first = component.render(120).join("\n");
    vi.advanceTimersByTime(2500);
    const second = component.render(120).join("\n");

    expect(first).not.toContain("2500ms");
    expect(second).toContain("2500ms");
    clearSlashLiveRequest("req-freeze-check");
    vi.useRealTimers();
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
        requestId: "req-expanded",
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
