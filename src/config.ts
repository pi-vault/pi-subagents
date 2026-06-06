import { existsSync, readFileSync } from "node:fs";
import type { LoadedConfig, ResolvedPaths, SubagentsConfig } from "./types.js";

export const DEFAULT_CONFIG: SubagentsConfig = {
  maxConcurrency: 3,
  maxRecursiveLevel: 3,
  defaultTimeoutMs: 600_000,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
