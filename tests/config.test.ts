import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../src/core/config.js";
import { resolvePaths } from "../src/core/paths.js";

describe("loadConfig", () => {
  test("uses defaults when subagents.json is missing", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const paths = resolvePaths(agentDir);

    const result = loadConfig(paths);

    expect(result.exists).toBe(false);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.config.defaultMaxTurns).toBe(0);
    expect(result.config.graceTurns).toBe(5);
  });

  test("merges configured values with defaults", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const configDir = join(agentDir, "extensions");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "subagents.json"),
      JSON.stringify({ maxConcurrency: 7, defaultMaxTurns: 20 }),
    );

    const result = loadConfig(resolvePaths(agentDir));

    expect(result.exists).toBe(true);
    expect(result.config).toEqual({
      maxConcurrency: 7,
      maxRecursiveLevel: DEFAULT_CONFIG.maxRecursiveLevel,
      defaultMaxTurns: 20,
      graceTurns: DEFAULT_CONFIG.graceTurns,
      defaultJoinMode: DEFAULT_CONFIG.defaultJoinMode,
    });
  });

  test("falls back to defaults when subagents.json is malformed", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const configDir = join(agentDir, "extensions");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "subagents.json"), "{ bad json", "utf8");

    const result = loadConfig(resolvePaths(agentDir));

    expect(result.exists).toBe(true);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  test("saveConfig writes only supported config keys", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const paths = resolvePaths(agentDir);

    saveConfig(paths, {
      maxConcurrency: 7,
      maxRecursiveLevel: 5,
      defaultMaxTurns: 15,
      graceTurns: 3,
      defaultJoinMode: "smart",
    });

    expect(JSON.parse(readFileSync(paths.configPath, "utf8"))).toEqual({
      maxConcurrency: 7,
      maxRecursiveLevel: 5,
      defaultMaxTurns: 15,
      graceTurns: 3,
      defaultJoinMode: "smart",
    });
  });
});
