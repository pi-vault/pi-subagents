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

  it("sanitize preserves widgetMode 'all'", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ widgetMode: "all" }));
    const settings = loadSettings(projectDir);
    expect(settings.widgetMode).toBe("all");
  });

  it("sanitize preserves widgetMode 'background'", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ widgetMode: "background" }));
    const settings = loadSettings(projectDir);
    expect(settings.widgetMode).toBe("background");
  });

  it("sanitize preserves widgetMode 'off'", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ widgetMode: "off" }));
    const settings = loadSettings(projectDir);
    expect(settings.widgetMode).toBe("off");
  });

  it("sanitize strips invalid widgetMode", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ widgetMode: "invalid" }));
    const settings = loadSettings(projectDir);
    expect(settings.widgetMode).toBeUndefined();
  });

  it("sanitize preserves fleetView true", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ fleetView: true }));
    const settings = loadSettings(projectDir);
    expect(settings.fleetView).toBe(true);
  });

  it("sanitize preserves fleetView false", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ fleetView: false }));
    const settings = loadSettings(projectDir);
    expect(settings.fleetView).toBe(false);
  });

  it("sanitize strips non-boolean fleetView", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ fleetView: "yes" }));
    const settings = loadSettings(projectDir);
    expect(settings.fleetView).toBeUndefined();
  });

  it("applySettings calls setWidgetMode when widgetMode is set", () => {
    let widgetMode: string | undefined;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => {},
      setDefaultJoinMode: () => {},
      setWidgetMode: (m) => { widgetMode = m; },
    };
    applySettings({ widgetMode: "all" }, appliers);
    expect(widgetMode).toBe("all");
  });

  it("applySettings calls setFleetView when fleetView is set", () => {
    let fleetView: boolean | undefined;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => {},
      setDefaultJoinMode: () => {},
      setFleetView: (v) => { fleetView = v; },
    };
    applySettings({ fleetView: false }, appliers);
    expect(fleetView).toBe(false);
  });

  it("applySettings does not call setWidgetMode or setFleetView when absent", () => {
    let called = false;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => {},
      setDefaultJoinMode: () => {},
      setWidgetMode: () => { called = true; },
      setFleetView: () => { called = true; },
    };
    applySettings({ maxConcurrent: 4 }, appliers);
    expect(called).toBe(false);
  });

  it("sanitize preserves valid modelScope", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
      modelScope: { enforce: true, allow: ["anthropic/*"] },
    }));
    const settings = loadSettings(projectDir);
    expect(settings.modelScope).toEqual({ enforce: true, allow: ["anthropic/*"] });
  });

  it("sanitize strips invalid modelScope (enforce not boolean)", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
      modelScope: { enforce: "yes", allow: [] },
    }));
    const settings = loadSettings(projectDir);
    expect(settings.modelScope).toBeUndefined();
  });

  it("sanitize strips non-object modelScope", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
      modelScope: "invalid",
    }));
    const settings = loadSettings(projectDir);
    expect(settings.modelScope).toBeUndefined();
  });

  it("sanitize preserves valid maxSpawnsPerSession", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 50 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBe(50);
  });

  it("sanitize strips non-integer maxSpawnsPerSession", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 3.5 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBeUndefined();
  });

  it("sanitize strips maxSpawnsPerSession below 1", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 0 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBeUndefined();
  });

  it("sanitize strips maxSpawnsPerSession above 10000", () => {
    writeFileSync(join(piDir, "subagents.json"), JSON.stringify({ maxSpawnsPerSession: 99999 }));
    const settings = loadSettings(projectDir);
    expect(settings.maxSpawnsPerSession).toBeUndefined();
  });

  it("applySettings calls setMaxSpawnsPerSession when value present", () => {
    let spawns: number | undefined;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => {},
      setDefaultJoinMode: () => {},
      setMaxSpawnsPerSession: (n) => { spawns = n; },
    };
    applySettings({ maxSpawnsPerSession: 25 }, appliers);
    expect(spawns).toBe(25);
  });

  it("applySettings does not call setMaxSpawnsPerSession when absent", () => {
    let called = false;
    const appliers: SettingsAppliers = {
      setMaxConcurrent: () => {},
      setDefaultJoinMode: () => {},
      setMaxSpawnsPerSession: () => { called = true; },
    };
    applySettings({ maxConcurrent: 4 }, appliers);
    expect(called).toBe(false);
  });
});
