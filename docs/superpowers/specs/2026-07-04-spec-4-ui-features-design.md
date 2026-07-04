# Spec 4: UI Features

Three TUI components for observing and interacting with agents: a persistent widget showing live agent status, a fleet list for navigation, and an overlay conversation viewer with steering. Also enhances the notification renderer from Spec 2.

## Prerequisites

- Spec 2 completed (background execution, AgentRecord, output files, notifications)
- Spec 3 completed (GroupTracker, parallel groups)

## Scope

**In scope:**
- Agent widget (persistent, above editor) — live status of running/queued/finished agents
- Fleet list (below editor) — navigable list of main session + agents, opens conversation viewer
- Conversation viewer (overlay) — scrollable conversation with steer + stop controls
- Enhanced notification renderer — polished collapsed/expanded views with stats and transcript links
- Viewer keybindings module

**Out of scope:**
- Scheduled execution UI — future
- Agent creation/editing UI — already exists in `/agents` menu
- Extension settings UI — already exists in `/agents` menu

## Agent Widget

Persistent widget rendered above the editor area showing all running, queued, and recently-finished agents.

### Registration

```typescript
uiCtx.setWidget("agents", renderCallback, { placement: "aboveEditor" })
```

Registered when the first agent starts (lazy). Widget removed when all agents finish and linger expires.

### Layout

Tree structure with heading and per-agent rows:

```
● Agents                                          ← heading (accent when agents active)
├─ ⠋ scout  explore this repo · ↻5≤30 · 3 tool uses · 12.3k token (45%) · 11.2s (running)
│   ⎿  reading src/index.ts, editing…             ← activity line (running agents only)
├─ ✓ reviewer  check error handling · ↻8 · 5 tool uses · 11.2s
╰─ ◦ 2 queued
```

### Heading

| State | Display |
|-------|---------|
| Active agents | `● Agents` (accent) |
| No active agents | `○ Agents` (dim) |

### Per-agent row format

**Running:**
```
├─ {spinner} {name}  {description} · ↻{turns}≤{maxTurns} · {toolUses} tool uses · {tokens} token ({contextPct}%) · {duration} (running)
│   ⎿  {activitySummary}
```

**Completed:**
```
├─ ✓ {name}  {description} · ↻{turns}≤{maxTurns} · {toolUses} tool uses · {duration}
```

**Steered:**
```
├─ ✓ {name}  {description} · ↻{turns}≤{maxTurns} · {toolUses} tool uses · {duration} (turn limit)
```

**Error:**
```
├─ ✗ {name}  {description} · {duration} error
```

**Aborted:**
```
├─ ✗ {name}  {description} · {duration} aborted
```

**Queued (collapsed):**
```
╰─ ◦ {count} queued
```

### Status icons

| Status | Icon | Color |
|--------|------|-------|
| Running | Spinner frame (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) | accent |
| Completed | `✓` | success |
| Steered | `✓` | warning |
| Stopped | `■` | dim |
| Error | `✗` | error |
| Aborted | `✗` | error |
| Queued | `◦` | muted |

### Activity summary

For running agents, show a second line with current tool activity:

```
│   ⎿  reading src/index.ts, editing…
```

- Sourced from `AgentRecord` + `AgentActivity` map (tool name + truncated args)
- Truncated to 60 chars
- Shows up to 2 concurrent tool names

### Widget modes

Configurable via `/agents` settings:

| Mode | Behavior |
|------|----------|
| `"all"` | Show all agents (foreground + background) |
| `"background"` | Show only background agents (default) |
| `"off"` | Widget disabled |

### Overflow

- Max 12 lines.
- Priority: running > queued > finished.
- If agents exceed the limit: show `+{N} more` indicator.

### Timing

- **Poll interval:** 80ms via `setInterval`.
- **Finished agents linger:** Controlled by turn starts. After 2 parent turns, finished agents are removed from the widget.

### Status bar

Update the status bar with a compact summary:

