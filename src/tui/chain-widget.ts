/**
 * chain-widget.ts — Persistent widget showing chain execution progress above the editor.
 *
 * Follows the same lifecycle and rendering pattern as AgentWidget:
 * - setUICtx() to receive the TUI context
 * - update(snapshot) to push new state and trigger re-render
 * - clear() to remove the widget
 * - dispose() to clean up resources
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme, UICtx } from "./agent-widget.js";
import { fitDashboardViewport } from "./dashboard-style.js";
import type {
  WorkflowGraphSnapshot,
  WorkflowNodeStatus,
} from "../shared/types.js";
import { SPINNER } from "./format.js";

const WIDGET_KEY = "chain";
const MAX_WIDGET_LINES = 12;
const MAX_BODY_LINES = MAX_WIDGET_LINES - 2;

function statusIcon(
  status: WorkflowNodeStatus,
  theme: Theme,
  frame?: string,
): string {
  switch (status) {
    case "completed":
      return theme.fg("success", "✓");
    case "running":
      return theme.fg("accent", frame ?? "●");
    case "failed":
      return theme.fg("error", "✗");
    case "skipped":
      return theme.fg("dim", "–");
    case "paused":
      return theme.fg("warning", "‖");
    case "stopped":
      return theme.fg("dim", "■");
    default:
      return theme.fg("dim", "○");
  }
}

export class ChainWidget {
  private uiCtx: UICtx | undefined;
  private snapshot: WorkflowGraphSnapshot | null = null;
  private widgetRegistered = false;
  // biome-ignore lint/suspicious/noExplicitAny: tui type is unavoidably any
  private tui: any | undefined;
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | undefined;

  setUICtx(ctx: UICtx): void {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
    }
  }

  update(snapshot: WorkflowGraphSnapshot): void {
    this.snapshot = snapshot;
    if (snapshot.nodes.length > 0) {
      this.ensureTimer();
    }
    this.render();
  }

  clear(): void {
    this.snapshot = null;
    if (this.uiCtx) {
      this.uiCtx.setWidget(WIDGET_KEY, undefined);
      this.widgetRegistered = false;
      this.tui = undefined;
    }
    this.stopTimer();
  }

  dispose(): void {
    this.clear();
    this.uiCtx = undefined;
  }

  /** Exposed for testing — renders snapshot to themed lines without needing UICtx. */
  renderLines(
    snapshot: WorkflowGraphSnapshot,
    theme: Theme,
    width: number,
  ): string[] {
    const total = snapshot.nodes.length;
    if (total === 0) return [];

    const safeWidth = Math.max(0, Math.floor(width));
    const spinnerFrame = SPINNER[this.frame % SPINNER.length]!;
    const bodyRows: Array<{ nodeId: string; text: string }> = [];

    for (let i = 0; i < total; i++) {
      const node = snapshot.nodes[i]!;
      const prefix = theme.fg("dim", "│");
      const idx = theme.fg("dim", `[${(node.stepIndex ?? i) + 1}/${total}]`);
      const icon = statusIcon(node.status, theme, spinnerFrame);

      if (
        node.kind === "parallel-group" ||
        node.kind === "dynamic-parallel-group"
      ) {
        bodyRows.push({
          nodeId: node.id,
          text: `${prefix} ${idx} ${icon} ${theme.bold(node.label)}`,
        });
        const children = node.children ?? [];
        for (let c = 0; c < children.length; c++) {
          const child = children[c]!;
          const connector = c === children.length - 1 ? "└─" : "├─";
          const childIcon = statusIcon(child.status, theme, spinnerFrame);
          let text = `${prefix}   ${theme.fg("dim", connector)} ${childIcon} ${child.label}`;
          if (child.error) text += ` ${theme.fg("error", `(${child.error})`)}`;
          bodyRows.push({ nodeId: child.id, text });
        }
      } else {
        let text = `${prefix} ${idx} ${icon} ${node.label}`;
        if (node.phase) text += ` ${theme.fg("dim", `(${node.phase})`)}`;
        if (node.error) text += ` ${theme.fg("error", node.error)}`;
        bodyRows.push({ nodeId: node.id, text });
      }
    }

    const selectedRow = bodyRows.findIndex(
      (row) => row.nodeId === snapshot.currentNodeId,
    );
    const bodyHeight = Math.min(bodyRows.length, MAX_BODY_LINES);
    const viewport = fitDashboardViewport(
      bodyRows.map((row) => row.text),
      selectedRow < 0 ? undefined : selectedRow,
      bodyHeight,
      0,
    );
    const hiddenRows = bodyRows.length - viewport.lines.length;
    const totals = [
      "completed",
      "running",
      "pending",
      "failed",
      "paused",
      "skipped",
      "stopped",
    ].flatMap((status) => {
      const count = snapshot.nodes.filter((node) => node.status === status).length;
      return count === 0 ? [] : [`${count} ${status}`];
    });
    if (hiddenRows > 0) totals.push(`+${hiddenRows} more`);

    const hasRunning = snapshot.nodes.some(
      (node) =>
        node.status === "running" ||
        node.children?.some((child) => child.status === "running"),
    );
    const lines = [
      theme.fg(
        hasRunning ? "accent" : "dim",
        `╭─ ✦ CHAIN · ${snapshot.runId}`,
      ),
      ...viewport.lines,
      `${theme.fg("dim", "╰─")} ${theme.fg("dim", totals.join(" · "))}`,
    ];
    return lines.map((line) =>
      truncateToWidth(line.replace(/[\r\n]+/g, " "), safeWidth, ""),
    );
  }

  private render(): void {
    if (!this.uiCtx) return;
    if (!this.snapshot || this.snapshot.nodes.length === 0) {
      if (this.widgetRegistered) {
        this.uiCtx.setWidget(WIDGET_KEY, undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      this.stopTimer();
      return;
    }

    this.frame++;

    if (!this.widgetRegistered) {
      this.uiCtx.setWidget(
        WIDGET_KEY,
        (tui, theme) => {
          this.tui = tui;
          return {
            render: (width) => {
              if (!this.snapshot) return [];
              return this.renderLines(this.snapshot, theme, width);
            },
            invalidate: () => {
              // Theme changed — force re-registration on next render.
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

  private ensureTimer(): void {
    if (!this.interval) {
      this.interval = setInterval(() => this.render(), 80);
    }
  }

  private stopTimer(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}
