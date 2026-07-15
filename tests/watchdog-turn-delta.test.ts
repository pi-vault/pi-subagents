import { describe, it, expect } from "vitest";
import { formatWatchdogTurnDelta } from "../src/core/watchdog-turn-delta.js";

describe("formatWatchdogTurnDelta", () => {
  it("returns empty string for empty messages", () => {
    expect(formatWatchdogTurnDelta([], 10)).toBe("");
  });

  it("formats a tool_use block with name and input path", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", name: "read_file", input: { path: "/foo.ts" } }] },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("read_file");
    expect(result).toContain("/foo.ts");
  });

  it("formats tool_result content", () => {
    const messages = [
      { role: "tool", content: [{ type: "tool_result", content: "the file contents" }] },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("the file contents");
  });

  it("formats text blocks in assistant messages", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "Let me analyze this code." }] },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("Let me analyze this code.");
  });

  it("handles string content (user messages)", () => {
    const messages = [
      { role: "user", content: "Please fix the null check." },
      { role: "assistant", content: "I will fix that now." },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("Please fix the null check.");
    expect(result).toContain("I will fix that now.");
  });

  it("limits output to last N messages", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: "assistant",
      content: [{ type: "tool_use", name: `tool_${i}`, input: {} }],
    }));
    const result = formatWatchdogTurnDelta(messages, 5);
    expect(result).toContain("tool_19");
    expect(result).toContain("tool_15");
    expect(result).not.toContain("tool_0");
    expect(result).not.toContain("tool_14");
  });

  it("redacts large string values in edit tool inputs", () => {
    const longContent = "x".repeat(500);
    const messages = [
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          name: "edit",
          input: { path: "/foo.ts", old_string: longContent, new_string: longContent },
        }],
      },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("[omitted 500 chars]");
    expect(result).not.toContain("x".repeat(100));
  });

  it("redacts new_string in write tool", () => {
    const longContent = "y".repeat(600);
    const messages = [
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          name: "write",
          input: { path: "/bar.ts", content: longContent },
        }],
      },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("[omitted 600 chars]");
    expect(result).not.toContain("y".repeat(100));
  });

  it("does not redact normal (short) tool inputs", () => {
    const messages = [
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          name: "read_file",
          input: { path: "/src/foo.ts" },
        }],
      },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("/src/foo.ts");
    expect(result).not.toContain("[omitted");
  });

  it("includes the role prefix in output", () => {
    const messages = [
      { role: "user", content: "Hello there" },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("[user]");
  });
});
