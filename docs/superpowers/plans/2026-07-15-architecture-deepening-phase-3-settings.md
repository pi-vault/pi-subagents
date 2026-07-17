# Settings Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both settings readers with one trust-aware resolver and make the active session settings snapshot authoritative for every execution path.

**Architecture:** `src/core/settings.ts` owns defaults, layered reads, validation, and queued single-key writes. `RuntimeDeps` owns one mutable session snapshot: it starts global-only, refreshes from the active Pi context on `session_start`, and is consumed by every adapter regardless of a child execution cwd. The Settings menu chooses one trusted scope per visit and refreshes the snapshot only after a successful write.

**Tech Stack:** TypeScript, Node.js filesystem/path APIs, Pi `getAgentDir`/`CONFIG_DIR_NAME`/`withFileMutationQueue`, Vitest, Biome.

---

## File map

- `src/core/settings.ts`: the only settings reader/writer; complete defaults, normalization, precedence, scoped paths, queued single-key writes, and live appliers.
- `tests/settings.test.ts`: resolver, validation, path, preservation, and concurrent-write contract.
- `src/shared/runtime-deps.ts`: persistence seams and mutable active-session snapshot.
- `src/index.ts`: global bootstrap, trusted session refresh, runtime appliers, current Watchdog, and current parent tool budget.
- `src/core/subagent.ts`: subagent, chain, command, model-scope, and invocation defaults from `deps.settings`.
- `src/core/slash-chain.ts`: slash-chain defaults from `deps.settings`.
- `src/core/child-subagent-tool.ts`: child invocation defaults from `deps.settings`.
- `src/core/rpc.ts`: RPC invocation defaults and budget from `deps.settings`.
- `src/tui/agents-menu.ts`: trust-aware scope selection and eight-key async writer.
- `src/shared/types.ts`: remove superseded `SubagentsConfig` and `LoadedConfig` types.
- `tests/_test-helpers.ts`: provide the new runtime seams to all caller tests.
- `tests/index.test.ts`: session trust, runtime activation, tool-budget, Watchdog, and menu-flow coverage.
- `tests/agents-menu.test.ts`: menu metadata and primitive parsing against `SubagentsSettings`.
- `tests/subagent.test.ts`: prove execution cwd does not select settings.
- Delete `src/core/config.ts` and `tests/config.test.ts` after all callers and still-relevant tests migrate.

## Commit sequence

1. `refactor: unify settings resolution`
2. `refactor: migrate settings callers`

### Task 1: Make `settings.ts` the complete persistence boundary

**Files:**
- Modify: `src/core/settings.ts`
- Modify: `tests/settings.test.ts`

- [ ] **Step 1: Replace the persistence test setup with isolated Pi paths**

At the top of `tests/settings.test.ts`, mock only Pi's paths while retaining the real mutation queue:

```ts
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
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
  applySettings,
  loadSettings,
  saveSetting,
  type EditableSettingKey,
  type SettingsAppliers,
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
```

Remove the old persistence tests after moving their specialized-parser and applier coverage into Steps 2 and 7. They use the old `.pi` setup and must not remain beside the mocked `.pi-test` paths.

- [ ] **Step 2: Add failing read/precedence tests**

Add these tests inside the `describe` block:

```ts
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
```

- [ ] **Step 3: Add failing single-key writer tests**

```ts
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
  mkdirSync(dirname(agentDir), { recursive: true });
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
```

- [ ] **Step 4: Run the resolver tests and confirm they fail**

Run:

```bash
pnpm vitest run tests/settings.test.ts
```

Expected: FAIL because `DEFAULT_SETTINGS`, scoped `loadSettings`, and `saveSetting` do not exist yet and the old reader has no legacy layer.

- [ ] **Step 5: Replace the settings contract and normalization**

In `src/core/settings.ts`, retain the existing specialized parser imports and replace the interfaces/constants/sanitizer with:

