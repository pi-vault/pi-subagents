import { describe, expect, it } from "vitest";
import { createViewerKeys } from "../src/tui/viewer-keys.js";

// Raw escape sequences for arrow keys (VT100/xterm)
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";

describe("createViewerKeys (default keybindings)", () => {
  const keys = createViewerKeys();

  it("up arrow scrolls up", () => {
    expect(keys.scrollUp(UP)).toBe(true);
  });
  it("k scrolls up", () => {
    expect(keys.scrollUp("k")).toBe(true);
  });
  it("down arrow scrolls down", () => {
    expect(keys.scrollDown(DOWN)).toBe(true);
  });
  it("j scrolls down", () => {
    expect(keys.scrollDown("j")).toBe(true);
  });
  it("pageUp pages up", () => {
    expect(keys.pageUp(PAGE_UP)).toBe(true);
  });
  it("pageDown pages down", () => {
    expect(keys.pageDown(PAGE_DOWN)).toBe(true);
  });
  it("unrelated key returns false for all", () => {
    expect(keys.scrollUp("x")).toBe(false);
    expect(keys.scrollDown("x")).toBe(false);
    expect(keys.pageUp("x")).toBe(false);
    expect(keys.pageDown("x")).toBe(false);
  });
});

describe("createViewerKeys (custom keybindings)", () => {
  it("uses custom keybindings.matches when provided", () => {
    const custom = {
      matches: (data: string, id: string) => id === "tui.select.up" && data === "ctrl+k",
    };
    const keys = createViewerKeys(custom);
    expect(keys.scrollUp("ctrl+k")).toBe(true);
    expect(keys.scrollUp(UP)).toBe(false); // custom overrides, matchesKey fallback not used
  });
});
