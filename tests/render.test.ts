import { describe, expect, test } from "vitest";
import {
  buildIntercomRequestText,
  buildSubagentCallText,
  buildSubagentResultText,
  buildWatchdogWarningText,
  renderSubagentMessage,
  toSubagentCommandMessage,
} from "../src/tui/render.js";
import type { SubagentExecutionDetails } from "../src/shared/types.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const semanticTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `<b>${text}</b>`,
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
    maxTurns: 30,
    durationMs: 321,
    childSessionDir: "/sessions/child/run-0",
    childSessionPath: "/sessions/child/run-0/session.jsonl",
    artifactPaths: {
      input: "/sessions/subagent-artifacts/run-123_Scout_0_input.md",
      output: "/sessions/subagent-artifacts/run-123_Scout_0_output.md",
      meta: "/sessions/subagent-artifacts/run-123_Scout_0_meta.json",
    },
    model: "openai/gpt-5",
    thinking: undefined,
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
  test("renders a running call with metadata before the task preview", () => {
    const lines = buildSubagentCallText(
      {
        agent: "Scout",
        task: "Inspect repo structure and summarize findings in a compact report.",
        cwd: "/repo/worktree",
      },
      theme,
    ).split("\n");

    expect(lines).toEqual([
      "● Scout running",
      "  cwd /repo/worktree",
      "  ⎿  Inspect repo structure and summarize findings in a compact report.",
    ]);
  });

  test("uses Pi semantic roles for a running call", () => {
    const firstLine = buildSubagentCallText(
      { agent: "Scout", task: "Inspect" },
      semanticTheme,
    ).split("\n")[0];

    expect(firstLine).toBe(
      "<accent>●</accent> <toolTitle><b>Scout</b></toolTitle> <accent>running</accent>",
    );
  });

  test.each([
    ["success", "✓", "success"],
    ["error", "✗", "error"],
    ["timeout", "✗", "error"],
    ["aborted", "✗", "error"],
    ["steered", "■", "warning"],
  ] as const)("renders %s with the expected icon and role", (status, icon, role) => {
    const firstLine = buildSubagentResultText(
      "output",
      createDetails({ status }),
      false,
      semanticTheme,
    ).split("\n")[0];

    expect(firstLine).toContain(`<${role}>${icon}</${role}>`);
    expect(firstLine).toContain("<toolTitle><b>Scout</b></toolTitle>");
    expect(firstLine).toContain(`<${role}>${status}</${role}>`);
  });

  test("renders collapsed result metadata in a stable order", () => {
    const lines = buildSubagentResultText(
      "final answer",
      createDetails(),
      false,
      theme,
    ).split("\n");

    expect(lines).toEqual([
      "✓ Scout success",
      "  openai/gpt-5 · 321ms · 12/8 tok · 2 turns · session /sessions/child/run-0/session.jsonl",
      "  ⎿  tools read done, bash done, write done, edit done, find done",
    ]);
    expect(lines.join("\n")).not.toContain("read start");
    expect(lines.join("\n")).not.toContain("final output:");
  });

  test("renders a background result with agent identity and optional id", () => {
    expect(
      buildSubagentResultText(
        "Agent started in background",
        createDetails({ status: "background", agentId: "agent-123" }),
        false,
        theme,
      ),
    ).toBe("● Scout background\n  id agent-123");
    expect(
      buildSubagentResultText(
        "Agent started in background",
        createDetails({ status: "background", agentId: undefined }),
        false,
        theme,
      ),
    ).toBe("● Scout background");
  });

  test("uses the accent role for a background result", () => {
    const firstLine = buildSubagentResultText(
      "Agent started in background",
      createDetails({ status: "background", agentId: "agent-123" }),
      false,
      semanticTheme,
    ).split("\n")[0];

    expect(firstLine).toContain("<accent>●</accent>");
    expect(firstLine).toContain("<accent>background</accent>");
  });

  test("keeps raw content when result details are unavailable", () => {
    expect(buildSubagentResultText("plain output", undefined, false, theme)).toBe(
      "plain output",
    );
    expect(buildSubagentResultText("", undefined, false, theme)).toBe("(no output)");
  });

  test("renders expanded results with task, diagnostics, recent tools, and final output", () => {
    const text = buildSubagentResultText(
      "final answer",
      createDetails({ status: "error", stopReason: "error", exitCode: 2, stderr: "child failed" }),
      true,
      theme,
    );

    expect(text).toContain("✗ Scout error");
    expect(text).toContain("task: Inspect repo structure and summarize findings");
    expect(text).toContain("cwd: /repo");
    expect(text).toContain("source: /repo/agents/scout.md");
    expect(text).toContain("model: openai/gpt-5");
    expect(text).toContain("turns: 30");
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

  test("renders completed details in a custom message", () => {
    const text = renderSubagentMessage(
      { content: "the answer", details: createDetails() },
      { expanded: false } as never,
      theme as never,
    ).render(120).join("\n");

    expect(text).toContain("✓ Scout success");
  });

  test("renders custom messages without details as plain text", () => {
    const text = renderSubagentMessage(
      { content: "plain output" },
      { expanded: false } as never,
      theme as never,
    ).render(120).join("\n");

    expect(text).toContain("plain output");
  });

  test("wraps details in the subagent command message envelope", () => {
    const message = toSubagentCommandMessage({
      content: "done",
      isError: false,
      details: createDetails(),
    });

    expect(message.customType).toBe("pi-subagent-result");
    expect(message.display).toBe(true);
    expect(message.details?.agent).toBe("Scout");
  });

  test("renders thinking level in expanded details", () => {
    const text = buildSubagentResultText(
      "done",
      createDetails({ thinking: "high" }),
      true,
      theme,
    );
    expect(text).toContain("thinking: high");
  });

  test("renders unlimited turns in expanded details", () => {
    const text = buildSubagentResultText(
      "done",
      createDetails({ maxTurns: 0 }),
      true,
      theme,
    );
    expect(text).toContain("turns: unlimited");
  });
});