```ts
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import type {
  JoinMode,
  ToolBudgetConfig,
  WidgetMode,
} from "../shared/types.js";
import { resolvePaths } from "./paths.js";

export type SettingsScope = "project" | "global";

export type EditableSettingKey =
  | "maxConcurrent"
  | "maxRecursiveLevel"
  | "defaultMaxTurns"
  | "graceTurns"
  | "defaultJoinMode"
  | "maxSpawnsPerSession"
  | "widgetMode"
  | "fleetView";

export interface SubagentsSettings {
  maxConcurrent: number;
  maxRecursiveLevel: number;
  defaultMaxTurns: number;
  graceTurns: number;
  defaultJoinMode: JoinMode;
  maxSpawnsPerSession: number;
  widgetMode: WidgetMode;
  fleetView: boolean;
  toolBudget?: ToolBudgetConfig;
  modelScope?: ModelScopeConfig;
  watchdog?: WatchdogConfig;
}

export interface SettingsAppliers {
  setMaxConcurrent: (n: number) => void;
  setMaxDepth?: (n: number) => void;
  setDefaultJoinMode: (mode: JoinMode) => void;
  setWidgetMode?: (mode: WidgetMode) => void;
  setFleetView?: (enabled: boolean) => void;
  setMaxSpawnsPerSession?: (n: number) => void;
}

export const DEFAULT_SETTINGS: SubagentsSettings = {
  maxConcurrent: 3,
  maxRecursiveLevel: 3,
  defaultMaxTurns: 0,
  graceTurns: 5,
  defaultJoinMode: "smart",
  maxSpawnsPerSession: 40,
  widgetMode: "background",
  fleetView: true,
};

const EDITABLE_KEYS: readonly EditableSettingKey[] = [
  "maxConcurrent",
  "maxRecursiveLevel",
  "defaultMaxTurns",
  "graceTurns",
  "defaultJoinMode",
  "maxSpawnsPerSession",
  "widgetMode",
  "fleetView",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function sanitize(raw: unknown): Partial<SubagentsSettings> {
  if (!isRecord(raw)) return {};
  const out: Partial<SubagentsSettings> = {};

  const maxConcurrent = isIntegerInRange(raw.maxConcurrent, 1, 1024)
    ? raw.maxConcurrent
    : raw.maxConcurrency;
  if (isIntegerInRange(maxConcurrent, 1, 1024)) {
    out.maxConcurrent = maxConcurrent;
  }
  if (isIntegerInRange(raw.maxRecursiveLevel, 1)) {
    out.maxRecursiveLevel = raw.maxRecursiveLevel;
  }
  if (isIntegerInRange(raw.defaultMaxTurns, 0)) {
    out.defaultMaxTurns = raw.defaultMaxTurns;
  }
  if (isIntegerInRange(raw.graceTurns, 0)) {
    out.graceTurns = raw.graceTurns;
  }
  if (
    raw.defaultJoinMode === "async" ||
    raw.defaultJoinMode === "group" ||
    raw.defaultJoinMode === "smart"
  ) {
    out.defaultJoinMode = raw.defaultJoinMode;
  }
  if (isIntegerInRange(raw.maxSpawnsPerSession, 0, 10_000)) {
    out.maxSpawnsPerSession = raw.maxSpawnsPerSession;
  }
  if (
    raw.widgetMode === "all" ||
    raw.widgetMode === "background" ||
    raw.widgetMode === "off"
  ) {
    out.widgetMode = raw.widgetMode;
  }
  if (typeof raw.fleetView === "boolean") {
    out.fleetView = raw.fleetView;
  }
  if (isRecord(raw.toolBudget)) {
    out.toolBudget = raw.toolBudget as ToolBudgetConfig;
  }
  if (raw.modelScope !== undefined) {
    const modelScope = parseModelScopeConfig(raw.modelScope);
    if (modelScope) out.modelScope = modelScope;
  }
  if (isRecord(raw.watchdog)) {
    out.watchdog = parseWatchdogConfig(raw.watchdog);
  }

  return out;
}
```

- [ ] **Step 6: Implement layered reads and queued writes**

Replace the old path/read/load/save functions in `src/core/settings.ts` with:

```ts
function globalPath(): string {
  return resolve(getAgentDir(), "subagents.json");
}

function projectPath(cwd: string): string {
  return resolve(cwd, CONFIG_DIR_NAME, "subagents.json");
}

function readObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readLayer(path: string): Partial<SubagentsSettings> {
  return sanitize(readObject(path));
}

export function loadSettings(
  cwd: string = process.cwd(),
  scope: SettingsScope = "global",
): SubagentsSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...readLayer(resolvePaths().configPath),
    ...readLayer(globalPath()),
    ...(scope === "project" ? readLayer(projectPath(cwd)) : {}),
  };
}

export async function saveSetting(
  cwd: string,
  scope: SettingsScope,
  key: EditableSettingKey,
  value: unknown,
): Promise<boolean> {
  if (!EDITABLE_KEYS.includes(key)) return false;
  const normalized = sanitize({ [key]: value });
  if (!Object.hasOwn(normalized, key)) return false;

  const path = scope === "project" ? projectPath(cwd) : globalPath();
  try {
    return await withFileMutationQueue(path, async () => {
      const current = readObject(path);
      if (!current) return false;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        `${JSON.stringify({ ...current, [key]: normalized[key] }, null, 2)}\n`,
        "utf8",
      );
      return true;
    });
  } catch {
    return false;
  }
}
```

Use `resolve` from `node:path`; keep `dirname` and remove unused `join`/`saveSettings` imports and code.

- [ ] **Step 7: Make live application complete, including recursion**

Replace `applySettings` with:

