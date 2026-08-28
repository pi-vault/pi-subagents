/**
 * conversation-viewer.ts — Live conversation overlay for viewing agent sessions.
 *
 * Displays a scrollable, live-updating view of an agent's conversation.
 * Subscribes to session events for real-time streaming updates.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  Input,
  isKeyRelease,
  type KeyId,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { AgentRecord } from "../shared/types.js";
import type { Theme } from "./agent-widget.js";
import {
  DASHBOARD_MAX_HEIGHT_RATIO,
  dashboardContentWidth,
  fitDashboardViewport,
  MIN_DASHBOARD_FRAME_WIDTH,
  renderDashboardFrame,
  renderDashboardTooSmall,
} from "./dashboard-style.js";
import { describeActivity, formatMs, formatTokens } from "./format.js";

const MIN_VIEWPORT = 3;
/** Height ceiling shared by the overlay's `maxHeight` and the viewer's internal viewport cap. */
export const VIEWPORT_HEIGHT_PCT = DASHBOARD_MAX_HEIGHT_RATIO * 100;

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

/** Structural subset of pi-tui's KeybindingsManager. */
export interface ViewerKeybindings {
  matches(data: string, keybinding: string): boolean;
}

interface ViewerKeys {
  scrollUp(data: string): boolean;
  scrollDown(data: string): boolean;
  pageUp(data: string): boolean;
  pageDown(data: string): boolean;
}

function createViewerKeys(keybindings?: ViewerKeybindings): ViewerKeys {
  const m = (data: string, id: string, fallback: KeyId): boolean =>
    keybindings ? keybindings.matches(data, id) : matchesKey(data, fallback);
  return {
    scrollUp: (data) => m(data, "tui.select.up", "up") || matchesKey(data, "k"),
    scrollDown: (data) => m(data, "tui.select.down", "down") || matchesKey(data, "j"),
    pageUp: (data) => m(data, "tui.select.pageUp", "pageUp") || matchesKey(data, "shift+up"),
    pageDown: (data) =>
      m(data, "tui.select.pageDown", "pageDown") || matchesKey(data, "shift+down"),
  };
}

export class ConversationViewer implements Component, Focusable {
  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private lastInnerW = 0;
  private closed = false;
  /** Two-press confirm guard for the stop key, so a stray key can't kill the agent. */
  private stopArmed = false;
  private keys: ViewerKeys;
  /** Steering composer — present while the user is typing a message to the agent. */
  private composer: Input | undefined;
  private _focused = false;

