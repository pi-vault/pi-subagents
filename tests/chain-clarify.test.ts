import { describe, expect, test, vi } from "vitest";
import { ChainClarifyComponent } from "../src/tui/chain-clarify.js";
import type { ChainClarifyResult } from "../src/tui/chain-clarify.js";
import type { ChainStep } from "../src/shared/types.js";

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
  steps: ChainStep[] = [{ agent: "scout", task: "analyze" }],
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

// ---------------------------------------------------------------------------
// Edit mode tests
// ---------------------------------------------------------------------------

describe("ChainClarifyComponent — edit mode", () => {
  test("e key enters edit-task mode and renders edit UI", () => {
    const { component } = makeComponent([{ agent: "scout", task: "analyze" }]);
    component.handleInput("e");
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("Edit Task"))).toBe(true);
    expect(lines.some((l) => l.includes("analyze"))).toBe(true);
  });

  test("m key enters edit-model mode", () => {
    const { component } = makeComponent([{ agent: "scout", task: "analyze", model: "gpt-4" }]);
    component.handleInput("m");
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("Edit Model"))).toBe(true);
    expect(lines.some((l) => l.includes("gpt-4"))).toBe(true);
  });

  test("typing in edit mode appends to buffer", () => {
    const { component } = makeComponent([{ agent: "scout", task: "" }]);
    component.handleInput("e");
    component.handleInput("h");
    component.handleInput("i");
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("hi"))).toBe(true);
  });

  test("backspace removes last character", () => {
    const { component } = makeComponent([{ agent: "scout", task: "abc" }]);
    component.handleInput("e");
    component.handleInput("\x7f"); // backspace
    const lines = component.render(80);
    // buffer should now be "ab"
    expect(lines.some((l) => l.includes("> ab"))).toBe(true);
  });

  test("Enter confirms task edit and applies override", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "old" }]);
    component.handleInput("e"); // enter edit-task
    component.handleInput("\x7f"); // backspace "ol"
    component.handleInput("\x7f");
    component.handleInput("\x7f");
    component.handleInput("n");
    component.handleInput("e");
    component.handleInput("w");
    component.handleInput("\r"); // confirm
    // Back in list mode — run it
    component.handleInput("\r");
    expect(result.value?.action).toBe("run");
    expect(result.value?.steps[0]).toMatchObject({ agent: "scout", task: "new" });
  });

  test("Enter confirms model edit and applies override", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "analyze", model: "old-model" }]);
    component.handleInput("m"); // enter edit-model
    // Clear buffer and type new model
    for (let i = 0; i < "old-model".length; i++) component.handleInput("\x7f");
    "claude".split("").forEach((c) => component.handleInput(c));
    component.handleInput("\r"); // confirm
    component.handleInput("\r"); // run
    expect(result.value?.steps[0]).toMatchObject({ model: "claude" });
  });

  test("Escape cancels edit and does not apply override", () => {
    const { component, result } = makeComponent([{ agent: "scout", task: "original" }]);
    component.handleInput("e"); // enter edit-task
    component.handleInput("X"); // type something
    component.handleInput("\x1b"); // escape — cancel edit
    component.handleInput("\r"); // run from list mode
    expect(result.value?.action).toBe("run");
    expect(result.value?.steps[0]).toMatchObject({ task: "original" });
  });

  test("edit mode does not apply to parallel steps", () => {
    const parallelStep = { parallel: [{ agent: "a", task: "t1" }, { agent: "b", task: "t2" }] };
    const { component } = makeComponent([parallelStep as any]);
    component.handleInput("e"); // should be a no-op for parallel step
    const lines = component.render(80);
    // Should remain in list mode — no "Edit Task" label
    expect(lines.some((l) => l.includes("Edit Task"))).toBe(false);
  });

  test("applyOverrides includes overrides from multiple steps", () => {
    const steps = [
      { agent: "a", task: "task-a" },
      { agent: "b", task: "task-b" },
    ];
    const { component, result } = makeComponent(steps);
    // Edit first step task
    component.handleInput("e");
    component.handleInput("\x7f"); component.handleInput("\x7f");
    component.handleInput("\x7f"); component.handleInput("\x7f");
    component.handleInput("\x7f"); component.handleInput("\x7f");
    "new-a".split("").forEach((c) => component.handleInput(c));
    component.handleInput("\r"); // confirm
    // Navigate to second step and edit
    component.handleInput("j");
    component.handleInput("e");
    component.handleInput("\x7f"); component.handleInput("\x7f");
    component.handleInput("\x7f"); component.handleInput("\x7f");
    component.handleInput("\x7f"); component.handleInput("\x7f");
    "new-b".split("").forEach((c) => component.handleInput(c));
    component.handleInput("\r"); // confirm
    // Run
    component.handleInput("\r");
    expect(result.value?.steps[0]).toMatchObject({ task: "new-a" });
    expect(result.value?.steps[1]).toMatchObject({ task: "new-b" });
  });
});
