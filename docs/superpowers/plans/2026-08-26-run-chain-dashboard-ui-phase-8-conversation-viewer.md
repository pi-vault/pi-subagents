# Phase 8: Conversation Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the live conversation viewer and steering composer to the shared dashboard frame without changing transcript ordering, background-agent control, or lifecycle behavior.

**Architecture:** Keep `ConversationViewer` as the single stateful component. Replace only its private rounded-box renderer with the existing dashboard frame/viewport primitives, raise its internal height cap from `70%` to the shared `85%`, and implement Pi/TUI's `Focusable` contract so the wrapper forwards overlay focus to the native `Input` created for steering. `FleetList` remains the sole caller and already supplies the shared overlay options.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent@0.84.3`, `@earendil-works/pi-tui@0.84.3`, Vitest, pnpm, Node `24.15.0`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

**Prerequisite:** Phase 7 is merged at `c0bd95d`; `src/tui/fleet-list.ts` already opens the viewer with `DASHBOARD_OVERLAY_OPTIONS` (`92%` centered width, `85%` max height).

**Usable result:** A heavy-framed, width-safe conversation overlay remains live while an agent runs, scrolls predictably, exposes a correctly focused native steering input, and still steers, stops, and closes through the existing callbacks.

## Assumptions and Current Repository Fit

- `src/tui/conversation-viewer.ts` currently owns the complete transcript, scroll, stop-confirmation, composer, subscription, and disposal state. Keep that ownership; no controller or second component is needed.
- `tests/conversation-viewer.test.ts` currently has 21 passing tests but does not cover shared-frame sizing, small-terminal rendering, wrapper focus, release events, actual steering submission, or subscription-driven refresh.
- `src/tui/dashboard-style.ts` already provides every presentation primitive needed: `DASHBOARD_MAX_HEIGHT_RATIO`, `MIN_DASHBOARD_FRAME_WIDTH`, `dashboardContentWidth()`, `fitDashboardViewport()`, `renderDashboardFrame()`, and `renderDashboardTooSmall()`.
- `VIEWPORT_HEIGHT_PCT` is an exported integer percentage today. Preserve that API shape and change its value from `70` to `85`; do not reinterpret it as the ratio `0.85`.
- Phase 7's instruction to retain the `70` assertion applied while implementing Phase 7. This phase now intentionally changes that assertion to `85`.
- `FleetList`, dashboard primitives, agent manager behavior, and the shared overlay options are verification-only in this phase.

## Reference Decisions

- Pi/TUI `0.84.3` sets focus on the component returned by `ctx.ui.custom()`. An embedded `Input` does not become the focused TUI component, so the wrapper must implement `Focusable`, remember `_focused`, and copy that value to the active composer.
- Pi/TUI's native `Input` already handles legacy input, CSI-u printable characters, submit, Escape, cursor movement, deletion, paste, and `CURSOR_MARKER`. Route composer input to it; do not duplicate any editor logic.
- Follow the established `ChainClarifyComponent` focus pattern and the dashboard logical layout: title/header, blank row, bounded body, blank row or composer title/input, and a dim key-hint footer.
- The shared frame contributes four rows: top border, top padding, bottom padding, and bottom border. The idle viewer therefore has eight non-message rows; composer mode has nine because it adds one row while preserving the total overlay height.
- Keep the current scroll percentage meaning: progress is measured at the bottom edge of the visible viewport. Do not redefine it during a visual migration.

## Global Constraints

