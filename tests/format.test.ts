import { describe, expect, it } from "vitest";
import {
  formatMs,
  formatTokens,
  formatTurns,
  describeActivity,
} from "../src/tui/format.js";

describe("formatMs", () => {
  it("formats milliseconds to seconds", () => {
    expect(formatMs(11_200)).toBe("11.2s");
  });
  it("formats sub-second", () => {
    expect(formatMs(500)).toBe("0.5s");
  });
});

describe("formatTokens", () => {
  it("formats small numbers", () => {
    expect(formatTokens(500)).toBe("500 token");
  });
  it("formats thousands", () => {
    expect(formatTokens(12_300)).toBe("12.3k token");
  });
  it("formats millions", () => {
    expect(formatTokens(1_200_000)).toBe("1.2M token");
  });
});

describe("formatTurns", () => {
  it("without max", () => {
    expect(formatTurns(5)).toBe("↻5");
  });
  it("with max", () => {
    expect(formatTurns(5, 30)).toBe("↻5≤30");
  });
});

describe("describeActivity", () => {
  it("returns thinking when no tools active", () => {
    expect(describeActivity([])).toBe("thinking…");
  });
  it("shows tool action", () => {
    expect(describeActivity(["read"])).toBe("reading…");
  });
  it("groups multiple same-tool", () => {
    expect(describeActivity(["read", "read"])).toBe("reading 2 files…");
  });
  it("joins different tools", () => {
    expect(describeActivity(["read", "edit"])).toBe("reading, editing…");
  });
  it("preserves first-seen action order while grouping duplicates", () => {
    expect(describeActivity(["edit", "read", "edit", "grep"])).toBe(
      "editing 2 files, reading, searching…",
    );
  });
  it("falls back to response text when no tools active", () => {
    expect(describeActivity([], "I will search the code")).toBe(
      "I will search the code",
    );
  });
  it("truncates long response text to 60 chars", () => {
    const long = "a".repeat(100);
    expect(describeActivity([], long).length).toBeLessThanOrEqual(63); // 60 + "..."
  });
  it("falls back to thinking when response text is empty", () => {
    expect(describeActivity([], "")).toBe("thinking…");
  });
  it("unknown tool name falls back to raw name", () => {
    expect(describeActivity(["my_custom_tool"])).toBe("my_custom_tool…");
  });
});
