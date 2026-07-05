import { describe, expect, it, vi } from "vitest";
import { FleetList, formatFleetElapsed, formatFleetTokens } from "../src/tui/fleet-list.js";
import type { AgentManager } from "../src/core/agent-manager.js";
import type { AgentRecord } from "../src/shared/types.js";
import type { Theme } from "../src/tui/agent-widget.js";

const DOWN = "\x1b[B";
const UP_ARROW = "\x1b[A";
const ESC = "\x1b";
/** Kitty key-release event for 'A' (codepoint 65, event type 3). */
const KEY_RELEASE = "\x1b[65:3u";

const makeRecord = (overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  type: "coder",
  description: "Fix bug",
  status: "running",
  toolUses: 0,
  turnCount: 1,
  startedAt: Date.now() - 5000,
  lifetimeUsage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0 },
  session: {},
  ...overrides,
});

const makeMockManager = (records: AgentRecord[] = []): AgentManager => ({
  listAgents: () => records,
  abort: vi.fn(() => true),
  steer: vi.fn(() => true),
} as unknown as AgentManager);

const makeUICtx = (editorText = "") => ({
  setWidget: vi.fn(),
  onTerminalInput: vi.fn(() => () => {}),
  getEditorText: () => editorText,
  notify: vi.fn(),
  custom: vi.fn(),
});

const makeTheme = (): Theme => ({
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
});

// ---- formatFleetElapsed ----

describe("formatFleetElapsed", () => {
  it("rounds 5500ms to 6s", () => {
    expect(formatFleetElapsed(5500)).toBe("6s");
  });

  it("formats 0ms as 0s", () => {
    expect(formatFleetElapsed(0)).toBe("0s");
  });

  it("formats 1000ms as 1s", () => {
    expect(formatFleetElapsed(1000)).toBe("1s");
  });
});

// ---- formatFleetTokens ----

describe("formatFleetTokens", () => {
  it("formats 0 as '↓ 0 tokens'", () => {
    expect(formatFleetTokens(0)).toBe("↓ 0 tokens");
  });

  it("formats 500 as '↓ 500 tokens'", () => {
    expect(formatFleetTokens(500)).toBe("↓ 500 tokens");
  });

  it("formats 13100 as '↓ 13.1k tokens'", () => {
    expect(formatFleetTokens(13100)).toBe("↓ 13.1k tokens");
  });

  it("formats 1_200_000 as '↓ 1.2M tokens'", () => {
    expect(formatFleetTokens(1_200_000)).toBe("↓ 1.2M tokens");
  });
});

// ---- FleetList key handling ----

describe("FleetList handleKey", () => {
  it("returns undefined when no agents", () => {
    const fleet = new FleetList(makeMockManager([]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    expect(fleet.handleKey(DOWN)).toBeUndefined();
    fleet.dispose();
  });

  it("returns undefined when editor has text (even with agents)", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx("some text");
    fleet.setUICtx(ui);
    expect(fleet.handleKey(DOWN)).toBeUndefined();
    fleet.dispose();
  });

  it("down arrow at empty editor with agents activates list and returns {consume:true}", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    const result = fleet.handleKey(DOWN);
    expect(result).toEqual({ consume: true });
    fleet.dispose();
  });

  it("up arrow when inactive returns undefined", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    expect(fleet.handleKey(UP_ARROW)).toBeUndefined();
    fleet.dispose();
  });

  it("non-activator key when inactive returns undefined", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    expect(fleet.handleKey("x")).toBeUndefined();
    fleet.dispose();
  });

  it("down arrow when active navigates and returns {consume:true}", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    fleet.handleKey(DOWN); // activate (selectedIndex=0)
    const result = fleet.handleKey(DOWN); // navigate down
    expect(result).toEqual({ consume: true });
    fleet.dispose();
  });

  it("escape when active deactivates and returns {consume:true}", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    fleet.handleKey(DOWN); // activate
    const result = fleet.handleKey(ESC);
    expect(result).toEqual({ consume: true });
    // now inactive: up arrow should be undefined
    expect(fleet.handleKey(UP_ARROW)).toBeUndefined();
    fleet.dispose();
  });

  it("key-release event returns undefined (filtered out)", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    fleet.handleKey(DOWN); // activate
    expect(fleet.handleKey(KEY_RELEASE)).toBeUndefined();
    fleet.dispose();
  });

  it("update() calls without throwing after agent finishes", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    expect(() => fleet.update()).not.toThrow();
    fleet.dispose();
  });

  it("setEnabled(false) deactivates the list", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    fleet.handleKey(DOWN); // activate
    fleet.setEnabled(false);
    // disabled: handleKey returns undefined for any key
    expect(fleet.handleKey(DOWN)).toBeUndefined();
    fleet.dispose();
  });

  it("dispose() runs without throwing", () => {
    const fleet = new FleetList(makeMockManager([]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    expect(() => fleet.dispose()).not.toThrow();
  });
});

// ---- FleetList rendering ----

describe("FleetList rendering", () => {
  it("update() with a running agent calls setWidget with key 'fleet'", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    fleet.update();
    expect(ui.setWidget).toHaveBeenCalledWith(
      "fleet",
      expect.any(Function),
      { placement: "belowEditor" },
    );
    fleet.dispose();
  });

  it("rendered output includes 'main' and agent type row", () => {
    const record = makeRecord();
    const fleet = new FleetList(makeMockManager([record]), new Map());
    const ui = makeUICtx();
    fleet.setUICtx(ui);
    fleet.update();

    // Extract the widget factory from the setWidget call
    const calls = ui.setWidget.mock.calls as Array<
      [string, ((tui: unknown, theme: Theme) => { render(width: number): string[] }) | undefined, unknown]
    >;
    const factory = calls.find(([key]) => key === "fleet")?.[1];
    expect(factory).toBeDefined();

    const theme = makeTheme();
    if (!factory) throw new Error("factory should be defined");
    const widget = factory({ requestRender: vi.fn() }, theme);
    const lines = widget.render(80);

    expect(lines.some((l) => l.includes("main"))).toBe(true);
    expect(lines.some((l) => l.includes("coder"))).toBe(true);
    fleet.dispose();
  });
});
