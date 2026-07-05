# Phase 5: UI Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build four TUI components -- Agent Widget, Fleet List, Conversation Viewer, and enhanced notification renderer -- plus a live activity tracking infrastructure and settings extensions, so users see real-time agent status, can interactively browse conversations, and steer/stop agents.

**Reference:** `tintinweb-pi-subagents` at `/Users/lanh/Developer/pi-packages/tintinweb-pi-subagents` is the source-of-truth implementation. This plan ports its patterns to pi-subagents' architecture.

**Architecture:** Create an `AgentActivity` tracking system with `createActivityTracker()`. Create shared formatting utilities in `src/tui/format.ts`. Build three UI components: `AgentWidget` (persistent above-editor), `FleetList` (below-editor navigation), and `ConversationViewer` (full-screen overlay with steer/stop). Enhance the notification renderer. Extend settings for `widgetMode` and `fleetView`. Wire everything through `tool_execution_start` for UI context acquisition.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` (truncateToWidth, matchesKey, isKeyRelease, visibleWidth, wrapTextWithAnsi, Input, Component, TUI), `@earendil-works/pi-coding-agent` (AgentSession, ExtensionAPI, Theme), Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-4-ui-features-design.md`

**Prerequisite:** Phase 4 (Parallel Execution) must be complete.

---

## File Structure

| Action | File                                  | Responsibility                                                                                                        |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Create | `src/tui/format.ts`                   | Shared formatting utilities (`formatMs`, `formatTokens`, `formatTurns`, `describeActivity`, `statusIcon`, etc.)       |
| Create | `src/tui/activity.ts`                 | `AgentActivity` type + `createActivityTracker()` factory                                                              |
| Create | `src/tui/agent-widget.ts`             | Above-editor persistent agent status widget                                                                           |
| Create | `src/tui/fleet-list.ts`               | Below-editor agent navigation list                                                                                    |
| Create | `src/tui/conversation-viewer.ts`      | Full-screen overlay conversation viewer with steer/stop                                                               |
| Create | `src/tui/viewer-keys.ts`              | Viewer keybinding module (matchesKey-based)                                                                           |
| Create | `tests/format.test.ts`                | Formatting utility tests                                                                                              |
| Create | `tests/activity.test.ts`              | Activity tracker tests                                                                                                |
| Create | `tests/agent-widget.test.ts`          | Widget rendering tests                                                                                                |
| Create | `tests/fleet-list.test.ts`            | Fleet list rendering tests                                                                                            |
| Create | `tests/conversation-viewer.test.ts`   | Viewer rendering tests                                                                                                |
| Create | `tests/notification-renderer.test.ts` | Notification renderer tests                                                                                           |
| Modify | `src/shared/types.ts`                 | Add `description` to `AgentRecord`+`AgentInvocation`, `WidgetMode` type, extend `NotificationDetails` with `maxTurns` |
| Modify | `src/core/settings.ts`                | Add `widgetMode`, `fleetView` to `SubagentsSettings`                                                                  |
| Modify | `src/core/agent-manager.ts`           | Store `description` on spawn, add `onStart` callback typedef                                                          |
| Modify | `src/index.ts`                        | Wire all UI components, create activity trackers, capture `ctx.ui`, enhance notification renderer                     |
| Modify | `src/tui/agents-menu.ts`              | Add Widget Mode and Fleet View settings                                                                               |

---

### Task 5.1: Add types and extend AgentRecord

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `description` to `AgentInvocation` and `AgentRecord`**

The widget/fleet/viewer all need a short display label. Tintinweb stores this as `record.description`. Currently pi-subagents only has `invocation.task` (which is the full prompt).

`description` is optional. When the caller does not provide one, auto-generate it from the first line of the prompt, truncated to 80 characters. This keeps the tool schema backward-compatible and avoids forcing every spawn path to supply a label.

