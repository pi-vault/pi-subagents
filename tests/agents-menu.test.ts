import { describe, expect, test, vi } from "vitest";
import {
  SETTINGS_MENU_ITEMS,
  renderRow,
  showAgentsMenu,
} from "../src/tui/agents-menu.js";
import type {
  AgentDefinition,
  ResolvedPaths,
  SubagentsConfig,
} from "../src/shared/types.js";
import type { RuntimeDeps } from "../src/shared/runtime-deps.js";

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

async function driveOverrideEdit(updateError?: Error) {
  const paths = {
    userAgentsDir: "/path/that/does/not/exist/user-agents",
    bundledAgentsDir: "/path/that/does/not/exist/bundled-agents",
  } as ResolvedPaths;
  const sourcePath = `${paths.userAgentsDir}/planner.md`;
  const original = "original Markdown\n";
  const edited = "edited Markdown\n";
  const override: AgentDefinition = {
    name: "planner",
    description: "Plans work",
    tools: ["read"],
    subagentAgents: [],
    systemPrompt: "Plan",
    sourcePath,
  };
  const catalog = {
    entries: [
      {
        name: "planner",
        state: "override" as const,
        override,
      },
    ],
    userDiagnostics: [
      { path: `${paths.userAgentsDir}/bad.md`, reason: "invalid" },
    ],
    bundledDiagnostics: [],
  };
  const discoverAgentCatalog = vi.fn(() => catalog);
  const readUserAgentOverride = vi.fn(() => original);
  const updateUserAgentOverride = vi.fn(() => {
    if (updateError) {
      throw updateError;
    }
    return override;
  });
  const deps = {
    resolvePaths: () => paths,
    discoverAgentCatalog,
    readUserAgentOverride,
    updateUserAgentOverride,
  } as unknown as RuntimeDeps;
  const inputs = ["\r", "\r", "\r", "\x1b", "\x1b"];
  const renders: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];

  type MenuFactory = (
    tui: { requestRender(): void },
    theme: {
      fg(color: string, text: string): string;
      bold(text: string): string;
    },
    keyboard: unknown,
    done: (value: undefined) => void,
  ) => {
    render(width: number): string[];
    handleInput(data: string): void;
  };

  await showAgentsMenu(
    {
      ui: {
        custom: async (factory: unknown) => {
          await new Promise<void>((resolveDone) => {
            const component = (factory as MenuFactory)(
              { requestRender() {} },
              {
                fg: (_color, text) => text,
                bold: (text) => text,
              },
              undefined,
              () => resolveDone(),
            );
            renders.push(component.render(120).join("\n"));
            component.handleInput(inputs.shift() ?? "\x1b");
          });
        },
        editor: async () => edited,
        notify: (message: string, level: string) => {
          notifications.push({ message, level });
        },
      },
    } as never,
    deps,
  );

  return {
    discoverAgentCatalog,
    edited,
    notifications,
    paths,
    readUserAgentOverride,
    renders,
    sourcePath,
    updateUserAgentOverride,
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

test("catalog display and override editing delegate through RuntimeDeps", async () => {
  const result = await driveOverrideEdit();

  expect(result.discoverAgentCatalog).toHaveBeenCalledWith(result.paths);
  expect(result.readUserAgentOverride).toHaveBeenCalledWith(
    result.paths,
    result.sourcePath,
  );
  expect(result.updateUserAgentOverride).toHaveBeenCalledWith(
    result.paths,
    result.sourcePath,
    result.edited,
  );
  expect(result.renders.join("\n")).toContain("Agents (1)");
  expect(result.renders.join("\n")).toContain(
    "planner  [global override]",
  );
  expect(result.renders.join("\n")).toContain(
    "1 invalid user agent file(s) skipped",
  );
  expect(result.notifications).toContainEqual({
    message: `Updated "planner" at ${result.sourcePath}`,
    level: "info",
  });
});

test("override update errors use the existing save notification", async () => {
  const result = await driveOverrideEdit(new Error("invalid edit"));

  expect(result.notifications).toContainEqual({
    message: "Could not save agent: invalid edit",
    level: "error",
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

    test("apply calls setMaxSpawnsPerSession on manager", () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "maxSpawnsPerSession");
      const setMaxSpawnsPerSession = vi.fn();
      item?.apply?.(15, { manager: { setMaxSpawnsPerSession } } as unknown as RuntimeDeps);
      expect(setMaxSpawnsPerSession).toHaveBeenCalledWith(15);
    });
  });
});