```typescript
uiCtx.setStatus("subagents", `${running} running · ${queued} queued`)
```

Cleared when no agents are active.

### Class API

```typescript
class AgentWidget {
  constructor(
    manager: AgentManager,
    agentActivity: Map<string, AgentActivity>,
    mode: () => WidgetMode,
  )
  setUICtx(ctx: UICtx): void
  onTurnStart(): void       // Ages finished agents, checks for removal
  markFinished(id: string): void
  update(): void             // Re-render, called by interval timer
  dispose(): void            // Clear interval, remove widget
}

type WidgetMode = "all" | "background" | "off"

interface AgentActivity {
  toolName: string
  args?: string
  startedAt: number
}
```

### Integration

- Created in `index.ts` alongside `AgentManager`.
- `onToolActivity` callbacks from the manager feed into the `agentActivity` map.
- `onTurnStart` event from the parent session triggers `widget.onTurnStart()`.
- Widget references `manager.listAgents()` to get current records.

## Fleet List

Navigable list rendered below the editor, showing the main session and all agents. Selecting an agent opens the conversation viewer.

### Registration

```typescript
ui.setWidget("fleet", renderCallback, { placement: "belowEditor" })
```

Registered when the first background agent starts. Removed when all agents finish and linger expires.

### Layout

```
esc to interrupt · ← for agents · ↓ to manage         ← hint line (inactive)
↑↓ select · enter view · esc back                      ← hint line (active)

  ⏺ main                                               ← main session (always first)
  ⏺ scout  explore this repo  11s · ↓ 13.1k tokens     ← agent row (selected)
  ◯ reviewer  check error handling  8s · ↓ 5.2k tokens  ← agent row (unselected)
```

### Main session row

Always first. Shows `main` with selected/unselected bullet.

### Agent rows

```
{bullet} {name}  {description}  {duration} · ↓ {tokens} tokens
```

- **Selected:** `⏺` (accent)
- **Unselected:** `◯` (dim)
- Name in muted, description in dim
- Duration and token count in dim

### Navigation

- **Activate:** `←` key (left arrow) when fleet is inactive
- **Deactivate:** `Esc` key
- **Navigate:** `↑` / `↓` arrow keys
- **Open viewer:** `Enter` on selected agent
- **Return to main:** `Enter` on `main` session

Input handled via `ui.onTerminalInput()`. When fleet is active, key events are consumed (not forwarded to editor).

### Overflow

- Max 5 agent rows visible.
- Scroll indicators: `↑ {N} more` / `↓ {N} more` when list overflows.

### Agent lifecycle

- Running/queued agents appear immediately.
- Finished agents linger for 4 seconds, then fade out.
- Ordered by launch time (earliest first).

### Class API

```typescript
class FleetList {
  constructor(
    manager: AgentManager,
    agentActivity: Map<string, AgentActivity>,
  )
  setEnabled(enabled: boolean): void
  setUICtx(ui: FleetUICtx): void
  onAgentFinished(id: string): void
  handleKey(data: string): { consume?: boolean; data?: string } | undefined
  update(): void
  dispose(): void
}

interface FleetUICtx {
  setWidget: (key: string, cb: WidgetCallback | undefined, opts?: WidgetOptions) => void
  onTerminalInput: (handler: InputHandler) => Disposable
  notify: (message: string, type: string) => void
  custom: <T>(factory: ComponentFactory<T>, opts?: CustomOptions) => Promise<T>
}
```

### Timing

- **Poll interval:** 200ms via `setInterval`.
- **Finished linger:** 4000ms.

## Conversation Viewer

Full-screen overlay for viewing an agent's conversation with steer and stop controls.

### Opening

Opened from the fleet list when the user presses Enter on an agent row. Uses the `ui.custom()` overlay API:

```typescript
ui.custom<undefined>(componentFactory, {
  overlay: true,
  overlayOptions: {
    anchor: "center",
    width: "90%",
    maxHeight: "70%",
  },
})
```

