import { type EditorComponent, visibleWidth } from "@earendil-works/pi-tui";
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

function harness(records: AgentRecord[]) {
  let editorText = "";
  let focused: unknown = editorComponent();
  let handler: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
  let widgetFactory: ((tui: unknown, theme: Theme) => { render(width: number): string[] }) | undefined;
  let overlayOpen = false;
  let overlayDone: (() => void) | undefined;
  let customOptions: CustomOptions | undefined;
  const unsubscribe = vi.fn();
  const manager = {
    listAgents: vi.fn(() => records),
    abort: vi.fn(() => true),
    steer: vi.fn(() => true),
  } as unknown as AgentManager;
  const tui = {
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
        factory(tui, makeTheme(), {}, done);
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
    render: (width: number) => widgetFactory?.(tui, makeTheme()).render(width) ?? [],
    setEditorText: (text: string) => { editorText = text; },
    setFocus: (component: unknown) => { focused = component; },
    closeOverlay: () => overlayDone?.(),
    overlayOpened: () => overlayOpen,
    customOptions: () => customOptions,
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

  it.each([LEGACY_ESCAPE, CSI_U_ESCAPE])("deactivates for Escape encoding %j", (escape) => {
    const h = harness([makeRecord()]);
    h.press(LEGACY_DOWN);
    expect(h.press(escape)).toEqual({ consume: true });
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
  it("registers the fleet widget and renders the main and agent rows", () => {
    const h = harness([makeRecord()]);
    expect(h.ui.setWidget).toHaveBeenCalledWith("fleet", expect.any(Function), { placement: "belowEditor" });
    const lines = h.render(80);
    expect(lines.some((line) => line.includes("main"))).toBe(true);
    expect(lines.some((line) => line.includes("coder"))).toBe(true);
    expect(lines.some((line) => line.includes("↓ 150 tokens"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
    h.fleet.dispose();
  });

  it("keeps FleetList's existing viewer overlay composition", () => {
    const h = harness([makeRecord()]);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_DOWN);
    h.press(LEGACY_ENTER);
    expect(h.customOptions()).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" },
    });
    expect(DASHBOARD_OVERLAY_OPTIONS).toBeDefined();
    h.closeOverlay();
    h.fleet.dispose();
  });
});
