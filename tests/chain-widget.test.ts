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

function mockUICtx(): UICtx & {
  widgets: Map<string, unknown>;
  statuses: Map<string, string | undefined>;
} {
  const widgets = new Map<string, unknown>();
  const statuses = new Map<string, string | undefined>();
  return {
    widgets,
    statuses,
    setWidget(key, content) {
      widgets.set(key, content);
    },
    setStatus(key, text) {
      statuses.set(key, text);
    },
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

  test("renderLines produces correct output for sequential steps", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "step",
            agent: "scout",
            label: "Scan files",
            status: "completed",
            flatIndex: 0,
            stepIndex: 0,
          },
          {
            id: "step-1",
            kind: "step",
            agent: "planner",
            label: "Create plan",
            status: "running",
            flatIndex: 1,
            stepIndex: 1,
          },
          {
            id: "step-2",
            kind: "step",
            agent: "coder",
            label: "Implement",
            status: "pending",
            flatIndex: 2,
            stepIndex: 2,
          },
        ],
      }),
      mockTheme(),
    );

    expect(lines.length).toBeGreaterThanOrEqual(4); // heading + 3 steps
    expect(lines[0]).toContain("Chain");
    expect(lines[1]).toContain("Scan files");
    expect(lines[2]).toContain("Create plan");
    expect(lines[3]).toContain("Implement");
  });

  test("renderLines handles parallel groups with children", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
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
                agent: "worker-a",
                label: "Worker A",
                status: "completed",
                flatIndex: 0,
                stepIndex: 0,
              },
              {
                id: "step-0-agent-1",
                kind: "agent",
                agent: "worker-b",
                label: "Worker B",
                status: "running",
                flatIndex: 1,
                stepIndex: 0,
              },
            ],
          },
        ],
      }),
      mockTheme(),
    );

    expect(lines.some((l) => l.includes("Parallel group"))).toBe(true);
    expect(lines.some((l) => l.includes("Worker A"))).toBe(true);
    expect(lines.some((l) => l.includes("Worker B"))).toBe(true);
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
    );

    expect(lines.some((l) => l.includes("Setup"))).toBe(true);
  });

  test("renderLines returns empty array for empty snapshot", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(makeSnapshot(), mockTheme());
    expect(lines).toHaveLength(0);
  });
});