- Modify only `src/tui/conversation-viewer.ts` and `tests/conversation-viewer.test.ts`. The plan file belongs to the planning change and is not staged with implementation commits.
- Preserve the `ConversationViewer` constructor parameter order, `ViewerKeybindings`, `VIEWPORT_HEIGHT_PCT` export, `handleInput()`, `render()`, `invalidate()`, and `dispose()` surface.
- Preserve chronological message rendering, supported message roles, the waiting state, the running activity line, 500-character result/output truncation, ANSI-aware wrapping, custom keybindings, and live reads from the mutable session/record.
- Preserve single-line and page scrolling, `j`/`k`, arrows, Home/End, auto-follow at the bottom, manual position while scrolled up, and the existing bottom-edge percentage calculation.
- Preserve Escape/`q` close, Enter-to-compose only for running/queued steerable agents, trimmed non-empty steering, empty-submit/cancel behavior, and the two-press `x` stop confirmation.
- Ignore Kitty key-release events before they reach either viewer actions or the native composer. Repeats remain available for scrolling; do not add a new key policy.
- Use only the active Pi theme roles. Keep running/accent, completed/success, error/error, fallback/dim status icons; bold the agent type, keep the description muted, and keep metadata/footer text dim.
- Use `renderDashboardFrame()` rather than maintaining a second border implementation. Do not change `src/tui/dashboard-style.ts` or copy its fixed-width logic locally.
- Use `dashboardContentWidth(width)` (`width - 6`, clamped) for message wrapping and `Input.render()`. The old `width - 4` value does not match the shared frame's two-column horizontal padding.
- Return `renderDashboardTooSmall()` when the seven-column frame or a three-row message body cannot fit. Escape and composer cancel must still work because input handling is independent of rendering.
- Do not import `DASHBOARD_OVERLAY_OPTIONS` into the viewer; it cannot open itself. Verify the already-merged Fleet caller instead.
- Add no dependency, setting, command, keybinding, scrollbar, search, transcript cache, custom editor, mouse action, or new generic UI abstraction.
- Existing repository-wide Biome diagnostics are out of scope; do not edit unrelated files to silence them.

## Target Logical Layout

The shared renderer supplies borders and two columns of horizontal padding. At normal width, pass this logical content to it:

```text
● coder  Fix the bug • 2 tools • 5.0s (running) • 10 token

<fixed-height message viewport>

29 lines • 100% • Enter Steer • x Stop    ↑/↓ Scroll • PgUp/PgDn or Shift+↑/↓ • Esc Close
```

When composing, replace the idle spacer/footer pair with three rows, reducing the message viewport by one so total height is unchanged:

```text
● coder  Fix the bug • 2 tools • 5.0s (running) • 10 token

<fixed-height message viewport>
Steer agent
> native Pi/TUI Input
Enter Send • Esc Cancel
```

Keep the existing responsive footer rule: show the line-count/percentage only when it fits, keep actions on the left and navigation on the right, and let the shared frame perform the final ANSI-safe clamp.

## File Structure

- Modify `tests/conversation-viewer.test.ts`: extend the existing lightweight factory into a realistic viewer driver and own frame, sizing, focus, input, scroll, subscription, action, and cleanup regressions.
- Modify `src/tui/conversation-viewer.ts`: consume the shared dashboard primitives, implement `Focusable`, keep native `Input`, and retain all existing transcript/control state.
- Verify only `src/tui/dashboard-style.ts`, `src/tui/fleet-list.ts`, `tests/dashboard-style.test.ts`, `tests/fleet-list.test.ts`, and `tests/agent-manager.test.ts`.

---

### Task 1: Lock the Viewer Contract with Focused Regressions

**Files:**

- Modify: `tests/conversation-viewer.test.ts`
- Do not modify production code in this task.

**Interfaces:**

- Continue constructing the real `ConversationViewer`; do not mock the component or Pi/TUI `Input`.
- Use public rendering and input behavior for assertions. The only state exposed by the harness should be mutable session/record fixtures and callback spies.

- [ ] **Step 1: Strengthen the existing test driver without adding a second harness.**

  Import `CURSOR_MARKER` and `visibleWidth` from Pi/TUI. Retain the current `makeRecord()` and `makeViewer()` entry points, then extend them so tests can:

  - mutate `tui.terminal.rows` and inspect `requestRender`,
  - capture the callback passed to `session.subscribe()` and invoke it with `session.emit()`,
  - mutate `session.messages` and the same `AgentRecord` after construction,
  - provide `onSteer`, `onStop`, `done`, and an optional `ViewerKeybindings`, and
  - render with a plain theme or a semantic/ANSI theme that records `fg()` and `bold()` calls.

  Add named real encodings rather than invented aliases:

  ```ts
  const LEGACY_ENTER = "\r";
  const LEGACY_ESCAPE = "\x1b";
  const LEGACY_UP = "\x1b[A";
  const KITTY_UP = "\x1b[1;1A";
  const KITTY_DOWN = "\x1b[1;1B";
  const CSI_U_ENTER = "\x1b[13u";
  const CSI_U_ESCAPE = "\x1b[27u";
  const CSI_U_X = "\x1b[120u";
  const CSI_U_ENTER_RELEASE = "\x1b[13;1:3u";
  const CSI_U_X_RELEASE = "\x1b[120;1:3u";
  ```

  Keep fixtures structural and local; do not instantiate Pi internals or add a generic TUI test utility. Replace fixed row assumptions while touching the harness: the shared frame inserts a blank row after the top border and before the bottom border, so existing header/status/stat tests must find the row containing the agent type, and the scroll test must find the row containing the percentage, rather than indexing `[1]` or `at(-2)`.