### Layout

```
╭──────────────────────────────────────────────────────╮
│ ● scout  explore this repo · 11.2s · 12.3k token    │  ← header
│   ↳ thinking: high · isolated · worktree             │  ← mode tags (if any)
│ ─────────────────────────────────────────────────────│  ← separator
│ [User]                                                │
│ Find all TODO comments in the codebase                │
│ ───                                                   │  ← entry separator
│ [Assistant]                                           │
│ I'll search the codebase for TODO comments...         │
│   [Tool: read]                                        │
│ ───                                                   │
│ [Result]                                              │
│ // TODO: implement caching                            │
│ ───                                                   │
│ [Assistant]                                           │
│ Found 14 TODO comments across 8 files...              │
│ ▍ thinking…                                           │  ← streaming indicator (running)
│ ─────────────────────────────────────────────────────│  ← separator
│ 150 lines · 45% · Enter steer · x stop · ↑↓ scroll  │  ← footer
╰──────────────────────────────────────────────────────╯
```

### Header

```
{statusIcon} {agentName}  {description} · {duration} · {tokens} token
```

Status icon follows the same mapping as the widget.

Mode tags (second line, only if any apply):
```
  ↳ thinking: {level} · isolated · worktree
```

### Content

Conversation entries from the agent's session:

| Entry type | Format |
|-----------|--------|
| User message | `[User]` (bold) + message text |
| Assistant message | `[Assistant]` (bold) + message text |
| Tool call | `  [Tool: {toolName}]` (muted) |
| Tool result | `[Result]` + truncated result (max 500 chars) |
| Entry separator | `───` (dim) |

For running agents, show a streaming indicator after the last assistant message:

```
▍ thinking…
```

### Scrolling

- Content area is scrollable.
- `↑`/`↓` or `j`/`k` for line scroll.
- `PageUp`/`PageDown` or `Shift+↑`/`Shift+↓` for page scroll.
- Footer shows current position: `{totalLines} lines · {scrollPct}%`.

### Steer mode

When the user presses Enter on a running agent:

1. Footer changes to compose mode:
   ```
   > your message here_
   ✎ steer                Enter send · Esc cancel
   ```
2. User types a message (single-line text input).
3. Enter sends the steer message via `manager.steer(agentId, message)`.
4. Esc cancels compose mode and returns to normal view.

### Stop

Press `x` to abort the agent via `manager.abort(agentId)`. Shows confirmation notification.

### Close

Press `Esc` (when not in compose mode) to close the viewer and return to the fleet list.

### Data source

The viewer has two data sources depending on session availability:

1. **Live session available** (running agents, or recently completed before cleanup): Read conversation directly from `session.sessionManager.getBranch()`. Subscribe to session events for live updates.
2. **Session disposed** (completed agents after cleanup timer): Read conversation from the JSONL output file written by Spec 2's `streamToOutputFile()`. No live updates — static view.

The constructor accepts either a `session` or an `outputFile` path. The fleet list passes whichever is available from the `AgentRecord`.

### Live updates

For running agents with a live session, the viewer subscribes to session events and re-renders on new content:

```typescript
session.subscribe(() => this.tui.requestRender())
```

### Class API

```typescript
class ConversationViewer implements Component {
  constructor(
    tui: TUI,
    record: AgentRecord,
    source: { session: AgentSession } | { outputFile: string },
    activity: AgentActivity | undefined,
    theme: Theme,
    done: (result: undefined) => void,
    onStop?: () => void,
    keybindings?: ViewerKeybindings,
    onSteer?: (message: string) => void,
  )
  handleInput(data: string): void
  render(width: number): string[]
  invalidate(): void
  dispose(): void
}
```

### Constants

| Constant | Value |
|----------|-------|
| Max viewport height | 70% of terminal |
| Chrome lines (header + footer) | 6 |
| Min viewport lines | 3 |
| Tool result truncation | 500 chars |

