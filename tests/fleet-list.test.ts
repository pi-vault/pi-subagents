import {
  type EditorComponent,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetList, formatFleetElapsed, formatFleetTokens } from "../src/tui/fleet-list.js";
import type { AgentManager } from "../src/core/agent-manager.js";
import type { AgentRecord } from "../src/shared/types.js";
import type { Theme } from "../src/tui/agent-widget.js";
import { DASHBOARD_OVERLAY_OPTIONS } from "../src/tui/dashboard-style.js";

const LEGACY_DOWN = "\x1b[B";
const LEGACY_UP = "\x1b[A";
const LEGACY_LEFT = "\x1b[D";
const LEGACY_ENTER = "\r";
const LEGACY_ESCAPE = "\x1b";
const KITTY_DOWN = "\x1b[1;1B";
const KITTY_UP = "\x1b[1;1A";
const KITTY_LEFT = "\x1b[1;1D";
const CSI_U_ENTER = "\x1b[13u";
const CSI_U_ESCAPE = "\x1b[27u";
const KITTY_DOWN_RELEASE = "\x1b[1;1:3B";

type CustomOptions = { overlay?: boolean; overlayOptions?: unknown };

const makeRecord = (overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  type: "coder",
  description: "Fix bug",
  status: "running",
  toolUses: 0,
  turnCount: 1,
  live: { activeTools: [], responseText: "" },
  startedAt: Date.now() - 5000,
  lifetimeUsage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0 },
  session: { messages: [], subscribe: () => () => {} },
  ...overrides,
});

const makeTheme = (): Theme => ({
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
});

const ansiTheme = (): Theme => {
  const colors: Record<string, number> = { accent: 35, dim: 2, muted: 36 };
  return {
    fg: (color, text) => `\x1b[${colors[color] ?? 37}m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`,
  };
};

const plain = stripTerminalSequences;

const editorComponent = (): EditorComponent => ({
  render: () => [],
  invalidate: () => {},
  handleInput: () => {},
  getText: () => "",
  setText: () => {},
});

const dialogComponent = () => ({
  render: () => [],
  invalidate: () => {},
  handleInput: () => {},
});

function harness(
  records: AgentRecord[],
  initialFocus: unknown = editorComponent(),
  mountedComponent: unknown = initialFocus,
) {
  let editorText = "";
  let focused = initialFocus;
  let handler: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
  let widgetFactory: ((tui: unknown, theme: Theme) => { render(width: number): string[] }) | undefined;
  let overlayOpen = false;
  let overlayDone: (() => void) | undefined;
  let customOptions: CustomOptions | undefined;
  let viewer: { handleInput(data: string): void } | undefined;
  const unsubscribe = vi.fn();
  const manager = {
    listAgents: vi.fn(() => records),
    abort: vi.fn(() => true),
    steer: vi.fn(() => true),
  } as unknown as AgentManager;
  const tui = {
    children: [mountedComponent],
    terminal: { rows: 40, columns: 80 },
    requestRender: vi.fn(),
    getFocusedComponent: () => focused,
  };
  const ui = {
    setWidget: vi.fn((key: string, content: unknown) => {
      if (key === "fleet" && typeof content === "function") {
        widgetFactory = content as (tui: unknown, theme: Theme) => { render(width: number): string[] };
      }
    }),
    onTerminalInput: vi.fn((nextHandler: typeof handler) => {
      handler = nextHandler;
      return unsubscribe;
    }),
    getEditorText: () => editorText,
    notify: vi.fn(),
    custom: vi.fn(<T>(factory: (tui: unknown, theme: Theme, keybindings: unknown, done: (result: T) => void) => unknown, options?: CustomOptions) => {
      customOptions = options;
      overlayOpen = true;
      return new Promise<T>((resolve) => {
        const done = (result: T) => {
          overlayOpen = false;
          resolve(result);
        };
        viewer = factory(tui, makeTheme(), {}, done) as typeof viewer;
        overlayDone = () => done(undefined as T);
      });
    }),
  };
  const fleet = new FleetList(manager);
  fleet.setUICtx(ui as never);
  fleet.update();
  if (widgetFactory) widgetFactory(tui, makeTheme());

  return {
    fleet,
    manager,
    records,
    ui,
    unsubscribe,
    press: (data: string) => handler?.(data),
    render: (width: number, theme = makeTheme()) => widgetFactory?.(tui, theme).render(width) ?? [],
    setEditorText: (text: string) => { editorText = text; },
    setFocus: (component: unknown) => { focused = component; },
    closeOverlay: () => overlayDone?.(),
    overlayOpened: () => overlayOpen,
    customOptions: () => customOptions,
    viewer: () => viewer,
  };
}

