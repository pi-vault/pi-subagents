import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type OverlayOptions,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  type SubagentsSettings,
} from "../src/core/settings.js";
import type { RuntimeDeps } from "../src/shared/runtime-deps.js";
import type {
  AgentDefinition,
  ResolvedPaths,
} from "../src/shared/types.js";
import { DASHBOARD_OVERLAY_OPTIONS } from "../src/tui/dashboard-style.js";
import {
  SETTINGS_MENU_ITEMS,
  renderRow,
  runAgentsMenuAction,
  showAgentsMenu,
} from "../src/tui/agents-menu.js";

type MenuComponent = Component & { handleInput(data: string): void };

type MenuFactory = (
  tui: TUI,
  theme: ReturnType<typeof createTheme>["theme"],
  keyboard: KeybindingsManager,
  done: (value: undefined) => void,
) => MenuComponent;

type CustomOptions = {
  overlay?: boolean;
  overlayOptions?: OverlayOptions | (() => OverlayOptions);
};

const TEST_PATHS = {
  userAgentsDir: "/path/that/does/not/exist/user-agents",
  bundledAgentsDir: "/path/that/does/not/exist/bundled-agents",
} as ResolvedPaths;

const KITTY_DOWN = "\x1b[1;1B";
const KITTY_UP = "\x1b[1;1A";
const CSI_U_ENTER = "\x1b[13u";
const CSI_U_ESCAPE = "\x1b[27u";

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

type TestTui = {
  terminal: { rows: number };
  requestRender(): void;
};

type MenuScript = (
  component: MenuComponent,
  tui: TestTui,
  capture: (renderWidth?: number) => void,
) => void;

function createCustomDriver(
  scripts: MenuScript[],
  terminalRows = 40,
  width = 80,
) {
  const renders: string[][] = [];
  const options: CustomOptions[] = [];
  let invocation = 0;

  const custom = async (
    factory: MenuFactory,
    customOptions?: CustomOptions,
  ): Promise<void> => {
    const script = scripts[invocation++];
    if (!script) throw new Error(`Missing menu script ${invocation}`);

    await new Promise<void>((resolveDone) => {
      const tui: TestTui = {
        terminal: { rows: terminalRows },
        requestRender() {},
      };
      const component = factory(
        tui as unknown as TUI,
        createTheme().theme,
        {} as KeybindingsManager,
        () => resolveDone(),
      );
      options.push(customOptions ?? {});
      script(component, tui, (renderWidth = width) =>
        renders.push(component.render(renderWidth)),
      );
    });
  };

  return { custom, options, renders };
}

