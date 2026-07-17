import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const piMocks = vi.hoisted(() => ({
  getAgentDir: vi.fn<() => string>(),
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@earendil-works/pi-coding-agent")
  >();
  return {
    ...actual,
    CONFIG_DIR_NAME: ".pi-test",
    getAgentDir: piMocks.getAgentDir,
  };
});

import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSetting,
  type EditableSettingKey,
} from "../src/core/settings.js";

describe("settings", () => {
  let root: string;
  let agentDir: string;
  let projectDir: string;
  let legacyPath: string;
  let globalPath: string;
  let projectPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pi-subagents-settings-"));
    agentDir = join(root, "agent");
    projectDir = join(root, "project");
    legacyPath = join(agentDir, "extensions", "subagents.json");
    globalPath = join(agentDir, "subagents.json");
    projectPath = join(projectDir, ".pi-test", "subagents.json");
    piMocks.getAgentDir.mockReturnValue(agentDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value), "utf8");
  }

  test("returns complete defaults when every file is missing", () => {
    expect(loadSettings(projectDir)).toEqual(DEFAULT_SETTINGS);
  });

  test("merges defaults, legacy global, canonical global, and explicit project layers", () => {
    writeJson(legacyPath, {
      maxConcurrency: 4,
      defaultMaxTurns: 11,
      toolBudget: { hard: 12 },
    });
    writeJson(globalPath, {
      maxConcurrent: 5,
      defaultMaxTurns: 13,
      widgetMode: "all",
    });
    writeJson(projectPath, {
      maxConcurrent: 6,
      fleetView: false,
    });

    expect(loadSettings(projectDir, "project")).toMatchObject({
      maxConcurrent: 6,
      defaultMaxTurns: 13,
      widgetMode: "all",
      fleetView: false,
      toolBudget: { hard: 12 },
    });
  });

  test("defaults to global scope and ignores project settings", () => {
    writeJson(globalPath, { maxConcurrent: 5 });
    writeJson(projectPath, { maxConcurrent: 9 });

    expect(loadSettings(projectDir).maxConcurrent).toBe(5);
    expect(loadSettings(projectDir, "project").maxConcurrent).toBe(9);
  });

  test("uses Pi's CONFIG_DIR_NAME for the project path", () => {
    writeJson(projectPath, { maxConcurrent: 8 });
    writeJson(join(projectDir, ".pi", "subagents.json"), {
      maxConcurrent: 99,
    });

    expect(loadSettings(projectDir, "project").maxConcurrent).toBe(8);
  });

  test("invalid higher-precedence fields preserve valid lower layers", () => {
    writeJson(globalPath, {
      maxConcurrent: 7,
      defaultJoinMode: "group",
    });
    writeJson(projectPath, {
      maxConcurrent: 0,
      defaultJoinMode: "invalid",
    });

    expect(loadSettings(projectDir, "project")).toMatchObject({
      maxConcurrent: 7,
      defaultJoinMode: "group",
    });
  });

  test.each([
    ["maxConcurrent", 1, 1],
    ["maxConcurrent", 1024, 1024],
    ["maxRecursiveLevel", 1, 1],
    ["defaultMaxTurns", 0, 0],
    ["graceTurns", 0, 0],
    ["maxSpawnsPerSession", 0, 0],
    ["maxSpawnsPerSession", 10_000, 10_000],
    ["defaultJoinMode", "async", "async"],
    ["widgetMode", "off", "off"],
    ["fleetView", false, false],
  ] as const)("accepts valid %s value", (key, value, expected) => {
    writeJson(globalPath, { [key]: value });
    expect(loadSettings(projectDir)[key]).toBe(expected);
  });

  test.each([
    ["maxConcurrent", 0],
    ["maxConcurrent", 1025],
    ["maxConcurrent", 1.5],
    ["maxRecursiveLevel", 0],
    ["defaultMaxTurns", -1],
    ["graceTurns", -1],
    ["maxSpawnsPerSession", -1],
    ["maxSpawnsPerSession", 10_001],
    ["defaultJoinMode", "invalid"],
    ["widgetMode", "invalid"],
    ["fleetView", "false"],
  ] as const)("rejects invalid %s value", (key, value) => {
    writeJson(globalPath, { [key]: value });
    expect(loadSettings(projectDir)[key]).toBe(DEFAULT_SETTINGS[key]);
  });

  test.each(["{ bad json", "[]", "null"])(
    "ignores malformed or non-object input: %s",
    (raw) => {
      mkdirSync(dirname(globalPath), { recursive: true });
      writeFileSync(globalPath, raw, "utf8");
      expect(loadSettings(projectDir)).toEqual(DEFAULT_SETTINGS);
    },
  );

  test("keeps specialized settings optional and uses their existing parsers", () => {
    writeJson(globalPath, {
      toolBudget: { soft: 5, hard: 10 },
      modelScope: { enforce: true, allow: ["anthropic/*"] },
      watchdog: { enabled: true },
    });

    expect(loadSettings(projectDir)).toMatchObject({
      toolBudget: { soft: 5, hard: 10 },
      modelScope: { enforce: true, allow: ["anthropic/*"] },
      watchdog: { enabled: true },
    });
  });

  test("omits invalid specialized settings", () => {
    writeJson(globalPath, {
      toolBudget: [],
      modelScope: { enforce: "yes", allow: [] },
      watchdog: "enabled",
    });

    const settings = loadSettings(projectDir);
    expect(settings.toolBudget).toBeUndefined();
    expect(settings.modelScope).toBeUndefined();
    expect(settings.watchdog).toBeUndefined();
  });

  const editableCases: Array<[EditableSettingKey, unknown]> = [
    ["maxConcurrent", 7],
    ["maxRecursiveLevel", 4],
    ["defaultMaxTurns", 12],
    ["graceTurns", 2],
    ["defaultJoinMode", "group"],
    ["maxSpawnsPerSession", 0],
    ["widgetMode", "all"],
    ["fleetView", false],
  ];

  test.each(editableCases)("writes editable key %s", async (key, value) => {
    expect(await saveSetting(projectDir, "global", key, value)).toBe(true);
    expect(JSON.parse(readFileSync(globalPath, "utf8"))).toMatchObject({
      [key]: value,
    });
  });

  test("writes project settings to Pi's project directory", async () => {
    expect(
      await saveSetting(projectDir, "project", "maxConcurrent", 8),
    ).toBe(true);
    expect(JSON.parse(readFileSync(projectPath, "utf8"))).toMatchObject({
      maxConcurrent: 8,
    });
  });

  test("preserves sibling and unknown keys", async () => {
    writeJson(globalPath, {
      maxConcurrent: 3,
      toolBudget: { hard: 9 },
      pluginOwned: { keep: true },
    });

    expect(
      await saveSetting(projectDir, "global", "maxConcurrent", 6),
    ).toBe(true);
    expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({
      maxConcurrent: 6,
      toolBudget: { hard: 9 },
      pluginOwned: { keep: true },
    });
  });

  test("serializes concurrent writes without losing either change", async () => {
    await Promise.all([
      saveSetting(projectDir, "global", "maxConcurrent", 6),
      saveSetting(projectDir, "global", "graceTurns", 2),
    ]);
    expect(JSON.parse(readFileSync(globalPath, "utf8"))).toMatchObject({
      maxConcurrent: 6,
      graceTurns: 2,
    });
  });

  test.each([
    ["maxConcurrent", 0],
    ["toolBudget", { hard: 3 }],
  ] as const)("rejects invalid or unsupported write %s", async (key, value) => {
    writeJson(globalPath, { untouched: true });
    const before = readFileSync(globalPath, "utf8");
    expect(
      await saveSetting(
        projectDir,
        "global",
        key as EditableSettingKey,
        value,
      ),
    ).toBe(false);
    expect(readFileSync(globalPath, "utf8")).toBe(before);
  });

  test.each(["{ bad json", "[]", "null"])(
    "does not overwrite malformed target: %s",
    async (raw) => {
      mkdirSync(dirname(globalPath), { recursive: true });
      writeFileSync(globalPath, raw, "utf8");
      expect(
        await saveSetting(projectDir, "global", "maxConcurrent", 6),
      ).toBe(false);
      expect(readFileSync(globalPath, "utf8")).toBe(raw);
    },
  );

  test("creates a missing target and parent directory", async () => {
    expect(existsSync(globalPath)).toBe(false);
    expect(
      await saveSetting(projectDir, "global", "maxConcurrent", 6),
    ).toBe(true);
    expect(existsSync(globalPath)).toBe(true);
  });

  test("returns false on a filesystem failure", async () => {
    writeFileSync(agentDir, "not a directory", "utf8");
    expect(
      await saveSetting(projectDir, "global", "maxConcurrent", 6),
    ).toBe(false);
  });

  test("global writes leave the legacy file untouched", async () => {
    writeJson(legacyPath, { maxConcurrency: 4, legacyOnly: true });
    const before = readFileSync(legacyPath, "utf8");
    expect(
      await saveSetting(projectDir, "global", "maxConcurrent", 6),
    ).toBe(true);
    expect(readFileSync(legacyPath, "utf8")).toBe(before);
  });
});