  constructor(
    private tui: TUI,
    private session: AgentSession,
    private record: AgentRecord,
    private theme: Theme,
    private done: (result: undefined) => void,
    /** Abort the agent shown here. Omitted → no stop affordance (e.g. read-only history). */
    private onStop?: () => void,
    /** User keybindings from `ctx.ui.custom()`. Omitted → hardcoded defaults. */
    keybindings?: ViewerKeybindings,
    /** Send a steering message to the agent. Omitted → no compose affordance. */
    private onSteer?: (message: string) => void,
  ) {
    this.keys = createViewerKeys(keybindings);
    this.unsubscribe = session.subscribe(() => {
      if (this.closed) return;
      this.tui.requestRender();
    });
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (this.composer) this.composer.focused = value;
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    if (this.closed) return;

    // While composing a steer message, the input owns all keys (Enter sends,
    // Esc cancels — both wired in openComposer()). Editing keys flow through.
    if (this.composer) {
      this.composer.handleInput(data);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    // Enter opens the steering composer (only while the agent can still be
    // steered) — then type + Enter sends, Esc or an empty submit returns. When
    // not steerable, fall through so the key still disarms a pending stop.
    if (matchesKey(data, "enter") && this.canSteer()) {
      this.stopArmed = false;
      this.openComposer();
      return;
    }

    // Stop/abort the agent (only while it can still be stopped). Two-press:
    // first "x" arms, second confirms — any other key disarms.
    if (matchesKey(data, "x")) {
      if (this.isStoppable()) {
        if (this.stopArmed) {
          this.stopArmed = false;
          this.onStop?.();
        } else {
          this.stopArmed = true;
        }
        this.tui.requestRender();
      }
      return;
    }
    if (this.stopArmed) this.stopArmed = false;

    const viewportHeight = this.viewportHeight();
    const totalLines = this.buildContentLines(this.lastInnerW).length;
    const maxScroll = Math.max(0, totalLines - viewportHeight);

    if (this.keys.scrollUp(data)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (this.keys.scrollDown(data)) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (this.keys.pageUp(data)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - viewportHeight);
      this.autoScroll = false;
    } else if (this.keys.pageDown(data)) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewportHeight);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey(data, "home")) {
      this.scrollOffset = 0;
      this.autoScroll = false;
    } else if (matchesKey(data, "end")) {
      this.scrollOffset = maxScroll;
      this.autoScroll = true;
    }
  }

  render(width: number): string[] {
    const targetRows = this.targetRows();
    if (width < MIN_DASHBOARD_FRAME_WIDTH || targetRows < this.chromeLines() + MIN_VIEWPORT) {
      return renderDashboardTooSmall(width, targetRows, this.theme);
    }

    const th = this.theme;
    const innerW = dashboardContentWidth(width);
    this.lastInnerW = innerW;
    const statusIcon =
      this.record.status === "running"
        ? th.fg("accent", "●")
        : this.record.status === "completed"
          ? th.fg("success", "✓")
          : this.record.status === "error"
            ? th.fg("error", "✗")
            : th.fg("dim", "○");
    const duration = this.record.completedAt
      ? formatMs(this.record.completedAt - this.record.startedAt)
      : `${formatMs(Date.now() - this.record.startedAt)} (running)`;
    const headerParts: string[] = [duration];
    if (this.record.toolUses > 0) {
      headerParts.unshift(`${this.record.toolUses} tool${this.record.toolUses === 1 ? "" : "s"}`);
    }
    const tokens =
      this.record.lifetimeUsage.inputTokens +
      this.record.lifetimeUsage.outputTokens +
      this.record.lifetimeUsage.cacheWriteTokens;
    if (tokens > 0) headerParts.push(formatTokens(tokens));
    const header = `${statusIcon} ${th.bold(this.record.type)}  ${th.fg("muted", this.record.description)} ${th.fg("dim", "•")} ${th.fg("dim", headerParts.join(" • "))}`;

    const contentLines = this.buildContentLines(innerW);
    const viewportHeight = this.viewportHeight();
    if (this.autoScroll) this.scrollOffset = Math.max(0, contentLines.length - viewportHeight);
    const viewport = fitDashboardViewport(
      contentLines,
      undefined,
      viewportHeight,
      this.scrollOffset,
    );
    this.scrollOffset = viewport.offset;

    const scrollPct =
      contentLines.length <= viewportHeight
        ? "100%"
        : `${Math.round(((viewport.offset + viewportHeight) / contentLines.length) * 100)}%`;
    const sep = th.fg("dim", " • ");
    const actions: string[] = [];
    if (this.canSteer()) actions.push(th.fg("dim", "Enter Steer"));
    if (this.isStoppable()) {
      actions.push(this.stopArmed ? th.fg("error", "x Again to STOP") : th.fg("dim", "x Stop"));
    }
    const footerRight = th.fg("dim", "↑/↓ Scroll • PgUp/PgDn or Shift+↑/↓ • Esc Close");
    const withCount = [
      th.fg("dim", `${contentLines.length} lines • ${scrollPct}`),
      ...actions,
    ].join(sep);
    const footerLeft =
      visibleWidth(withCount) + visibleWidth(footerRight) + 1 <= innerW
        ? withCount
        : actions.join(sep);
    const idleFooter =
      footerLeft +
      " ".repeat(Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight))) +
      footerRight;

    return renderDashboardFrame(
      [
        header,
        "",
        ...viewport.lines,
        ...(this.composer
          ? [
              th.fg("accent", "Steer agent"),
              this.composer.render(innerW)[0] ?? "",
              th.fg("dim", "Enter Send • Esc Cancel"),
            ]
          : ["", idleFooter]),
      ],
      width,
      th,
    );
  }

  /** Stoppable only when a stop handler exists and the agent is still active. */
  private isStoppable(): boolean {
    return !!this.onStop && (this.record.status === "running" || this.record.status === "queued");
  }

  /** Steerable only when a steer handler exists and the agent is still active. */
  private canSteer(): boolean {
    return !!this.onSteer && (this.record.status === "running" || this.record.status === "queued");
  }

  /** Open the inline steering composer and route subsequent input to it. */
  private openComposer(): void {
    const input = new Input();
    input.focused = this._focused;
    input.onSubmit = (value: string) => {
      const message = value.trim();
      this.closeComposer();
      if (message) this.onSteer?.(message);
    };
    input.onEscape = () => this.closeComposer();
    this.composer = input;
    this.tui.requestRender();
  }

  invalidate(): void {
    /* no cached state to clear */
  }

  dispose(): void {
    this.closed = true;
    this._focused = false;
    this.closeComposer();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  // ---- Private ----

  private closeComposer(): void {
    if (!this.composer) return;
    this.composer.focused = false;
    this.composer.onSubmit = undefined;
    this.composer.onEscape = undefined;
    this.composer = undefined;
  }

  private targetRows(): number {
    return Math.max(1, Math.floor(this.tui.terminal.rows * DASHBOARD_MAX_HEIGHT_RATIO));
  }

  private viewportHeight(): number {
    return Math.max(MIN_VIEWPORT, this.targetRows() - this.chromeLines());
  }

  private chromeLines(): number {
    return 8 + (this.composer ? 1 : 0);
  }

  private buildContentLines(width: number): string[] {
    if (width <= 0) return [];

    const th = this.theme;
    const messages = this.session.messages;
    const lines: string[] = [];

    if (messages.length === 0) {
      lines.push(th.fg("dim", "(waiting for first message...)"));
      return lines;
    }

    let needsSeparator = false;
    for (const msg of messages) {
      if (msg.role === "user") {
        const text = extractText(msg.content);
        if (!text.trim()) continue;
        if (needsSeparator) lines.push(th.fg("dim", "───"));
        lines.push(th.fg("accent", "[User]"));
        for (const line of wrapTextWithAnsi(text.trim(), width)) {
          lines.push(line);
        }
      } else if (msg.role === "assistant") {
        const textParts: string[] = [];
        const toolCalls: string[] = [];
        for (const c of msg.content) {
          if (c.type === "text" && c.text) textParts.push(c.text);
          else if (c.type === "toolCall") {
            toolCalls.push(c.name);
          }
        }
        if (needsSeparator) lines.push(th.fg("dim", "───"));
        lines.push(th.bold("[Assistant]"));
        if (textParts.length > 0) {
          for (const line of wrapTextWithAnsi(textParts.join("\n").trim(), width)) {
            lines.push(line);
          }
        }
        for (const name of toolCalls) {
          lines.push(truncateToWidth(th.fg("muted", `  [Tool: ${name}]`), width));
        }
      } else if (msg.role === "toolResult") {
        const text = extractText(msg.content);
        const truncated = text.length > 500 ? `${text.slice(0, 500)}... (truncated)` : text;
        if (!truncated.trim()) continue;
        if (needsSeparator) lines.push(th.fg("dim", "───"));
        lines.push(th.fg("dim", "[Result]"));
        for (const line of wrapTextWithAnsi(truncated.trim(), width)) {
          lines.push(th.fg("dim", line));
        }
      } else if (msg.role === "bashExecution") {
        if (needsSeparator) lines.push(th.fg("dim", "───"));
        lines.push(truncateToWidth(th.fg("muted", `  $ ${msg.command}`), width));
        if (msg.output?.trim()) {
          const out =
            msg.output.length > 500 ? `${msg.output.slice(0, 500)}... (truncated)` : msg.output;
          for (const line of wrapTextWithAnsi(out.trim(), width)) {
            lines.push(th.fg("dim", line));
          }
        }
      } else {
        continue;
      }
      needsSeparator = true;
    }

    // Streaming indicator for running agents
    if (this.record.status === "running") {
      const act = describeActivity(this.record.live.activeTools, this.record.live.responseText);
      lines.push("");
      lines.push(truncateToWidth(th.fg("accent", "▍ ") + th.fg("dim", act), width));
    }

    return lines.map((l) => truncateToWidth(l, width));
  }
}