async function driveOverrideEdit(updateError?: Error) {
  const sourcePath = `${TEST_PATHS.userAgentsDir}/planner.md`;
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
      { path: `${TEST_PATHS.userAgentsDir}/bad.md`, reason: "invalid" },
    ],
    bundledDiagnostics: [],
  };
  const discoverAgentCatalog = vi.fn(() => catalog);
  const readUserAgentOverride = vi.fn(() => original);
  const updateUserAgentOverride = vi.fn(() => {
    if (updateError) throw updateError;
    return override;
  });
  const deps = {
    resolvePaths: () => TEST_PATHS,
    discoverAgentCatalog,
    readUserAgentOverride,
    updateUserAgentOverride,
  } as unknown as RuntimeDeps;
  const inputs = ["\r", "\r", "\r", "\x1b", "\x1b"];
  const menuNames = [
    "root",
    "catalog",
    "action",
    "catalog-return",
    "root-return",
  ];
  const events: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const editor = vi.fn(async () => {
    events.push("editor");
    return edited;
  });
  const driver = createCustomDriver(
    Array.from({ length: inputs.length }, () => (component, _tui, capture) => {
      capture();
      component.handleInput(inputs.shift() ?? "\x1b");
    }),
    40,
    120,
  );

  await showAgentsMenu(
    {
      ui: {
        custom: async (...args: Parameters<typeof driver.custom>) => {
          const menuName = menuNames.shift();
          await driver.custom(...args);
          events.push(`${menuName}-done`);
        },
        editor,
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
    editor,
    events,
    notifications,
    paths: TEST_PATHS,
    readUserAgentOverride,
    renders: driver.renders.map((render) => render.join("\n")),
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
  expect(result.editor).toHaveBeenCalledWith(
    "Edit planner",
    "original Markdown\n",
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
  expect(result.events).toEqual([
    "root-done",
    "catalog-done",
    "action-done",
    "editor",
    "catalog-return-done",
    "root-return-done",
  ]);
});

test("root menu uses the dashboard overlay frame and controls", async () => {
  const driver = createCustomDriver([
    (component, _tui, capture) => {
      capture();
      component.handleInput(CSI_U_ESCAPE);
    },
  ]);

  await showAgentsMenu(
    {
      ui: { custom: driver.custom, notify: vi.fn() },
    } as never,
    {
      resolvePaths: vi.fn(() => TEST_PATHS),
      discoverAgentCatalog: vi.fn(() => ({
        entries: [],
        userDiagnostics: [],
        bundledDiagnostics: [],
      })),
    } as unknown as RuntimeDeps,
  );

  const [lines] = driver.renders;
  expect(lines[0]).toMatch(/^┏━/);
  expect(lines.at(-1)).toMatch(/━┛$/);
  expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true);
  expect(lines.join("\n")).toContain("▸ Agents (0)");
  expect(lines.join("\n")).toContain("↑/↓ Select");
  expect(lines.join("\n")).toContain("Enter Choose");
  expect(lines.join("\n")).toContain("Esc Close");
  expect(driver.options[0]).toEqual({
    overlay: true,
    overlayOptions: DASHBOARD_OVERLAY_OPTIONS,
  });
});

function catalogWithAgents(count: number) {
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      name: `agent-${index + 1}`,
      state: "bundled" as const,
    })),
    userDiagnostics: [],
    bundledDiagnostics: [],
  };
}

test("catalog viewport keeps the selected agent visible while scrolling", async () => {
  const catalog = catalogWithAgents(12);
  const driver = createCustomDriver(
    [
      (component) => component.handleInput(CSI_U_ENTER),
      (component, _tui, capture) => {
        for (let index = 0; index < 11; index++) component.handleInput(KITTY_DOWN);
        capture();
        for (let index = 0; index < 11; index++) component.handleInput(KITTY_UP);
        capture();
        component.handleInput(CSI_U_ESCAPE);
      },
      (component) => component.handleInput(CSI_U_ESCAPE),
    ],
    14,
  );

  await showAgentsMenu(
    { ui: { custom: driver.custom, notify: vi.fn() } } as never,
    {
      resolvePaths: vi.fn(() => TEST_PATHS),
      discoverAgentCatalog: vi.fn(() => catalog),
    } as unknown as RuntimeDeps,
  );

  const [lastSelected, firstSelected] = driver.renders;
  expect(driver.options).toHaveLength(3);
  expect(lastSelected.join("\n")).toContain("▸ agent-12");
  expect(lastSelected.join("\n")).not.toContain("agent-1   [bundled]");
  expect(firstSelected.join("\n")).toContain("▸ agent-1");
});

test("catalog resize fallback remains escapable and restores its viewport", async () => {
  const catalog = catalogWithAgents(12);
  const driver = createCustomDriver(
    [
      (component) => component.handleInput(CSI_U_ENTER),
      (component, tui, capture) => {
        for (let index = 0; index < 11; index++) component.handleInput(KITTY_DOWN);
        capture(80);
        tui.terminal.rows = 3;
        capture(30);
        tui.terminal.rows = 14;
        capture(80);
        component.handleInput(CSI_U_ESCAPE);
      },
      (component) => component.handleInput(CSI_U_ESCAPE),
    ],
    14,
  );

  await showAgentsMenu(
    { ui: { custom: driver.custom, notify: vi.fn() } } as never,
    {
      resolvePaths: vi.fn(() => TEST_PATHS),
      discoverAgentCatalog: vi.fn(() => catalog),
    } as unknown as RuntimeDeps,
  );

  const [normalLines, tinyLines, restoredLines] = driver.renders;
  expect(driver.options).toHaveLength(3);
  expect(normalLines.join("\n")).toContain("▸ agent-12");
  expect(tinyLines).toHaveLength(2);
  expect(tinyLines.every((line) => visibleWidth(line) === 30)).toBe(true);
  expect(tinyLines.join("\n")).toContain("Esc");
  expect(restoredLines.join("\n")).toContain("▸ agent-12");
});

