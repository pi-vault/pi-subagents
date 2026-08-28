# Phase 7: Fleet List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the below-editor FleetList and prevent its global terminal listener from stealing keys when Pi has focused a dialog, without changing the roster, activation keys, or conversation-viewer behavior.

**Architecture:** Keep `FleetList` as the existing render-only `belowEditor` widget with one `onTerminalInput()` listener. Harden that listener at its shared boundary by checking Pi/TUI's public `getFocusedComponent()` result for the editor contract, then change only the list's text composition and the overlay options passed when an agent opens. The roster, five-agent window, timers, activation state, viewer construction, and completion linger remain in the existing class.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent@0.84.3`, `@earendil-works/pi-tui@0.84.3`, Vitest, pnpm, Node `24.15.0`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

**Prerequisite:** Phase 6 is merged at `0c236ff`.

**Usable result:** An unboxed, width-safe fleet uses the dashboard visual language, consumes navigation only while Pi's prompt editor owns focus, and opens the selected agent with the shared overlay dimensions.

## Reference Decisions

- `/Users/lanh/Developer/pi-packages/pi` at tag `v0.84.3` (`4e58f324f`): use `matchesKey()` and `isKeyRelease()` for terminal encodings; use public `TUI.getFocusedComponent()` rather than reading private TUI state. `ctx.ui.custom()` must receive both `overlay: true` and `overlayOptions` for overlay sizing.
- `/Users/lanh/Developer/pi-vault/pi-status` at `b47dadc`: reuse the established centered `92%` width / `85%` max-height options and semantic theme roles. Do not import its dashboard state, palette, sidebar, frame, or configuration.
- `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` at `2e23ae7`: retain the useful editor-focus boundary, selected-row-aware bounded window, ANSI-width clamping, and concise key hints. Do not add its nested fleet tree, configurable shortcuts, compact/expanded modes, history, inspector, or action system.
- `/Users/lanh/Developer/pi-packages/tintinweb-pi-subagents` at `86c72ae`: retain the proven lifecycle cases—real Down-release filtering, earliest-first rows, pending-session filtering, viewer identity after reorder, linger, timer cleanup, and steering to the selected id. Do not add its agent badges, color registry, separate activity map, private `focusedComponent` access, or assumptions about `Editor` class identity.

## Global Constraints

- Modify only `src/tui/fleet-list.ts` and `tests/fleet-list.test.ts`. The plan file belongs to the planning change and is not staged with implementation commits.
- Preserve the `FleetList` constructor and public methods, `FLEET_KEY = "fleet"`, `belowEditor` placement, `MAX_AGENT_ROWS = 5`, `TICK_MS = 200`, and `FINISHED_LINGER_MS = 4000`.
- Preserve the roster: `main`, then session-backed running/queued agents in earliest-started order, the viewed agent, and recently completed agents during the existing linger window.
- Preserve activation on Down or Left at an empty prompt, clamped Up/Down navigation, Enter behavior, Escape behavior, other-key pass-through, key-release suppression, viewer steering/stopping, and cleanup.
- Consume no key unless the Pi prompt editor owns focus. Unknown, absent, selector, input-dialog, and overlay focus all pass through; switching away while FleetList is active deactivates it.
- Keep the persistent fleet unboxed. Do not call `renderDashboardFrame()` or add a component/controller/helper file.
- Render exactly five agent rows at once; `main`, heading, footer, and optional `↑/↓ N more` rows are outside that five-agent budget.
- Use `✦ Agents` as the heading, `▸` only for the active selected row, blank marker space for unselected/inactive rows, and dim `•` separators. Do not use ambiguous circle glyphs as selection markers.
- Keep elapsed time and token usage right-aligned and more important than long left-hand text. Normalize dynamic CR/LF to spaces and ensure every returned line has `visibleWidth(line) <= allocatedWidth`.
- Pass `DASHBOARD_OVERLAY_OPTIONS` from `src/tui/dashboard-style.ts` when opening `ConversationViewer`. Phase 8 still owns the viewer frame, `Focusable`, composer focus, internal viewport, and `VIEWPORT_HEIGHT_PCT` change from `70` to `85`.
- Add no dependency, setting, exported generic UI abstraction, new command, new keybinding, wrapping navigation, search, filtering, history, or nested-agent presentation.
- Existing repository-wide Biome diagnostics are out of scope; do not edit unrelated files to silence them.

## File Structure

- Modify `src/tui/fleet-list.ts`: own the prompt-focus boundary, unboxed fleet composition, ANSI-safe alignment, and shared viewer overlay options.
- Modify `tests/fleet-list.test.ts`: own a realistic FleetList driver plus input, focus, roster, rendering, overlay, timer, and cleanup regressions.

---

### Task 1: Harden the Terminal-Input Boundary

**Files:**

- Modify: `tests/fleet-list.test.ts`
- Modify: `src/tui/fleet-list.ts:12-18,31-36,90-292`

**Interfaces:**

- Consume from Pi/TUI:
  - `TUI.getFocusedComponent(): Component | null`
  - `EditorComponent`'s structural `render`, `invalidate`, `handleInput`, `getText`, and `setText` methods
  - `matchesKey(data, key)` and `isKeyRelease(data)`
- Preserve:
  - `FleetList.handleKey(data): { consume?: boolean; data?: string } | undefined`
  - `FleetUICtx.onTerminalInput()` and its unsubscribe function
  - the current activation, navigation, deactivation, and viewer-open state machine
- Add no exported runtime symbol.

- [ ] **Step 1: Replace the isolated mocks with one realistic FleetList driver.**

  In `tests/fleet-list.test.ts`, import `visibleWidth`, `type EditorComponent`, and `DASHBOARD_OVERLAY_OPTIONS`. Keep the existing format-helper tests, then add these key constants:

  ```ts
  const LEGACY_DOWN = "\x1b[B";
  const LEGACY_UP = "\x1b[A";
  const LEGACY_LEFT = "\x1b[D";
  const LEGACY_ENTER = "\r";
  const LEGACY_ESCAPE = "\x1b";
  const KITTY_DOWN = "\x1b[1;1B";
  const KITTY_UP = "\x1b[1;1A";
  const KITTY_LEFT = "\x1b[1;1D";
  const CSI_U_ENTER = "\x1b[13u";
  const CSI_U_ESCAPE = "\x1b[27u";
  const KITTY_DOWN_RELEASE = "\x1b[1;1:3B";
  ```

  Build one `harness(records)` that:
  - registers and captures the `onTerminalInput` handler and unsubscribe spy,
  - captures the `setWidget` factory and instantiates it with a fake TUI,
  - exposes `press(data)`, `render(width)`, `setEditorText(text)`, `setFocus(component)`, `closeOverlay()`, captured custom options, and manager spies,
  - gives the fake TUI `requestRender()`, `getFocusedComponent()`, and a normal editor-shaped focused component by default,
  - gives default sessions `messages: []` and `subscribe: () => () => {}` so every visible record is openable, and
  - keeps the custom promise pending until `done()` is called so overlay-open behavior is realistic.

  Use this structural editor fixture rather than constructing Pi internals:

  ```ts
  const editorComponent = (): EditorComponent => ({
    render: () => [],
    invalidate: () => {},
    handleInput: () => {},
    getText: () => "",
    setText: () => {},
  });
  ```

  A dialog fixture is only `{ render: () => [], invalidate: () => {}, handleInput: () => {} }`; it deliberately lacks `getText()` and `setText()`.

- [ ] **Step 2: Add failing legacy, CSI-u/Kitty, release, and focus regressions.**

  Add table-driven assertions that both legacy and modern Down/Left encodings activate from an empty focused editor and return `{ consume: true }`. Add navigation assertions using both legacy and Kitty Up/Down plus both Enter/Escape encodings.

  Add these boundary cases:

  ```ts
  it("does not steal activation keys from a focused dialog", () => {
    const h = harness([makeRecord()]);
    h.setFocus(dialogComponent());
    expect(h.press(KITTY_DOWN)).toBeUndefined();
  });

  it("deactivates and passes through when focus leaves the editor", () => {
    const h = harness([makeRecord()]);
    expect(h.press(LEGACY_DOWN)).toEqual({ consume: true });
    h.setFocus(dialogComponent());
    expect(h.press(LEGACY_DOWN)).toBeUndefined();
    h.setFocus(editorComponent());
    expect(h.press(LEGACY_UP)).toBeUndefined();
  });

  it("does not consume input while focused component is unknown", () => {
    const h = harness([makeRecord()]);
    h.setFocus(null);
    expect(h.press(LEGACY_DOWN)).toBeUndefined();
  });

  it("ignores the release half of a Down key", () => {
    const h = harness([makeRecord(), makeRecord({ id: "a2" })]);
    h.press(KITTY_DOWN);
    expect(h.press(KITTY_DOWN_RELEASE)).toBeUndefined();
    h.press(CSI_U_ENTER);
    expect(h.overlayOpened()).toBe(false);
  });
  ```

  Retain or add assertions that a non-navigation key deactivates and passes through, Up above `main` deactivates, Escape deactivates, and Enter on `main` deactivates without opening an overlay. With fake timers, also prove disabling or emptying the fleet clears its interval, re-enabling with agents starts one interval again, and `dispose()` calls the terminal-input unsubscribe, closes an open viewer, clears a registered widget, and leaves no timer.

- [ ] **Step 3: Run the input tests and confirm focus-only failures.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/fleet-list.test.ts
  ```

  Expected: legacy/CSI-u matching and release filtering pass through Pi/TUI; the focused-dialog, focus-loss, and unknown-focus assertions fail because the current raw listener checks only `getEditorText()`.

