import { describe, expect, test } from "vitest";
import { renderRow } from "../src/tui/agents-menu.js";

function createTheme() {
  const calls: Array<{ method: string; color?: string; text: string }> = [];
  return {
    calls,
    theme: {
      fg(color: string, text: string) {
        calls.push({ method: "fg", color, text });
        return text;
      },
      bold(text: string) {
        calls.push({ method: "bold", text });
        return text;
      },
      bg(color: string, text: string) {
        calls.push({ method: "bg", color, text });
        return text;
      },
    },
  };
}

describe("agents menu row rendering", () => {
  test("selected rows use accent arrow + accent label without background fill", () => {
    const { calls, theme } = createTheme();
    const line = renderRow(theme as never, "Agents (5)", true);

    expect(line).toContain("▸");
    expect(calls.some((entry) => entry.method === "fg" && entry.color === "accent" && entry.text.includes("▸"))).toBe(true);
    expect(calls.some((entry) => entry.method === "fg" && entry.color === "accent" && entry.text.includes("Agents (5)"))).toBe(true);
    expect(calls.some((entry) => entry.method === "bg")).toBe(false);
  });

  test("unselected rows stay dimmed", () => {
    const { calls, theme } = createTheme();
    const line = renderRow(theme as never, "Create new agent", false);

    expect(line.startsWith("  ")).toBe(true);
    expect(calls.some((entry) => entry.method === "fg" && entry.color === "dim" && entry.text.includes("Create new agent"))).toBe(true);
  });
});
