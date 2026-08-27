import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import {
  dashboardContentWidth,
  fitDashboardViewport,
  MIN_DASHBOARD_FRAME_WIDTH,
  renderDashboardFrame,
  renderDashboardTooSmall,
} from "../src/tui/dashboard-style.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};
const ansiTheme = {
  fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[39m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

describe("dashboard style", () => {
  test("renders a heavy frame at the requested visible width", () => {
    const lines = renderDashboardFrame(["Header", "Body"], 24, plainTheme);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(`┏${"━".repeat(22)}┓`);
    expect(lines.at(-1)).toBe(`┗${"━".repeat(22)}┛`);
    expect(lines.every((line) => visibleWidth(line) === 24)).toBe(true);
    expect(dashboardContentWidth(24)).toBe(18);
  });

  test("preserves visible width with ANSI and embedded newlines", () => {
    const lines = renderDashboardFrame(["one\r\ntwo"], 24, ansiTheme);
    expect(lines.some((line) => line.includes("\x1b[31m"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) === 24)).toBe(true);
    expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
  });

  test("preserves the complete seven-column minimum", () => {
    expect(MIN_DASHBOARD_FRAME_WIDTH).toBe(7);
    expect(renderDashboardFrame(["x"], 7, plainTheme)).toEqual([
      "┏━━━━━┓",
      "┃     ┃",
      "┃  x  ┃",
      "┃     ┃",
      "┗━━━━━┛",
    ]);
  });

  test("keeps selection visible without unnecessary offset jumps", () => {
    const lines = ["0", "1", "2", "3", "4"];
    expect(fitDashboardViewport(lines, 4, 3, 0)).toEqual({
      lines: ["2", "3", "4"],
      offset: 2,
    });
    expect(fitDashboardViewport(lines, 2, 3, 1)).toEqual({
      lines: ["1", "2", "3"],
      offset: 1,
    });
    expect(fitDashboardViewport(["0", "1"], 1, 3, 99)).toEqual({
      lines: ["0", "1", ""],
      offset: 0,
    });
    expect(fitDashboardViewport(lines, 2, 0, 1)).toEqual({
      lines: [],
      offset: 0,
    });
  });

  test("renders a bounded small-terminal escape message", () => {
    const lines = renderDashboardTooSmall(30, 3, plainTheme);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => visibleWidth(line) === 30)).toBe(true);
    expect(lines.join("\n")).toContain("Esc");
  });
});
