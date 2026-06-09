import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  LoadedConfig,
  ResolvedPaths,
  SubagentsConfig,
} from "../shared/types.js";

export const DEFAULT_CONFIG: SubagentsConfig = {
  maxConcurrency: 3,
  maxRecursiveLevel: 3,
  defaultTimeoutMs: 600_000,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function saveConfig(
  paths: ResolvedPaths,
  config: SubagentsConfig,
): void {
  mkdirSync(dirname(paths.configPath), { recursive: true });
  writeFileSync(
    paths.configPath,
    `${JSON.stringify(
      {
        maxConcurrency: config.maxConcurrency,
        maxRecursiveLevel: config.maxRecursiveLevel,
        defaultTimeoutMs: config.defaultTimeoutMs,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function loadConfig(paths: ResolvedPaths): LoadedConfig {
  if (!existsSync(paths.configPath)) {
    return {
      config: { ...DEFAULT_CONFIG },
      exists: false,
    };
  }

  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(
      readFileSync(paths.configPath, "utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        config: { ...DEFAULT_CONFIG },
        exists: true,
      };
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return {
      config: { ...DEFAULT_CONFIG },
      exists: true,
    };
  }

  return {
    config: {
      maxConcurrency: isFiniteNumber(raw.maxConcurrency)
        ? raw.maxConcurrency
        : DEFAULT_CONFIG.maxConcurrency,
      maxRecursiveLevel: isFiniteNumber(raw.maxRecursiveLevel)
        ? raw.maxRecursiveLevel
        : DEFAULT_CONFIG.maxRecursiveLevel,
      defaultTimeoutMs: isFiniteNumber(raw.defaultTimeoutMs)
        ? raw.defaultTimeoutMs
        : DEFAULT_CONFIG.defaultTimeoutMs,
    },
    exists: true,
  };
}
