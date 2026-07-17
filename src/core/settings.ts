import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
import type { ModelScopeConfig } from "./model-scope.js";
import { parseModelScopeConfig } from "./model-scope.js";
import { resolvePaths } from "./paths.js";
import { parseWatchdogConfig, type WatchdogConfig } from "./watchdog.js";

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
    out.toolBudget = raw.toolBudget as unknown as ToolBudgetConfig;
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