test("override update errors use the existing save notification", async () => {
  const result = await driveOverrideEdit(new Error("invalid edit"));

  expect(result.notifications).toContainEqual({
    message: "Could not save agent: invalid edit",
    level: "error",
  });
});

test("create keeps the native input/editor workflow", async () => {
  const input = vi
    .fn()
    .mockResolvedValueOnce("planner")
    .mockResolvedValueOnce("Plans work")
    .mockResolvedValueOnce("read, bash")
    .mockResolvedValueOnce("provider/model")
    .mockResolvedValueOnce("high")
    .mockResolvedValueOnce("worker");
  const editor = vi.fn().mockResolvedValue("Plan carefully.");
  const discovery = { agents: [], diagnostics: [] };
  const created: AgentDefinition = {
    name: "planner",
    description: "Plans work",
    tools: ["read", "bash"],
    subagentAgents: ["worker"],
    systemPrompt: "Plan carefully.",
    sourcePath: `${TEST_PATHS.userAgentsDir}/planner.md`,
  };
  const createAgentFile = vi.fn(() => created);

  await runAgentsMenuAction(
    { kind: "create-agent" },
    { ui: { input, editor, notify: vi.fn() } } as never,
    {
      resolvePaths: vi.fn(() => TEST_PATHS),
      discoverAgents: vi.fn(() => discovery),
      discoverToolNames: vi.fn(() => ["read", "bash"]),
      createAgentFile,
    } as unknown as RuntimeDeps,
  );

  expect(createAgentFile).toHaveBeenCalledWith(
    TEST_PATHS,
    {
      name: "planner",
      filenameSlug: undefined,
      description: "Plans work",
      tools: ["read", "bash"],
      model: "provider/model",
      thinking: "high",
      subagentAgents: ["worker"],
      systemPrompt: "Plan carefully.",
    },
    discovery,
    ["read", "bash"],
  );
});

test("delete keeps the existing immediate RuntimeDeps action", async () => {
  const deleteUserAgentOverride = vi.fn();

  await runAgentsMenuAction(
    { kind: "delete-override", agentName: "planner" },
    { ui: { notify: vi.fn() } } as never,
    {
      resolvePaths: vi.fn(() => TEST_PATHS),
      deleteUserAgentOverride,
    } as unknown as RuntimeDeps,
  );

  expect(deleteUserAgentOverride).toHaveBeenCalledWith(TEST_PATHS, "planner");
});

describe("SETTINGS_MENU_ITEMS", () => {
  const settings = DEFAULT_SETTINGS;

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
    test('formatValue with widgetMode "all" returns "all"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(
        item?.formatValue({ ...DEFAULT_SETTINGS, widgetMode: "all" }),
      ).toBe("all");
    });

    test('formatValue uses the default "background"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "widgetMode");
      expect(item?.formatValue(DEFAULT_SETTINGS)).toBe("background");
    });
  });

  describe("fleetView item formatValue", () => {
    test('formatValue with fleetView false returns "false"', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
      expect(
        item?.formatValue({ ...DEFAULT_SETTINGS, fleetView: false }),
      ).toBe("false");
    });

    test('formatValue uses the default true', () => {
      const item = SETTINGS_MENU_ITEMS.find((i) => i.key === "fleetView");
      expect(item?.formatValue(DEFAULT_SETTINGS)).toBe("true");
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
      const value = {
        ...settings,
        maxSpawnsPerSession: 25,
      } satisfies SubagentsSettings;
      expect(item?.formatValue(value)).toBe("25");
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
