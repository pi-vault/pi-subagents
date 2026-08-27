/**
 * agent-widget.ts — Persistent widget showing running/completed agents above the editor.
 *
 * Displays a tree of agents with animated spinners, live stats, and activity descriptions.
 * Uses the callback form of setWidget for themed rendering.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentManager } from "../core/agent-manager.js";
import type { AgentRecord, WidgetMode } from "../shared/types.js";
import { SPINNER, describeActivity, formatMs, formatTokens, formatTurns } from "./format.js";

// ---- Constants ----

/** Maximum number of rendered lines before overflow collapse kicks in. */
const MAX_WIDGET_LINES = 12;

/** Statuses that indicate an error/non-success outcome (used for linger behavior and icon rendering). */
export const ERROR_STATUSES = new Set(["error", "aborted", "steered", "stopped"]);

// ---- Types ----

export type Theme = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

export type UICtx = {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    // biome-ignore lint/suspicious/noExplicitAny: tui type is unavoidably any
    content: undefined | ((tui: any, theme: Theme) => { render(width: number): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
};

// ---- Helpers ----

/** Render a finished agent line. Exported for testability. */
export function renderFinishedLine(
  a: {
    id: string;
    type: string;
    status: string;
    description: string;
    toolUses: number;
    startedAt: number;
    completedAt?: number;
    error?: string;
  },
  theme: Theme,
): string {
  const name = a.type;
  const duration = formatMs((a.completedAt ?? Date.now()) - a.startedAt);

  let icon: string;
  let statusText: string;
  if (a.status === "completed") {
    icon = theme.fg("success", "✓");
    statusText = "";
  } else if (a.status === "steered") {
    icon = theme.fg("warning", "✓");
    statusText = theme.fg("warning", " (turn limit)");
  } else if (a.status === "stopped") {
    icon = theme.fg("dim", "■");
    statusText = theme.fg("dim", " stopped");
  } else if (a.status === "error") {
    icon = theme.fg("error", "✗");
    const errMsg = a.error ? `: ${a.error.slice(0, 60)}` : "";
    statusText = theme.fg("error", ` error${errMsg}`);
  } else {
    // aborted
    icon = theme.fg("error", "✗");
    statusText = theme.fg("warning", " aborted");
  }

  const parts: string[] = [];
  if (a.toolUses > 0) parts.push(`${a.toolUses} tool use${a.toolUses === 1 ? "" : "s"}`);
  parts.push(duration);

  return `${icon} ${theme.fg("dim", name)}  ${theme.fg("dim", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}${statusText}`;
}

// ---- Widget manager ----

export class AgentWidget {
  private uiCtx: UICtx | undefined;
  private widgetFrame = 0;
  private widgetInterval: ReturnType<typeof setInterval> | undefined;
  /** Tracks how many turns each finished agent has survived. Key: agent ID, Value: turns since finished. */
  private finishedTurnAge = new Map<string, number>();
  /** How many extra turns error/aborted agents linger (completed agents clear after 1 turn). */
  private static readonly ERROR_LINGER_TURNS = 2;

  /** Whether the widget callback is currently registered with the TUI. */
  private widgetRegistered = false;
  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  // biome-ignore lint/suspicious/noExplicitAny: tui type is unavoidably any
  private tui: any | undefined;
  /** Last status bar text, used to avoid redundant setStatus calls. */
  private lastStatusText: string | undefined;

  constructor(
    private manager: AgentManager,
    /**
     * Read live at render time. Selects which agents the widget shows — see WidgetMode.
     * Defaults to `"all"` when no policy is supplied.
     */
    private mode: () => WidgetMode = () => "all",
  ) {}

  /**
   * Agents eligible for the widget, per the current WidgetMode:
   *   - `off`: none
   *   - `background`: drop agents known to be foreground (isBackground === false)
   *   - `all`: every agent
   */
  private widgetAgents(): AgentRecord[] {
    const all = this.manager.listAgents();
    switch (this.mode()) {
      case "off":
        return [];
      case "background":
        return all.filter((a) => a.isBackground !== false);
      default:
        return all;
    }
  }

  /** Set the UI context (grabbed from first tool execution). */
  setUICtx(ctx: UICtx) {
    if (ctx !== this.uiCtx) {
      // UICtx changed — the widget registered on the old context is gone.
      // Force re-registration on next update().
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
    }
  }

  /**
   * Called on each new turn (tool_execution_start).
   * Ages finished agents and clears those that have lingered long enough.
   */
  onTurnStart() {
    for (const [id, age] of this.finishedTurnAge) {
      this.finishedTurnAge.set(id, age + 1);
    }
    this.update();
  }

  /** Ensure the widget update timer is running. */
  ensureTimer() {
    if (!this.widgetInterval) {
      this.widgetInterval = setInterval(() => this.update(), 80);
    }
  }

  /** Check if a finished agent should still be shown in the widget. */
  private shouldShowFinished(agentId: string, status: string): boolean {
    const age = this.finishedTurnAge.get(agentId) ?? 0;
    const maxAge = ERROR_STATUSES.has(status) ? AgentWidget.ERROR_LINGER_TURNS : 1;
    return age < maxAge;
  }

  /** Record an agent as finished (call when agent completes). */
  markFinished(agentId: string) {
    if (!this.finishedTurnAge.has(agentId)) {
      this.finishedTurnAge.set(agentId, 0);
    }
  }

  /** Render the widget content, reading live state on every render. */
  private renderWidget(width: number, theme: Theme): string[] {
    const allAgents = this.widgetAgents();
    const running = allAgents.filter((a) => a.status === "running");
    const queued = allAgents.filter((a) => a.status === "queued");
    const finished = allAgents.filter(
      (a) =>
        a.status !== "running" &&
        a.status !== "queued" &&
        a.completedAt &&
        this.shouldShowFinished(a.id, a.status),
    );
    const hasActive = running.length > 0 || queued.length > 0;

    if (!hasActive && finished.length === 0) return [];

    const safeWidth = Math.max(0, Math.floor(width));
    const truncate = (line: string) =>
      truncateToWidth(line.replace(/[\r\n]+/g, " "), safeWidth, "");
    const frame = SPINNER[this.widgetFrame % SPINNER.length];
    const maxBodyLines = MAX_WIDGET_LINES - 2;
    const body: string[] = [];
    let hiddenRunning = 0;
    let hiddenFinished = 0;

    for (const a of running) {
      if (body.length + 2 > maxBodyLines) {
        hiddenRunning++;
        continue;
      }
      const elapsed = formatMs(Date.now() - a.startedAt);
      const tokens =
        a.lifetimeUsage.inputTokens +
        a.lifetimeUsage.outputTokens +
        a.lifetimeUsage.cacheWriteTokens;
      const tokenText = tokens > 0 ? formatTokens(tokens) : "";
      const parts: string[] = [formatTurns(Math.max(1, a.turnCount), a.live.maxTurns)];
      if (a.toolUses > 0) {
        parts.push(`${a.toolUses} tool use${a.toolUses === 1 ? "" : "s"}`);
      }
      if (tokenText) parts.push(tokenText);
      parts.push(elapsed);

      body.push(
        truncate(
          `${theme.fg("dim", "│")} ${theme.fg("accent", frame)} ${theme.bold(a.type)}  ${theme.fg("muted", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}`,
        ),
        truncate(
          `${theme.fg("dim", "│   ⎿")} ${theme.fg("dim", describeActivity(a.live.activeTools, a.live.responseText))}`,
        ),
      );
    }

    for (const a of finished) {
      if (body.length === maxBodyLines) {
        hiddenFinished++;
        continue;
      }
      body.push(truncate(`${theme.fg("dim", "│")} ${renderFinishedLine(a, theme)}`));
    }

    const totals: string[] = [];
    if (running.length > 0) totals.push(`${running.length} running`);
    if (queued.length > 0) totals.push(`${queued.length} queued`);
    if (finished.length > 0) totals.push(`${finished.length} finished`);
    if (hiddenRunning + hiddenFinished > 0) {
      totals.push(`+${hiddenRunning + hiddenFinished} more`);
    }

    return [
      truncate(theme.fg(hasActive ? "accent" : "dim", "╭─ ✦ AGENTS")),
      ...body,
      truncate(`${theme.fg("dim", "╰─")} ${theme.fg("dim", totals.join(" · "))}`),
    ];
  }

  /** Force an immediate widget update. */
  update() {
    if (!this.uiCtx) return;
    const allAgents = this.widgetAgents();

    // Lightweight existence checks — full categorization happens in renderWidget()
    let runningCount = 0;
    let queuedCount = 0;
    let hasFinished = false;
    for (const a of allAgents) {
      if (a.status === "running") {
        runningCount++;
      } else if (a.status === "queued") {
        queuedCount++;
      } else if (a.completedAt && this.shouldShowFinished(a.id, a.status)) {
        hasFinished = true;
      }
    }
    const hasActive = runningCount > 0 || queuedCount > 0;

    // Nothing to show — clear widget
    if (!hasActive && !hasFinished) {
      if (this.widgetRegistered) {
        this.uiCtx.setWidget("agents", undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      if (this.lastStatusText !== undefined) {
        this.uiCtx.setStatus("subagents", undefined);
        this.lastStatusText = undefined;
      }
      if (this.widgetInterval) {
        clearInterval(this.widgetInterval);
        this.widgetInterval = undefined;
      }
      // Clean up stale entries
      for (const [id] of this.finishedTurnAge) {
        if (!allAgents.some((a) => a.id === id)) this.finishedTurnAge.delete(id);
      }
      return;
    }

    // Status bar — only call setStatus when the text actually changes
    let newStatusText: string | undefined;
    if (hasActive) {
      const statusParts: string[] = [];
      if (runningCount > 0) statusParts.push(`${runningCount} running`);
      if (queuedCount > 0) statusParts.push(`${queuedCount} queued`);
      const total = runningCount + queuedCount;
      newStatusText = `${statusParts.join(", ")} agent${total === 1 ? "" : "s"}`;
    }
    if (newStatusText !== this.lastStatusText) {
      this.uiCtx.setStatus("subagents", newStatusText);
      this.lastStatusText = newStatusText;
    }

    this.widgetFrame++;

    // Register widget callback once; subsequent updates use requestRender()
    // which re-invokes render() without replacing the component (avoids layout thrashing).
    if (!this.widgetRegistered) {
      this.uiCtx.setWidget(
        "agents",
        (tui, theme) => {
          this.tui = tui;
          return {
            render: (width) => this.renderWidget(width, theme),
            invalidate: () => {
              // Theme changed — force re-registration so factory captures fresh theme.
              this.widgetRegistered = false;
              this.tui = undefined;
            },
          };
        },
        { placement: "aboveEditor" },
      );
      this.widgetRegistered = true;
    } else {
      this.tui?.requestRender();
    }
  }

  dispose() {
    if (this.widgetInterval) {
      clearInterval(this.widgetInterval);
      this.widgetInterval = undefined;
    }
    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
    this.widgetRegistered = false;
    this.tui = undefined;
    this.lastStatusText = undefined;
  }
}