```ts
export function applySettings(
  settings: SubagentsSettings,
  appliers: SettingsAppliers,
): void {
  appliers.setMaxConcurrent(settings.maxConcurrent);
  appliers.setMaxDepth?.(settings.maxRecursiveLevel);
  appliers.setDefaultJoinMode(settings.defaultJoinMode);
  appliers.setWidgetMode?.(settings.widgetMode);
  appliers.setFleetView?.(settings.fleetView);
  appliers.setMaxSpawnsPerSession?.(settings.maxSpawnsPerSession);
}
```

Use this single complete applier regression test:

```ts
test("applySettings applies every primitive runtime field", () => {
  const appliers: SettingsAppliers = {
    setMaxConcurrent: vi.fn(),
    setMaxDepth: vi.fn(),
    setDefaultJoinMode: vi.fn(),
    setWidgetMode: vi.fn(),
    setFleetView: vi.fn(),
    setMaxSpawnsPerSession: vi.fn(),
  };
  applySettings(
    {
      ...DEFAULT_SETTINGS,
      maxConcurrent: 7,
      maxRecursiveLevel: 6,
      defaultJoinMode: "group",
      maxSpawnsPerSession: 0,
      widgetMode: "off",
      fleetView: false,
    },
    appliers,
  );

  expect(appliers.setMaxConcurrent).toHaveBeenCalledWith(7);
  expect(appliers.setMaxDepth).toHaveBeenCalledWith(6);
  expect(appliers.setDefaultJoinMode).toHaveBeenCalledWith("group");
  expect(appliers.setMaxSpawnsPerSession).toHaveBeenCalledWith(0);
  expect(appliers.setWidgetMode).toHaveBeenCalledWith("off");
  expect(appliers.setFleetView).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 8: Run focused checks**

Run:

```bash
pnpm vitest run tests/settings.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/settings.ts tests/settings.test.ts
```

Expected: the settings suite passes, TypeScript exits 0, and Biome reports no errors in the two touched files.

- [ ] **Step 9: Commit the persistence boundary**

```bash
git add src/core/settings.ts tests/settings.test.ts
git diff --cached --check
git commit -m "refactor: unify settings resolution"
```

Expected: one commit containing only the resolver and its tests.

### Task 2: Make the active session snapshot authoritative

**Files:**
- Delete: `src/core/config.ts`
- Delete: `tests/config.test.ts`
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/index.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/child-subagent-tool.ts`
- Modify: `src/core/rpc.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `tests/_test-helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/agents-menu.test.ts`
- Modify: `tests/subagent.test.ts`

- [ ] **Step 1: Change the shared runtime test factory first**

In `tests/_test-helpers.ts`, import `DEFAULT_SETTINGS` and replace the old config seams with:

```ts
settings: { ...DEFAULT_SETTINGS },
loadSettings: () => ({ ...DEFAULT_SETTINGS }),
saveSetting: async () => true,
refreshSettings: () => {},
```

Apply the same replacement in `createMenuDeps` in `tests/index.test.ts`. This deliberately makes TypeScript fail until `RuntimeDeps` changes.

- [ ] **Step 2: Add failing session refresh and runtime-applier tests**

In `tests/index.test.ts`, add:

```ts
test.each([
  [true, "project"],
  [false, "global"],
] as const)(
  "session_start refreshes %s trust with %s scope",
  (trusted, expectedScope) => {
    const { pi, handlers } = createPiWithEventCapture();
    const refreshSettings = vi.fn();
    registerSubagentsExtension(
      pi,
      createMenuDeps({ refreshSettings }),
    );

    handlers.get("session_start")?.(
      {},
      { cwd: "/active-project", isProjectTrusted: () => trusted },
    );

    expect(refreshSettings).toHaveBeenCalledWith(
      "/active-project",
      expectedScope === "project",
    );
  },
);

test("refresh applies recursion, concurrency, spawn, widget, and fleet settings", () => {
  const { pi } = createPiWithEventCapture();
  const deps = createRuntimeDeps(pi);
  const setMaxDepth = vi.spyOn(deps.manager, "setMaxDepth");
  const setMaxConcurrent = vi.spyOn(deps.manager, "setMaxConcurrent");
  const setMaxSpawns = vi.spyOn(deps.manager, "setMaxSpawnsPerSession");
  const setWidgetMode = vi.fn();
  const setFleetView = vi.fn();
  deps.setWidgetMode = setWidgetMode;
  deps.setFleetView = setFleetView;
  deps.loadSettings = vi.fn(() => ({
    ...DEFAULT_SETTINGS,
    maxRecursiveLevel: 6,
    maxConcurrent: 7,
    maxSpawnsPerSession: 0,
    widgetMode: "off",
    fleetView: false,
  }));

  deps.refreshSettings("/active-project", true);

  expect(deps.loadSettings).toHaveBeenCalledWith(
    "/active-project",
    "project",
  );
  expect(setMaxDepth).toHaveBeenCalledWith(6);
  expect(setMaxConcurrent).toHaveBeenCalledWith(7);
  expect(setMaxSpawns).toHaveBeenCalledWith(0);
  expect(setWidgetMode).toHaveBeenCalledWith("off");
  expect(setFleetView).toHaveBeenCalledWith(false);
  expect(deps.settings.maxRecursiveLevel).toBe(6);
  deps.manager.dispose();
});

