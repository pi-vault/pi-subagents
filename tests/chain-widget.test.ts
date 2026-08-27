import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { ChainWidget } from "../src/tui/chain-widget.js";
import type { Theme, UICtx } from "../src/tui/agent-widget.js";
import type { WorkflowGraphSnapshot } from "../src/shared/types.js";

function mockTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function mockUICtx(): UICtx & { widgets: Map<string, unknown> } {
  const widgets = new Map<string, unknown>();
  return {
    widgets,
    setWidget(key, content) {
      widgets.set(key, content);
    },
    setStatus() {},
  };
}

function makeSnapshot(
  overrides: Partial<WorkflowGraphSnapshot> = {},
): WorkflowGraphSnapshot {
  return {
    runId: "test-chain",
    mode: "chain",
    phases: [],
    nodes: [],
    ...overrides,
  };
}

function renderRegisteredWidget(
  ctx: ReturnType<typeof mockUICtx>,
  width: number,
  terminalColumns = 200,
): string[] {
  const factory = ctx.widgets.get("chain") as
    | ((
        tui: unknown,
        theme: Theme,
      ) => {
        render(width: number): string[];
      })
    | undefined;
  if (!factory) return [];
  return factory(
    { terminal: { columns: terminalColumns }, requestRender() {} },
    mockTheme(),
  ).render(width);
}

describe("ChainWidget", () => {
  test("does nothing when no UICtx is set", () => {
    const widget = new ChainWidget();
    // Should not throw
    widget.update(makeSnapshot());
    widget.clear();
    widget.dispose();
  });

  test("registers widget on first update", () => {
    const widget = new ChainWidget();
    const ctx = mockUICtx();
    widget.setUICtx(ctx);

    widget.update(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "step",
            agent: "scout",
            label: "Scan",
            status: "running",
            flatIndex: 0,
            stepIndex: 0,
          },
          {
            id: "step-1",
            kind: "step",
            agent: "planner",
            label: "Plan",
            status: "pending",
            flatIndex: 1,
            stepIndex: 1,
          },
        ],
        currentNodeId: "step-0",
      }),
    );

    expect(ctx.widgets.has("chain")).toBe(true);
    widget.dispose();
  });

  test("unregisters widget on clear()", () => {
    const widget = new ChainWidget();
    const ctx = mockUICtx();
    widget.setUICtx(ctx);

    widget.update(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "step",
            agent: "a",
            label: "A",
            status: "running",
            flatIndex: 0,
            stepIndex: 0,
          },
        ],
      }),
    );
    expect(ctx.widgets.has("chain")).toBe(true);

    widget.clear();
    expect(ctx.widgets.get("chain")).toBeUndefined();
    widget.dispose();
  });

  test("renders sequential progress with a dashboard summary", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "step",
            label: "Scan files",
            status: "completed",
            flatIndex: 0,
            stepIndex: 0,
          },
          {
            id: "step-1",
            kind: "step",
            label: "Create plan",
            status: "running",
            flatIndex: 1,
            stepIndex: 1,
          },
          {
            id: "step-2",
            kind: "step",
            label: "Implement",
            status: "pending",
            flatIndex: 2,
            stepIndex: 2,
          },
        ],
        currentNodeId: "step-1",
      }),
      mockTheme(),
      100,
    );

    expect(lines[0]).toBe("╭─ ✦ CHAIN · test-chain");
    expect(lines[1]).toBe("│ [1/3] ✓ Scan files");
    expect(lines[2]).toMatch(/^│ \[2\/3\] [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Create plan$/);
    expect(lines[3]).toBe("│ [3/3] ○ Implement");
    expect(lines.at(-1)).toBe("╰─ 1 completed · 1 running · 1 pending");
  });

  const parallelSnapshot = makeSnapshot({
    nodes: [
      {
        id: "step-0",
        kind: "parallel-group",
        label: "Parallel group (2)",
        status: "running",
        stepIndex: 0,
        children: [
          {
            id: "step-0-agent-0",
            kind: "agent",
            label: "Worker A",
            status: "completed",
            flatIndex: 0,
            stepIndex: 0,
          },
          {
            id: "step-0-agent-1",
            kind: "agent",
            label: "Worker B",
            status: "running",
            flatIndex: 1,
            stepIndex: 0,
          },
        ],
      },
    ],
    currentNodeId: "step-0-agent-1",
  });

  test("keeps parallel children under their parent row", () => {
    const lines = new ChainWidget().renderLines(
      parallelSnapshot,
      mockTheme(),
      100,
    );
    expect(
      lines.some(
        (line) => line.startsWith("│ [1/1]") && line.includes("Parallel group"),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) => line.startsWith("│   ├─") && line.includes("Worker A"),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) => line.startsWith("│   └─") && line.includes("Worker B"),
      ),
    ).toBe(true);
  });

  test("renderLines shows error info", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "step",
            agent: "a",
            label: "Failing step",
            status: "failed",
            flatIndex: 0,
            stepIndex: 0,
            error: "timeout",
          },
        ],
      }),
      mockTheme(),
      100,
    );

    expect(lines.some((l) => l.includes("timeout"))).toBe(true);
  });

  test("renderLines shows phase on sequential step", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "step",
            agent: "a",
            label: "Setup task",
            status: "pending",
            flatIndex: 0,
            stepIndex: 0,
            phase: "Setup",
          },
        ],
      }),
      mockTheme(),
      100,
    );

    expect(lines.some((l) => l.includes("Setup"))).toBe(true);
  });

  const longLabelSnapshot = makeSnapshot({
    nodes: [
      {
        id: "step-0",
        kind: "step",
        label: "long label\r\nsecond line",
        status: "running",
        flatIndex: 0,
        stepIndex: 0,
      },
    ],
    currentNodeId: "step-0",
  });

  test("caps output while keeping the active row visible", () => {
    const nodes = Array.from({ length: 15 }, (_, index) => ({
      id: `step-${index}`,
      kind: "step" as const,
      label: `Step ${index}`,
      status:
        index < 12
          ? ("completed" as const)
          : index === 12
            ? ("running" as const)
            : ("pending" as const),
      flatIndex: index,
      stepIndex: index,
    }));
    const lines = new ChainWidget().renderLines(
      makeSnapshot({ nodes, currentNodeId: "step-12" }),
      mockTheme(),
      60,
    );

    expect(lines).toHaveLength(12);
    expect(lines.join("\n")).toContain("Step 12");
    expect(lines.join("\n")).not.toContain("Step 0");
    expect(lines.at(-1)).toContain("+5 more");
  });

  test("uses the component width rather than terminal columns", () => {
    const widget = new ChainWidget();
    const ctx = mockUICtx();
    widget.setUICtx(ctx);
    widget.update(longLabelSnapshot);

    for (const width of [0, 1, 12, 40]) {
      const lines = renderRegisteredWidget(ctx, width, 200);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
    }
    widget.dispose();
  });

  test("measures ANSI output by visible width", () => {
    const ansiTheme: Theme = {
      fg: (_color, text) => `\x1b[31m${text}\x1b[39m`,
      bold: (text) => `\x1b[1m${text}\x1b[22m`,
    };
    const lines = new ChainWidget().renderLines(
      longLabelSnapshot,
      ansiTheme,
      40,
    );
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
    expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
  });

  test("renderLines returns empty array for empty snapshot", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(makeSnapshot(), mockTheme(), 100);
    expect(lines).toHaveLength(0);
  });
});