- [ ] **Step 4: Use Pi's public focused-component API at the shared boundary.**

  In `src/tui/fleet-list.ts`, import `type EditorComponent` and retain the existing `TUI` type import. Expand the local TUI handle:

  ```ts
  type TuiHandle = Pick<TUI, "getFocusedComponent" | "requestRender">;
  ```

  Add this private method to `FleetList`:

  ```ts
  private editorHasFocus(): boolean {
    const focused = this.tuiHandle?.getFocusedComponent();
    if (!focused) return false;
    const candidate = focused as Partial<EditorComponent>;
    return (
      typeof candidate.render === "function" &&
      typeof candidate.invalidate === "function" &&
      typeof candidate.handleInput === "function" &&
      typeof candidate.getText === "function" &&
      typeof candidate.setText === "function"
    );
  }
  ```

  In `handleKey()`, immediately after the existing key-release and open-viewer guards, add:

  ```ts
  if (!this.editorHasFocus()) {
    if (this.active) this.deactivate();
    return undefined;
  }
  ```

  Do not read a private `focusedComponent` property, use `instanceof Editor`, add focus mutation, or change any later key branch.

- [ ] **Step 5: Run the focused test and commit the boundary fix.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/fleet-list.test.ts
  mise exec node@24.15.0 -- pnpm typecheck
  git diff --check
  ```

  Expected: FleetList consumes legacy and modern navigation only when the editor fixture owns focus; all input, overlay, and existing format tests pass.

  Commit:

  ```bash
  git add src/tui/fleet-list.ts tests/fleet-list.test.ts
  git commit -m "fix: preserve fleet input focus"
  ```

---

### Task 2: Apply the Unboxed Fleet Presentation and Shared Overlay Options

**Files:**

- Modify: `tests/fleet-list.test.ts`
- Modify: `src/tui/fleet-list.ts:12-18,76-88,294-412`

**Interfaces:**

- Consume: `DASHBOARD_OVERLAY_OPTIONS` from `src/tui/dashboard-style.ts`.
- Preserve: `formatFleetElapsed()`, `formatFleetTokens()`, `rightAlign()`, the five-agent window, roster filtering/order, viewer callbacks, selection restoration by agent id, timer cadence, and cleanup.
- Presentation contract at normal width:

  ```text
  ✦ Agents
    main
  ▸ coder  Fix bug                                      5s • ↓ 150 tokens
  ↑/↓ Select • Enter View • Esc Back
  ```

  When inactive, no row has `▸` and the footer is `↓/← Focus agents • Esc Interrupt`. Unselected rows reserve the same marker width with spaces. Optional `↑ N more` / `↓ N more` rows remain dim and right-aligned.

- [ ] **Step 1: Add exact visual, semantic-role, and overlay regressions.**

  Use fake timers and a fixed system time so elapsed text is stable. Render one inactive and one active fleet at width `80`, strip only the test theme markers, and assert:

  ```ts
  expect(plain(inactive[0])).toBe("✦ Agents");
  expect(plain(inactive.at(-1)!)).toBe("↓/← Focus agents • Esc Interrupt");
  expect(plain(inactive.join("\n"))).not.toContain("▸");

  expect(plain(active[0])).toBe("✦ Agents");
  expect(plain(active.find((line) => line.includes("coder"))!)).toMatch(
    /^▸ coder  Fix bug\s+5s • ↓ 150 tokens$/,
  );
  expect(plain(active.at(-1)!)).toBe("↑/↓ Select • Enter View • Esc Back");
  ```

  With a semantic test theme, assert the heading is `accent` + bold, the selected `▸` uses `accent`, footer/overflow/separators use `dim`, and the component emits none of `┏━┃┗╭─│╰`.

  Open the first agent and assert the exact custom options:

  ```ts
  expect(h.customOptions()).toEqual({
    overlay: true,
    overlayOptions: DASHBOARD_OVERLAY_OPTIONS,
  });
  ```

  Also assert the real viewer factory still receives the selected live record: rendered output includes its tool count, token count, and activity, a steer submission calls `manager.steer(selectedId, message)` once, and pressing `x` twice calls `manager.abort(selectedId)` once.

- [ ] **Step 2: Add five-agent window, roster, width, and text-safety regressions.**

  Add tests proving:
  - eight agents render only five agent rows plus `↓ 3 more` at the top of the window;
  - moving to the last agent keeps it visible and shows `↑ 3 more`;
  - `main` does not count against the five-agent budget;
  - session-less queued agents are hidden;
  - visible agents are earliest-started first;
  - a recently completed agent lingers while an agent completed more than four seconds ago is absent;
  - closing a viewer reselects the viewed agent by id after an earlier row disappears; and
  - dynamic type/description text containing CR/LF produces no embedded CR/LF in a returned row.

  For widths `[0, 1, 4, 8, 20, 40, 80, 200]`, render long dynamic text with an ANSI-producing theme and assert:

  ```ts
  expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
  ```

  Keep the right-hand `elapsed • tokens` metadata visible in preference to the left-hand label whenever the width can contain it.

- [ ] **Step 3: Run the focused test and confirm presentation-only failures.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/fleet-list.test.ts
  ```

  Expected: roster, viewer identity, and existing lifecycle behavior pass; heading, marker, footer, separator, CR/LF normalization, and shared-overlay assertions fail against the old composition.

