import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_MAX_SPAWNS_PER_SESSION,
  checkSpawnLimit,
  resolveMaxSpawns,
} from "../src/core/spawn-guard.js";

describe("resolveMaxSpawns", () => {
  afterEach(() => {
    delete process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION;
  });

  test("returns default when no config and no env var", () => {
    expect(resolveMaxSpawns()).toBe(DEFAULT_MAX_SPAWNS_PER_SESSION);
  });

  test("returns config value when set and no env var", () => {
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("env var takes priority over config", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "5";
    expect(resolveMaxSpawns(20)).toBe(5);
  });

  test("falls back to config when env var is non-integer", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "3.5";
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("falls back to config when env var is negative", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "-1";
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("falls back to config when env var is empty", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "";
    expect(resolveMaxSpawns(20)).toBe(20);
  });

  test("env var 0 is valid (blocks all spawns)", () => {
    process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION = "0";
    expect(resolveMaxSpawns(20)).toBe(0);
  });
});

describe("checkSpawnLimit", () => {
  test("allows spawn within limit", () => {
    expect(checkSpawnLimit(5, 1, 40)).toBeUndefined();
  });

  test("allows spawn at exactly max - 1", () => {
    expect(checkSpawnLimit(39, 1, 40)).toBeUndefined();
  });

  test("blocks spawn at max", () => {
    const error = checkSpawnLimit(40, 1, 40);
    expect(error).toBeTypeOf("string");
    expect(error).toContain("40/40");
  });

  test("blocks spawn over max", () => {
    const error = checkSpawnLimit(41, 1, 40);
    expect(error).toBeTypeOf("string");
  });

  test("handles batch requested > 1", () => {
    expect(checkSpawnLimit(38, 3, 40)).toBeTypeOf("string");
    expect(checkSpawnLimit(37, 3, 40)).toBeUndefined();
  });

  test("max 0 blocks all spawns", () => {
    const error = checkSpawnLimit(0, 1, 0);
    expect(error).toBeTypeOf("string");
    expect(error).toContain("0/0");
  });

  test("requested 0 always passes", () => {
    expect(checkSpawnLimit(100, 0, 40)).toBeUndefined();
  });

  test("error message includes counts", () => {
    const error = checkSpawnLimit(39, 2, 40);
    expect(error).toContain("39/40");
    expect(error).toContain("2 requested");
  });
});