```typescript
// In AgentInvocation, add:
description?: string;  // Short display label; optional, auto-generated from prompt when absent

// In AgentRecord, add:
description: string;   // Always populated: caller-supplied or auto-generated from prompt
```

- [ ] **Step 2: Add `WidgetMode` type**

```typescript
export type WidgetMode = "all" | "background" | "off";
```

- [ ] **Step 3: Verify typecheck passes, commit**

---

### Task 5.2: Create shared formatting utilities

**Files:**

- Create: `src/tui/format.ts`
- Create: `tests/format.test.ts`

Reference: `tintinweb-pi-subagents/src/ui/agent-widget.ts` lines 93-204.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  formatMs,
  formatTokens,
  formatTurns,
  describeActivity,
  statusIcon,
} from "../src/tui/format.js";

describe("formatMs", () => {
  it("formats milliseconds to seconds", () => {
    expect(formatMs(11_200)).toBe("11.2s");
  });
  it("formats sub-second", () => {
    expect(formatMs(500)).toBe("0.5s");
  });
});

describe("formatTokens", () => {
  it("formats small numbers", () => {
    expect(formatTokens(500)).toBe("500 token");
  });
  it("formats thousands", () => {
    expect(formatTokens(12_300)).toBe("12.3k token");
  });
  it("formats millions", () => {
    expect(formatTokens(1_200_000)).toBe("1.2M token");
  });
});

describe("formatTurns", () => {
  it("without max", () => {
    expect(formatTurns(5)).toBe("↻5");
  });
  it("with max", () => {
    expect(formatTurns(5, 30)).toBe("↻5≤30");
  });
});

describe("describeActivity", () => {
  it("returns thinking when no tools active", () => {
    expect(describeActivity(new Map())).toBe("thinking...");
  });
  it("shows tool action", () => {
    const tools = new Map([["read_1", "read"]]);
    expect(describeActivity(tools)).toBe("reading...");
  });
  it("groups multiple same-tool", () => {
    const tools = new Map([
      ["read_1", "read"],
      ["read_2", "read"],
    ]);
    expect(describeActivity(tools)).toBe("reading 2 files...");
  });
  it("joins different tools", () => {
    const tools = new Map([
      ["read_1", "read"],
      ["edit_1", "edit"],
    ]);
    expect(describeActivity(tools)).toBe("reading, editing...");
  });
  it("falls back to response text", () => {
    expect(describeActivity(new Map(), "I will search the code")).toBe(
      "I will search the code",
    );
  });
});

describe("statusIcon", () => {
  it("returns spinner frame for running", () => {
    const result = statusIcon("running");
    expect(result.icon).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  });
  it("returns checkmark for completed", () => {
    expect(statusIcon("completed").icon).toBe("✓");
  });
  it("returns x for error", () => {
    expect(statusIcon("error").icon).toBe("✗");
  });
});
```

- [ ] **Step 2: Implement format utilities**

Port from `tintinweb-pi-subagents/src/ui/agent-widget.ts` (lines 93-204). Key functions:

```typescript
// src/tui/format.ts

/** Braille spinner frames. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Tool name → human-readable action for built-in tools.
 *  Non-built-in tools fall back to the raw tool name via `TOOL_DISPLAY[name] ?? name`
 *  in describeActivity(). This matches tintinweb's behavior.
 */
const TOOL_DISPLAY: Record<string, string> = {
  read: "reading",
  bash: "running command",
  edit: "editing",
  write: "writing",
  grep: "searching",
  find: "finding files",
  ls: "listing",
};

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDuration(
  startedAt: number,
  completedAt?: number,
): string {
  if (completedAt) return formatMs(completedAt - startedAt);
  return `${formatMs(Date.now() - startedAt)} (running)`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
  return `${count} token`;
}

export function formatTurns(
  turnCount: number,
  maxTurns?: number | null,
): string {
  return maxTurns != null ? `↻${turnCount}≤${maxTurns}` : `↻${turnCount}`;
}