- [ ] **Step 4: Implement the minimum unboxed composition.**

  In `src/tui/fleet-list.ts`:
  1. Import `DASHBOARD_OVERLAY_OPTIONS` and stop importing `VIEWPORT_HEIGHT_PCT` from `conversation-viewer.ts`.
  2. In `rightAlign()`, replace CR/LF runs in both inputs with one space before width calculation. Keep truncating the left side first and keep the final `truncateToWidth()` clamp.
  3. Render `theme.fg("accent", theme.bold("✦ Agents"))` as the first line.
  4. Replace the circle marker with a two-column marker: active selected rows use accent `▸`; every other row uses spaces. Bold only the selected row's subject; keep agent type semantic styling, description text, and right-aligned stats.
  5. Change the right metadata separator from `·` to `•` inside the existing dim style.
  6. Keep the existing selected-aware five-agent `start`, `visible`, and `hiddenBelow` calculations plus the `↑/↓ N more` rows.
  7. Append exactly one dim footer line: active `↑/↓ Select • Enter View • Esc Back`; inactive `↓/← Focus agents • Esc Interrupt`.
  8. Remove the old leading hint and blank spacer. Do not add a frame or padding rows.
  9. Replace the inline overlay dimensions with `overlayOptions: DASHBOARD_OVERLAY_OPTIONS` while retaining `overlay: true`.

  Use these composition fragments; keep the existing roster/window loop around them:

  ```ts
  const heading = theme.fg("accent", theme.bold("✦ Agents"));
  const footer = this.active
    ? "↑/↓ Select • Enter View • Esc Back"
    : "↓/← Focus agents • Esc Interrupt";

  private marker(rosterIndex: number, selectedIndex: number, theme: Theme): string {
    return this.active && rosterIndex === selectedIndex
      ? `${theme.fg("accent", "▸")} `
      : "  ";
  }

  const right = theme.fg(
    "dim",
    `${formatFleetElapsed(elapsedMs)} • ${formatFleetTokens(tokens)}`,
  );
  ```

  The overlay call remains:

  ```ts
  {
    overlay: true,
    overlayOptions: DASHBOARD_OVERLAY_OPTIONS,
  }
  ```

  Do not change `agentRecords()`, `roster()`, `clampSelection()`, `openSelected()` callbacks, `clearViewer()`, timer registration, or disposal beyond the overlay-options replacement.

