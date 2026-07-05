/**
 * agent-widget.ts — Persistent widget showing running/completed agents above the editor.
 *
 * Displays a tree of agents with animated spinners, live stats, and activity descriptions.
 * Uses the callback form of setWidget for themed rendering.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentManager } from "../core/agent-manager.js";
import type { AgentRecord, WidgetMode } from "../shared/types.js";
import { type AgentActivity, getLifetimeTotal } from "./activity.js";
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
    content: undefined | ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
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
  activity: AgentActivity | undefined,
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
  if (activity) parts.push(formatTurns(activity.turnCount, activity.maxTurns));
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
    private agentActivity: Map<string, AgentActivity>,
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

  /**
   * Render the widget content. Called from the registered widget's render() callback,
   * reading live state each time instead of capturing it in a closure.
   */
  // biome-ignore lint/suspicious/noExplicitAny: tui type is unavoidably any
  private renderWidget(tui: any, theme: Theme): string[] {
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
    const hasFinished = finished.length > 0;

    // Nothing to show — return empty (widget will be unregistered by update())
    if (!hasActive && !hasFinished) return [];

    const w = tui.terminal.columns;
    const truncate = (line: string) => truncateToWidth(line, w);
    const headingColor = hasActive ? "accent" : "dim";
    const headingIcon = hasActive ? "●" : "○";
    const frame = SPINNER[this.widgetFrame % SPINNER.length];

    // Build sections separately for overflow-aware assembly.
    // Each running agent = 2 lines (header + activity), finished = 1 line, queued = 1 line.

    const finishedLines: string[] = [];
    for (const a of finished) {
      const activity = this.agentActivity.get(a.id);
      finishedLines.push(
        truncate(`${theme.fg("dim", "├─")} ${renderFinishedLine(a, activity, theme)}`),
      );
    }

    const runningLines: string[][] = []; // each entry is [header, activity]
    for (const a of running) {
      const name = a.type;
      const elapsed = formatMs(Date.now() - a.startedAt);

      const bg = this.agentActivity.get(a.id);
      const toolUses = bg?.toolUses ?? a.toolUses;
      const tokens = getLifetimeTotal(bg?.lifetimeUsage);
      const tokenText = tokens > 0 ? formatTokens(tokens) : "";

      const parts: string[] = [];
      if (bg) parts.push(formatTurns(bg.turnCount, bg.maxTurns));
      if (toolUses > 0) parts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
      if (tokenText) parts.push(tokenText);
      parts.push(elapsed);
      const statsText = parts.join(" · ");

      const activityDesc = bg ? describeActivity(bg.activeTools, bg.responseText) : "thinking…";

      runningLines.push([
        truncate(
          `${theme.fg("dim", "├─")} ${theme.fg("accent", frame)} ${theme.bold(name)}  ${theme.fg("muted", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", statsText)}`,
        ),
        truncate(theme.fg("dim", "│  ") + theme.fg("dim", `  ⎿  ${activityDesc}`)),
      ]);
    }

    const queuedLine =
      queued.length > 0
        ? truncate(
            `${theme.fg("dim", "├─")} ${theme.fg("muted", "◦")} ${theme.fg("dim", `${queued.length} queued`)}`,
          )
        : undefined;

    // Assemble with overflow cap (heading + overflow indicator = 2 reserved lines).
    const maxBody = MAX_WIDGET_LINES - 1; // heading takes 1 line
    const totalBody = finishedLines.length + runningLines.length * 2 + (queuedLine ? 1 : 0);

    const lines: string[] = [
      truncate(`${theme.fg(headingColor, headingIcon)} ${theme.fg(headingColor, "Agents")}`),
    ];

    if (totalBody <= maxBody) {
      // Everything fits — add all lines and fix up connectors for the last item.
      lines.push(...finishedLines);
      for (const pair of runningLines) lines.push(...pair);
      if (queuedLine) lines.push(queuedLine);

      // Fix last connector: swap ├─ → └─ and │ → space for activity lines.
      if (lines.length > 1) {
        const last = lines.length - 1;
        lines[last] = lines[last].replace("├─", "└─");
        // If last item is a running agent activity line, fix indent of that line
        // and fix the header line above it.
        if (runningLines.length > 0 && !queuedLine) {
          // The last two lines are the last running agent's header + activity.
          if (last >= 2) {
            lines[last - 1] = lines[last - 1].replace("├─", "└─");
            lines[last] = lines[last].replace("│  ", "   ");
          }
        }
      }
    } else {
      // Overflow — prioritize: running > queued > finished.
      // Reserve 1 line for overflow indicator.
      let budget = maxBody - 1;
      let hiddenRunning = 0;
      let hiddenFinished = 0;

      // 1. Running agents (2 lines each)
      for (const pair of runningLines) {
        if (budget >= 2) {
          lines.push(...pair);
          budget -= 2;
        } else {
          hiddenRunning++;
        }
      }

      // 2. Queued line
      if (queuedLine && budget >= 1) {
        lines.push(queuedLine);
        budget--;
      }

      // 3. Finished agents
      for (const fl of finishedLines) {
        if (budget >= 1) {
          lines.push(fl);
          budget--;
        } else {
          hiddenFinished++;
        }
      }

      // Overflow summary
      const overflowParts: string[] = [];
      if (hiddenRunning > 0) overflowParts.push(`${hiddenRunning} running`);
      if (hiddenFinished > 0) overflowParts.push(`${hiddenFinished} finished`);
      const overflowText = overflowParts.join(", ");
      lines.push(
        truncate(
          `${theme.fg("dim", "└─")} ${theme.fg("dim", `+${hiddenRunning + hiddenFinished} more (${overflowText})`)}`,
        ),
      );
    }

    return lines;
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
            render: () => this.renderWidget(tui, theme),
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