- [ ] **Step 2: Replace the old rounded-frame assertions with red dashboard layout tests.**

  Replace the current `"is 70"` case, including its name, with:

  ```ts
  it("is 85", () => {
    expect(VIEWPORT_HEIGHT_PCT).toBe(85);
  });
  ```

  At `terminal.rows = 40` and render width `80`, assert the idle viewer:

  - starts with `┏━` and ends with `━┛`, with none of `╭╮╰╯│`,
  - returns exactly `Math.floor(40 * 0.85) === 34` rows,
  - returns rows whose `visibleWidth()` is exactly `80`, including with an ANSI-producing theme,
  - contains the type, description, status icon, tool count, duration, and token count,
  - applies the current semantic roles to status/description/metadata and bolds the type, and
  - contains dashboard vocabulary and bullet separators: `Enter Steer`, `x Stop`, `↑/↓ Scroll`, `PgUp/PgDn`, and `Esc Close`.

  Add a composer render at the same dimensions and assert it is also 34 rows and width-safe, contains `Steer agent`, the native `> ` prompt, and `Enter Send • Esc Cancel`, and no longer displays the idle `Enter Steer` hint.

- [ ] **Step 3: Add small-terminal and resize regressions.**

  Cover both failure dimensions:

  - width `6` with normal terminal height returns bounded fallback rows instead of `[]`, and every row is exactly six columns;
  - a terminal whose `Math.floor(rows * 0.85)` is below the idle `8 + 3` row minimum shows `Terminal too small · Esc` when width permits;
  - an 11-row budget can render the idle viewer but switches to fallback when the composer raises the minimum to `9 + 3`, then returns to the viewer when the composer is cancelled; and
  - after scrolling away from the bottom, rendering the fallback and restoring the same normal dimensions preserves the prior line position.

  While in fallback, send Escape and assert `done(undefined)` still fires. In a separate composer case, send Escape and assert only the composer closes—the overlay remains open.

- [ ] **Step 4: Add focus, modern-input, and release-event regressions.**

  Exercise the order used by the real overlay host: focus the wrapper before the composer exists, then open it.

  ```ts
  viewer.focused = true;
  viewer.handleInput(CSI_U_ENTER);
  expect(viewer.render(80).join("\n")).toContain("Steer agent");
  expect(viewer.render(80).join("\n")).toContain(CURSOR_MARKER);
  viewer.focused = false;
  expect(viewer.render(80).join("\n")).not.toContain(CURSOR_MARKER);
  ```

  Also prove focus toggles correctly when changed after the composer opens. Table-test legacy and CSI-u Enter/Escape, type at least one character through CSI-u printable input, and submit a trimmed message through both legacy and CSI-u Enter.

  Directly send `CSI_U_ENTER_RELEASE` to an idle viewer and assert no composer opens. Send `CSI_U_X_RELEASE` twice and assert it neither arms the stop footer nor calls `onStop`. These tests require a first-line `isKeyRelease()` guard even though Pi/TUI normally filters releases during standard component dispatch.

