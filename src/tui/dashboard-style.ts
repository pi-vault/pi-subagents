import { truncateToWidth, visibleWidth, type OverlayOptions } from "@earendil-works/pi-tui";
import type { Theme } from "./agent-widget.js";

const PADDING_X = 2;
const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

export const DASHBOARD_MAX_HEIGHT_RATIO = 0.85;
export const MIN_DASHBOARD_FRAME_WIDTH = 7;
export const DASHBOARD_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "center",
  width: "92%",
  maxHeight: "85%",
};

export function dashboardContentWidth(width: number): number {
  return Math.max(1, Math.floor(width) - 6);
}

function fixedWidth(text: string, width: number): string {
  const truncated = truncateToWidth(text.replace(/[\r\n]+/g, " "), width, "");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export function renderDashboardFrame(lines: readonly string[], width: number, theme: Theme): string[] {
  const frameWidth = Math.max(MIN_DASHBOARD_FRAME_WIDTH, Math.floor(width));
  const contentWidth = dashboardContentWidth(frameWidth);
  const border = (glyph: string) => theme.fg("border", glyph);
  const row = (content: string) =>
    fixedWidth(`${border(FRAME.v)}${" ".repeat(PADDING_X)}${fixedWidth(content, contentWidth)}${" ".repeat(PADDING_X)}${border(FRAME.v)}`, frameWidth);

  return [
    fixedWidth(`${border(FRAME.tl)}${border(FRAME.h.repeat(frameWidth - 2))}${border(FRAME.tr)}`, frameWidth),
    row(""),
    ...lines.map(row),
    row(""),
    fixedWidth(`${border(FRAME.bl)}${border(FRAME.h.repeat(frameWidth - 2))}${border(FRAME.br)}`, frameWidth),
  ];
}

export function fitDashboardViewport(
  lines: readonly string[],
  selectedLine: number | undefined,
  height: number,
  offset: number,
): { lines: string[]; offset: number } {
  const viewportHeight = Math.max(0, Math.floor(height));
  if (viewportHeight === 0) return { lines: [], offset: 0 };

  const maxOffset = Math.max(0, lines.length - viewportHeight);
  let nextOffset = Math.max(0, Math.min(Math.floor(offset), maxOffset));
  if (selectedLine !== undefined) {
    if (selectedLine < nextOffset) nextOffset = selectedLine;
    else if (selectedLine >= nextOffset + viewportHeight) nextOffset = selectedLine - viewportHeight + 1;
    nextOffset = Math.max(0, Math.min(nextOffset, maxOffset));
  }

  const visibleLines = lines.slice(nextOffset, nextOffset + viewportHeight);
  return { lines: [...visibleLines, ...Array(viewportHeight - visibleLines.length).fill("")], offset: nextOffset };
}

export function renderDashboardTooSmall(width: number, height: number, theme: Theme): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const message = theme.fg("accent", "Terminal too small · Esc");
  return Array.from({ length: safeHeight }, (_, index) => fixedWidth(index === Math.floor(safeHeight / 2) ? message : "", safeWidth));
}
