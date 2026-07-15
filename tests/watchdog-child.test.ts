import { describe, it, expect } from "vitest";
import { resolveChildWatchdogConfig } from "../src/core/watchdog-child.js";
import { parseWatchdogConfig } from "../src/core/watchdog.js";

describe("resolveChildWatchdogConfig", () => {
  it("returns undefined when parent watchdog is disabled", () => {
    const config = parseWatchdogConfig({ enabled: false, children: { enabled: true } });
    expect(resolveChildWatchdogConfig(config, "scout")).toBeUndefined();
  });

  it("returns undefined when children.enabled is false", () => {
    const config = parseWatchdogConfig({ enabled: true, children: { enabled: false } });
    expect(resolveChildWatchdogConfig(config, "scout")).toBeUndefined();
  });

  it("returns child config for enabled parent with enabled children", () => {
    const config = parseWatchdogConfig({ enabled: true, children: { enabled: true } });
    const result = resolveChildWatchdogConfig(config, "worker");
    expect(result).toBeDefined();
  });

  it("inherits parent model when no children.model and no override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "parent-model",
      children: { enabled: true },
    });
    const result = resolveChildWatchdogConfig(config, "worker");
    expect(result!.model).toBe("parent-model");
  });

  it("uses children.model when set and no per-agent override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "parent-model",
      children: { enabled: true, model: "child-default-model" },
    });
    const result = resolveChildWatchdogConfig(config, "worker");
    expect(result!.model).toBe("child-default-model");
  });

  it("uses per-agent override model over children.model", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "parent-model",
      children: {
        enabled: true,
        model: "child-default-model",
        overrides: { scout: { model: "scout-specific-model" } },
      },
    });
    const result = resolveChildWatchdogConfig(config, "scout");
    expect(result!.model).toBe("scout-specific-model");
  });

  it("applies per-agent thinking override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      thinking: "medium",
      children: {
        enabled: true,
        overrides: { scout: { thinking: "low" } },
      },
    });
    const result = resolveChildWatchdogConfig(config, "scout");
    expect(result!.thinking).toBe("low");
  });

  it("returns undefined when per-agent override disables that agent", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: {
        enabled: true,
        overrides: { scout: { enabled: false } },
      },
    });
    expect(resolveChildWatchdogConfig(config, "scout")).toBeUndefined();
  });

  it("still enables other agents when one is disabled via override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: {
        enabled: true,
        overrides: { scout: { enabled: false } },
      },
    });
    expect(resolveChildWatchdogConfig(config, "worker")).toBeDefined();
    expect(resolveChildWatchdogConfig(config, "scout")).toBeUndefined();
  });

  it("inherits parent thinking when no override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      thinking: "high",
      children: { enabled: true },
    });
    const result = resolveChildWatchdogConfig(config, "worker");
    expect(result!.thinking).toBe("high");
  });
});
