import { describe, expect, test, vi } from "vitest";
import { ChainClarifyComponent } from "../src/tui/chain-clarify.js";
import type { ChainClarifyResult } from "../src/tui/chain-clarify.js";

// ---------------------------------------------------------------------------
// Minimal mocks — the component only calls tui.requestRender()
// ---------------------------------------------------------------------------

const mockTui = { requestRender: vi.fn() } as unknown as import("@earendil-works/pi-tui").TUI;
// Minimal theme-compatible object — the component uses theme.fg() for styling
const mockTheme = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
} as unknown as import("../src/tui/agent-widget.js").Theme;

function makeComponent(
  steps = [{ agent: "scout", task: "analyze" }],
  done?: (r: ChainClarifyResult) => void,
): { component: ChainClarifyComponent; result: { value: ChainClarifyResult | undefined } } {
  const result: { value: ChainClarifyResult | undefined } = { value: undefined };
  const component = new ChainClarifyComponent(
    mockTui,
    mockTheme,
    steps,
    [],
    "test task",
    done ?? ((r) => { result.value = r; }),
  );
  return { component, result };
}

// ---------------------------------------------------------------------------
// Render tests
// ---------------------------------------------------------------------------

describe("ChainClarifyComponent — render", () => {
  test("renders step list with agent names", () => {
    const { component } = makeComponent([
      { agent: "scout", task: "analyze" },
      { agent: "planner", task: "plan" },
    ]);
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("scout"))).toBe(true);
    expect(lines.some((l) => l.includes("planner"))).toBe(true);
  });

  test("render returns an array of strings", () => {
    const { component } = makeComponent();
    const lines = component.render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.every((l) => typeof l === "string")).toBe(true);
  });

  test("shows key hint for run", () => {
    const { component } = makeComponent();
    const text = component.render(80).join("\n");
    expect(text.toLowerCase()).toMatch(/enter|run/);
  });
});

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

describe("ChainClarifyComponent — input", () => {
  test("Enter key returns run action", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "analyze" }]);
    component.handleInput("\r");
    expect(result.value?.action).toBe("run");
    expect(result.value?.steps).toEqual([{ agent: "scout", task: "analyze" }]);
  });

  test("Escape key returns cancel action", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "analyze" }]);
    component.handleInput("\x1b");
    expect(result.value?.action).toBe("cancel");
  });

  test("b key returns bg action", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "analyze" }]);
    component.handleInput("b");
    expect(result.value?.action).toBe("bg");
  });

  test("q key returns cancel action", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "analyze" }]);
    component.handleInput("q");
    expect(result.value?.action).toBe("cancel");
  });

  test("j key moves selection down", () => {
    const { component } = makeComponent([
      { agent: "scout", task: "analyze" },
      { agent: "planner", task: "plan" },
    ]);
    component.handleInput("j");
    const lines = component.render(80);
    // Second step should now be selected (cursor on planner)
    const hasCursorOnPlanner = lines.some(
      (l) => l.includes(">") && l.includes("planner"),
    );
    expect(hasCursorOnPlanner).toBe(true);
  });

  test("k key moves selection up after going down", () => {
    const { component } = makeComponent([
      { agent: "scout", task: "analyze" },
      { agent: "planner", task: "plan" },
    ]);
    component.handleInput("j"); // move to planner
    component.handleInput("k"); // back to scout
    const lines = component.render(80);
    const hasCursorOnScout = lines.some(
      (l) => l.includes(">") && l.includes("scout"),
    );
    expect(hasCursorOnScout).toBe(true);
  });

  test("navigation does not go below last step", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "analyze" }]);
    component.handleInput("j"); // already at last — should stay
    component.handleInput("\r");
    // Should still run successfully
    expect(result.value?.action).toBe("run");
  });

  test("navigation does not go above first step", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "analyze" }]);
    component.handleInput("k"); // already at first — should stay
    component.handleInput("\r");
    expect(result.value?.action).toBe("run");
  });
});

// ---------------------------------------------------------------------------
// Result includes steps
// ---------------------------------------------------------------------------

describe("ChainClarifyComponent — result steps", () => {
  test("run result contains all original steps", () => {
    const steps = [
      { agent: "a", task: "task-a" },
      { agent: "b", task: "task-b" },
    ];
    const { component, result } = makeComponent(steps);
    component.handleInput("\r");
    expect(result.value?.steps).toHaveLength(2);
    expect(result.value?.steps[0]).toMatchObject({ agent: "a" });
    expect(result.value?.steps[1]).toMatchObject({ agent: "b" });
  });

  test("bg result contains all original steps", () => {
    const steps = [{ agent: "scout", task: "analyze" }];
    const { component, result } = makeComponent(steps);
    component.handleInput("b");
    expect(result.value?.steps).toHaveLength(1);
  });
});
