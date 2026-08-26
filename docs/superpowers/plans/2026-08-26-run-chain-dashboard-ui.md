# Run-Chain Input Repair and Dashboard UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/run-chain` usable with modern CSI-u/Kitty terminal input and give every pi-subagents-owned UI surface the compact visual language of the pi-status dashboard.

**Architecture:** Add one small local dashboard-style renderer for framed overlays, ANSI-safe sizing, and viewport fitting. Keep current managers, commands, schemas, settings, and surface placements; repair chain input with Pi/TUI primitives and migrate each existing UI onto the shared visual conventions without importing pi-status or its state machine.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai@0.84.3`, `@earendil-works/pi-coding-agent@0.84.3`, `@earendil-works/pi-tui@0.84.3`, Vitest, pnpm, Biome.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

## Global Constraints

- The tested Pi/TUI baseline is exactly `0.84.3`; retain wildcard Pi peer dependencies and document Pi `0.84.3+` for users.
- Use Pi's active theme only. Do not add pi-status palette presets, color settings, config files, or cross-extension reads.
- Do not add a runtime dependency on pi-status or extract a shared package.
- Preserve `/run-chain`, `/chain`, `/agents`, `--yes`, `--bg`, chain schemas, tool contracts, agent definitions, and settings formats.
- Preserve AgentWidget above-editor placement, ChainWidget above-editor placement, and FleetList below-editor placement.
- Keep Pi's native input/editor dialogs for multi-step agent creation and full markdown editing.
- Interactive overlays use a centered `92%` width and `85%` maximum height.
- A failed or cancelled chain preview must never launch an unconfirmed chain.
- Every new branch, viewport calculation, or input path leaves a focused runnable Vitest regression.

---

## Approved Design

The defect is in `ChainClarifyComponent`: its raw string comparisons recognize legacy bytes such as `"\r"` and `"j"`, while modern terminals may send CSI-u values such as `"\x1b[13u"` and `"\x1b[106u"`. Pi/TUI's `matchesKey()` already recognizes both encodings. Existing tests pass because they feed only the legacy strings, so they do not exercise the failing boundary.

The migration ports only pi-status' general presentation ideas: heavy framed overlays, visible selection, semantic theme roles, restrained spacing, footer key hints, ANSI-safe truncation, and a selected-row-aware viewport. pi-status' dashboard reducer, statusbar domain, sidebar, palettes, and configuration remain outside this repository.

Owned surfaces included in the migration:

1. Interactive overlays: `/agents` menus, chain preview/editor, and conversation viewer/composer.
2. Persistent surfaces: AgentWidget, ChainWidget, and FleetList.
3. Inline surfaces: subagent tool calls/results, completion notifications, watchdog warnings, and intercom messages.

## File Structure

- Create `src/tui/dashboard-style.ts`: shared overlay constants, frame rendering, ANSI-safe padding, viewport fitting, and small-terminal rendering.
- Create `tests/dashboard-style.test.ts`: exact width, viewport, and narrow-terminal regressions.
- Modify `src/tui/chain-clarify.ts`: modern key matching, native `Input`, focus forwarding, and dashboard rendering.
- Modify `src/core/slash-chain.ts`: TUI-only preview gating and safe preview failure behavior.
- Modify `src/tui/agents-menu.ts` and `src/tui/conversation-viewer.ts`: shared framed overlays and viewport behavior.
- Modify `src/tui/agent-widget.ts`, `src/tui/chain-widget.ts`, and `src/tui/fleet-list.ts`: compact dashboard-style headings and rows without changing placement or lifecycle.
- Modify `src/tui/render.ts` and `src/index.ts`: consistent inline status and metadata hierarchy.
- Modify corresponding existing `tests/*.test.ts` files, `package.json`, `pnpm-lock.yaml`, `README.md`, and `CHANGELOG.md`.

---

### Task 1: Align the Pi Baseline and Add Dashboard Primitives

**Files:**

- Create: `src/tui/dashboard-style.ts`
- Create: `tests/dashboard-style.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

```ts
import type { OverlayOptions } from "@earendil-works/pi-tui";
import type { Theme } from "./agent-widget.js";

export const DASHBOARD_MAX_HEIGHT_RATIO = 0.85;
export const DASHBOARD_OVERLAY_OPTIONS: OverlayOptions;
export const MIN_DASHBOARD_FRAME_WIDTH = 7;

export function dashboardContentWidth(width: number): number;
export function renderDashboardFrame(
  lines: readonly string[],
  width: number,
  theme: Theme,
): string[];
export function fitDashboardViewport(
  lines: readonly string[],
  selectedLine: number | undefined,
  height: number,
  offset: number,
): { lines: string[]; offset: number };
export function renderDashboardTooSmall(
  width: number,
  height: number,
  theme: Theme,
): string[];
```

- [ ] **Step 1: Update only the three Pi development packages.**

  In `package.json`, change these versions and leave TypeScript, Vitest, Biome, TypeBox, engines, and peer dependencies unchanged:

  ```json
  {
    "devDependencies": {
      "@earendil-works/pi-ai": "^0.84.3",
      "@earendil-works/pi-coding-agent": "^0.84.3",
      "@earendil-works/pi-tui": "^0.84.3"
    }
  }
  ```

  Run:

  ```bash
  pnpm install --lockfile-only
  pnpm typecheck
  ```

  Expected: the lockfile resolves the three Pi packages at `0.84.3` and the existing source typechecks without compatibility shims. If typecheck exposes a real upstream API change, record the exact compiler error in this task and make only the smallest call-site adjustment required by that error.

- [ ] **Step 2: Write failing frame and viewport tests.**

  Create `tests/dashboard-style.test.ts` with a no-ANSI theme and these assertions:

  ```ts
  import { describe, expect, test } from "vitest";
  import {
    dashboardContentWidth,
    fitDashboardViewport,
    renderDashboardFrame,
    renderDashboardTooSmall,
  } from "../src/tui/dashboard-style.js";

  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  describe("dashboard style", () => {
    test("renders every frame row at the requested visible width", () => {
      const lines = renderDashboardFrame(["Header", "Body"], 24, theme);
      expect(lines).toHaveLength(6);
      expect(lines.every((line) => line.length === 24)).toBe(true);
      expect(lines[0]).toBe(`┏${"━".repeat(22)}┓`);
      expect(lines.at(-1)).toBe(`┗${"━".repeat(22)}┛`);
      expect(dashboardContentWidth(24)).toBe(18);
    });

    test("moves the viewport until the selected row is visible", () => {
      const result = fitDashboardViewport(["0", "1", "2", "3", "4"], 4, 3, 0);
      expect(result).toEqual({ lines: ["2", "3", "4"], offset: 2 });
    });

    test("renders a bounded small-terminal escape message", () => {
      const lines = renderDashboardTooSmall(30, 3, theme);
      expect(lines).toHaveLength(3);
      expect(lines.every((line) => line.length === 30)).toBe(true);
      expect(lines.join("\n")).toContain("Esc");
    });
  });
  ```

- [ ] **Step 3: Run the new tests and confirm the missing module failure.**

  ```bash
  pnpm vitest run tests/dashboard-style.test.ts
  ```

  Expected: FAIL because `src/tui/dashboard-style.ts` does not exist.

- [ ] **Step 4: Implement the exact shared primitives.**

  Adapt pi-status' frame and viewport algorithms into `src/tui/dashboard-style.ts` with these fixed values:

  ```ts
  import {
    truncateToWidth,
    visibleWidth,
    type OverlayOptions,
  } from "@earendil-works/pi-tui";
  import type { Theme } from "./agent-widget.js";

  const PADDING_X = 2;
  const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

  export const DASHBOARD_MAX_HEIGHT_RATIO = 0.85;
  export const MIN_DASHBOARD_FRAME_WIDTH = 7;
  export const DASHBOARD_OVERLAY_OPTIONS: OverlayOptions = {
    anchor: "center",
    width: "92%",
    maxHeight: "85%",
  };

  function pad(text: string, width: number): string {
    if (width <= 0) return "";
    const value = truncateToWidth(text, width, "");
    return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
  }

  export function dashboardContentWidth(width: number): number {
    return Math.max(1, Math.floor(width) - 2 - PADDING_X * 2);
  }
  ```

  Implement `renderDashboardFrame()` with top border, one blank row, padded content, one blank row, and bottom border. Implement `fitDashboardViewport()` with clamped height/offset and selected-row visibility. Implement `renderDashboardTooSmall()` as fixed-width rows with `Terminal too small · Esc` centered vertically.

- [ ] **Step 5: Run the focused tests and typecheck.**

  ```bash
  pnpm vitest run tests/dashboard-style.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: all dashboard primitive tests pass, every rendered line stays within its requested visible width, and no unrelated dependency changes appear.

- [ ] **Step 6: Commit the foundation.**

  ```bash
  git add package.json pnpm-lock.yaml src/tui/dashboard-style.ts tests/dashboard-style.test.ts
  git commit -m "feat: add dashboard ui primitives"
  ```

### Task 2: Repair `/run-chain` Input and Restyle the Preview

**Files:**

- Modify: `src/tui/chain-clarify.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `tests/chain-clarify.test.ts`
- Modify: `tests/slash-chain.test.ts`
- Modify: `tests/core/chain-clarify-integration.test.ts`

**Interfaces:**

- Consumes `DASHBOARD_OVERLAY_OPTIONS`, `dashboardContentWidth()`, `fitDashboardViewport()`, `renderDashboardFrame()`, and `renderDashboardTooSmall()` from Task 1.
- Preserves `ChainClarifyResult = { action: "run" | "cancel" | "bg"; steps: ChainStep[] }`.
- `ChainClarifyComponent` implements both `Component` and `Focusable`; its `focused` setter forwards focus to the active `Input`.

- [ ] **Step 1: Add failing CSI-u component regressions.**

  Extend `tests/chain-clarify.test.ts` with encoded keys that Pi/TUI recognizes but the raw switch currently ignores:

  ```ts
  test("CSI-u Enter returns the run action", () => {
    const { component, result } = makeComponent([
      { agent: "scout", task: "analyze" },
    ]);
    component.handleInput("\x1b[13u");
    expect(result.value?.action).toBe("run");
  });

  test("CSI-u printable shortcuts navigate and background the chain", () => {
    const { component, result } = makeComponent([
      { agent: "scout", task: "analyze" },
      { agent: "worker", task: "change" },
    ]);
    component.handleInput("\x1b[106u");
    expect(
      component
        .render(80)
        .some((line) => line.includes("▸") && line.includes("worker")),
    ).toBe(true);
    component.handleInput("\x1b[98u");
    expect(result.value?.action).toBe("bg");
  });
  ```

  Update legacy cursor assertions from `>` to the dashboard marker `▸` in the same test file.

- [ ] **Step 2: Add a failing command-to-component integration regression.**

  In `tests/slash-chain.test.ts`, construct a TUI command context whose `ui.custom` calls the provided factory, feeds `"\x1b[13u"` into the returned component, and resolves from `done`. Invoke `executeSlashChain()` with one valid Scout step and assert `manager.spawnAndWait` is called exactly once.

  Add a second case where `ui.custom` rejects with `new Error("preview failed")`; assert `spawnAndWait` is not called and `pi.sendMessage` receives a visible `pi-subagent-result` containing `preview failed`.

  The context must include:

  ```ts
  const ctx = {
    mode: "tui",
    cwd: "/tmp",
    model: parentModel,
    modelRegistry,
    ui: {
      custom: async (factory: Function) =>
        await new Promise((resolve) => {
          const component = factory(
            mockTui,
            mockTheme,
            mockKeybindings,
            resolve,
          );
          component.handleInput("\x1b[13u");
        }),
    },
  } as unknown as ExtensionCommandContext;
  ```

- [ ] **Step 3: Run both regressions and confirm the root-cause failure.**

  ```bash
  pnpm vitest run tests/chain-clarify.test.ts tests/slash-chain.test.ts
  ```

  Expected: the legacy tests pass, while CSI-u Enter/printable input does not resolve the current component and the integration path does not reach `spawnAndWait`.

- [ ] **Step 4: Replace raw keys and manual editing with Pi/TUI primitives.**

  In `chain-clarify.ts`:
  - Import `Input`, `Key`, `matchesKey`, `type Focusable`, and `isKeyRelease` from `@earendil-works/pi-tui`.
  - Ignore key-release events before dispatching actions.
  - Use `matchesKey(data, Key.enter)`, `matchesKey(data, Key.escape)`, `matchesKey(data, Key.up)`, and `matchesKey(data, Key.down)` for primary actions.
  - Preserve `j`/`k`, `q`, `b`, `e`, and `m` by matching each printable key through `matchesKey()`.
  - Replace `editBuffer` and `handleEditInput()` with one `Input | undefined`. Prefill through `input.handleInput(currentValue)`, save through `input.onSubmit`, and return to list mode through `input.onEscape`.
  - Implement `focused` getter/setter and forward the value to the current `Input`.
  - Clear input focus in `dispose()`.

  Render the overlay as:

  ```text
  Chain Preview · N steps

  ▸ [1/N] agent
      Task   task text
      Model  inherited-or-override

  ↑/↓ Select • e Edit task • m Edit model • Enter Run • b Background • q/Esc Cancel
  ```

  Use `fitDashboardViewport()` so the selected step remains visible and `renderDashboardTooSmall()` when the frame or body cannot fit. Parallel groups remain read-only and show their child agent names; do not add parallel-item editing.

- [ ] **Step 5: Gate the preview to TUI and use shared overlay options.**

  In `executeSlashChain()` keep the existing `!bg && !yes` condition and add `ctx.mode === "tui"`. Pass:

  ```ts
  { overlay: true, overlayOptions: DASHBOARD_OVERLAY_OPTIONS }
  ```

  to `ctx.ui.custom()`. Keep cancellation as an immediate return. Wrap the custom call inside `executeSlashChain()` so a rejected preview sends a visible `pi-subagent-result` containing the error and returns before preflight or dispatch. This shared error path must cover both `/chain` and `/run-chain`.

  Update test contexts that intentionally exercise the preview to include `mode: "tui"`. Add one `mode: "rpc"` case and assert the chain executes without calling `ui.custom`.

- [ ] **Step 6: Run chain input, execution, and preflight regressions.**

  ```bash
  pnpm vitest run \
    tests/chain-clarify.test.ts \
    tests/core/chain-clarify-integration.test.ts \
    tests/slash-chain.test.ts \
    tests/chain-preflight.test.ts \
    tests/chain-execution.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: legacy and CSI-u input both work, confirmation reaches the first child spawn, cancellation does not spawn, `--yes`/`--bg` still bypass the preview, and preflight behavior is unchanged.

- [ ] **Step 7: Commit the root fix and preview migration.**

  ```bash
  git add src/core/slash-chain.ts src/tui/chain-clarify.ts \
    tests/chain-clarify.test.ts tests/core/chain-clarify-integration.test.ts tests/slash-chain.test.ts
  git commit -m "fix: handle modern input in chain preview"
  ```

### Task 3: Migrate `/agents` Menus to Framed Overlays

**Files:**

- Modify: `src/tui/agents-menu.ts`
- Modify: `tests/agents-menu.test.ts`

**Interfaces:**

- Consumes the Task 1 dashboard frame, viewport, small-terminal renderer, and overlay options.
- Preserves `showAgentsMenu()`, `runAgentsMenuAction()`, `runAgentsMenuSettingsFlow()`, `SETTINGS_MENU_ITEMS`, and every persisted setting parser.

- [ ] **Step 1: Add failing dashboard-menu render and navigation tests.**

  Extend the menu test harness so `ctx.ui.custom` captures the returned component. Assert:

  ```ts
  expect(component.render(80)[0]).toMatch(/^┏━/);
  expect(component.render(80).at(-1)).toMatch(/━┛$/);
  expect(component.render(80).join("\n")).toContain("↑/↓ Select");
  ```

  Add a 12-row terminal fixture with more rows than fit, move down to the last row using `matchesKey`-compatible input, and assert the selected row remains rendered. Keep existing action, scope, parsing, create, edit, disable, export, and delete assertions.

- [ ] **Step 2: Run the menu tests and confirm the unframed failure.**

  ```bash
  pnpm vitest run tests/agents-menu.test.ts
  ```

  Expected: current behavioral tests pass and the new frame/viewport assertions fail.

- [ ] **Step 3: Refactor only `showRowsMenu()` presentation.**

  Keep all agent and settings workflows unchanged. Inside `showRowsMenu()`:
  - Track `selectedIndex` and `offset`.
  - Render the title, a blank row, aligned menu rows, a blank row, and the supplied footer through `renderDashboardFrame()`.
  - Use `▸` in accent for the selected row and dim text for unselected rows.
  - Use `fitDashboardViewport()` with terminal rows capped at `85%`; selection must remain visible.
  - Use the shared small-terminal output and keep Escape operational.
  - Invoke `ctx.ui.custom()` with the shared centered overlay options.
  - Keep `ctx.ui.select()` as the non-custom fallback.

  Do not replace `ctx.ui.input()` or `ctx.ui.editor()` in create, edit, or settings flows.

- [ ] **Step 4: Run all agent-menu tests and typecheck.**

  ```bash
  pnpm vitest run tests/agents-menu.test.ts tests/agents.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: the dashboard frame and scrolling work while all existing agent actions and setting writes retain their current arguments and results.

- [ ] **Step 5: Commit the menu migration.**

  ```bash
  git add src/tui/agents-menu.ts tests/agents-menu.test.ts
  git commit -m "refactor: frame agents menus as dashboard overlays"
  ```

### Task 4: Migrate the Conversation Viewer and Composer

**Files:**

- Modify: `src/tui/conversation-viewer.ts`
- Modify: `src/tui/fleet-list.ts`
- Modify: `tests/conversation-viewer.test.ts`
- Modify: `tests/fleet-list.test.ts`

**Interfaces:**

- Consumes Task 1 dashboard primitives and overlay options.
- Preserves `ConversationViewer`, `ViewerKeybindings`, Fleet activation, live session subscription, steering, stopping, and cleanup.
- Changes `VIEWPORT_HEIGHT_PCT` from `70` to `85` so internal body sizing matches the shared overlay cap.

- [ ] **Step 1: Add failing frame, focus, and viewport tests.**

  Add tests asserting the viewer uses `┏━`/`━┛`, renders the dashboard footer vocabulary, and fits within `Math.floor(terminal.rows * 0.85)` rows. Add a focus test:

  ```ts
  component.focused = true;
  component.handleInput("\x1b[13u");
  expect(component.render(80).join("\n")).toContain("Steer agent");
  component.focused = false;
  ```

  In FleetList tests, assert the custom overlay receives `DASHBOARD_OVERLAY_OPTIONS` and existing activation/key-release behavior still consumes exactly the same keys.

- [ ] **Step 2: Run focused tests and confirm the visual/focus failures.**

  ```bash
  pnpm vitest run tests/conversation-viewer.test.ts tests/fleet-list.test.ts
  ```

  Expected: current scroll/steer/stop tests pass; new shared-frame and focus-forwarding assertions fail.

- [ ] **Step 3: Reuse the frame and implement `Focusable`.**

  In `ConversationViewer`:
  - Implement `Focusable` with `_focused`, getter, and setter.
  - Forward focus to the composer when it exists; remove unconditional `input.focused = true`.
  - Render header, content viewport, and footer as content passed to `renderDashboardFrame()` instead of maintaining a second border implementation.
  - Keep message extraction, truncation limits, live auto-scroll, scroll percentage, steering, two-press stop, and `dispose()` subscription cleanup unchanged.
  - Set `VIEWPORT_HEIGHT_PCT = 85` and include the shared frame's four chrome rows in viewport calculations.

  In `FleetList`, replace its inline `90%`/`70%` overlay values with `DASHBOARD_OVERLAY_OPTIONS`; do not change terminal-input capture or roster behavior.

- [ ] **Step 4: Run viewer/fleet and lifecycle tests.**

  ```bash
  pnpm vitest run tests/conversation-viewer.test.ts tests/fleet-list.test.ts tests/agent-manager.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: the viewer stays live after agent completion, steering and stop callbacks fire once, Escape closes, key releases remain ignored by FleetList, and all rows remain ANSI-width safe.

- [ ] **Step 5: Commit the viewer migration.**

  ```bash
  git add src/tui/conversation-viewer.ts src/tui/fleet-list.ts \
    tests/conversation-viewer.test.ts tests/fleet-list.test.ts
  git commit -m "refactor: migrate conversation viewer to dashboard frame"
  ```

### Task 5: Restyle Persistent and Inline Surfaces

**Files:**

- Modify: `src/tui/agent-widget.ts`
- Modify: `src/tui/chain-widget.ts`
- Modify: `src/tui/fleet-list.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/index.ts`
- Modify: `tests/agent-widget.test.ts`
- Modify: `tests/chain-widget.test.ts`
- Modify: `tests/fleet-list.test.ts`
- Modify: `tests/render.test.ts`
- Modify: `tests/watchdog-render.test.ts`

**Interfaces:**

- No new exported runtime interfaces.
- Preserve widget keys (`agents`, `chain`, `fleet`), placements, timers, status keys, message custom types, expanded/collapsed behavior, and notification details.

- [ ] **Step 1: Lock the compact visual grammar in failing tests.**

  Update render expectations to require these exact conventions:

  ```text
  ╭─ ✦ AGENTS
  │ ● worker  description · metadata
  │   ⎿ activity
  ╰─ running/queued summary
  ```

  ```text
  ╭─ ✦ CHAIN · chain-id
  │ [1/N] ✓ agent
  ╰─ completed/running summary
  ```

  FleetList remains unboxed but uses `✦ Agents`, `▸` for the active row, dim `•` separators, and one dashboard-style footer hint. Inline render tests must assert icon + bold subject on the first line, dim metadata on the second line, and indented preview/content below it.

  Preserve existing assertions for maximum widget lines, overflow priority, right-aligned fleet statistics, expanded result fields, output paths, watchdog severity, and grouped notifications.

- [ ] **Step 2: Run render tests and confirm only expected-string failures.**

  ```bash
  pnpm vitest run \
    tests/agent-widget.test.ts \
    tests/chain-widget.test.ts \
    tests/fleet-list.test.ts \
    tests/render.test.ts \
    tests/watchdog-render.test.ts
  ```

  Expected: state/lifecycle assertions pass and the new presentation assertions fail.

- [ ] **Step 3: Restyle widgets without changing lifecycle code.**

  In AgentWidget and ChainWidget, alter only `renderWidget()`/`renderLines()` output assembly:
  - Use `╭─ ✦ TITLE`, `│` body prefixes, and `╰─` summary/last row.
  - Keep `success`, `accent`, `warning`, `error`, `muted`, and `dim` semantic roles.
  - Keep spinner cadence, overflow caps, finished-agent aging, timers, widget registration, and status text unchanged.

  In FleetList, change only labels, selection marker, separators, and footer copy. Keep its unboxed compact form, right alignment, activation boundary, roster order, and five-agent window.

- [ ] **Step 4: Normalize inline renderer hierarchy.**

  In `src/tui/render.ts`, centralize only these two formatting helpers:

  ```ts
  function statusHeader(icon: string, subject: string, status: string): string;
  function metadataLine(parts: readonly string[]): string;
  ```

  Reuse them for subagent calls/results and completion notifications. In `src/index.ts`, apply the same first-line header and second-line metadata structure to watchdog warnings and intercom messages while preserving their custom message types, details, expanded content, and severity colors.

  Do not add a card component: Pi already supplies the native message/tool shell.

- [ ] **Step 5: Run all UI render and lifecycle tests.**

  ```bash
  pnpm vitest run \
    tests/agent-widget.test.ts \
    tests/chain-widget.test.ts \
    tests/fleet-list.test.ts \
    tests/render.test.ts \
    tests/watchdog-render.test.ts \
    tests/notification-renderer.test.ts \
    tests/agent-manager.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: all owned passive and inline surfaces share the agreed hierarchy without changing update timing, placement, payloads, or cleanup.

- [ ] **Step 6: Commit passive and inline styling.**

  ```bash
  git add src/tui/agent-widget.ts src/tui/chain-widget.ts src/tui/fleet-list.ts \
    src/tui/render.ts src/index.ts tests/agent-widget.test.ts tests/chain-widget.test.ts \
    tests/fleet-list.test.ts tests/render.test.ts tests/watchdog-render.test.ts
  git commit -m "refactor: unify subagent ui presentation"
  ```

### Task 6: Document, Verify, and Package the Migration

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Verify: all files changed by Tasks 1–5

**Interfaces:**

- Documentation declares Pi `0.84.3+` and the existing command behavior; it introduces no new configuration keys or flags.

- [ ] **Step 1: Update compatibility and usage documentation.**

  In README:
  - Add `Pi 0.84.3 or newer is required` beside the existing Node requirement.
  - Update `/run-chain` documentation to state that foreground execution opens a keyboard-accessible preview; Enter runs, `b` backgrounds, Escape cancels, and `--yes` skips it.
  - Update `/agents` and Fleet descriptions to mention centered dashboard overlays and current navigation keys.

  In CHANGELOG, add an Unreleased section containing:

  ```markdown
  ## Unreleased

  ### Fixed

  - Handle CSI-u/Kitty keyboard input in the foreground chain preview so `/run-chain` can be confirmed in modern terminals.

  ### Changed

  - Align pi-subagents UI surfaces with the pi-status dashboard visual language and raise the tested Pi baseline to 0.84.3.
  ```

- [ ] **Step 2: Run the complete automated verification.**

  ```bash
  pnpm check
  pnpm pack --dry-run
  git diff --check
  ```

  Expected: Biome lint, TypeScript, every Vitest suite, package contents, and whitespace checks pass. The tarball includes `src/tui/dashboard-style.ts` through the existing `src` package inclusion.

- [ ] **Step 3: Perform manual modern-terminal acceptance.**

  In a TUI session using Ghostty, Kitty, or another terminal with CSI-u input enabled:
  1. Run `/run-chain implement -- inspect this repository`; navigate with arrows and `j`/`k`, edit task/model, cancel once, then reopen and confirm with Enter. Verify the first agent starts.
  2. Reopen the chain and press `b`; verify a background chain ID appears and ChainWidget updates.
  3. Run the same command with `--yes`; verify no preview appears.
  4. Open `/agents`; browse agents, enter Settings, cancel a native input, and return without losing keyboard focus.
  5. Start a background agent, activate FleetList from an empty prompt, open ConversationViewer, steer once, and close with Escape.
  6. Resize below the dashboard minimum and back; verify the small-terminal message appears and the selected row returns into view.
  7. Switch Pi themes; verify every owned surface follows the active theme without writing a color configuration.

  Record the terminal name and Pi version in the implementation handoff. Any failed path blocks completion.

- [ ] **Step 4: Review the final diff for scope.**

  ```bash
  git status --short
  git diff --stat
  git diff -- package.json README.md CHANGELOG.md src/tui src/core/slash-chain.ts tests
  ```

  Expected: no chain execution semantics, schemas, settings formats, agent discovery, manager logic, or unrelated files changed.

- [ ] **Step 5: Commit documentation and final verification changes.**

  ```bash
  git add README.md CHANGELOG.md
  git commit -m "docs: document dashboard ui migration"
  ```

## Completion Criteria

- `/run-chain` accepts legacy and CSI-u/Kitty input and reaches execution after explicit confirmation.
- Run, Background, Cancel, edit, `--yes`, `--bg`, non-TUI, and preflight paths have runnable regressions.
- All three interactive overlays use the shared dashboard frame and selected-row-aware viewport.
- All three persistent surfaces and all inline renderers use the agreed compact dashboard hierarchy.
- Pi's current theme is the only color source.
- No new runtime dependency, palette, setting, schema, command, or custom form exists.
- `pnpm check`, `pnpm pack --dry-run`, `git diff --check`, and manual modern-terminal acceptance all pass.
