import { describe, expect, test } from "vitest";
import { SETTINGS_MENU_ITEMS, renderRow } from "../src/tui/agents-menu.js";
import type { SubagentsConfig } from "../src/shared/types.js";

function createTheme() {
  const calls: Array<{ method: string; color?: string; text: string }> = [];
  return {
    calls,
    theme: {
      fg(color: string, text: string) {
        calls.push({ method: "fg", color, text });
        return text;
      },
      bold(text: string) {
        calls.push({ method: "bold", text });
        return text;
      },
      bg(color: string, text: string) {
        calls.push({ method: "bg", color, text });
        return text;
      },
    },
  };
}

describe("agents menu row rendering", () => {
  test("selected rows use accent arrow + accent label without background fill", () => {
    const { calls, theme } = createTheme();
    const line = renderRow(theme as never, "Agents (5)", true);

    expect(line).toContain("▸");
    expect(calls.some((entry) => entry.method === "fg" && entry.color === "accent" && entry.text.includes("▸"))).toBe(true);
    expect(calls.some((entry) => entry.method === "fg" && entry.color === "accent" && entry.text.includes("Agents (5)"))).toBe(true);
    expect(calls.some((entry) => entry.method === "bg")).toBe(false);
  });

  test("unselected rows stay dimmed", () => {
    const { calls, theme } = createTheme();
    const line = renderRow(theme as never, "Create new agent", false);

    expect(line.startsWith("  ")).toBe(true);
    expect(calls.some((entry) => entry.method === "fg" && entry.color === "dim" && entry.text.includes("Create new agent"))).toBe(true);
  });
});

describe("SETTINGS_MENU_ITEMS", () => {
  const config = {} as SubagentsConfig;

  test("contains widgetMode item with correct key and label", () => {
    const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
    expect(item).toBeDefined();
    expect(item?.label).toBe("Widget Mode");
  });

  test("contains fleetView item with correct key and label", () => {
    const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
    expect(item).toBeDefined();
    expect(item?.label).toBe("Fleet View");
  });

  describe("widgetMode item parse", () => {
    test('parse("all") returns "all"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(item?.parse("all")).toBe("all");
    });

    test('parse("background") returns "background"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(item?.parse("background")).toBe("background");
    });

    test('parse("off") returns "off"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(item?.parse("off")).toBe("off");
    });

    test('parse("invalid") returns undefined', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(item?.parse("invalid")).toBeUndefined();
    });
  });

  describe("fleetView item parse", () => {
    test('parse("true") returns true', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
      expect(item?.parse("true")).toBe(true);
    });

    test('parse("false") returns false', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
      expect(item?.parse("false")).toBe(false);
    });

    test('parse("yes") returns undefined', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
      expect(item?.parse("yes")).toBeUndefined();
    });
  });

  describe("widgetMode item formatValue", () => {
    test('formatValue with deps { widgetMode: "all" } returns "all"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(item?.formatValue(config, { widgetMode: "all" })).toBe("all");
    });

    test('formatValue with empty deps returns "background" (default)', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(item?.formatValue(config, {})).toBe("background");
    });
  });

  describe("fleetView item formatValue", () => {
    test('formatValue with deps { fleetView: false } returns "false"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
      expect(item?.formatValue(config, { fleetView: false })).toBe("false");
    });

    test('formatValue with empty deps returns "true" (default)', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
      expect(item?.formatValue(config, {})).toBe("true");
    });
  });

  describe("maxSpawnsPerSession item", () => {
    test("contains maxSpawnsPerSession item with correct key and label", () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "maxSpawnsPerSession");
      expect(item).toBeDefined();
      expect(item?.label).toBe("Max Spawns Per Session");
    });

    test("formatValue returns string of config.maxSpawnsPerSession", () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "maxSpawnsPerSession");
      const cfg = { maxSpawnsPerSession: 25 } as SubagentsConfig;
      expect(item?.formatValue(cfg)).toBe("25");
    });

    test("parse accepts non-negative integers", () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "maxSpawnsPerSession");
      expect(item?.parse("0")).toBe(0);
      expect(item?.parse("10")).toBe(10);
      expect(item?.parse("40")).toBe(40);
    });

    test("parse rejects negative numbers and non-integers", () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "maxSpawnsPerSession");
      expect(item?.parse("-1")).toBeUndefined();
      expect(item?.parse("1.5")).toBeUndefined();
      expect(item?.parse("abc")).toBeUndefined();
    });
  });
});
