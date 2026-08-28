import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../src/shared/types.js";
import { ConversationViewer, VIEWPORT_HEIGHT_PCT } from "../src/tui/conversation-viewer.js";

const LEGACY_ENTER = "\r";
const LEGACY_ESCAPE = "\x1b";
const LEGACY_UP = "\x1b[A";
const LEGACY_DOWN = "\x1b[B";
const LEGACY_PAGE_UP = "\x1b[5~";
const LEGACY_PAGE_DOWN = "\x1b[6~";
const LEGACY_HOME = "\x1b[H";
const LEGACY_END = "\x1b[F";
const KITTY_UP = "\x1b[1;1A";
const KITTY_DOWN = "\x1b[1;1B";
const CSI_U_ENTER = "\x1b[13u";
const CSI_U_ESCAPE = "\x1b[27u";
const CSI_U_X = "\x1b[120u";
const CSI_U_ENTER_RELEASE = "\x1b[13;1:3u";
const CSI_U_X_RELEASE = "\x1b[120;1:3u";

const makeTheme = (ansi = false) => ({
  fg: vi.fn((_: string, text: string) => (ansi ? `\x1b[36m${text}\x1b[39m` : text)),
  bold: vi.fn((text: string) => (ansi ? `\x1b[1m${text}\x1b[22m` : text)),
});

const makeTui = (rows = 40) =>
  ({ terminal: { rows, columns: 80 }, requestRender: vi.fn() }) as unknown as TUI & {
    terminal: { rows: number; columns: number };
    requestRender: ReturnType<typeof vi.fn>;
  };

const makeSession = (messages: unknown[] = []) => {
  let notify: (() => void) | undefined;
  const unsubscribe = vi.fn();
  return {
    messages,
    subscribe: vi.fn((listener: () => void) => {
      notify = listener;
      return unsubscribe;
    }),
    emit: () => notify?.(),
    _unsubscribe: unsubscribe,
  };
};

const makeRecord = (overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  type: "coder",
  description: "Fix the bug",
  status: "running",
  toolUses: 0,
  turnCount: 1,
  live: { activeTools: [], responseText: "" },
  startedAt: Date.now() - 5000,
  lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
  ...overrides,
});

function makeViewer(
  opts: {
    rows?: number;
    messages?: unknown[];
    record?: AgentRecord;
    onStop?: () => void;
    onSteer?: (message: string) => void;
    keybindings?: { matches(data: string, id: string): boolean };
    theme?: ReturnType<typeof makeTheme>;
  } = {},
) {
  const tui = makeTui(opts.rows);
  const session = makeSession(opts.messages);
  const done = vi.fn();
  const viewer = new ConversationViewer(
    tui,
    session as unknown as AgentSession,
    opts.record ?? makeRecord(),
    opts.theme ?? makeTheme(),
    done,
    opts.onStop,
    opts.keybindings,
    opts.onSteer,
  );
  return { viewer, tui, session, done };
}

const messages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    role: "user" as const,
    content: `message ${index}`,
    timestamp: Date.now(),
  }));

describe("VIEWPORT_HEIGHT_PCT", () => {
  it("is 85", () => {
    expect(VIEWPORT_HEIGHT_PCT).toBe(85);
  });
});