afterEach(() => vi.useRealTimers());

// ---- format helpers ----

describe("formatFleetElapsed", () => {
  it("rounds 5500ms to 6s", () => expect(formatFleetElapsed(5500)).toBe("6s"));
  it("formats 0ms as 0s", () => expect(formatFleetElapsed(0)).toBe("0s"));
  it("formats 1000ms as 1s", () => expect(formatFleetElapsed(1000)).toBe("1s"));
});

describe("formatFleetTokens", () => {
  it("formats 0 as '↓ 0 tokens'", () => expect(formatFleetTokens(0)).toBe("↓ 0 tokens"));
  it("formats 500 as '↓ 500 tokens'", () => expect(formatFleetTokens(500)).toBe("↓ 500 tokens"));
  it("formats 13100 as '↓ 13.1k tokens'", () => expect(formatFleetTokens(13100)).toBe("↓ 13.1k tokens"));
  it("formats 1_200_000 as '↓ 1.2M tokens'", () => expect(formatFleetTokens(1_200_000)).toBe("↓ 1.2M tokens"));
});

// ---- FleetList input boundary ----

describe("FleetList terminal input", () => {
  it.each([LEGACY_DOWN, KITTY_DOWN, LEGACY_LEFT, KITTY_LEFT])("activates from an empty focused editor for %j", (key) => {
    const h = harness([makeRecord()]);
    expect(h.press(key)).toEqual({ consume: true });
    h.fleet.dispose();
  });

  it.each([LEGACY_DOWN, KITTY_DOWN])("navigates with legacy and Kitty arrows after %j activation", (activate) => {
    const h = harness([makeRecord()]);
    expect(h.press(activate)).toEqual({ consume: true });
    expect(h.press(KITTY_DOWN)).toEqual({ consume: true });
    expect(h.press(LEGACY_UP)).toEqual({ consume: true });
    expect(h.press(KITTY_UP)).toEqual({ consume: true });
    expect(h.press(LEGACY_UP)).toBeUndefined();
    h.fleet.dispose();
  });

  it.each([LEGACY_ESCAPE, CSI_U_ESCAPE])("deactivates for Escape encoding %j", (escapeSequence) => {
    const h = harness([makeRecord()]);
    h.press(LEGACY_DOWN);
    expect(h.press(escapeSequence)).toEqual({ consume: true });
    expect(h.press(LEGACY_UP)).toBeUndefined();
    h.fleet.dispose();
  });

  it.each([LEGACY_ENTER, CSI_U_ENTER])("Enter encoding %j deactivates on main without opening an overlay", (enter) => {
    const h = harness([makeRecord()]);
    h.press(LEGACY_DOWN);
    expect(h.press(enter)).toEqual({ consume: true });
    expect(h.overlayOpened()).toBe(false);
    expect(h.press(LEGACY_UP)).toBeUndefined();
    h.fleet.dispose();
  });

  it.each([LEGACY_ENTER, CSI_U_ENTER])("Enter encoding %j opens the selected agent", (enter) => {
    const h = harness([makeRecord()]);
    h.press(LEGACY_DOWN);
    h.press(KITTY_DOWN);
    expect(h.press(enter)).toEqual({ consume: true });
    expect(h.overlayOpened()).toBe(true);
    h.closeOverlay();
    h.fleet.dispose();
  });

  it("passes a non-navigation key through after deactivating", () => {
    const h = harness([makeRecord()]);
    h.press(LEGACY_DOWN);
    expect(h.press("x")).toBeUndefined();
    expect(h.press(LEGACY_UP)).toBeUndefined();
    h.fleet.dispose();
  });

  it("does not activate when the editor has text", () => {
    const h = harness([makeRecord()]);
    h.setEditorText("some text");
    expect(h.press(LEGACY_DOWN)).toBeUndefined();
    h.fleet.dispose();
  });

  it("does not steal activation keys from a focused dialog", () => {
    const h = harness([makeRecord()]);
    h.setFocus(dialogComponent());
    expect(h.press(KITTY_DOWN)).toBeUndefined();
    h.fleet.dispose();
  });

  it("does not steal activation keys from another editor component", () => {
    const h = harness([makeRecord()]);
    h.setFocus(editorComponent());
    expect(h.press(KITTY_DOWN)).toBeUndefined();
    h.fleet.dispose();
  });

  it("learns the prompt editor after mounting behind an overlay", () => {
    const promptEditor = editorComponent();
    const h = harness([makeRecord()], editorComponent(), promptEditor);
    expect(h.press(KITTY_DOWN)).toBeUndefined();
    h.setFocus(promptEditor);
    expect(h.press(KITTY_DOWN)).toEqual({ consume: true });
    h.fleet.dispose();
  });

  it("deactivates and passes through when focus leaves the editor", () => {
    const h = harness([makeRecord()]);
    expect(h.press(LEGACY_DOWN)).toEqual({ consume: true });
    h.setFocus(dialogComponent());
    expect(h.press(LEGACY_DOWN)).toBeUndefined();
    h.setFocus(editorComponent());
    expect(h.press(LEGACY_UP)).toBeUndefined();
    h.fleet.dispose();
  });

  it("does not consume input while focused component is unknown", () => {
    const h = harness([makeRecord()]);
    h.setFocus(null);
    expect(h.press(LEGACY_DOWN)).toBeUndefined();
    h.fleet.dispose();
  });

  it("ignores the release half of a Down key", () => {
    const h = harness([makeRecord(), makeRecord({ id: "a2" })]);
    h.press(KITTY_DOWN);
    expect(h.press(KITTY_DOWN_RELEASE)).toBeUndefined();
    h.press(CSI_U_ENTER);
    expect(h.overlayOpened()).toBe(false);
    h.fleet.dispose();
  });
});

