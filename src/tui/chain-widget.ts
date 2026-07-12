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
import type {
  WorkflowGraphNode,
  WorkflowGraphSnapshot,
  WorkflowNodeStatus,
} from "../shared/types.js";
import { SPINNER } from "./format.js";

const WIDGET_KEY = "chain";

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
  renderLines(snapshot: WorkflowGraphSnapshot, theme: Theme): string[] {
    const total = snapshot.nodes.length;
    if (total === 0) return [];

    const spinnerFrame = SPINNER[this.frame % SPINNER.length]!;
    const hasRunning = snapshot.nodes.some(
      (n) =>
        n.status === "running" ||
        n.children?.some((c) => c.status === "running"),
    );
    const headingIcon = hasRunning
      ? theme.fg("accent", "●")
      : theme.fg("dim", "○");
    const headingColor = hasRunning ? "accent" : "dim";

    const lines: string[] = [
      `${headingIcon} ${theme.fg(headingColor, "Chain")} ${theme.fg("dim", snapshot.runId)}`,
    ];

    for (let i = 0; i < total; i++) {
      const node = snapshot.nodes[i]!;
      const connector = i === total - 1 ? "└─" : "├─";
      const prefix = theme.fg("dim", connector);
      const idx = theme.fg("dim", `[${(node.stepIndex ?? i) + 1}/${total}]`);
      const icon = statusIcon(node.status, theme, spinnerFrame);

      if (
        node.kind === "parallel-group" ||
        node.kind === "dynamic-parallel-group"
      ) {
        lines.push(`${prefix} ${idx} ${icon} ${theme.bold(node.label)}`);
        const children = node.children ?? [];
        for (let c = 0; c < children.length; c++) {
          const child = children[c]!;
          const childConnector = c === children.length - 1 ? "└─" : "├─";
          const indent =
            i === total - 1 ? "   " : theme.fg("dim", "│  ");
          const childIcon = statusIcon(child.status, theme, spinnerFrame);
          let childLine = `${indent}${theme.fg("dim", childConnector)} ${childIcon} ${child.label}`;
          if (child.error) childLine += ` ${theme.fg("error", `(${child.error})`)}`;
          lines.push(childLine);
        }
      } else {
        let line = `${prefix} ${idx} ${icon} ${node.label}`;
        if (node.phase) line += ` ${theme.fg("dim", `(${node.phase})`)}`;
        if (node.error) line += ` ${theme.fg("error", node.error)}`;
        lines.push(line);
      }
    }

    return lines;
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
            render: () => {
              if (!this.snapshot) return [];
              const w = tui.terminal.columns;
              return this.renderLines(this.snapshot, theme).map((l) =>
                truncateToWidth(l, w),
              );
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