- [ ] **Step 5: Fill the existing behavior gaps without duplicating message-format tests.**

  Add the smallest cases that lock the state being refactored:

  - a mixed user/assistant/tool-result transcript remains in chronological order;
  - initial render follows the newest message, Home/repeated Up clamp at the first message, End/repeated Down clamp at the newest message, and Page Up/Down stay within the same bounds;
  - a supplied `ViewerKeybindings` still handles its configured up/down/page IDs while `j`/`k` fallbacks remain available;
  - while manually scrolled up, `session.emit()` requests a render but does not jump to the bottom; after End, a new message is auto-followed;
  - a subscription event requests one render, a live status/activity mutation appears on the next render, and the viewer remains open when the record becomes completed;
  - a trimmed non-empty composer submission calls `onSteer` once, empty submit and Escape call it zero times, scroll keys type into the composer rather than moving the transcript, and each composer key requests at most one component render;
  - two press events for `x` call `onStop` once, another key disarms the first press, and completed/read-only viewers expose neither action; and
  - outer legacy/CSI-u Escape and `q` each close once, while `dispose()` unsubscribes once, suppresses later subscription renders, and remains idempotent.

  Retain the current waiting, role-label, status-icon, live-activity, and aggregate-stat tests. Do not port the large upstream transcript-width suite; the shared renderer already owns generic frame-width behavior, and one viewer-level ANSI regression covers this integration.

