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
    expect(describeActivity(new Map())).toBe("thinking…");
  });
  it("shows tool action", () => {
    const tools = new Map([["read_1", "read"]]);
    expect(describeActivity(tools)).toBe("reading…");
  });
  it("groups multiple same-tool", () => {
    const tools = new Map([
      ["read_1", "read"],
      ["read_2", "read"],
    ]);
    expect(describeActivity(tools)).toBe("reading 2 files…");
  });
  it("joins different tools", () => {
    const tools = new Map([
      ["read_1", "read"],
      ["edit_1", "edit"],
    ]);
    expect(describeActivity(tools)).toBe("reading, editing…");
  });
  it("falls back to response text when no tools active", () => {
    expect(describeActivity(new Map(), "I will search the code")).toBe(
      "I will search the code",
    );
  });
  it("truncates long response text to 60 chars", () => {
    const long = "a".repeat(100);
    expect(describeActivity(new Map(), long).length).toBeLessThanOrEqual(63); // 60 + "..."
  });
  it("falls back to thinking when response text is empty", () => {
    expect(describeActivity(new Map(), "")).toBe("thinking…");
  });
  it("unknown tool name falls back to raw name", () => {
    const tools = new Map([["custom_1", "my_custom_tool"]]);
    expect(describeActivity(tools)).toBe("my_custom_tool…");
  });
});