test("refresh requests only global settings for an untrusted project", () => {
  const { pi } = createPiWithEventCapture();
  const deps = createRuntimeDeps(pi);
  deps.loadSettings = vi.fn(() => ({ ...DEFAULT_SETTINGS }));

  deps.refreshSettings("/untrusted-project", false);

  expect(deps.loadSettings).toHaveBeenCalledWith(
    "/untrusted-project",
    "global",
  );
  deps.manager.dispose();
});

test("refresh replaces Watchdog only when its resolved config changes", () => {
  const { pi } = createPiWithEventCapture();
  const deps = createRuntimeDeps(pi);
  const initial = deps.watchdog;
  deps.loadSettings = vi.fn(() => ({
    ...DEFAULT_SETTINGS,
    watchdog: parseWatchdogConfig({ enabled: true }),
  }));

  deps.refreshSettings("/active-project", true);

  expect(initial?.status()).toBe("disabled");
  expect(deps.watchdog).not.toBe(initial);
  expect(deps.watchdog?.status()).toBe("idle");
  deps.manager.dispose();
});
```

Import `DEFAULT_SETTINGS` and `parseWatchdogConfig`. The table's `expectedScope` makes the trust expectation readable; `refreshSettings` itself still receives the required boolean.

- [ ] **Step 3: Replace conditional parent-budget tests with live-budget tests**

In `tests/index.test.ts`, replace the two old `tool_call` registration tests with:

```ts
test("always registers tool_call and reads the current settings budget", () => {
  const { pi, registeredEvents, handlers } = createPiWithEventCapture();
  const deps = createRuntimeDeps(pi);
  deps.settings = { ...DEFAULT_SETTINGS };
  deps.loadSettings = vi.fn((_cwd, scope) => ({
    ...DEFAULT_SETTINGS,
    ...(scope === "project"
      ? { toolBudget: { hard: 1, block: "*" as const } }
      : {}),
  }));
  registerSubagentsExtension(pi, deps);
  expect(registeredEvents).toContain("tool_call");

  const handler = handlers.get("tool_call");
  expect(handler?.({ toolName: "read" })).toBeUndefined();
  handlers.get("session_start")?.(
    {},
    { cwd: "/active-project", isProjectTrusted: () => true },
  );
  expect(handler?.({ toolName: "read" })).toBeUndefined();
  expect(handler?.({ toolName: "read" })).toMatchObject({ block: true });
  expect(deps.loadSettings).toHaveBeenCalledWith(
    "/active-project",
    "project",
  );
  deps.manager.dispose();
});
```

This is the regression check for a trusted project budget becoming active after global bootstrap.

- [ ] **Step 4: Add failing settings-menu trust and write-flow tests**

Replace the old bulk-write menu test in `tests/index.test.ts` with:

```ts
test("trusted settings visit selects Project once for multiple edits", async () => {
  const selections = [
    "Project",
    "Max Concurrency",
    "Max Recursive Level",
    "Back",
  ];
  const inputs = ["7", "5"];
  const saveSetting = vi.fn(async () => true);
  const refreshSettings = vi.fn();

  await runAgentsMenuSettingsFlow(
    {
      cwd: "/active-project",
      isProjectTrusted: () => true,
      ui: {
        select(_title: string, options: string[]) {
          const prefix = selections.shift();
          return Promise.resolve(
            options.find((option) => option.startsWith(prefix ?? "")),
          );
        },
        input: () => Promise.resolve(inputs.shift()),
        notify() {},
      },
    } as unknown as ExtensionCommandContext,
    createMenuDeps({ saveSetting, refreshSettings }),
  );

  expect(saveSetting.mock.calls).toEqual([
    ["/active-project", "project", "maxConcurrent", 7],
    ["/active-project", "project", "maxRecursiveLevel", 5],
  ]);
  expect(refreshSettings).toHaveBeenCalledTimes(2);
});

