import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../src/shared/types.js";
import { ConversationViewer, VIEWPORT_HEIGHT_PCT } from "../src/tui/conversation-viewer.js";

const LEGACY_ENTER = "\r";
const LEGACY_ESCAPE = "\x1b";
const LEGACY_UP = "\x1b[A";
const LEGACY_HOME = "\x1b[H";
const LEGACY_END = "\x1b[F";
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
      "5.0s",
      "10 token",
      "Enter Steer",
      "x Stop",
      "↑/↓ Scroll",
      "PgUp/PgDn",
      "Esc Close",
    ]) {
      expect(rendered).toContain(text);
    }
    expect(theme.bold).toHaveBeenCalledWith("coder");
    expect(theme.fg).toHaveBeenCalledWith("accent", "●");
    expect(theme.fg).toHaveBeenCalledWith("muted", "Fix the bug");
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
    const { viewer, tui, done } = makeViewer({ rows: 40, messages: messages(20) });
    viewer.render(80);
    viewer.handleInput(LEGACY_UP);
    expect(viewer.render(80).join("\n")).not.toContain("100%");

    tui.terminal.rows = 10;
    expect(viewer.render(80).join("\n")).toContain("Terminal too small · Esc");
    viewer.handleInput(LEGACY_ESCAPE);
    expect(done).toHaveBeenCalledWith(undefined);

    tui.terminal.rows = 40;
    expect(viewer.render(80).join("\n")).not.toContain("100%");
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
    const { viewer } = makeViewer({ onSteer, onStop: vi.fn() });
    viewer.focused = true;
    viewer.handleInput(CSI_U_ENTER_RELEASE);
    viewer.handleInput(CSI_U_X_RELEASE);
    viewer.handleInput(CSI_U_X_RELEASE);
    expect(viewer.render(80).join("\n")).not.toContain("Steer agent");
    expect(viewer.render(80).join("\n")).not.toContain("Again to STOP");

    viewer.handleInput(LEGACY_ENTER);
    viewer.handleInput(" ");
    viewer.handleInput("\x1b[97u");
    viewer.handleInput(" ");
    viewer.handleInput(CSI_U_ENTER);
    expect(onSteer).toHaveBeenCalledWith("a");

    viewer.handleInput(LEGACY_ENTER);
    viewer.handleInput("b");
    viewer.handleInput(LEGACY_ENTER);
    expect(onSteer).toHaveBeenLastCalledWith("b");
  });

  it("cancels the composer without closing and does not render twice per composer key", () => {
    const { viewer, tui, done } = makeViewer({ onSteer: vi.fn() });
    viewer.handleInput(LEGACY_ENTER);
    tui.requestRender.mockClear();
    viewer.handleInput("a");
    expect(tui.requestRender).toHaveBeenCalledOnce();
    viewer.handleInput(CSI_U_ESCAPE);
    expect(viewer.render(80).join("\n")).not.toContain("Steer agent");
    expect(done).not.toHaveBeenCalled();
  });

  it("preserves transcript order, scroll bounds, custom keys, and auto-follow", () => {
    const transcript = [
      { role: "user" as const, content: "first", timestamp: Date.now() },
      { role: "assistant" as const, content: [{ type: "text", text: "second" }] },
      { role: "toolResult" as const, content: [{ type: "text", text: "third" }] },
    ];
    const keybindings = {
      matches: (data: string, id: string) => id === "tui.select.up" && data === "w",
    };
    const { viewer } = makeViewer({ messages: transcript, keybindings });
    const ordered = viewer.render(100).join("\n");
    expect(ordered.indexOf("first")).toBeLessThan(ordered.indexOf("second"));
    expect(ordered.indexOf("second")).toBeLessThan(ordered.indexOf("third"));

    const scroll = makeViewer({ messages: messages(30), keybindings });
    scroll.viewer.render(100);
    scroll.viewer.handleInput(LEGACY_HOME);
    scroll.viewer.handleInput("w");
    scroll.viewer.handleInput("k");
    expect(scroll.viewer.render(100).join("\n")).toContain("message 0");
    scroll.viewer.handleInput(LEGACY_END);
    expect(scroll.viewer.render(100).join("\n")).toContain("100%");
    scroll.viewer.handleInput("w");
    const before = scroll.viewer.render(100).join("\n");
    expect(before).not.toContain("100%");
    scroll.tui.requestRender.mockClear();
    scroll.session.messages.push({
      role: "user" as const,
      content: "newest",
      timestamp: Date.now(),
    });
    scroll.session.emit();
    expect(scroll.tui.requestRender).toHaveBeenCalledOnce();
    expect(scroll.viewer.render(100).join("\n")).not.toContain("100%");
    scroll.viewer.handleInput(LEGACY_END);
    expect(scroll.viewer.render(100).join("\n")).toContain("100%");
  });

  it("reads mutable record state and keeps completed viewers open", () => {
    const record = makeRecord({ live: { activeTools: [], responseText: "working" } });
    const { viewer, session, tui, done } = makeViewer({
      record,
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });
    expect(viewer.render(80).join("\n")).toContain("working");
    record.status = "completed";
    record.live.responseText = "finished";
    tui.requestRender.mockClear();
    session.emit();
    expect(tui.requestRender).toHaveBeenCalledOnce();
    expect(viewer.render(80).join("\n")).toContain("✓");
    expect(done).not.toHaveBeenCalled();
  });

  it("keeps stop confirmation and cleanup behavior", () => {
    const onStop = vi.fn();
    const { viewer, session, done, tui } = makeViewer({ onStop });
    viewer.handleInput(CSI_U_X);
    viewer.handleInput("a");
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
