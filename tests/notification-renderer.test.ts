import { describe, expect, it } from "vitest";
import { buildNotificationText } from "../src/tui/render.js";
import type { NotificationDetails } from "../src/shared/types.js";

const makeTheme = () => ({
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
});

const makeDetails = (overrides: Partial<NotificationDetails> = {}): NotificationDetails => ({
  id: "a1",
  description: "Fix the login bug",
  status: "completed",
  toolUses: 5,
  turnCount: 3,
  totalTokens: 12300,
  durationMs: 11200,
  resultPreview: "Fixed the authentication issue",
  ...overrides,
});

describe("buildNotificationText", () => {
  it("completed: contains ✓, bold description, and 'completed' status", () => {
    const text = buildNotificationText(makeDetails(), false, makeTheme());
    expect(text).toContain("✓");
    expect(text).toContain("Fix the login bug");
    expect(text).toContain("completed");
  });

  it("error: contains ✗, description, and 'error' status text", () => {
    const text = buildNotificationText(makeDetails({ status: "error" }), false, makeTheme());
    expect(text).toContain("✗");
    expect(text).toContain("Fix the login bug");
    expect(text).toContain("error");
  });

  it("aborted: contains ✗ and 'aborted' status text", () => {
    const text = buildNotificationText(makeDetails({ status: "aborted" }), false, makeTheme());
    expect(text).toContain("✗");
    expect(text).toContain("aborted");
  });

  it("stopped: contains ✗ and 'stopped' status text", () => {
    const text = buildNotificationText(makeDetails({ status: "stopped" }), false, makeTheme());
    expect(text).toContain("✗");
    expect(text).toContain("stopped");
  });

  it("steered: contains ✓ and 'completed (steered)' text", () => {
    const text = buildNotificationText(makeDetails({ status: "steered" }), false, makeTheme());
    expect(text).toContain("✓");
    expect(text).toContain("completed (steered)");
  });

  it("stats line contains turns, tool uses, tokens, and duration", () => {
    const text = buildNotificationText(makeDetails(), false, makeTheme());
    expect(text).toContain("↻3");
    expect(text).toContain("5 tool uses");
    expect(text).toContain("12.3k token");
    expect(text).toContain("11.2s");
  });

  it("stats line uses singular 'tool use' when toolUses=1", () => {
    const text = buildNotificationText(makeDetails({ toolUses: 1 }), false, makeTheme());
    expect(text).toContain("1 tool use");
    expect(text).not.toContain("1 tool uses");
  });

  it("collapsed: shows first line of resultPreview truncated to 80 chars with ⎿ prefix", () => {
    const longLine = "a".repeat(100);
    const text = buildNotificationText(
      makeDetails({ resultPreview: longLine }),
      false,
      makeTheme(),
    );
    expect(text).toContain("⎿");
    expect(text).toContain("a".repeat(80));
    expect(text).not.toContain("a".repeat(81));
  });

  it("collapsed: shows first line only when resultPreview has multiple lines", () => {
    const text = buildNotificationText(
      makeDetails({ resultPreview: "line one\nline two\nline three" }),
      false,
      makeTheme(),
    );
    expect(text).toContain("line one");
    expect(text).not.toContain("line two");
  });

  it("expanded: shows up to 30 lines of resultPreview", () => {
    const lines = Array.from({ length: 35 }, (_, i) => `line ${i + 1}`);
    const text = buildNotificationText(
      makeDetails({ resultPreview: lines.join("\n") }),
      true,
      makeTheme(),
    );
    expect(text).toContain("line 1");
    expect(text).toContain("line 30");
    expect(text).not.toContain("line 31");
  });

  it("with outputFile: shows 'transcript: /path/to/file'", () => {
    const text = buildNotificationText(
      makeDetails({ outputFile: "/path/to/file" }),
      false,
      makeTheme(),
    );
    expect(text).toContain("transcript: /path/to/file");
  });

  it("without outputFile: does not show transcript line", () => {
    const text = buildNotificationText(makeDetails(), false, makeTheme());
    expect(text).not.toContain("transcript:");
  });

  it("no stats line when all stats are zero", () => {
    const text = buildNotificationText(
      makeDetails({ turnCount: 0, toolUses: 0, totalTokens: 0, durationMs: 0 }),
      false,
      makeTheme(),
    );
    expect(text).not.toContain("↻");
    expect(text).not.toContain("tool use");
    expect(text).not.toContain("token");
    expect(text).not.toContain("s\n");
  });

  it("maxTurns present: stats shows '↻3≤30'", () => {
    const text = buildNotificationText(
      makeDetails({ maxTurns: 30 }),
      false,
      makeTheme(),
    );
    expect(text).toContain("↻3≤30");
  });

  it("group rendering: others[] produces multi-agent output", () => {
    const primary = makeDetails({ description: "Agent A" });
    const secondary = makeDetails({ description: "Agent B", status: "error" });
    const all = [primary, secondary];
    const output = all
      .map((item) => buildNotificationText(item, false, makeTheme()))
      .join("\n");
    expect(output).toContain("Agent A");
    expect(output).toContain("Agent B");
    expect(output).toContain("✓"); // primary completed
    expect(output).toContain("✗"); // secondary error
  });
});