test("Global edit refreshes and retains the trusted Project override", async () => {
  const { pi } = createPiWithEventCapture();
  const deps = createRuntimeDeps(pi);
  const selections = ["Global", "Max Concurrency", "Back"];
  deps.loadSettings = vi.fn((_cwd, scope) => ({
    ...DEFAULT_SETTINGS,
    maxConcurrent: scope === "project" ? 9 : 7,
  }));
  deps.saveSetting = vi.fn(async () => true);

  await runAgentsMenuSettingsFlow(
    {
      cwd: "/active-project",
      isProjectTrusted: () => true,
      ui: {
        select(_title: string, options: string[]) {
          const prefix = selections.shift();
          return Promise.resolve(
            options.find((option) => option.startsWith(prefix ?? "")),
          );
        },
        input: () => Promise.resolve("7"),
        notify() {},
      },
    } as unknown as ExtensionCommandContext,
    deps,
  );

  expect(deps.saveSetting).toHaveBeenCalledWith(
    "/active-project",
    "global",
    "maxConcurrent",
    7,
  );
  expect(deps.settings.maxConcurrent).toBe(9);
  expect(deps.loadSettings).toHaveBeenCalledWith(
    "/active-project",
    "project",
  );
  deps.manager.dispose();
});

test("untrusted settings visit omits Project and writes Global", async () => {
  const seenOptions: string[][] = [];
  const selections = ["Global", "Max Concurrency", "Back"];
  const saveSetting = vi.fn(async () => true);

  await runAgentsMenuSettingsFlow(
    {
      cwd: "/active-project",
      isProjectTrusted: () => false,
      ui: {
        select(_title: string, options: string[]) {
          seenOptions.push(options);
          const prefix = selections.shift();
          return Promise.resolve(
            options.find((option) => option.startsWith(prefix ?? "")),
          );
        },
        input: () => Promise.resolve("7"),
        notify() {},
      },
    } as unknown as ExtensionCommandContext,
    createMenuDeps({ saveSetting }),
  );

  expect(seenOptions[0]).toEqual(["Global", "Back"]);
  expect(saveSetting).toHaveBeenCalledWith(
    "/active-project",
    "global",
    "maxConcurrent",
    7,
  );
});