export function describeActivity(
  activeTools: Map<string, string>,
  responseText?: string,
): string {
  // Group concurrent tools by action name, format as "reading 2 files, editing..."
  // Fall back to truncated responseText, then "thinking..."
  // Port from tintinweb lines 179-204
}

export function statusIcon(
  status: string,
  frame?: number,
): { icon: string; colorKey: string } {
  // Map status → icon + theme color key
  // Port from tintinweb widget renderFinishedLine pattern
}
```

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.3: Create AgentActivity tracking

**Files:**

- Create: `src/tui/activity.ts`
- Create: `tests/activity.test.ts`

Reference: `tintinweb-pi-subagents/src/index.ts` lines 82-123.

This is the **backbone of live UI updates**. Every agent spawn creates an activity tracker that feeds the widget and fleet with real-time data.

- [ ] **Step 1: Write failing tests**

Test that `createActivityTracker()`:

- Returns `state` with correct initial values
- `callbacks.onToolActivity("start")` adds to `state.activeTools`
- `callbacks.onToolActivity("end")` removes from `state.activeTools` and increments `state.toolUses`
- `callbacks.onTextDelta` updates `state.responseText`
- `callbacks.onTurnEnd` updates `state.turnCount`
- `callbacks.onSessionCreated` stores `state.session`
- `callbacks.onUsage` accumulates into `state.lifetimeUsage`
- `onStreamUpdate` callback is fired on each state change

- [ ] **Step 2: Implement activity tracker**

```typescript
// src/tui/activity.ts
import type { ToolActivity } from "../shared/types.js";

export interface LifetimeUsage {
  input: number;
  output: number;
  cacheWrite: number;
}

export interface AgentActivity {
  activeTools: Map<string, string>;
  toolUses: number;
  responseText: string;
  session?: unknown; // AgentSession — unknown to avoid circular dep
  turnCount: number;
  maxTurns?: number;
  lifetimeUsage: LifetimeUsage;
}

/** Sum of lifetime usage components. */
export function getLifetimeTotal(u?: LifetimeUsage): number {
  return u ? u.input + u.output + u.cacheWrite : 0;
}

/**
 * Create an AgentActivity state and spawn callbacks for tracking.
 * Used by both foreground and background agent paths.
 *
 * Reference: tintinweb-pi-subagents/src/index.ts createActivityTracker()
 */
export function createActivityTracker(
  maxTurns?: number,
  onStreamUpdate?: () => void,
) {
  const state: AgentActivity = {
    activeTools: new Map(),
    toolUses: 0,
    turnCount: 1,
    maxTurns,
    responseText: "",
    session: undefined,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
  };

  const callbacks = {
    onToolActivity: (activity: ToolActivity) => {
      if (activity.type === "start") {
        state.activeTools.set(
          `${activity.toolName}_${Date.now()}`,
          activity.toolName,
        );
      } else {
        for (const [key, name] of state.activeTools) {
          if (name === activity.toolName) {
            state.activeTools.delete(key);
            break;
          }
        }
        state.toolUses++;
      }
      onStreamUpdate?.();
    },
    onTextDelta: (_delta: string, fullText: string) => {
      state.responseText = fullText;
      onStreamUpdate?.();
    },
    onTurnEnd: (turnCount: number) => {
      state.turnCount = turnCount;
      onStreamUpdate?.();
    },
    onSessionCreated: (session: unknown) => {
      state.session = session;
    },
    onUsage: (usage: { input: number; output: number; cacheWrite: number }) => {
      state.lifetimeUsage.input += usage.input;
      state.lifetimeUsage.output += usage.output;
      state.lifetimeUsage.cacheWrite += usage.cacheWrite;
      onStreamUpdate?.();
    },
  };

  return { state, callbacks };
}
```

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.4: Create Agent Widget

**Files:**

- Create: `src/tui/agent-widget.ts`
- Create: `tests/agent-widget.test.ts`

Reference: `tintinweb-pi-subagents/src/ui/agent-widget.ts` (559 lines).

- [ ] **Step 1: Write failing tests**

Test:

- `renderWidget()` output for running agents (spinner + name + description + stats + activity line)
- `renderWidget()` output for completed/steered/error/aborted agents (status icon + stats)
- `renderWidget()` output for queued agents (collapsed count)
- Tree structure connectors (`├─`, `└─`, `│`)
- Overflow with `+N more` indicator when >12 lines
- Widget modes: `"all"` shows all, `"background"` hides foreground, `"off"` returns empty
- `onTurnStart()` ages finished agents; removed after N turns
- `update()` calls `setWidget(undefined)` when no agents to show
- `update()` calls `setStatus()` with running/queued counts
- Status bar text only updates when changed (no redundant calls)

- [ ] **Step 2: Implement AgentWidget**

```typescript
// src/tui/agent-widget.ts
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentManager } from "../core/agent-manager.js";
import type { AgentRecord, WidgetMode } from "../shared/types.js";
import type { AgentActivity } from "./activity.js";
import {
  describeActivity,
  formatDuration,
  formatMs,
  formatTokens,
  formatTurns,
  SPINNER,
} from "./format.js";

