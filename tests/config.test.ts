import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { resolvePaths } from "../src/paths.js";

describe("loadConfig", () => {
  test("uses defaults when subagents.json is missing, including maxRecursiveLevel=3", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const paths = resolvePaths(agentDir);

    const result = loadConfig(paths);

    expect(result.exists).toBe(false);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  test("merges configured values with defaults", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-agent-dir-"));
    const configDir = join(agentDir, "extensions");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "subagents.json"),
      JSON.stringify({ maxConcurrency: 7, defaultTimeoutMs: 1234 }),
    );

    const result = loadConfig(resolvePaths(agentDir));

    expect(result.exists).toBe(true);
    expect(result.config).toEqual({
      maxConcurrency: 7,
      maxRecursiveLevel: DEFAULT_CONFIG.maxRecursiveLevel,
      defaultTimeoutMs: 1234,
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
});