- [ ] **Step 6: Run the red test and record the expected boundary.**

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/conversation-viewer.test.ts
  ```

  Expected before production changes: existing transcript/action tests and most new preservation tests pass; the `85` constant, heavy frame, 34-row cap, fallback, `Steer agent` hierarchy, focus removal, and release-event assertions fail. Do not weaken those assertions to match the old renderer.

---

### Task 2: Apply the Shared Frame, Viewport, and Focus Contract

**Files:**

- Modify: `src/tui/conversation-viewer.ts`
- Test: `tests/conversation-viewer.test.ts`

**Interfaces:**

- Consume from `src/tui/dashboard-style.ts`:
  - `DASHBOARD_MAX_HEIGHT_RATIO`
  - `MIN_DASHBOARD_FRAME_WIDTH`
  - `dashboardContentWidth()`
  - `fitDashboardViewport()`
  - `renderDashboardFrame()`
  - `renderDashboardTooSmall()`
- Consume from Pi/TUI: `Focusable`, `Input`, `isKeyRelease()`, existing key matching/wrapping/width helpers, and no new component.

- [ ] **Step 1: Establish release-safe wrapper focus and preserve the exported percentage.**

  Import `type Focusable` and `isKeyRelease`, make the class implement `Component, Focusable`, and add only the established wrapper state:

  ```ts
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (this.composer) this.composer.focused = value;
  }
  ```

  At the first line of `handleInput()`, return for `isKeyRelease(data)`. Keep all later branch order unchanged: active composer, close, open composer, stop confirmation, then scrolling.

  Preserve the integer export while deriving it from the shared source of truth:

  ```ts
  export const VIEWPORT_HEIGHT_PCT = DASHBOARD_MAX_HEIGHT_RATIO * 100;
  ```

  Do not export a second ratio or leave a duplicate literal `0.85`/`85` in height calculations.

- [ ] **Step 2: Replace the private rounded frame with shared logical composition.**

  Remove the local `pad`, `row`, `hrTop`, `hrMid`, and `hrBot` implementation. Put the shared cap in one private method because both rendering and key-driven scrolling need it:

  ```ts
  private targetRows(): number {
    return Math.max(
      1,
      Math.floor(this.tui.terminal.rows * DASHBOARD_MAX_HEIGHT_RATIO),
    );
  }
  ```

  In `render()`, set `const targetRows = this.targetRows()`. If `width < MIN_DASHBOARD_FRAME_WIDTH` or `targetRows < this.chromeLines() + MIN_VIEWPORT`, immediately return `renderDashboardTooSmall(width, targetRows, theme)`. Do not mutate `lastInnerW` or scroll state in this branch, so a resize back to the same normal dimensions restores the prior viewport. Make `viewportHeight()` subtract `chromeLines()` from `targetRows()` and retain the existing `MIN_VIEWPORT` floor for input received while fallback is visible.

  For a normal render:

  1. Set `innerW = dashboardContentWidth(width)` and retain it in `lastInnerW` for key-driven scroll calculations.
  2. Build content lines from the live session at that width.
  3. Keep the existing `maxScroll` and `autoScroll` decision.
  4. Call `fitDashboardViewport(contentLines, undefined, viewportHeight, this.scrollOffset)` to clamp/pad the message body; store its returned offset and use it for the percentage calculation.
  5. Pass the target logical layout from this plan to `renderDashboardFrame()`.

  The final composition is deliberately only one conditional tail:

  ```ts
  return renderDashboardFrame(
    [
      header,
      "",
      ...viewport.lines,
      ...(this.composer
        ? [
            theme.fg("accent", "Steer agent"),
            this.composer.render(innerW)[0] ?? "",
            theme.fg("dim", "Enter Send • Esc Cancel"),
          ]
        : ["", idleFooter]),
    ],
    width,
    theme,
  );
  ```

  Replace `CHROME_LINES_BASE = 6` with a private dashboard-specific base of `8`; `chromeLines()` continues to add one while a composer exists. The message viewport is therefore `targetRows - 8` when idle and `targetRows - 9` while composing, and both framed results remain exactly `targetRows` rows.

- [ ] **Step 3: Keep the current header data and adopt dashboard hierarchy only.**

  Keep the current status mapping, duration calculation, tool pluralization, and token sum/order. Change only presentation:

  - status icon in its existing semantic color,
  - agent type bold,
  - description muted,
  - metadata dim, and
  - `•` as the dim separator between description and metadata and within metadata.

  Do not introduce a model name, turn counter, custom color registry, second title row, or snapshot of the record; the same mutable record must be read on every render.

- [ ] **Step 4: Preserve footer priority while changing its vocabulary.**

  Keep the current two-group width calculation with `visibleWidth()`:

  - optional left prefix: `<N> lines • <bottom-edge %>` when it fits,
  - left actions: `Enter Steer` and `x Stop`, or error-styled `x Again to STOP`, only when the existing capability checks allow them,
  - right navigation: `↑/↓ Scroll • PgUp/PgDn or Shift+↑/↓ • Esc Close`, and
  - dim ` • ` separators.

  Keep at least one space between left and right groups and let `renderDashboardFrame()` apply the final clamp. Hints remain text for the existing keyboard branches; do not add button objects or duplicate callbacks.

- [ ] **Step 5: Seed and clean up the native composer from wrapper state.**

  In `openComposer()`, replace unconditional `input.focused = true` with:

  ```ts
  input.focused = this._focused;
  ```

  Render `theme.fg("accent", "Steer agent")`, `input.render(innerW)[0] ?? ""`, and `theme.fg("dim", "Enter Send • Esc Cancel")` in the composer layout. Continue forwarding every non-release event to `Input.handleInput()` while it exists.

  On submit or Escape, blur that same input, clear its submit/Escape callbacks, and then clear `this.composer`; submit only the trimmed non-empty value. The surrounding composer branch in `handleInput()` already requests a render after `Input.handleInput()`, so remove the callback-level `requestRender()` calls instead of rendering twice. In `dispose()`, set `_focused = false`, blur an open composer, clear its callbacks/reference, and then retain the existing idempotent subscription cleanup. Do not call `done()` from `dispose()`.

- [ ] **Step 6: Leave transcript construction and control routing in place.**

  Do not rewrite `extractText()`, `createViewerKeys()`, `buildContentLines()`, `isStoppable()`, or `canSteer()` beyond formatting/import adjustments required by the new content width. In particular:

  - message role order and separators remain unchanged,
  - streaming activity remains the last body line for running agents,
  - user/result/bash content still wraps through Pi/TUI,
  - result and bash output truncation remains 500 characters,
  - `onSteer` and `onStop` retain their current arguments and call counts, and
  - a completed agent changes affordances/status but does not close the viewer.

- [ ] **Step 7: Run focused and neighboring green verification.**

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/conversation-viewer.test.ts \
    tests/dashboard-style.test.ts \
    tests/fleet-list.test.ts \
    tests/agent-manager.test.ts
  mise exec node@24.15.0 -- pnpm typecheck
  git diff --check
  ```

  Expected: all viewer layout/control tests pass; dashboard primitives remain unchanged; Fleet still supplies `DASHBOARD_OVERLAY_OPTIONS`, routes steering to the selected id, stops once, ignores release events at its own listener, and restores selection after the overlay closes.

---