describe("watchdog and intercom render helpers", () => {
  test("renders a collapsed blocker as header, metadata, and summary", () => {
    const text = buildWatchdogWarningText(
      {
        severity: "blocker",
        summary: "Null pointer dereference",
        evidence: "src/foo.ts:42",
        recommendedAction: "Add null check",
        category: "correctness",
        state: "displayed",
        agentId: "agent-xyz",
      },
      false,
      theme,
    );

    expect(text.split("\n")).toEqual([
      "⚠ Watchdog Blocker displayed",
      "  correctness · agent agent-xyz",
      "  ⎿  Null pointer dereference",
    ]);
  });

  test("preserves expanded watchdog evidence and action", () => {
    const text = buildWatchdogWarningText(
      {
        severity: "concern",
        summary: "Missing test coverage",
        evidence: "src/bar.ts",
        recommendedAction: "Add unit test",
        category: "test-gap",
        autoFollowAttempt: 2,
      },
      true,
      theme,
    );

    expect(text).toContain("⚠ Watchdog Concern auto-follow attempt 2");
    expect(text).toContain("⎿  Missing test coverage");
    expect(text).toContain("Evidence: src/bar.ts");
    expect(text).toContain("Recommended action: Add unit test");
    expect(text).toContain("Category: test-gap");
  });

  test.each([
    ["stale", "stale"],
    ["failed", "failed review"],
    ["stalemate", "stalemate"],
  ] as const)("preserves the %s watchdog state label", (state, label) => {
    const firstLine = buildWatchdogWarningText(
      {
        severity: "blocker",
        summary: "Review stopped",
        evidence: "src/foo.ts:42",
        recommendedAction: "Inspect manually",
        category: "correctness",
        state,
      },
      false,
      theme,
    ).split("\n")[0];

    expect(firstLine).toContain(label);
  });

  test("omits the watchdog status fragment when no state applies", () => {
    const firstLine = buildWatchdogWarningText(
      {
        severity: "blocker",
        summary: "Broken",
        evidence: "src/foo.ts:42",
        recommendedAction: "Fix it",
        category: "correctness",
      },
      false,
      semanticTheme,
    ).split("\n")[0];

    expect(firstLine).toBe(
      "<error>⚠</error> <toolTitle><b>Watchdog Blocker</b></toolTitle>",
    );
  });

  test("uses semantic roles for watchdog severity and intercom requests", () => {
    expect(
      buildWatchdogWarningText(
        {
          severity: "blocker",
          summary: "Broken",
          evidence: "src/foo.ts:42",
          recommendedAction: "Fix it",
          category: "correctness",
        },
        false,
        semanticTheme,
      ),
    ).toContain("<error>⚠</error>");
    expect(
      buildWatchdogWarningText(
        {
          severity: "concern",
          summary: "Missing test",
          evidence: "src/foo.ts:42",
          recommendedAction: "Add it",
          category: "test-gap",
        },
        false,
        semanticTheme,
      ),
    ).toContain("<warning>⚠</warning>");
    expect(
      buildIntercomRequestText(
        {
          id: "request-1",
          agentId: "agent-1",
          agentName: "Scout",
          reason: "need_decision",
          message: "Which file should I change?",
          expectsReply: true,
          createdAt: 1,
        },
        semanticTheme,
      ),
    ).toContain("<accent>◆</accent>");
  });

  test("renders intercom reason, request metadata, and message", () => {
    const text = buildIntercomRequestText(
      {
        id: "request-1",
        agentId: "agent-1",
        agentName: "Scout",
        reason: "need_decision",
        message: "Which file should I change?",
        expectsReply: true,
        createdAt: 1,
      },
      theme,
    );

    expect(text.split("\n")).toEqual([
      "◆ Scout need decision",
      "  agent agent-1 · request request-1 · reply requested",
      "  ⎿  Which file should I change?",
    ]);
  });

  test("labels non-blocking intercom updates without a reply promise", () => {
    const text = buildIntercomRequestText(
      {
        id: "request-2",
        agentId: "agent-1",
        agentName: "Scout",
        reason: "progress_update",
        message: "Halfway done",
        expectsReply: false,
        createdAt: 2,
      },
      theme,
    );

    expect(text).toContain("◆ Scout progress update");
    expect(text).toContain("no reply needed");
  });
});
