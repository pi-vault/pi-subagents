import { describe, expect, it, vi } from "vitest";
import type { AgentActivity } from "../src/tui/activity.js";
import {
  AgentWidget,
  ERROR_STATUSES,
  type Theme,
  renderFinishedLine,
} from "../src/tui/agent-widget.js";
import type { AgentManager } from "../src/core/agent-manager.js";
import type { AgentRecord } from "../src/shared/types.js";

// ---- Helpers ----

const makeMockTheme = (): Theme => ({
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
});

function makeMockUICtx() {
  return {
    setStatus: vi.fn(),
    setWidget: vi.fn(),
  };
}

function makeMockManager(agents: AgentRecord[]): AgentManager {
  return { listAgents: () => agents } as unknown as AgentManager;
}

/** Minimal valid AgentRecord for tests. */
function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    type: "scout",
    description: "do the thing",
    status: "running",
    toolUses: 0,
    turnCount: 0,
    live: { activeTools: [], responseText: "" },
    startedAt: Date.now() - 5000,
    lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    ...overrides,
  };
}

/** Invoke the registered widget factory and call render(). */
function captureRender(
  ctx: ReturnType<typeof makeMockUICtx>,
  theme: Theme,
  columns = 200,
): string[] {
  const calls = ctx.setWidget.mock.calls as Array<
    [string, ((tui: unknown, theme: Theme) => { render(): string[] }) | undefined, unknown]
  >;
  const factory = calls.find(([key]) => key === "agents")?.[1];
  if (!factory) return [];
  const mockTui = { terminal: { columns }, requestRender: vi.fn() };
  return factory(mockTui, theme).render();
}

// ---- ERROR_STATUSES ----

describe("ERROR_STATUSES", () => {
  it("contains error, aborted, steered, stopped", () => {
    expect(ERROR_STATUSES.has("error")).toBe(true);
    expect(ERROR_STATUSES.has("aborted")).toBe(true);
    expect(ERROR_STATUSES.has("steered")).toBe(true);
    expect(ERROR_STATUSES.has("stopped")).toBe(true);
  });

  it("does not contain completed", () => {
    expect(ERROR_STATUSES.has("completed")).toBe(false);
  });
});

// ---- renderFinishedLine ----

describe("renderFinishedLine", () => {
  const BASE = {
    id: "a1",
    type: "scout",
    description: "scan repo",
    toolUses: 0,
    startedAt: 1000,
    completedAt: 6000, // 5.0s duration
  };

  it("completed: contains ✓, description, and formatted duration", () => {
    const line = renderFinishedLine({ ...BASE, status: "completed" }, undefined, makeMockTheme());
    expect(line).toContain("✓");
    expect(line).toContain("scan repo");
    expect(line).toContain("5.0s");
  });

  it("error: contains ✗ and error message", () => {
    const line = renderFinishedLine(
      { ...BASE, status: "error", error: "connection refused" },
      undefined,
      makeMockTheme(),
    );
    expect(line).toContain("✗");
    expect(line).toContain("connection refused");
  });

  it("steered: contains ✓ and (turn limit)", () => {
    const line = renderFinishedLine({ ...BASE, status: "steered" }, undefined, makeMockTheme());
    expect(line).toContain("✓");
    expect(line).toContain("(turn limit)");
  });

  it("stopped: contains ■", () => {
    const line = renderFinishedLine({ ...BASE, status: "stopped" }, undefined, makeMockTheme());
    expect(line).toContain("■");
  });

  it("aborted: contains ✗ and aborted", () => {
    const line = renderFinishedLine({ ...BASE, status: "aborted" }, undefined, makeMockTheme());
    expect(line).toContain("✗");
    expect(line).toContain("aborted");
  });

  it("includes turn count from activity when provided", () => {
    const activity: AgentActivity = {
      activeTools: new Map(),
      toolUses: 0,
      responseText: "",
      turnCount: 5,
      maxTurns: 30,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    };
    const line = renderFinishedLine({ ...BASE, status: "completed" }, activity, makeMockTheme());
    expect(line).toContain("↻5≤30");
  });

  it("includes tool use count in stats", () => {
    const line = renderFinishedLine(
      { ...BASE, status: "completed", toolUses: 3 },
      undefined,
      makeMockTheme(),
    );
    expect(line).toContain("3 tool uses");
  });

  it("shows singular tool use when count is 1", () => {
    const line = renderFinishedLine(
      { ...BASE, status: "completed", toolUses: 1 },
      undefined,
      makeMockTheme(),
    );
    expect(line).toContain("1 tool use");
    expect(line).not.toContain("1 tool uses");
  });

  it("uses completedAt for duration when available", () => {
    const line = renderFinishedLine(
      { ...BASE, status: "completed", startedAt: 0, completedAt: 10_000 },
      undefined,
      makeMockTheme(),
    );
    expect(line).toContain("10.0s");
  });

  it("shows agent type as display name", () => {
    const line = renderFinishedLine(
      { ...BASE, type: "my-custom-agent", status: "completed" },
      undefined,
      makeMockTheme(),
    );
    expect(line).toContain("my-custom-agent");
  });
});

