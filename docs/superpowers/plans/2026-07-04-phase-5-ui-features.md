# Phase 5: UI Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three TUI components -- Agent Widget, Fleet List, and Conversation Viewer -- plus an enhanced notification renderer, so users see real-time agent status and can interactively browse conversations and steer agents.

**Architecture:** Create shared formatting utilities in `src/ui/format.ts`. Create a viewer keybindings module. Build three UI components: `AgentWidget` (persistent above-editor status), `FleetList` (below-editor agent navigation), and `ConversationViewer` (full-screen overlay with steer/stop controls). Enhance the notification renderer for polished collapsed/expanded views. Wire all components into the extension entry point.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` (Container, Text, ui.custom()), Vitest, Biome, pnpm.

**Verification:** `pnpm check` (runs `biome lint . && tsc --noEmit && vitest run`).

**Spec:** `docs/superpowers/specs/2026-07-04-spec-4-ui-features-design.md`

**Prerequisite:** Phase 4 (Parallel Execution) must be complete.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/ui/format.ts` | Shared formatting utilities (`formatDuration`, `formatTokens`, `truncate`, etc.) |
| Create | `src/ui/viewer-keys.ts` | Viewer keybinding module |
| Create | `src/ui/agent-widget.ts` | Above-editor persistent agent status widget |
| Create | `src/ui/fleet-list.ts` | Below-editor agent navigation list |
| Create | `src/ui/conversation-viewer.ts` | Full-screen overlay conversation viewer with steer/stop |
| Create | `tests/format.test.ts` | Formatting utility tests |
| Create | `tests/viewer-keys.test.ts` | Keybinding tests |
| Create | `tests/agent-widget.test.ts` | Widget rendering tests |
| Create | `tests/fleet-list.test.ts` | Fleet list rendering tests |
| Create | `tests/conversation-viewer.test.ts` | Viewer rendering tests |
| Modify | `src/index.ts` | Wire all UI components, notification renderer |
| Modify | `src/tui/render.ts` | Use shared `ui/format.ts` utilities |
| Modify | `src/tui/agents-menu.ts` | Widget mode setting |
| Modify | `src/core/agent-manager.ts` | Expose activity map for UI |

---

### Task 5.1: Create shared formatting utilities

**Files:**
- Create: `src/ui/format.ts`
- Create: `tests/format.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTokens,
  formatTurns,
  truncate,
} from "../src/ui/format.js";

describe("formatDuration", () => {
  it("formats sub-second", () => {
    expect(formatDuration(500)).toBe("0ms");
  });
  it("formats seconds", () => {
    expect(formatDuration(11_200)).toBe("11.2s");
  });
  it("formats minutes", () => {
    expect(formatDuration(150_000)).toBe("2m 30s");
  });
  it("formats hours", () => {
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });
});

describe("formatTokens", () => {
  it("formats small numbers", () => {
    expect(formatTokens(500)).toBe("500");
  });
  it("formats thousands", () => {
    expect(formatTokens(12_300)).toBe("12.3k");
  });
  it("formats millions", () => {
    expect(formatTokens(1_200_000)).toBe("1.2M");
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

describe("truncate", () => {
  it("under limit unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });
  it("over limit truncated", () => {
    expect(truncate("hello world foo", 10)).toBe("hello wor…");
  });
});
```

- [ ] **Step 2: Implement format utilities**

```typescript
export function formatDuration(ms: number): string {
  if (ms < 1000) return "0ms";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60)
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatTurns(turns: number, maxTurns?: number): string {
  return maxTurns ? `↻${turns}≤${maxTurns}` : `↻${turns}`;
}

export function formatActivity(
  activity: { toolName: string; args?: string } | undefined,
  maxLen: number,
): string {
  if (!activity) return "";
  const text = activity.args
    ? `${activity.toolName}: ${activity.args}`
    : activity.toolName;
  return truncate(text, maxLen);
}

export function statusIcon(
  status: string,
): { icon: string; colorKey: string } {
  switch (status) {
    case "running":
      return { icon: "⠋", colorKey: "accent" };
    case "completed":
      return { icon: "✓", colorKey: "success" };
    case "steered":
      return { icon: "✓", colorKey: "warning" };
    case "stopped":
      return { icon: "■", colorKey: "dim" };
    case "error":
      return { icon: "✗", colorKey: "error" };
    case "aborted":
      return { icon: "✗", colorKey: "error" };
    case "queued":
      return { icon: "◦", colorKey: "muted" };
    default:
      return { icon: "?", colorKey: "dim" };
  }
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/format.ts tests/format.test.ts
git commit -m "feat: add shared UI formatting utilities"
```

### Task 5.2: Create viewer keybindings module

**Files:**
- Create: `src/ui/viewer-keys.ts`
- Create: `tests/viewer-keys.test.ts`

- [ ] **Step 1: Write failing tests**

- [ ] **Step 2: Implement viewer keys**

