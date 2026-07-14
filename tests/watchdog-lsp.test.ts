import { describe, expect, it } from "vitest";
import {
  collectLspDiagnostics,
  parseTscOutput,
} from "../src/core/watchdog-lsp.js";
import type { LspConfig } from "../src/core/watchdog-lsp.js";

describe("parseTscOutput", () => {
  it("parses error lines", () => {
    const output = `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/utils.ts(3,1): error TS2304: Cannot find name 'foo'.`;
    const result = parseTscOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "src/index.ts",
      line: 10,
      severity: "error",
      message: "Type 'string' is not assignable to type 'number'.",
      code: "TS2322",
    });
  });

  it("parses warning lines", () => {
    const output = `src/foo.ts(1,1): warning TS6133: 'x' is declared but its value is never read.`;
    const result = parseTscOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });

  it("returns empty array for clean output", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("Found 0 errors.")).toEqual([]);
  });

  it("handles lines that don't match the pattern", () => {
    const output = `some random text
src/index.ts(1,1): error TS1234: Real error.
more noise`;
    const result = parseTscOutput(output);
    expect(result).toHaveLength(1);
  });
});

describe("collectLspDiagnostics", () => {
  const defaultConfig: LspConfig = {
    enabled: true,
    timeoutMs: 3000,
    maxFiles: 20,
    maxDiagnostics: 50,
  };

  it("returns ok with empty diagnostics when no TS/JS files in changedPaths", async () => {
    const result = await collectLspDiagnostics(
      "/tmp",
      ["readme.md", "data.json"],
      defaultConfig,
    );
    expect(result.status).toBe("ok");
    expect(result.diagnostics).toEqual([]);
  });

  it("returns unavailable when tsc is not found", async () => {
    const result = await collectLspDiagnostics(
      "/nonexistent-dir-xyz",
      ["index.ts"],
      defaultConfig,
    );
    expect(["unavailable", "failed"]).toContain(result.status);
  });

  it("respects maxFiles limit", async () => {
    const config: LspConfig = { ...defaultConfig, maxFiles: 2 };
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"];
    const result = await collectLspDiagnostics("/tmp", files, config);
    expect(result.checkedPaths.length).toBeLessThanOrEqual(2);
  });
});