## Viewer Keybindings

Extracted module for scroll key handling, shared between conversation viewer and any future scrollable components.

```typescript
function createViewerKeys(keybindings?: ViewerKeybindings): ViewerKeys

interface ViewerKeys {
  scrollUp(data: string): boolean
  scrollDown(data: string): boolean
  pageUp(data: string): boolean
  pageDown(data: string): boolean
}

interface ViewerKeybindings {
  "tui.select.up"?: string
  "tui.select.down"?: string
  "tui.select.pageUp"?: string
  "tui.select.pageDown"?: string
}
```

Default bindings:
- Scroll up: `↑` or `k`
- Scroll down: `↓` or `j`
- Page up: `PageUp` or `Shift+↑`
- Page down: `PageDown` or `Shift+↓`

## Enhanced Notification Renderer

Spec 2 defined the notification mechanism and `NotificationDetails` type. This spec polishes the visual rendering.

### Registration

```typescript
pi.registerMessageRenderer<NotificationDetails>("subagent-notification", renderFn)
```

Already registered in Spec 2. This spec refines the render function output.

### Collapsed view (default)

```
✓ scout: "explore this repo" completed
  ↻5≤30 · 3 tool uses · 12.3k token · 11.2s
  ⎿ Found 14 TODO comments across 8 files...
  transcript: /tmp/pi-subagents-.../tasks/abc123.output
```

- Line 1: status icon (success/error/warning) + description (bold) + status text (dim)
- Line 2: stats line (dim) — turns, tool uses, tokens, duration
- Line 3: result preview, first 80 chars, prefixed with `⎿` (dim)
- Line 4: transcript file link (muted), only if output file exists

### Expanded view

Same as collapsed, but result preview shows up to 30 lines instead of 80 chars.

### Group notifications

When multiple agents complete together (via group join), stack their notifications:

```
✓ scout: "find TODOs" completed
  ↻5≤30 · 3 tool uses · 12.3k token · 11.2s
  ⎿ Found 14 TODO comments...

✓ scout: "check coverage" completed
  ↻8 · 5 tool uses · 5.1k token · 15s
  ⎿ Coverage is 78%...

✗ reviewer: "check errors" error
  4 turns · 2 tool uses · 3.0k token · 8s
  ⎿ Context window exceeded
```

Uses `NotificationDetails.others[]` from Spec 2 to render each agent in the batch.

### Stats format

Turn count display adapts based on whether a limit was set:

| Has max turns | Format |
|---------------|--------|
| Yes | `↻{turns}≤{maxTurns}` |
| No | `↻{turns}` |

Token count uses compact formatting: `12.3k`, `1.2M`.

Duration uses human-friendly formatting: `11.2s`, `2m 30s`, `1h 5m`.

### Status icon mapping

Same as widget icons:

| Status | Icon | Color |
|--------|------|-------|
| Completed | `✓` | success |
| Steered | `✓` | warning, text: "completed (steered)" |
| Error | `✗` | error |
| Stopped | `✗` | error, text: "stopped" |
| Aborted | `✗` | error, text: "aborted" |

### Constants

| Constant | Value |
|----------|-------|
| Collapsed preview | 80 chars |
| Expanded max lines | 30 |
| Result max length | 500 chars |

## Shared Formatting Utilities

Several formatting functions are shared across widget, fleet list, notification renderer, and conversation viewer. Extract to a shared module:

```typescript
// ui/format.ts

function formatDuration(ms: number): string
// 0-999ms → "0ms", 1-59s → "11.2s", 1-59m → "2m 30s", 1h+ → "1h 5m"

function formatTokens(count: number): string
// 0-999 → "500", 1000-999999 → "12.3k", 1000000+ → "1.2M"

function formatTurns(turns: number, maxTurns?: number): string
// maxTurns set → "↻5≤30", no max → "↻5"

function formatActivity(activity: AgentActivity | undefined, maxLen: number): string
// "reading src/index.ts, editing…"

function statusIcon(status: AgentRecord["status"], theme: Theme): { icon: string; color: string }
// Maps status to icon + theme color

function truncate(text: string, maxLen: number): string
// Truncates with "…" suffix
```