describe("ConversationViewer", () => {
  it("renders the shared heavy frame at its 85% height with semantic header and footer", () => {
    const theme = makeTheme(true);
    const { viewer } = makeViewer({
      theme,
      onSteer: vi.fn(),
      onStop: vi.fn(),
      record: makeRecord({
        toolUses: 2,
        lifetimeUsage: { inputTokens: 4, outputTokens: 5, cacheWriteTokens: 1 },
      }),
    });
    const lines = viewer.render(80);
    const rendered = lines.join("\n");

    expect(lines).toHaveLength(34);
    expect(lines[0].replaceAll("\x1b[36m", "").replaceAll("\x1b[39m", "").startsWith("┏━")).toBe(
      true,
    );
    expect(
      (lines.at(-1) ?? "").replaceAll("\x1b[36m", "").replaceAll("\x1b[39m", "").endsWith("━┛"),
    ).toBe(true);
    expect(rendered).not.toMatch(/[╭╮╰╯│]/);
    expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true);
    for (const text of [
      "coder",
      "Fix the bug",
      "●",
      "2 tools",
      "10 token",
      "Enter Steer",
      "x Stop",
      "↑/↓ Scroll",
      "PgUp/PgDn",
      "Esc Close",
    ]) {
      expect(rendered).toContain(text);
    }
    expect(rendered).toMatch(/\d+\.\d+s \(running\)/);
    expect(theme.bold).toHaveBeenCalledWith("coder");
    expect(theme.fg).toHaveBeenCalledWith("accent", "●");
    expect(theme.fg).toHaveBeenCalledWith("muted", "Fix the bug");
  });

  it.each([
    ["running", "●", "accent"],
    ["completed", "✓", "success"],
    ["error", "✗", "error"],
    ["queued", "○", "dim"],
  ] as const)("renders the %s status with its semantic role", (status, icon, role) => {
    const theme = makeTheme();
    const { viewer } = makeViewer({ record: makeRecord({ status }), theme });

    expect(viewer.render(80).join("\n")).toContain(icon);
    expect(theme.fg).toHaveBeenCalledWith(role, icon);
  });

  it("renders the waiting state for an empty session", () => {
    const { viewer } = makeViewer({ messages: [] });

    expect(viewer.render(80).join("\n")).toContain("(waiting for first message...)");
  });

  it.each([
    ["user", { role: "user", content: "hello", timestamp: 1 }, "[User]"],
    ["assistant", { role: "assistant", content: [{ type: "text", text: "hello" }] }, "[Assistant]"],
    ["tool result", { role: "toolResult", content: [{ type: "text", text: "hello" }] }, "[Result]"],
  ])("renders the %s role label", (_name, message, label) => {
    const { viewer } = makeViewer({ messages: [message] });

    expect(viewer.render(80).join("\n")).toContain(label);
  });

  it("renders the native composer in the same capped frame", () => {
    const { viewer } = makeViewer({ onSteer: vi.fn() });
    viewer.focused = true;
    viewer.handleInput(CSI_U_ENTER);
    const lines = viewer.render(80);
    const rendered = lines.join("\n");

    expect(lines).toHaveLength(34);
    expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true);
    expect(rendered).toContain("Steer agent");
    expect(rendered).toContain("> ");
    expect(rendered).toContain("Enter Send • Esc Cancel");
    expect(rendered).not.toContain("Enter Steer");
  });

  it("uses bounded fallback rendering without changing navigation state", () => {
    const { viewer, tui } = makeViewer({ rows: 40, messages: messages(20) });
    viewer.render(80);
    viewer.handleInput(LEGACY_UP);
    expect(viewer.render(80).join("\n")).not.toContain("100%");

    tui.terminal.rows = 10;
    expect(viewer.render(80).join("\n")).toContain("Terminal too small · Esc");
    tui.terminal.rows = 40;
    expect(viewer.render(80).join("\n")).not.toContain("100%");
  });

  it("closes from fallback rendering", () => {
    const { viewer, done } = makeViewer({ rows: 10 });

    expect(viewer.render(80).join("\n")).toContain("Terminal too small · Esc");
    viewer.handleInput(LEGACY_ESCAPE);
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("handles both width and composer height fallback limits", () => {
    const narrow = makeViewer();
    const narrowLines = narrow.viewer.render(6);
    expect(narrowLines.length).toBeGreaterThan(0);
    expect(narrowLines.every((line) => visibleWidth(line) === 6)).toBe(true);

    const { viewer } = makeViewer({ rows: 13, onSteer: vi.fn() });
    expect(viewer.render(80).join("\n")).not.toContain("Terminal too small");
    viewer.handleInput(LEGACY_ENTER);
    expect(viewer.render(80).join("\n")).toContain("Terminal too small · Esc");
    viewer.handleInput(LEGACY_ESCAPE);
    expect(viewer.render(80).join("\n")).not.toContain("Terminal too small");
  });

  it("forwards wrapper focus to a composer opened afterwards", () => {
    const { viewer } = makeViewer({ onSteer: vi.fn() });
    viewer.focused = true;
    viewer.handleInput(CSI_U_ENTER);
    expect(viewer.render(80).join("\n")).toContain(CURSOR_MARKER);
    viewer.focused = false;
    expect(viewer.render(80).join("\n")).not.toContain(CURSOR_MARKER);
    viewer.focused = true;
    expect(viewer.render(80).join("\n")).toContain(CURSOR_MARKER);
  });

  it("routes legacy and CSI-u composer input, while release events do nothing", () => {
    const onSteer = vi.fn();
    const onStop = vi.fn();
    const { viewer } = makeViewer({ onSteer, onStop });
    viewer.focused = true;
    viewer.handleInput(CSI_U_ENTER_RELEASE);
    viewer.handleInput(CSI_U_X_RELEASE);
    viewer.handleInput(CSI_U_X_RELEASE);
    expect(viewer.render(80).join("\n")).not.toContain("Steer agent");
    expect(viewer.render(80).join("\n")).not.toContain("Again to STOP");
    expect(onSteer).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it.each([
    ["legacy", LEGACY_ENTER, "a", LEGACY_ENTER],
    ["CSI-u", CSI_U_ENTER, "\x1b[97u", CSI_U_ENTER],
  ])("submits trimmed %s composer input", (_name, open, input, submit) => {
    const onSteer = vi.fn();
    const { viewer } = makeViewer({ onSteer });

    viewer.handleInput(open);
    viewer.handleInput(" ");
    viewer.handleInput(input);
    viewer.handleInput(" ");
    viewer.handleInput(submit);
    expect(onSteer).toHaveBeenCalledWith("a");
    expect(onSteer).toHaveBeenCalledOnce();
  });

  it.each([
    ["legacy", LEGACY_ENTER, LEGACY_ESCAPE],
    ["CSI-u", CSI_U_ENTER, CSI_U_ESCAPE],
  ])("cancels a %s composer without steering or closing", (_name, open, cancel) => {
    const onSteer = vi.fn();
    const { viewer, done } = makeViewer({ onSteer });

    viewer.handleInput(open);
    viewer.handleInput("a");
    viewer.handleInput(cancel);
    expect(viewer.render(80).join("\n")).not.toContain("Steer agent");
    expect(onSteer).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("ignores an empty composer submission", () => {
    const onSteer = vi.fn();
    const { viewer } = makeViewer({ onSteer });

    viewer.handleInput(LEGACY_ENTER);
    viewer.handleInput(" ");
    viewer.handleInput(CSI_U_ENTER);
    expect(onSteer).not.toHaveBeenCalled();
    expect(viewer.render(80).join("\n")).not.toContain("Steer agent");
  });

  it("keeps composer keys from scrolling and renders once for input, submit, and cancel", () => {
    const onSteer = vi.fn();
    const { viewer, tui, done } = makeViewer({ messages: messages(30), onSteer });
    viewer.handleInput(LEGACY_ENTER);
    tui.requestRender.mockClear();
    viewer.handleInput("j");
    expect(tui.requestRender).toHaveBeenCalledOnce();
    tui.requestRender.mockClear();
    viewer.handleInput("k");
    expect(tui.requestRender).toHaveBeenCalledOnce();
    tui.requestRender.mockClear();
    viewer.handleInput(CSI_U_ENTER);
    expect(tui.requestRender).toHaveBeenCalledOnce();
    expect(onSteer).toHaveBeenCalledWith("jk");

    viewer.handleInput(LEGACY_ENTER);
    tui.requestRender.mockClear();
    viewer.handleInput(CSI_U_ESCAPE);
    expect(tui.requestRender).toHaveBeenCalledOnce();
    expect(viewer.render(80).join("\n")).not.toContain("Steer agent");
    expect(done).not.toHaveBeenCalled();
  });

  it.each([
    ["legacy Escape", LEGACY_ESCAPE],
    ["CSI-u Escape", CSI_U_ESCAPE],
    ["q", "q"],
  ])("closes once for outer %s", (_name, key) => {
    const { viewer, done } = makeViewer();

    viewer.handleInput(key);
    viewer.handleInput(key);
    expect(done).toHaveBeenCalledOnce();
  });

  it("preserves chronological transcript order", () => {
    const transcript = [
      { role: "user" as const, content: "first", timestamp: Date.now() },
      { role: "assistant" as const, content: [{ type: "text", text: "second" }] },
      { role: "toolResult" as const, content: [{ type: "text", text: "third" }] },
    ];
    const { viewer } = makeViewer({ messages: transcript });
    const ordered = viewer.render(100).join("\n");
    expect(ordered.indexOf("first")).toBeLessThan(ordered.indexOf("second"));
    expect(ordered.indexOf("second")).toBeLessThan(ordered.indexOf("third"));
  });

  it("moves and clamps legacy, Kitty, and page scrolling at both transcript bounds", () => {
    const { viewer } = makeViewer({ messages: messages(30) });

    expect(viewer.render(100).join("\n")).toContain("message 29");
    for (const [up, down] of [
      [LEGACY_UP, LEGACY_DOWN],
      [KITTY_UP, KITTY_DOWN],
      [LEGACY_PAGE_UP, LEGACY_PAGE_DOWN],
    ]) {
      viewer.handleInput(up);
      expect(viewer.render(100).join("\n")).not.toContain("100%");
      viewer.handleInput(down);
      expect(viewer.render(100).join("\n")).toContain("100%");
    }

    viewer.handleInput(LEGACY_HOME);
    for (let index = 0; index < 100; index++) viewer.handleInput(KITTY_UP);
    for (let index = 0; index < 10; index++) viewer.handleInput(LEGACY_PAGE_UP);
    expect(viewer.render(100).join("\n")).toContain("message 0");

    viewer.handleInput(LEGACY_END);
    for (let index = 0; index < 100; index++) viewer.handleInput(KITTY_DOWN);
    for (let index = 0; index < 10; index++) viewer.handleInput(LEGACY_PAGE_DOWN);
    expect(viewer.render(100).join("\n")).toContain("100%");
    expect(viewer.render(100).join("\n")).toContain("message 29");
  });

  it("honors custom scroll and page bindings while retaining j/k fallbacks", () => {
    const bindings = new Map([
      ["w", "tui.select.up"],
      ["s", "tui.select.down"],
      ["u", "tui.select.pageUp"],
      ["d", "tui.select.pageDown"],
    ]);
    const keybindings = { matches: (data: string, id: string) => bindings.get(data) === id };
    const { viewer } = makeViewer({ messages: messages(30), keybindings });

    viewer.render(100);
    for (const [up, down] of [
      ["w", "s"],
      ["u", "d"],
      ["k", "j"],
    ]) {
      viewer.handleInput(up);
      expect(viewer.render(100).join("\n")).not.toContain("100%");
      viewer.handleInput(down);
      expect(viewer.render(100).join("\n")).toContain("100%");
    }
  });

  it("preserves manual position on updates and auto-follows new messages after End", () => {
    const { viewer, session, tui } = makeViewer({ messages: messages(30) });

    viewer.render(100);
    viewer.handleInput(KITTY_UP);
    tui.requestRender.mockClear();
    session.messages.push({
      role: "user" as const,
      content: "newest",
      timestamp: Date.now(),
    });
    session.emit();
    expect(tui.requestRender).toHaveBeenCalledOnce();
    expect(viewer.render(100).join("\n")).not.toContain("100%");

    viewer.handleInput(LEGACY_END);
    session.messages.push({
      role: "user" as const,
      content: "after End",
      timestamp: Date.now(),
    });
    session.emit();
    const followed = viewer.render(100).join("\n");
    expect(followed).toContain("after End");
    expect(followed).toContain("100%");
  });

  it("reads mutable record state and keeps completed viewers open", () => {
    const record = makeRecord({ live: { activeTools: [], responseText: "working" } });
    const { viewer, session, tui, done } = makeViewer({
      record,
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });
    expect(viewer.render(80).join("\n")).toContain("working");
    record.live.responseText = "still working";
    expect(viewer.render(80).join("\n")).toContain("still working");
    record.status = "completed";
    record.live.responseText = "finished";
    tui.requestRender.mockClear();
    session.emit();
    expect(tui.requestRender).toHaveBeenCalledOnce();
    expect(viewer.render(80).join("\n")).toContain("✓");
    expect(done).not.toHaveBeenCalled();
  });

  it.each([
    ["completed", makeRecord({ status: "completed", completedAt: Date.now() })],
    ["read-only", makeRecord()],
  ])("hides and disables actions for a %s viewer", (_name, record) => {
    const onSteer = vi.fn();
    const onStop = vi.fn();
    const callbacks = _name === "read-only" ? {} : { onSteer, onStop };
    const { viewer } = makeViewer({ record, ...callbacks });
    const rendered = viewer.render(80).join("\n");

    expect(rendered).not.toContain("Enter Steer");
    expect(rendered).not.toContain("x Stop");
    viewer.handleInput(LEGACY_ENTER);
    viewer.handleInput(CSI_U_X);
    viewer.handleInput(CSI_U_X);
    expect(onSteer).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("keeps stop confirmation and cleanup behavior", () => {
    const onStop = vi.fn();
    const { viewer, session, done, tui } = makeViewer({ onStop });
    viewer.handleInput(CSI_U_X);
    expect(viewer.render(80).join("\n")).toContain("x Again to STOP");
    viewer.handleInput("a");
    expect(viewer.render(80).join("\n")).not.toContain("x Again to STOP");
    expect(onStop).not.toHaveBeenCalled();
    viewer.handleInput(CSI_U_X);
    viewer.handleInput(CSI_U_X);
    expect(onStop).toHaveBeenCalledOnce();
    viewer.handleInput("q");
    expect(done).toHaveBeenCalledOnce();
    viewer.dispose();
    viewer.dispose();
    expect(session._unsubscribe).toHaveBeenCalledOnce();
    tui.requestRender.mockClear();
    session.emit();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });
});
