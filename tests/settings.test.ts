import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSettings, saveSettings, applySettings } from "../src/core/settings.js";
import type { SettingsAppliers } from "../src/core/settings.js";

describe("settings", () => {
  const testDir = join(tmpdir(), `pi-subagents-settings-test-${Date.now()}`);
  const projectDir = join(testDir, "project");
  const piDir = join(projectDir, ".pi");

  beforeEach(() => {
    mkdirSync(piDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty settings when no file exists", () => {
    const settings = loadSettings(join(testDir, "nonexistent"));
    expect(settings).toEqual({});
  });

  it("reads project settings", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxConcurrent: 8 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxConcurrent).toBe(8);
  });

  it("sanitizes invalid values", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
      maxConcurrent: -1,
      defaultJoinMode: "invalid",
    }));
    const settings = loadSettings(projectDir);
    expect(settings.maxConcurrent).toBeUndefined();
    expect(settings.defaultJoinMode).toBeUndefined();
  });

  it("saves project settings", () => {
    const result = saveSettings({ maxConcurrent: 6 }, projectDir);
    expect(result).toBe(true);
    const raw = JSON.parse(readFileSync(join(piDir, "subagents.json"), "utf-8"));
    expect(raw.maxConcurrent).toBe(6);
  });

  it("applySettings calls setters for present fields", () => {
    let maxConcurrent = 0;
    let joinMode = "";
    const appliers: SettingsAppliers = {
      setMaxConcurrent: (n) => { maxConcurrent = n; },
      setDefaultJoinMode: (m) => { joinMode = m; },
    };
    applySettings({ maxConcurrent: 10, defaultJoinMode: "group" }, appliers);
    expect(maxConcurrent).toBe(10);
    expect(joinMode).toBe("group");
  });

  it("applySettings skips missing fields", () => {
    let called = false;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => { called = true; },
      setDefaultJoinMode: () => { called = true; },
    };
    applySettings({}, appliers);
    expect(called).toBe(false);
  });
});