- [ ] **Step 5: Run focused and neighboring UI verification.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/fleet-list.test.ts \
    tests/dashboard-style.test.ts \
    tests/agents-menu.test.ts \
    tests/conversation-viewer.test.ts \
    tests/agent-manager.test.ts
  mise exec node@24.15.0 -- pnpm typecheck
  git diff --check
  ```

  Expected: the unboxed fleet and shared overlay contract pass without changing the Phase 8 viewer's current `VIEWPORT_HEIGHT_PCT = 70` assertion or any manager lifecycle behavior.

- [ ] **Step 6: Commit the presentation migration.**

  ```bash
  git add src/tui/fleet-list.ts tests/fleet-list.test.ts
  git commit -m "feat: restyle background agent fleet"
  ```

---

### Task 3: Verify the Complete Fleet Phase

**Files:**

- Verify only: `src/tui/fleet-list.ts`
- Verify only: `tests/fleet-list.test.ts`
- Verify only: `src/tui/dashboard-style.ts`
- Verify only: `src/tui/conversation-viewer.ts`
- Verify only: `src/index.ts`

**Interfaces:**

- Produces no new extension API, command, setting, dependency, exported helper, or viewer behavior.
- Accepts the phase only when focused tests, the complete repository check, diff validation, and a rendered TUI smoke path pass.

- [ ] **Step 1: Run the complete repository check at the pinned runtime.**

  Run:

  ```bash
  mise exec node@24.15.0 -- env GIT_CONFIG_GLOBAL=/dev/null pnpm check
  ```

  Expected: exit `0`; every Vitest file passes. Existing Biome warnings or infos may print, but no unrelated file is edited to silence them.

- [ ] **Step 2: Inspect the implementation diff for scope and whitespace.**

  Run:

  ```bash
  git status --short
  git diff --stat 0c236ff..HEAD
  git diff 0c236ff..HEAD -- src/tui/fleet-list.ts tests/fleet-list.test.ts
  git diff --check 0c236ff..HEAD
  git diff --check
  ```

  Expected: implementation commits since `0c236ff` change only `src/tui/fleet-list.ts` and `tests/fleet-list.test.ts`; the separately committed planning change may also contain this plan file. No viewer, manager, settings, schema, dependency, or index wiring changes appear.

- [ ] **Step 3: Smoke-test focus handoff and rendering in Pi.**

  Start the local extension:

  ```bash
  mise exec node@24.15.0 -- pi -e ./src/index.ts
  ```

  In Ghostty, Kitty, or another terminal with CSI-u/Kitty keyboard input enabled:
  1. Start at least six background agents; verify `✦ Agents`, the unboxed five-agent window, right-aligned stats, and overflow row.
  2. At an empty prompt, use Down and Left to activate, navigate with arrows, and confirm `▸` follows the selected row without wrapping.
  3. Type prompt text and press Down; verify FleetList does not activate and editor navigation remains native.
  4. Open `/agents` while FleetList is visible; navigate its custom menu and one native input/editor dialog. Verify FleetList never consumes their arrows or Enter/Escape.
  5. Return to the empty prompt, open a background agent, scroll, steer once, close with Escape, and verify the same agent remains selected.
  6. Let the selected agent finish while its viewer is open; verify the viewer stays readable, then closes back to the lingering row.
  7. Resize from wide to narrow and back; verify no fleet row wraps and right-hand metadata survives before long descriptions.

  Expected: editor/dialog focus is preserved, legacy and modern terminal encodings work once per key press, the correct agent opens and receives steering, and the fleet remains unboxed and width-safe.

- [ ] **Step 4: Record final verification and confirm a clean implementation worktree.**

  Run:

  ```bash
  git log -3 --oneline
  git status --short --branch
  ```

  Expected: the focus and presentation commits are present, and no implementation file remains modified. Record the terminal name and Pi version in the implementation handoff; any failed smoke path blocks completion.

## Completion Criteria

- FleetList consumes Down/Left/Up/Enter/Escape only while a structurally valid Pi editor owns focus and never steals keys from dialogs or unknown focus.
- Legacy and CSI-u/Kitty encodings work, and key-release events never move or activate twice.
- The list stays below the editor, unboxed, earliest-first, session-backed, and limited to five visible agent rows.
- `✦ Agents`, active `▸`, dim `•` separators, overflow indicators, and the single state-aware footer follow the exact presentation contract.
- Every rendered line is CR/LF-safe and no wider than Pi's allocated component width; elapsed/token metadata remains right-aligned.
- Opening a row uses `{ overlay: true, overlayOptions: DASHBOARD_OVERLAY_OPTIONS }` and still targets the correct agent for viewing, steering, stopping, and post-close selection.
- Timers, widget registration, finished-agent linger, viewer persistence, unsubscribe behavior, and disposal remain covered and unchanged.
- Focused tests, neighboring UI tests, `pnpm check`, typecheck, diff checks, and the live Pi smoke path pass.