test("failed settings write reports once and does not refresh", async () => {
  const selections = ["Global", "Max Concurrency", "Back"];
  const refreshSettings = vi.fn();
  const notifications: Array<[string, string]> = [];

  await runAgentsMenuSettingsFlow(
    {
      cwd: "/active-project",
      isProjectTrusted: () => true,
      ui: {
        select(_title: string, options: string[]) {
          const prefix = selections.shift();
          return Promise.resolve(
            options.find((option) => option.startsWith(prefix ?? "")),
          );
        },
        input: () => Promise.resolve("7"),
        notify(message: string, level: string) {
          notifications.push([message, level]);
        },
      },
    } as unknown as ExtensionCommandContext,
    createMenuDeps({
      saveSetting: async () => false,
      refreshSettings,
    }),
  );

  expect(refreshSettings).not.toHaveBeenCalled();
  expect(notifications).toEqual([
    ["Settings not saved: could not write subagents settings.", "error"],
  ]);
});
```

Keep the existing invalid-input notification assertion unchanged.

For that invalid-input test and the existing select-fallback rendering test, add `cwd: "/active-project"` and `isProjectTrusted: () => false` to the context, and prepend `"Global"` to each `selections` array. Their remaining assertions and notification strings stay unchanged.

- [ ] **Step 5: Add the execution-cwd regression test**

In `tests/subagent.test.ts`, add a test beside the successful execute case:

```ts
test("uses the active settings snapshot when params.cwd differs", async () => {
  const { pi, registeredTool } = createPi();
  const manager = new AgentManager();
  const spawnAndWait = vi.spyOn(manager, "spawnAndWait").mockResolvedValue({
    id: "run-settings",
    record: completedRecord("done"),
  });
  registerSubagentTool(
    pi,
    createDeps({
      manager,
      settings: {
        ...DEFAULT_SETTINGS,
        defaultMaxTurns: 17,
        graceTurns: 2,
      },
    }),
  );

  await registeredTool().execute(
    "tool-call-settings",
    { agent: "Scout", task: "explore", cwd: "/tmp" },
    undefined,
    undefined,
    { cwd: "/repo" } as ExtensionContext,
  );

  expect(spawnAndWait).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      cwd: "/tmp",
      maxTurns: 17,
      graceTurns: 2,
    }),
  );
});
```

Import `DEFAULT_SETTINGS`. The different `cwd` proves execution location remains separate from settings selection.

- [ ] **Step 6: Run the new tests and confirm they fail**

Run:

```bash
pnpm vitest run tests/index.test.ts tests/subagent.test.ts
pnpm tsc --noEmit
```

Expected: FAIL because `RuntimeDeps` still exposes `loadConfig`/`saveConfig`, no `session_start` refresh exists, and the menu still bulk-writes legacy config.

- [ ] **Step 7: Replace the RuntimeDeps config seams**

In `src/shared/runtime-deps.ts`, import the settings types from `../core/settings.js`, remove `LoadedConfig` and `SubagentsConfig`, then replace `loadConfig`/`saveConfig` with:

```ts
settings: SubagentsSettings;
loadSettings: (
  cwd?: string,
  scope?: SettingsScope,
) => SubagentsSettings;
saveSetting: (
  cwd: string,
  scope: SettingsScope,
  key: EditableSettingKey,
  value: unknown,
) => Promise<boolean>;
refreshSettings: (cwd: string, projectTrusted: boolean) => void;
```

Keep `defaultJoinMode`, `widgetMode`, `fleetView`, and their setters because existing widgets and the batch tracker already consume them.

- [ ] **Step 8: Bootstrap global settings and make Watchdog replaceable**

In `src/index.ts`:

1. Remove the `config.ts` import.
2. Import `saveSetting` with `applySettings` and `loadSettings`.
3. Change the bootstrap read to `const settings = loadSettings();` so it cannot read project settings.
4. Store the Watchdog options once and track the normalized config key:

```ts
const watchdogOptions = {
  onWarnings: (agentId: string, warnings: WatchdogWarning[], source: "parent" | "child") => {
    for (const warning of warnings) {
      const childLabel = source === "child" ? "/child" : "";
      const content =
        `[watchdog${childLabel}/${warning.severity}] ${warning.summary}\n` +
        `Evidence: ${warning.evidence}\n` +
        `Action: ${warning.recommendedAction}`;
      (pi as unknown as {
        sendMessage: (message: unknown, options?: unknown) => void;
      }).sendMessage(
        {
          customType: "watchdog-warning",
          content,
          display: true,
          details: {
            agentId,
            ...warning,
            state: "displayed",
            ...(source === "child" ? { source } : {}),
          },
        } as unknown as Parameters<typeof pi.sendMessage>[0],
        { deliverAs: "followUp", triggerTurn: true },
      );
    }
  },
  getSessionMessages: (agentId: string) => sessionMessageSource?.(agentId),
  resumeAgent: async (agentId: string, message: string) => {
    await resumeAgentFn?.(agentId, message);
  },
};
let watchdogConfig = parseWatchdogConfig(settings.watchdog);
let watchdogConfigKey = JSON.stringify(watchdogConfig);
const watchdog = createWatchdogRuntime(watchdogConfig, watchdogOptions);
```

Import `WatchdogWarning` as a type. Move only the existing `onWarnings` body into the shown callback; do not change its messages.

Change the manager completion callback to consult the mutable runtime:

```ts
const currentWatchdog = deps.watchdog;
if (
  currentWatchdog &&
  currentWatchdog.status() !== "disabled" &&
  record.status === "completed"
) {
  currentWatchdog.handleAgentEnd({
    id: record.id,
    type: record.type,
    cwd: record.cwd ?? process.cwd(),
  }).catch((error) => {
    console.error("[watchdog] handleAgentEnd failed:", error);
  });
}
```

Delete the separate startup `loadConfig(resolvePaths())` spawn-limit read.

- [ ] **Step 9: Add the active snapshot and refresh implementation**

In the `deps` object in `createRuntimeDeps`, replace the old config properties with:

```ts
settings,
loadSettings,
saveSetting,
defaultJoinMode: settings.defaultJoinMode,
widgetMode: settings.widgetMode,
fleetView: settings.fleetView,
refreshSettings(cwd, projectTrusted) {
  applyResolvedSettings(
    deps.loadSettings(cwd, projectTrusted ? "project" : "global"),
  );
},
```

Initialize `defaultJoinMode`, `widgetMode`, and `fleetView` from `settings`. Immediately after the object, replace the one-time `applySettings` call with:

```ts
function applyResolvedSettings(next: SubagentsSettings): void {
  deps.settings = next;
  applySettings(next, {
    setMaxConcurrent: (value) => deps.manager.setMaxConcurrent(value),
    setMaxDepth: (value) => deps.manager.setMaxDepth(value),
    setDefaultJoinMode: (value) => {
      deps.defaultJoinMode = value;
    },
    setWidgetMode: (value) => {
      deps.widgetMode = value;
      deps.setWidgetMode?.(value);
    },
    setFleetView: (value) => {
      deps.fleetView = value;
      deps.setFleetView?.(value);
    },
    setMaxSpawnsPerSession: (value) => {
      deps.manager.setMaxSpawnsPerSession(value);
    },
  });

  const nextWatchdogConfig = parseWatchdogConfig(next.watchdog);
  const nextWatchdogKey = JSON.stringify(nextWatchdogConfig);
  if (nextWatchdogKey !== watchdogConfigKey) {
    const previous = deps.watchdog;
    deps.watchdog = createWatchdogRuntime(
      nextWatchdogConfig,
      watchdogOptions,
    );
    watchdogConfig = nextWatchdogConfig;
    watchdogConfigKey = nextWatchdogKey;
    previous?.dispose();
  }
}