// ---- AgentWidget ----

describe("AgentWidget.markFinished", () => {
  it("subsequent calls for same agent are no-ops (age stays 0)", () => {
    const agent = makeRecord({ id: "fin", status: "completed", completedAt: Date.now() - 1000 });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);

    widget.markFinished("fin");
    widget.markFinished("fin"); // no-op

    widget.update();
    // Widget registers — agent is still visible (age=0 < maxAge=1)
    expect(ctx.setWidget).toHaveBeenCalledWith("agents", expect.any(Function), {
      placement: "aboveEditor",
    });
  });
});

describe("AgentWidget.setUICtx", () => {
  it("resets widgetRegistered when ctx changes, causing re-registration on next update", () => {
    const agent = makeRecord({ status: "running" });
    const manager = makeMockManager([agent]);
    const ctx1 = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());

    widget.setUICtx(ctx1);
    widget.update(); // registers on ctx1
    expect(ctx1.setWidget).toHaveBeenCalledTimes(1);

    const ctx2 = makeMockUICtx();
    widget.setUICtx(ctx2); // resets widgetRegistered
    widget.update(); // re-registers on ctx2
    expect(ctx2.setWidget).toHaveBeenCalledTimes(1);
    expect(ctx2.setWidget).toHaveBeenCalledWith("agents", expect.any(Function), {
      placement: "aboveEditor",
    });
  });

  it("calling setUICtx with the same ctx is a no-op", () => {
    const agent = makeRecord({ status: "running" });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());

    widget.setUICtx(ctx);
    widget.update(); // registers once

    widget.setUICtx(ctx); // same ctx — no reset
    widget.update(); // already registered, no new setWidget call
    expect(ctx.setWidget).toHaveBeenCalledTimes(1);
  });
});

describe("AgentWidget.onTurnStart", () => {
  it("ages finished agents by 1 per turn", () => {
    const agent = makeRecord({ id: "fin", status: "completed", completedAt: Date.now() - 1000 });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.markFinished("fin");
    widget.update(); // visible: age=0

    widget.onTurnStart(); // ages to 1 → completed maxAge=1 → 1 < 1 = false → widget clears
    expect(ctx.setWidget).toHaveBeenLastCalledWith("agents", undefined);
  });

  it("error agents survive the first onTurnStart", () => {
    const agent = makeRecord({ id: "err", status: "error", completedAt: Date.now() - 1000 });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.markFinished("err");
    widget.update(); // registers widget

    widget.onTurnStart(); // age=1, maxAge=2 → still visible
    // setWidget should NOT have been called with undefined yet
    const calls = ctx.setWidget.mock.calls as Array<[string, unknown]>;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).not.toEqual(["agents", undefined]);
  });

  it("error agents disappear after 2 onTurnStart calls", () => {
    const agent = makeRecord({ id: "err", status: "error", completedAt: Date.now() - 1000 });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.markFinished("err");
    widget.update();

    widget.onTurnStart(); // age=1 — still shows
    widget.onTurnStart(); // age=2 — 2 < 2 = false → clears
    expect(ctx.setWidget).toHaveBeenLastCalledWith("agents", undefined);
  });
});

describe("AgentWidget widget modes", () => {
  it("mode=off: update() never registers a widget", () => {
    const agent = makeRecord({ status: "running" });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map(), () => "off");
    widget.setUICtx(ctx);
    widget.update();

    // setWidget should not be called with a factory (agents hidden)
    const calls = ctx.setWidget.mock.calls as Array<[string, unknown]>;
    expect(calls.every(([, content]) => content === undefined)).toBe(true);
  });

  it("mode=background: excludes foreground agents (isBackground=false)", () => {
    const fg = makeRecord({ id: "fg", status: "running", isBackground: false });
    const bg = makeRecord({ id: "bg", status: "running", isBackground: true });
    const manager = makeMockManager([fg, bg]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map(), () => "background");
    widget.setUICtx(ctx);
    widget.update();

    // Only background agent shown → "1 running agent"
    expect(ctx.setStatus).toHaveBeenCalledWith("subagents", "1 running agent");
  });

  it("mode=background: includes agents with isBackground=undefined (unclassified)", () => {
    const unknown_ = makeRecord({ id: "u", status: "running", isBackground: undefined });
    const manager = makeMockManager([unknown_]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map(), () => "background");
    widget.setUICtx(ctx);
    widget.update();

    expect(ctx.setStatus).toHaveBeenCalledWith("subagents", "1 running agent");
  });

  it("mode=all: includes all agents regardless of isBackground flag", () => {
    const fg = makeRecord({ id: "fg", status: "running", isBackground: false });
    const bg = makeRecord({ id: "bg", status: "running", isBackground: true });
    const manager = makeMockManager([fg, bg]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map(), () => "all");
    widget.setUICtx(ctx);
    widget.update();

    expect(ctx.setStatus).toHaveBeenCalledWith("subagents", "2 running agents");
  });
});