export type Theme = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

export type UICtx = {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content:
      | undefined
      | ((
          tui: any,
          theme: Theme,
        ) => { render(width: number): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
};

const MAX_WIDGET_LINES = 12;
const ERROR_STATUSES = new Set(["error", "aborted", "steered", "stopped"]);

export class AgentWidget {
  private uiCtx: UICtx | undefined;
  private widgetFrame = 0;
  private widgetInterval: ReturnType<typeof setInterval> | undefined;
  private finishedTurnAge = new Map<string, number>();
  private widgetRegistered = false;
  private tui: any | undefined;
  private lastStatusText: string | undefined;
  private static readonly ERROR_LINGER_TURNS = 2;

  constructor(
    private manager: AgentManager,
    private agentActivity: Map<string, AgentActivity>,
    private mode: () => WidgetMode = () => "all",
  ) {}

  // Port setUICtx, onTurnStart, ensureTimer, markFinished, shouldShowFinished,
  // renderFinishedLine, renderWidget, update, dispose
  // from tintinweb agent-widget.ts lines 208-559
}
```

Key patterns from tintinweb:

- `setWidget("agents", (tui, theme) => { render, invalidate })` factory pattern
- `widgetRegistered` flag + `invalidate` callback resets it
- `tui.requestRender()` for efficient re-renders (only when already registered)
- `setInterval(80ms)` for spinner animation
- `setStatus("subagents", text)` only when text actually changes
- `setWidget("agents", undefined)` to clear when no agents

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.5: Create Fleet List

**Files:**

- Create: `src/tui/fleet-list.ts`
- Create: `tests/fleet-list.test.ts`

Reference: `tintinweb-pi-subagents/src/ui/fleet-list.ts` (359 lines).

- [ ] **Step 1: Write failing tests**

Test:

- `renderBar()` output: hint line, main entry, agent rows
- Main session always first
- Agent rows show display name + description + right-aligned stats (elapsed, tokens)
- Selection markers: `⏺` (selected, accent) vs `◯` (unselected, dim)
- Overflow with scroll indicators (`↑ N more` / `↓ N more`) when >5 agents
- Finished agents linger for 4 seconds then disappear
- `handleKey()`: ↓/← at empty prompt activates, ↑/↓ navigates, Enter opens viewer, Esc deactivates
- `handleKey()` returns `{ consume: true }` when key is handled, `undefined` otherwise
- `handleKey()` filters `isKeyRelease` (kitty protocol)
- `handleKey()` only activates when `getEditorText() === ""`
- Agent filtering: only shows agents with sessions

- [ ] **Step 2: Implement FleetList**

```typescript
// src/tui/fleet-list.ts
import { isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentManager } from "../core/agent-manager.js";
import type { AgentRecord } from "../shared/types.js";
import type { AgentActivity } from "./activity.js";
import { getLifetimeTotal } from "./activity.js";
import { ConversationViewer, VIEWPORT_HEIGHT_PCT } from "./conversation-viewer.js";
import type { Theme } from "./agent-widget.js";

const FLEET_KEY = "fleet";
const MAX_AGENT_ROWS = 5;
const TICK_MS = 200;
const FINISHED_LINGER_MS = 4000;

export type FleetUICtx = {
  setWidget(...): void;
  onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
  getEditorText(): string;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  custom<T>(...): Promise<T>;
};

export class FleetList {
  // Port from tintinweb fleet-list.ts (359 lines)
  // Key patterns:
  // - belowEditor widget via setWidget factory
  // - onTerminalInput for key interception
  // - getEditorText() === "" gating for activation
  // - isKeyRelease() filtering
  // - matchesKey() for key matching (not raw string comparison)
  // - rightAlign() for stats positioning
  // - formatFleetElapsed() and formatFleetTokens() inline helpers
  // - openSelected() launches ConversationViewer via ui.custom()
  // - viewerClose/viewingAgentId for overlay lifecycle
}
```

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.6: Create viewer keybindings module

**Files:**

- Create: `src/tui/viewer-keys.ts`
- Create: `tests/viewer-keys.test.ts`

Reference: `tintinweb-pi-subagents/src/ui/viewer-keys.ts` (39 lines).

- [ ] **Step 1: Write failing tests**

Test:

- Default keybindings: up/k for scrollUp, down/j for scrollDown, pageUp/shift+up for pageUp, pageDown/shift+down for pageDown
- Custom keybindings override defaults

- [ ] **Step 2: Implement viewer keys**

```typescript
// src/tui/viewer-keys.ts
import { type KeyId, matchesKey } from "@earendil-works/pi-tui";

export type ViewerScrollKeybinding =
  | "tui.select.up"
  | "tui.select.down"
  | "tui.select.pageUp"
  | "tui.select.pageDown";

export interface ViewerKeybindings {
  matches(data: string, keybinding: ViewerScrollKeybinding): boolean;
}

export interface ViewerKeys {
  scrollUp(data: string): boolean;
  scrollDown(data: string): boolean;
  pageUp(data: string): boolean;
  pageDown(data: string): boolean;
}

export function createViewerKeys(keybindings?: ViewerKeybindings): ViewerKeys {
  const matches = (
    data: string,
    id: ViewerScrollKeybinding,
    fallback: KeyId,
  ): boolean =>
    keybindings ? keybindings.matches(data, id) : matchesKey(data, fallback);
  return {
    scrollUp: (data) =>
      matches(data, "tui.select.up", "up") || matchesKey(data, "k"),
    scrollDown: (data) =>
      matches(data, "tui.select.down", "down") || matchesKey(data, "j"),
    pageUp: (data) =>
      matches(data, "tui.select.pageUp", "pageUp") ||
      matchesKey(data, "shift+up"),
    pageDown: (data) =>
      matches(data, "tui.select.pageDown", "pageDown") ||
      matchesKey(data, "shift+down"),
  };
}
```

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.7: Create Conversation Viewer

**Files:**

- Create: `src/tui/conversation-viewer.ts`
- Create: `tests/conversation-viewer.test.ts`

Reference: `tintinweb-pi-subagents/src/ui/conversation-viewer.ts` (362 lines).

- [ ] **Step 1: Write failing tests**

Test:

- `render()` output: header with status icon + name + stats, content area, footer
- Conversation formatting: `[User]`, `[Assistant]`, `[Tool: name]`, `[Result]` entries
- Tool results truncated to 500 chars
- Scrolling: up/down, page up/down, home/end, auto-scroll at bottom
- Steer compose mode: Enter opens composer, type, Enter sends, Esc cancels
- Stop: x arms, x again confirms (two-press)
- Close: Esc (when not composing)
- Streaming indicator for running agents: `▍ activity...`
- `isStoppable()` and `canSteer()` gate on status

- [ ] **Step 2: Implement ConversationViewer**

```typescript
// src/tui/conversation-viewer.ts
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Input,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { AgentRecord } from "../shared/types.js";
import type { AgentActivity } from "./activity.js";
import { getLifetimeTotal } from "./activity.js";
import { describeActivity, formatDuration, formatTokens } from "./format.js";
import type { Theme } from "./agent-widget.js";
import {
  createViewerKeys,
  type ViewerKeybindings,
  type ViewerKeys,
} from "./viewer-keys.js";

const CHROME_LINES_BASE = 6;
const MIN_VIEWPORT = 3;
export const VIEWPORT_HEIGHT_PCT = 70;

export class ConversationViewer implements Component {
  // Port from tintinweb conversation-viewer.ts (362 lines)
  // Key patterns:
  // - session.subscribe() for live updates → tui.requestRender()
  // - session.messages for conversation content
  // - extractText() helper for content arrays
  // - wrapTextWithAnsi() for text wrapping
  // - Input component for steer composer
  // - Two-press stop confirmation (stopArmed flag)
  // - Auto-scroll (tracks bottom), manual scroll disables auto
  // - Viewport height: 70% of terminal minus chrome lines
  // - Box drawing: ╭╮╰╯│─ border characters
}
```

Important: The viewer reads `session.messages` directly from the `AgentSession`. For the JSONL fallback (disposed sessions), we can add that in a follow-up — the live session path is the primary use case.

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.8: Enhance notification renderer

**Files:**

- Modify: `src/index.ts`
- Create: `tests/notification-renderer.test.ts`

Reference: `tintinweb-pi-subagents/src/index.ts` lines 215-261.

- [ ] **Step 1: Write failing tests**

Test the `renderOne()` function output:

- Completed: `✓` icon (success) + bold description + "completed"
- Error: `✗` icon (error) + description + "error"
- Steered: `✓` icon (success) + description + "completed (steered)"
- Stats line: turns, tool uses, tokens, duration (all formatted)
- Collapsed: first line of result, max 80 chars, prefixed with `⎿`
- Expanded: up to 30 lines of result
- Output file link when present
- Group notifications: renders each agent in `details.others[]`

- [ ] **Step 2: Replace current notification renderer**

Current renderer (lines 212-232 of `src/index.ts`) is basic. Replace with the polished version from tintinweb:

```typescript
pi.registerMessageRenderer<NotificationDetails>(
  "subagent-notification",
  (message, { expanded }, theme) => {
    const d = message.details;
    if (!d) return undefined;

    function renderOne(d: NotificationDetails): string {
      const isError =
        d.status === "error" ||
        d.status === "stopped" ||
        d.status === "aborted";
      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const statusText = isError
        ? d.status
        : d.status === "steered"
          ? "completed (steered)"
          : "completed";

      let line = `${icon} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

      // Stats line
      const parts: string[] = [];
      if (d.turnCount > 0) parts.push(formatTurns(d.turnCount, d.maxTurns));
      if (d.toolUses > 0)
        parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
      if (d.totalTokens > 0) parts.push(formatTokens(d.totalTokens));
      if (d.durationMs > 0) parts.push(formatMs(d.durationMs));
      if (parts.length) {
        line +=
          "\n  " +
          parts
            .map((p) => theme.fg("dim", p))
            .join(" " + theme.fg("dim", "·") + " ");
      }

      // Result preview
      if (expanded) {
        const lines = d.resultPreview.split("\n").slice(0, 30);
        for (const l of lines) line += "\n" + theme.fg("dim", `  ${l}`);
      } else {
        const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
        line += "\n  " + theme.fg("dim", `⎿  ${preview}`);
      }

      // Output file link
      if (d.outputFile) {
        line += "\n  " + theme.fg("muted", `transcript: ${d.outputFile}`);
      }

      return line;
    }

    const all = [d, ...(d.others ?? [])];
    return new Text(all.map(renderOne).join("\n"), 0, 0);
  },
);
```

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.9: Extend settings for UI features

**Files:**

- Modify: `src/core/settings.ts`
- Modify: `src/shared/types.ts` (if `SubagentsSettings` needs extending — currently in `types.ts` but settings also has its own interface)

- [ ] **Step 1: Add `widgetMode` and `fleetView` to settings**

```typescript
// In SubagentsSettings:
export interface SubagentsSettings {
  maxConcurrent?: number;
  defaultJoinMode?: JoinMode;
  widgetMode?: WidgetMode; // "all" | "background" | "off", default "background"
  fleetView?: boolean; // default true
}

// Update sanitize() to validate:
// - widgetMode: must be one of "all", "background", "off"
// - fleetView: must be boolean

// Update SettingsAppliers:
export interface SettingsAppliers {
  setMaxConcurrent: (n: number) => void;
  setDefaultJoinMode: (mode: JoinMode) => void;
  setWidgetMode?: (mode: WidgetMode) => void;
  setFleetView?: (enabled: boolean) => void;
}

// Update applySettings() to call new appliers
```

- [ ] **Step 2: Update tests, verify pass, commit**

---

### Task 5.10: Add settings to `/agents` menu

**Files:**

- Modify: `src/tui/agents-menu.ts`

Reference: `tintinweb-pi-subagents/src/index.ts` settings wiring (lines 517-526, 670-684).

- [ ] **Step 1: Add Widget Mode setting**

Add to `SETTINGS_MENU_ITEMS`:

```typescript
{
  key: "widgetMode",
  label: "Widget Mode",
  promptTitle: "Widget Mode (all / background / off)",
  formatValue: () => widgetMode,
  parse: (raw) => ["all", "background", "off"].includes(raw) ? raw : undefined,
  apply: (value, deps) => deps.setWidgetMode?.(value as WidgetMode),
}
```

This requires either:

- Passing `setWidgetMode` through `RuntimeDeps`, or
- Adding it as a setting applier callback

Choose the simpler approach based on current patterns.

- [ ] **Step 2: Add Fleet View setting**

Similar to widget mode, add a boolean toggle for fleet view.

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.11: Wire UI components into index.ts

**Files:**

- Modify: `src/index.ts`
- Modify: `src/core/agent-manager.ts`

Reference: `tintinweb-pi-subagents/src/index.ts` lines 272-621.

This is the integration task. Each step is independently verifiable.

- [ ] **Step 1: Create activity map and UI components**

In `createRuntimeDeps()` or `registerSubagentsExtension()`:

```typescript
import { type AgentActivity, createActivityTracker } from "./tui/activity.js";
import { AgentWidget, type UICtx } from "./tui/agent-widget.js";
import { FleetList, type FleetUICtx } from "./tui/fleet-list.js";
import type { WidgetMode } from "./shared/types.js";

const agentActivity = new Map<string, AgentActivity>();

let widgetMode: WidgetMode = "background";
const widget = new AgentWidget(deps.manager, agentActivity, () => widgetMode);

const fleet = new FleetList(deps.manager, agentActivity);
let fleetViewEnabled = true;
```

- [ ] **Step 2: Wire `tool_execution_start` for UI context + turn aging**

```typescript
pi.on("tool_execution_start", async (_event, ctx) => {
  widget.setUICtx(ctx.ui as UICtx);
  fleet.setUICtx(ctx.ui as unknown as FleetUICtx);
  widget.onTurnStart();
});
```

This is the **only** place the UI context is captured — it comes from the first tool execution event.

- [ ] **Step 3: Create activity trackers in spawn paths**

When an agent is spawned (in the tool execute handler), create a tracker:

```typescript
const { state: activityState, callbacks } = createActivityTracker(
  effectiveMaxTurns,
  () => widget.update(),
);
agentActivity.set(agentId, activityState);

// Pass callbacks.onToolActivity, callbacks.onTextDelta, etc.
// into the spawn options alongside existing callbacks
```

The `onStreamUpdate` callback calls `widget.update()` so the widget re-renders on each tool/text/turn event.

- [ ] **Step 4: Wire agent completion to widget and fleet**

In the `onComplete` callback:

```typescript
agentActivity.delete(record.id);
widget.markFinished(record.id);
fleet.onAgentFinished(record.id);
widget.update();
```

- [ ] **Step 5: Wire agent start to widget timer and fleet timer**

In the `onStart` callback (or after `spawn()`):

```typescript
widget.ensureTimer();
fleet.ensureTimer();
```

- [ ] **Step 6: Store `description` on AgentRecord at spawn time**

In `agent-manager.ts`, when creating the `AgentRecord` in `spawn()`, set `description` from the tool invocation's description parameter:

```typescript
const record: AgentRecord = {
  // ... existing fields ...
  description: options.description ?? options.prompt.slice(0, 80),
};
```

Add `description?: string` to `SpawnOptions`.

- [ ] **Step 7: Wire settings appliers for widgetMode and fleetView**

```typescript
function setWidgetMode(m: WidgetMode): void {
  widgetMode = m;
  widget.update();
}
function setFleetViewEnabled(b: boolean): void {
  fleetViewEnabled = b;
  fleet.setEnabled(b);
}
```

Pass to `applySettings()`:

```typescript
applySettings(settings, {
  setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
  setDefaultJoinMode: (mode) => {
    deps.defaultJoinMode = mode;
  },
  setWidgetMode,
  setFleetView: setFleetViewEnabled,
});
```

- [ ] **Step 8: Wire session_shutdown to dispose UI**

```typescript
pi.on("session_shutdown", () => {
  // ... existing cleanup ...
  fleet.dispose();
});
```

- [ ] **Step 9: Run `pnpm check`, fix all issues**

- [ ] **Step 10: Commit**

---

### Task 5.12: Live progress rendering for foreground agents

**Files:**

- Modify: `src/index.ts` (or `src/tui/render.ts`)

Reference: `tintinweb-pi-subagents/src/index.ts` `renderRunningAgentStatus()` (lines 60-70).

- [ ] **Step 1: Add foreground agent progress rendering**

When a foreground agent runs (via `subagent` tool or `/agent` command), update the parent's working message to show live status:

```typescript
// During foreground agent execution:
const { state, callbacks } = createActivityTracker(maxTurns, () => {
  // Update the working message with current activity
  const activity = describeActivity(state.activeTools, state.responseText);
  ctx.ui.setWorkingMessage(`${agentName}: ${activity}`);
});
```

This provides live progress feedback during foreground execution without needing the full widget.

- [ ] **Step 2: Reset working message on completion**

```typescript
ctx.ui.setWorkingMessage(); // Restore default
```

- [ ] **Step 3: Run tests, verify pass, commit**

---

### Task 5.13: Final integration verification

- [ ] **Step 1: Run full verification**

```bash
pnpm check
```

Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Manual smoke test checklist**

Verify (mentally, or document for future testing):

- Widget appears above editor when background agents run
- Widget shows spinner, name, description, stats, activity line
- Widget clears when all agents finish + linger expires
- Fleet list appears below editor when agents run
- Fleet list activates on ↓/← at empty prompt
- Fleet list navigates with ↑/↓, opens viewer on Enter
- Conversation viewer shows scrollable conversation
- Steer composer opens on Enter, sends on Enter, cancels on Esc
- Stop requires two x presses
- Notification renderer shows polished collapsed/expanded views
- Settings menu has Widget Mode and Fleet View options
- Live progress shows during foreground agent execution

- [ ] **Step 3: Commit any remaining fixes**