applyResolvedSettings(settings);
```

Import `SubagentsSettings` as a type. Keep `watchdogConfig` assigned so TypeScript and future debugger inspection both reflect the current normalized config.

- [ ] **Step 10: Refresh from Pi trust on every session start**

At the start of `registerSubagentsExtension`, register:

```ts
pi.on("session_start", (_event, ctx) => {
  deps.refreshSettings(ctx.cwd, ctx.isProjectTrusted());
});
```

This is the only place that decides whether the project layer may be read.

- [ ] **Step 11: Make parent tool-budget interception always live**

Replace the conditional parent-budget registration in `src/index.ts` with:

```ts
let parentToolCount = 0;
let parentSoftNudged = false;

pi.on("tool_call", (event: ToolCallEvent): ToolCallEventResult | undefined => {
  const { budget } = validateToolBudget(deps.settings.toolBudget);
  if (!budget) return undefined;

  parentToolCount++;
  const result = evaluateToolCall(budget, parentToolCount, event.toolName);
  if (result.outcome === "hard-blocked") {
    return {
      block: true,
      reason: result.message ?? "Tool budget hard limit reached.",
    };
  }
  if (result.outcome === "soft-reached" && !parentSoftNudged) {
    parentSoftNudged = true;
    try {
      pi.sendUserMessage?.(
        result.message ?? "Tool budget soft limit reached.",
        { deliverAs: "steer" },
      );
    } catch {
      // Advisory; a failed nudge must not fail the tool call.
    }
  }
  return undefined;
});
```

Reset both counters unconditionally in `session_before_switch`; remove the stale captured `parentBudget` variable.

- [ ] **Step 12: Migrate every execution adapter to `deps.settings`**

Make these mechanical replacements without adding new reads:

```ts
// src/core/subagent.ts
const settings = deps.settings;
// loadedConfig.config.defaultMaxTurns -> settings.defaultMaxTurns
// loadedConfig.config.graceTurns -> settings.graceTurns
// loadedConfig.config.toolBudget -> settings.toolBudget
// loadSettings(effectiveCwd).modelScope -> settings.modelScope

// src/core/slash-chain.ts
const settings = deps.settings;
// loadedConfig.config.defaultMaxTurns -> settings.defaultMaxTurns

// src/core/child-subagent-tool.ts
const settings = deps.settings;
// resolveInvocationConfig(..., loadedConfig.config) -> resolveInvocationConfig(..., settings)
// loadedConfig.config.graceTurns -> settings.graceTurns

// src/core/rpc.ts
const settings = deps.settings;
// loadedConfig.config.defaultMaxTurns -> settings.defaultMaxTurns
// loadedConfig.config.toolBudget -> settings.toolBudget
// loadedConfig.config.graceTurns -> settings.graceTurns
```

Remove the direct `loadSettings` import from `subagent.ts`. Do not pass `effectiveCwd`, `stepCwd`, `parentCwd`, or `process.cwd()` to the resolver from any adapter.

- [ ] **Step 13: Replace menu-local settings types and direct appliers**

In `src/tui/agents-menu.ts`:

1. Import `EditableSettingKey`, `SettingsScope`, and `SubagentsSettings` from `../core/settings.js`.
2. Delete the local `SettingsKey` union and use `EditableSettingKey`.
3. Change the first key from `maxConcurrency` to `maxConcurrent` without changing its label or prompt.
4. Change every `formatValue` to read `SubagentsSettings` directly.
5. Delete `SettingsMenuItem.apply` and all per-item `apply` functions.
6. Enforce the resolver ceilings in the two numeric parsers:

```ts
// maxConcurrent
return Number.isInteger(value) && value >= 1 && value <= 1024
  ? value
  : undefined;

// maxSpawnsPerSession
return Number.isInteger(value) && value >= 0 && value <= 10_000
  ? value
  : undefined;