```typescript
export interface ViewerKeybindings {
  "tui.select.up"?: string;
  "tui.select.down"?: string;
  "tui.select.pageUp"?: string;
  "tui.select.pageDown"?: string;
}

export interface ViewerKeys {
  scrollUp(data: string): boolean;
  scrollDown(data: string): boolean;
  pageUp(data: string): boolean;
  pageDown(data: string): boolean;
}

export function createViewerKeys(keybindings?: ViewerKeybindings): ViewerKeys {
  const upKey = keybindings?.["tui.select.up"] ?? "\x1b[A";
  const downKey = keybindings?.["tui.select.down"] ?? "\x1b[B";
  const pageUpKey = keybindings?.["tui.select.pageUp"] ?? "\x1b[5~";
  const pageDownKey = keybindings?.["tui.select.pageDown"] ?? "\x1b[6~";

  return {
    scrollUp: (data) => data === upKey || data === "k",
    scrollDown: (data) => data === downKey || data === "j",
    pageUp: (data) => data === pageUpKey,
    pageDown: (data) => data === pageDownKey,
  };
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/viewer-keys.ts tests/viewer-keys.test.ts
git commit -m "feat: add viewer keybindings module"
```

### Task 5.3: Create Agent Widget

**Files:**
- Create: `src/ui/agent-widget.ts`
- Create: `tests/agent-widget.test.ts`

- [ ] **Step 1: Write failing tests**

Test rendering output for each agent status (running, completed, steered, error, aborted, queued). Test tree structure connectors. Test overflow with +N more. Test widget modes.

- [ ] **Step 2: Implement AgentWidget**

Follow the spec layout:

- Tree structure with heading and per-agent rows
- Status icons with spinner animation
- Activity summary line for running agents
- Overflow handling (max 12 lines)
- Finished agent aging (removed after 2 parent turns)
- Status bar updates

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/agent-widget.ts tests/agent-widget.test.ts
git commit -m "feat: add Agent Widget for persistent above-editor status"
```

### Task 5.4: Create Fleet List

**Files:**
- Create: `src/ui/fleet-list.ts`
- Create: `tests/fleet-list.test.ts`

- [ ] **Step 1: Write failing tests**

Test main session row, agent rows, selection state, overflow with scroll indicators, finished agent linger, key handling.

- [ ] **Step 2: Implement FleetList**

Follow the spec:

- Below-editor widget
- Main session always first
- Navigation: left arrow to activate, `Esc` to deactivate, up/down arrows, Enter to open viewer
- Max 5 visible rows with scroll indicators
- Finished agents linger for 4 seconds

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/fleet-list.ts tests/fleet-list.test.ts
git commit -m "feat: add Fleet List for below-editor agent navigation"
```

### Task 5.5: Create Conversation Viewer

**Files:**
- Create: `src/ui/conversation-viewer.ts`
- Create: `tests/conversation-viewer.test.ts`

- [ ] **Step 1: Write failing tests**

Test header rendering, conversation formatting, scrolling, steer compose mode, stop confirmation, streaming indicator.

- [ ] **Step 2: Implement ConversationViewer**

Follow the spec:

- Full-screen overlay via `ui.custom()`
- Header with status icon, agent name, duration, tokens
- Conversation entries (User/Assistant/Tool/Result)
- Scrollable content
- Steer compose mode (Enter to start, Enter to send, Esc to cancel)
- Stop with `x` key
- Close with Esc
- Data source: live session or JSONL output file

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/ui/conversation-viewer.ts tests/conversation-viewer.test.ts
git commit -m "feat: add Conversation Viewer overlay with steer/stop controls"
```

### Task 5.6: Enhanced notification renderer

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement the polished notification renderer**

Follow the spec format:

- Collapsed: status icon + description + stats line + result preview (80 chars) + transcript link
- Expanded: up to 30 lines of result
- Group notifications: stack all agents in batch
- Turn count display adapts based on max turns

- [ ] **Step 2: Run tests, commit**

```bash
git add src/index.ts
git commit -m "feat: enhance notification renderer with polished collapsed/expanded views"
```

### Task 5.7: Wire UI components into index.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `src/core/agent-manager.ts`

- [ ] **Step 1: Create AgentWidget and FleetList in `registerSubagentsExtension()`**

```typescript
import { AgentWidget } from "./ui/agent-widget.js";
import { FleetList } from "./ui/fleet-list.js";

// In registerSubagentsExtension:
const agentActivity = new Map();
const widget = new AgentWidget(deps.manager, agentActivity, () => widgetMode);
const fleetList = new FleetList(deps.manager, agentActivity);

// Wire tool_execution_start to widget
pi.on("tool_execution_start", () => widget.onTurnStart());

// Wire manager events to widget and fleet
// Wire session events for widget/fleet updates
```

- [ ] **Step 2: Expose agentActivity map from AgentManager**

Add a method or property to AgentManager that exposes the activity map for UI consumption.

- [ ] **Step 3: Add widget mode setting to agents-menu**

- [ ] **Step 4: Update `tui/render.ts` to use shared `ui/format.ts`**

Replace inline formatting with calls to the shared utilities.

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire Agent Widget, Fleet List, and Conversation Viewer into extension"
```

### Task 5.8: Final integration verification

- [ ] **Step 1: Run full verification**

```bash
pnpm check
```

Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from Phase 5 wiring"
```