### Task 3: Verify the Complete Conversation Viewer Phase

**Files:**

- Verify/commit only: `src/tui/conversation-viewer.ts`
- Verify/commit only: `tests/conversation-viewer.test.ts`
- Verify only: `src/tui/dashboard-style.ts`
- Verify only: `src/tui/fleet-list.ts`

**Interfaces:**

- Produces no new extension API, setting, dependency, command, manager behavior, or Fleet behavior.
- Accept the phase only when automated checks, diff scope, and a real modern-terminal path pass.

- [ ] **Step 1: Run the complete repository check at the pinned runtime.**

  ```bash
  mise exec node@24.15.0 -- env GIT_CONFIG_GLOBAL=/dev/null pnpm check
  git diff --check
  ```

  Expected: Biome lint, TypeScript, and every Vitest suite exit `0`. Existing warnings or infos may print, but no unrelated file is edited to silence them.

- [ ] **Step 2: Inspect scope and deletion-first implementation shape.**

  ```bash
  git status --short
  git diff --stat
  git diff -- src/tui/conversation-viewer.ts tests/conversation-viewer.test.ts
  git diff -- src/tui/dashboard-style.ts src/tui/fleet-list.ts tests/fleet-list.test.ts
  ```

  Expected: implementation changes are limited to the viewer and its test. The old rounded-border helpers are deleted rather than wrapped, no shared helper is duplicated, and the verification-only files have no diff.

- [ ] **Step 3: Perform modern-terminal acceptance.**

  In Pi `0.84.3+` under Ghostty, Kitty, or another terminal with CSI-u enabled:

  1. Start a background agent, activate FleetList from an empty prompt, and open that agent. Verify the centered `92%`/`85%` overlay has the heavy frame and live activity updates.
  2. Scroll with arrows and `j`/`k`; use Page Up/Down and Home/End. While scrolled up, wait for an update and verify position stays put; return to End and verify new output auto-follows.
  3. Press Enter, verify the hardware cursor is in the native `> ` composer, type/edit a message, and submit it. Confirm the selected agent receives the steering message once.
  4. Reopen the composer, cancel with Escape, and verify the overlay remains open. Then press `x`, disarm it with another key, and press `x` twice to stop the agent once.
  5. Let an agent complete while viewed. Verify the overlay remains open, status/affordances update, and outer Escape closes back to the same Fleet row.
  6. Resize below the frame/height minimum and back. Verify `Terminal too small · Esc`, retained scroll state, and working Escape.

  Record terminal name and Pi version in the implementation handoff. Any failed path blocks completion.

- [ ] **Step 4: Commit the focused phase.**

  ```bash
  git add src/tui/conversation-viewer.ts tests/conversation-viewer.test.ts
  git commit -m "refactor: migrate conversation viewer to dashboard frame"
  ```

## Risks and Verification Points

- **Footer clipping from double-counted frame rows:** idle and composer tests must both equal `floor(rows * 0.85)` and retain their footer; the dynamic `8/9` chrome count is the acceptance point.
- **Message reflow from shared padding:** use `dashboardContentWidth()` consistently for body wrapping and native input; ANSI-width tests catch mixed old/new widths.
- **Focus arriving before composer creation:** `_focused` is persistent wrapper state; the cursor-marker test opens the composer only after focus is already true.
- **Release events triggering destructive actions:** guard before composer/action routing; direct Enter/X release tests catch regressions.
- **Resize mutating navigation:** fallback returns before viewport fitting; resize-away-and-back tests preserve offset.
- **Phase 7 regression:** Fleet source remains untouched and its focused suite verifies overlay sizing, selected-id steering/stopping, and cleanup.

## Completion Criteria

- Heavy frame, semantic header, dashboard footer, small-terminal fallback, and every row are ANSI-width safe.
- `VIEWPORT_HEIGHT_PCT === 85`, and idle/composer renders stay within the shared `85%` cap without clipping.
- Wrapper focus controls the native composer cursor; legacy and CSI-u input work; release events do nothing.
- Live updates, transcript order, scrolling/auto-follow, steer, stop, close, and disposal behavior remain intact.
- Only the two phase-owned implementation files change, all automated checks pass, and the manual modern-terminal path succeeds.