## Module Changes

### New modules

| Module | Est. lines | Responsibility |
|--------|-----------|----------------|
| `ui/agent-widget.ts` | 400-500 | Persistent above-editor widget |
| `ui/fleet-list.ts` | 300-350 | Below-editor navigable agent list |
| `ui/conversation-viewer.ts` | 300-350 | Overlay conversation view + steer/stop |
| `ui/viewer-keys.ts` | 40 | Scroll keybinding extraction |
| `ui/format.ts` | 60-80 | Shared formatting utilities |

### Modified modules

| Module | Change |
|--------|--------|
| `index.ts` | Create AgentWidget, FleetList. Wire to manager events. Register notification renderer. Wire parent `tool_execution_start` to widget. |
| `tui/render.ts` | Import and use shared formatting from `ui/format.ts`. Update foreground progress rendering to use consistent format with widget. |
| `tui/agents-menu.ts` | Add widget mode setting (`all`/`background`/`off`). |
| `core/agent-manager.ts` | Expose `agentActivity` map for widget/fleet consumption. Emit events on tool activity changes. |

### Unchanged

Agent runner, agent format, subagent tool, group tracker, group join manager, worktree, output file, settings, skill loader, artifacts, paths, config, types — all unchanged.

## Integration Flow

```
Parent session
  │
  ├─ tool_execution_start event
  │   → widget.onTurnStart()          Ages finished agents
  │
  ├─ manager.spawn() / spawnAndWait()
  │   → widget.update()               New agent appears in widget
  │   → fleetList.update()            New agent appears in fleet
  │
  ├─ onToolActivity callback
  │   → agentActivity map updated     Widget shows current tool
  │
  ├─ agent completes
  │   → widget.markFinished(id)       Status icon changes
  │   → fleetList.onAgentFinished(id) Linger timer starts
  │   → notification renderer fires   Completion notification shown
  │
  ├─ fleet list: user selects agent
  │   → conversationViewer opens      Overlay with conversation
  │
  ├─ conversation viewer: user steers
  │   → manager.steer(id, message)    Steer message sent to agent
  │
  ╰─ conversation viewer: user stops
      → manager.abort(id)             Agent aborted
```

## Testing

### New tests

- **`agent-widget.test.ts`**: Test render output for running/completed/steered/error/aborted/queued agents. Test tree structure connectors. Test overflow with +N more. Test widget modes (all/background/off). Test finished agent aging (removed after N turns). Test spinner frame cycling. Test status bar text.
- **`fleet-list.test.ts`**: Test main session always first. Test agent row formatting. Test selection state. Test overflow with scroll indicators. Test finished agent linger (removed after 4s). Test key handling (activate, navigate, select, deactivate). Test input consumption when active.
- **`conversation-viewer.test.ts`**: Test header rendering with status icon. Test conversation formatting (user/assistant/tool/result entries). Test scrolling (line scroll, page scroll). Test steer compose mode (enter compose, type, send, cancel). Test stop confirmation. Test live updates for running agents. Test streaming indicator.
- **`viewer-keys.test.ts`**: Test default keybindings. Test custom keybindings override.
- **`format.test.ts`**: Test `formatDuration` edge cases (0ms, sub-second, minutes, hours). Test `formatTokens` (small, k, M). Test `formatTurns` (with/without max). Test `truncate` (under limit, at limit, over limit). Test `statusIcon` mapping.

### Updated tests

- **`render.test.ts`**: Update to use shared format utilities. Test foreground progress consistency with widget format.
- **`agents-menu.test.ts`**: Test widget mode setting.
- **`index.test.ts`**: Test widget and fleet list creation. Test event wiring.