// ---- FleetList lifecycle and rendering ----

describe("FleetList lifecycle", () => {
  it("clears its interval when disabled or empty and restarts it when re-enabled", () => {
    vi.useFakeTimers();
    const h = harness([makeRecord()]);
    expect(vi.getTimerCount()).toBe(1);
    h.fleet.setEnabled(false);
    expect(vi.getTimerCount()).toBe(0);
    h.fleet.setEnabled(true);
    expect(vi.getTimerCount()).toBe(1);
    h.records.length = 0;
    h.fleet.update();
    expect(vi.getTimerCount()).toBe(0);
    h.fleet.dispose();
  });

  it("dispose unsubscribes, closes an open viewer, clears its widget, and timer", () => {
    vi.useFakeTimers();
    const h = harness([makeRecord()]);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_ENTER);
    expect(h.overlayOpened()).toBe(true);
    h.fleet.dispose();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.overlayOpened()).toBe(false);
    expect(h.ui.setWidget).toHaveBeenCalledWith("fleet", undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("FleetList rendering", () => {
  it("renders the unboxed inactive and active fleet presentation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
    const h = harness([makeRecord()]);
    const inactive = h.render(80);
    expect(plain(inactive[0])).toBe("✦ Agents");
    expect(plain(inactive.at(-1) ?? "")).toBe("↓/← Focus agents • Esc Interrupt");
    expect(plain(inactive.join("\n"))).not.toContain("▸");

    h.press(LEGACY_DOWN);
    h.press(LEGACY_DOWN);
    const active = h.render(80);
    expect(plain(active[0])).toBe("✦ Agents");
    expect(plain(active.find((line) => line.includes("coder")) ?? "")).toMatch(
      /^▸ coder {2}Fix bug\s+5s • ↓ 150 tokens$/,
    );
    expect(plain(active.at(-1) ?? "")).toBe("↑/↓ Select • Enter View • Esc Back");
    h.fleet.dispose();
  });

  it("uses semantic styles without fleet box glyphs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
    const h = harness([makeRecord(), makeRecord({ id: "a2", type: "reviewer" })]);
    const inactive = h.render(80, ansiTheme());
    expect(inactive[0]).toContain("\x1b[35m\x1b[1m✦ Agents");
    expect(inactive.at(-1)?.startsWith("\x1b[2m")).toBe(true);

    h.press(LEGACY_DOWN);
    h.press(LEGACY_DOWN);
    const active = h.render(80, ansiTheme());
    const selected = active.find((line) => plain(line).includes("coder")) ?? "";
    expect(selected.startsWith("\x1b[35m▸")).toBe(true);
    expect(selected).toContain("\x1b[2m5s • ↓ 150 tokens");
    expect(active.at(-1)?.startsWith("\x1b[2m")).toBe(true);
    expect(plain(active.join("\n"))).not.toMatch(/[┏━┃┗╭─│╰]/);
    h.fleet.dispose();

    const overflow = harness(Array.from({ length: 6 }, (_, index) => makeRecord({ id: `o${index}` })));
    expect(overflow.render(80, ansiTheme()).find((line) => plain(line).trim() === "↓ 1 more")).toContain(
      "\x1b[2m↓ 1 more",
    );
    overflow.fleet.dispose();
  });

  it("uses dashboard overlay options and targets the selected live agent", () => {
    const record = makeRecord();
    const h = harness([record]);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_ENTER);
    expect(h.customOptions()).toEqual({
      overlay: true,
      overlayOptions: DASHBOARD_OVERLAY_OPTIONS,
    });
    const viewer = h.viewer();
    if (!viewer) throw new Error("Expected viewer");
    viewer.handleInput(LEGACY_ENTER);
    viewer.handleInput("message");
    viewer.handleInput(LEGACY_ENTER);
    expect(h.manager.steer).toHaveBeenCalledOnce();
    expect(h.manager.steer).toHaveBeenCalledWith(record.id, "message");
    viewer.handleInput("x");
    viewer.handleInput("x");
    expect(h.manager.abort).toHaveBeenCalledOnce();
    expect(h.manager.abort).toHaveBeenCalledWith(record.id);
    h.closeOverlay();
    h.fleet.dispose();
  });

  it("keeps a five-agent window separate from main and shows overflow above and below", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
    const records = Array.from({ length: 8 }, (_, index) =>
      makeRecord({ id: `a${index}`, type: `agent-${index}`, startedAt: Date.now() - (8000 - index) }),
    );
    const h = harness(records);
    let lines = h.render(80).map(plain);
    expect(lines.filter((line) => line.includes("agent-")).length).toBe(5);
    expect(lines.some((line) => line.trim() === "↓ 3 more")).toBe(true);
    expect(lines.some((line) => line.includes("main"))).toBe(true);

    h.press(LEGACY_DOWN);
    for (let index = 0; index < 8; index++) h.press(LEGACY_DOWN);
    lines = h.render(80).map(plain);
    expect(lines.filter((line) => line.includes("agent-")).length).toBe(5);
    expect(lines.some((line) => line.trim() === "↑ 3 more")).toBe(true);
    expect(lines.some((line) => line.startsWith("▸ agent-7"))).toBe(true);
    h.fleet.dispose();
  });

  it("filters, orders, and lingers roster records", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
    const h = harness([
      makeRecord({ id: "late", type: "late", startedAt: Date.now() - 1000 }),
      makeRecord({ id: "hidden", type: "hidden", session: undefined }),
      makeRecord({ id: "early", type: "early", startedAt: Date.now() - 3000 }),
      makeRecord({ id: "linger", type: "linger", status: "completed", completedAt: Date.now() - 3999 }),
      makeRecord({ id: "gone", type: "gone", status: "completed", completedAt: Date.now() - 4000 }),
    ]);
    const output = h.render(80).map(plain).join("\n");
    expect(output).not.toContain("hidden");
    expect(output).toContain("linger");
    expect(output).not.toContain("gone");
    expect(output.indexOf("early")).toBeLessThan(output.indexOf("late"));
    h.fleet.dispose();
  });

  it("reselects a viewed agent by id when an earlier row disappears", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
    const first = makeRecord({ id: "first", type: "first", startedAt: Date.now() - 2000 });
    const selected = makeRecord({ id: "selected", type: "selected", startedAt: Date.now() - 1000 });
    const h = harness([first, selected]);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_ENTER);
    first.status = "completed";
    first.completedAt = Date.now() - 4000;
    h.closeOverlay();
    await Promise.resolve();
    expect(h.render(80).map(plain).find((line) => line.includes("selected"))).toMatch(/^▸ selected/);
    h.fleet.dispose();
  });

  it("caps ANSI output, normalizes dynamic CR/LF text, and retains metadata when it fits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
    const h = harness([makeRecord({ type: "coder\r\nlong", description: "Fix\n\rvery long bug" })]);
    for (const width of [0, 1, 4, 8, 20, 40, 80, 200]) {
      const lines = h.render(width, ansiTheme());
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
    }
    expect(plain(h.render(20, ansiTheme()).find((line) => plain(line).includes("5s")) ?? "")).toContain(
      "5s • ↓ 150 tokens",
    );
    h.fleet.dispose();
  });
});