```

Use the snapshot fields for widget/fleet formatting:

```ts
formatValue: (settings) => settings.widgetMode,
formatValue: (settings) => String(settings.fleetView),
```

- [ ] **Step 14: Implement one trust-aware scope selection per menu visit**

Add above `runAgentsMenuSettingsFlow`:

```ts
async function selectSettingsScope(
  ctx: ExtensionCommandContext,
  projectTrusted: boolean,
): Promise<SettingsScope | undefined> {
  return showRowsMenu(
    ctx,
    "Settings scope",
    [
      ...(projectTrusted
        ? [{ label: "Project", value: "project" as const }]
        : []),
      { label: "Global", value: "global" as const },
      { label: "Back", value: undefined, kind: "back" as const },
    ],
    projectTrusted
      ? "Choose where settings are stored"
      : "Project settings require a trusted project",
  );
}
```

Replace `runAgentsMenuSettingsFlow` with:

```ts
export async function runAgentsMenuSettingsFlow(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  const projectTrusted = ctx.isProjectTrusted();
  const scope = await selectSettingsScope(ctx, projectTrusted);
  if (!scope) return;

  while (true) {
    const settings = deps.loadSettings(ctx.cwd, scope);
    const selected = await showRowsMenu(
      ctx,
      "Settings",
      buildSettingsRows(settings),
      "Select a setting to edit",
    );
    if (!selected || selected === "back") return;

    const item = SETTINGS_MENU_ITEMS.find(
      (entry) => entry.key === selected,
    );
    if (!item) return;

    const raw = await ctx.ui.input(
      item.promptTitle,
      item.formatValue(settings),
    );
    if (raw === undefined) continue;

    const parsed = item.parse(raw);
    if (parsed === undefined) {
      ctx.ui.notify(
        "Settings not saved: all values must be positive numbers.",
        "error",
      );
      continue;
    }

    const saved = await deps.saveSetting(ctx.cwd, scope, item.key, parsed);
    if (!saved) {
      ctx.ui.notify(
        "Settings not saved: could not write subagents settings.",
        "error",
      );
      continue;
    }

    deps.refreshSettings(ctx.cwd, ctx.isProjectTrusted());
    ctx.ui.notify("Updated subagents settings", "info");
  }
}
```

Change `buildSettingsRows` to accept only `SubagentsSettings` and call `item.formatValue(settings)`.

- [ ] **Step 15: Remove obsolete types, module, tests, and menu assertions**

Delete `SubagentsConfig` and `LoadedConfig` from `src/shared/types.ts`.

Delete the files:

```bash
git rm src/core/config.ts tests/config.test.ts
```

In `tests/agents-menu.test.ts`, replace `SubagentsConfig` with `SubagentsSettings`, construct values with `{ ...DEFAULT_SETTINGS, field: value }`, and remove assertions for deleted `item.apply` functions. In `tests/index.test.ts`, remove `SubagentsConfig` imports and bulk-config write arrays.

Make the widget/fleet formatting assertions use the settings value directly:

```ts
expect(
  widgetItem?.formatValue({ ...DEFAULT_SETTINGS, widgetMode: "all" }),
).toBe("all");
expect(widgetItem?.formatValue(DEFAULT_SETTINGS)).toBe("background");
expect(
  fleetItem?.formatValue({ ...DEFAULT_SETTINGS, fleetView: false }),
).toBe("false");
expect(fleetItem?.formatValue(DEFAULT_SETTINGS)).toBe("true");
```

- [ ] **Step 16: Run all focused migration suites**

Run:

```bash
pnpm vitest run \
  tests/settings.test.ts \
  tests/index.test.ts \
  tests/agents-menu.test.ts \
  tests/subagent.test.ts \
  tests/subagent-chain.test.ts \
  tests/child-subagent-tool.test.ts \
  tests/rpc.test.ts \
  tests/slash-chain.test.ts
```

Expected: all listed suites pass, including trusted/untrusted refresh, live parent budget, Watchdog replacement, menu scope reuse, write failure, and execution-cwd isolation.

- [ ] **Step 17: Prove the duplicate API is gone**

Run:

```bash
rg -n "config\.ts|loadConfig|saveConfig|saveSettings|SubagentsConfig|LoadedConfig" src tests
```

Expected: no output and exit code 1.

Then run:

```bash
pnpm tsc --noEmit
pnpm biome lint \
  src/core/settings.ts \
  src/shared/runtime-deps.ts \
  src/shared/types.ts \
  src/index.ts \
  src/core/subagent.ts \
  src/core/slash-chain.ts \
  src/core/child-subagent-tool.ts \
  src/core/rpc.ts \
  src/tui/agents-menu.ts \
  tests/settings.test.ts \
  tests/_test-helpers.ts \
  tests/index.test.ts \
  tests/agents-menu.test.ts \
  tests/subagent.test.ts
```

Expected: TypeScript exits 0 and Biome reports no errors. The six pre-existing `noNonNullAssertion` warnings in `src/core/slash-chain.ts` may remain; this phase must add no warnings.

- [ ] **Step 18: Commit the caller migration**

```bash
git add \
  src/shared/runtime-deps.ts \
  src/shared/types.ts \
  src/index.ts \
  src/core/subagent.ts \
  src/core/slash-chain.ts \
  src/core/child-subagent-tool.ts \
  src/core/rpc.ts \
  src/tui/agents-menu.ts \
  tests/_test-helpers.ts \
  tests/index.test.ts \
  tests/agents-menu.test.ts \
  tests/subagent.test.ts
git diff --cached --check
git commit -m "refactor: migrate settings callers"
```

Expected: the second commit contains the runtime/menu/caller migration and removal of the duplicate config module.

### Task 3: Final repository verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the complete repository check**

```bash
pnpm check
```

Expected: Biome, TypeScript, and every Vitest suite pass.

- [ ] **Step 2: Inspect the final history and worktree**

```bash
git log -2 --oneline
git status --short
```

Expected: the two planned refactor commits are the newest implementation commits and `git status --short` prints nothing.