describe("AgentWidget.update", () => {
  it("calls setWidget(undefined) when no visible agents remain", () => {
    let agents = [makeRecord({ status: "running" })];
    const manager = { listAgents: () => agents } as unknown as AgentManager;
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update(); // registers widget

    agents = [];
    widget.update(); // clears widget

    expect(ctx.setWidget).toHaveBeenLastCalledWith("agents", undefined);
  });

  it("only calls setStatus() when text changes", () => {
    const manager = makeMockManager([makeRecord({ status: "running" })]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);

    widget.update();
    widget.update(); // same state — no duplicate call

    expect(ctx.setStatus).toHaveBeenCalledTimes(1);
    expect(ctx.setStatus).toHaveBeenCalledWith("subagents", "1 running agent");
  });

  it("calls setStatus with undefined when agents finish and are no longer active", () => {
    let agents: AgentRecord[] = [makeRecord({ status: "running" })];
    const manager = { listAgents: () => agents } as unknown as AgentManager;
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update(); // sets status to "1 running agent"

    agents = []; // no agents
    widget.update(); // clears status

    expect(ctx.setStatus).toHaveBeenLastCalledWith("subagents", undefined);
  });

  it("does not call setStatus for finished-only agents (no active)", () => {
    const agent = makeRecord({ id: "fin", status: "completed", completedAt: Date.now() - 1000 });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.markFinished("fin");
    widget.setUICtx(ctx);
    widget.update();

    // Only finished agents — no setStatus call (hasActive=false, newStatusText=undefined,
    // lastStatusText is already undefined)
    expect(ctx.setStatus).not.toHaveBeenCalled();
  });

  it("uses plural for multiple running agents", () => {
    const manager = makeMockManager([
      makeRecord({ id: "a1", status: "running" }),
      makeRecord({ id: "a2", status: "running" }),
    ]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    expect(ctx.setStatus).toHaveBeenCalledWith("subagents", "2 running agents");
  });

  it("shows queued count in status text", () => {
    const manager = makeMockManager([
      makeRecord({ id: "r1", status: "running" }),
      makeRecord({ id: "q1", status: "queued" }),
    ]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    expect(ctx.setStatus).toHaveBeenCalledWith("subagents", "1 running, 1 queued agents");
  });
});

describe("AgentWidget renderWidget (via factory capture)", () => {
  it("heading line contains 'Agents'", () => {
    const agent = makeRecord({ status: "running" });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Agents");
  });

  it("heading uses ● when there are running agents", () => {
    const agent = makeRecord({ status: "running" });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme());
    expect(lines[0]).toContain("●");
  });

  it("heading uses ○ when only finished agents are visible", () => {
    const agent = makeRecord({ id: "fin", status: "completed", completedAt: Date.now() - 1000 });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.markFinished("fin");
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme());
    expect(lines[0]).toContain("○");
  });

  it("running agent lines include agent type as name", () => {
    const agent = makeRecord({ type: "researcher", status: "running" });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme());
    expect(lines.some((l) => l.includes("researcher"))).toBe(true);
  });

  it("running agent lines include description", () => {
    const agent = makeRecord({ description: "find all bugs", status: "running" });
    const manager = makeMockManager([agent]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme());
    expect(lines.some((l) => l.includes("find all bugs"))).toBe(true);
  });

  it("returns empty array when no agents", () => {
    const manager = makeMockManager([]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    // update() won't register a widget when empty, so factory won't exist
    widget.update();
    const lines = captureRender(ctx, makeMockTheme());
    expect(lines).toEqual([]);
  });

  it("shows queued count line", () => {
    const manager = makeMockManager([makeRecord({ id: "q1", status: "queued" })]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme());
    expect(lines.some((l) => l.includes("queued"))).toBe(true);
  });

  it("overflow: shows +N more line when body exceeds 11 lines", () => {
    // 7 running agents × 2 lines each = 14 body lines > 11 (MAX_WIDGET_LINES - 1 = 11)
    const agents = Array.from({ length: 7 }, (_, i) =>
      makeRecord({ id: `a${i}`, status: "running" }),
    );
    const manager = makeMockManager(agents);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager, new Map());
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme());
    expect(lines.some((l) => l.includes("more"))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(12); // MAX_WIDGET_LINES
  });
});
