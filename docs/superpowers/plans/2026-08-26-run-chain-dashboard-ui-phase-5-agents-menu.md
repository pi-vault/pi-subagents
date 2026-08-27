# Phase 5: Agents Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every custom `/agents` list and detail menu to a responsive centered dashboard overlay without changing agent, settings, or native dialog behavior.

**Architecture:** Refactor the existing `showRowsMenu()` presentation boundary only. It will reuse the Phase 3 dashboard frame, height ratio, selected-row viewport, small-terminal fallback, and overlay options; all callers and workflows continue to use the same values and `RuntimeDeps` operations. Pi's native `input()`, `editor()`, and non-custom `select()` remain responsible for their own focus and lifecycle after the custom overlay closes.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent@0.84.3`, `@earendil-works/pi-tui@0.84.3`, Vitest, pnpm, Node `24.15.0`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

**Prerequisite:** Phase 4 live widgets is merged at `65445e0`.

**Usable result:** `/agents` list, detail, settings, and scope menus render inside the same `92%` by `85%` dashboard overlay, keep the selected row visible, fall back safely on tiny terminals, and preserve every existing action.

## Reference Decisions

- `/Users/lanh/Developer/pi-packages/pi` at tag `v0.84.3`: `ExtensionUIContext.custom()` requires `{ overlay: true, overlayOptions }` for an overlay; Pi focuses the custom component and restores the editor when it closes. Native `input()` and `editor()` dialogs manage their own focus.
- `/Users/lanh/Developer/pi-vault/pi-status`: reuse its `85%` height cap, eight-row dashboard chrome, one-row normal minimum, heavy frame, small-terminal fallback, and selected-row-aware viewport.
- `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents`: retain the useful bounded-list behavior—visible selection, viewport retention, and concise key hints—without importing its search field or selector component.
- `/Users/lanh/Developer/pi-packages/tintinweb-pi-subagents`: keep native create, settings, and markdown dialogs outside the custom list component; closing the list before opening a native dialog is the focus handoff.

## Global Constraints

- Modify only `src/tui/agents-menu.ts` and `tests/agents-menu.test.ts`.
- Reuse `DASHBOARD_OVERLAY_OPTIONS`, `DASHBOARD_MAX_HEIGHT_RATIO`, `MIN_DASHBOARD_FRAME_WIDTH`, `fitDashboardViewport()`, `renderDashboardFrame()`, and `renderDashboardTooSmall()` from `src/tui/dashboard-style.ts`; add no component, dependency, setting, or shared helper.
- Pass both `overlay: true` and `overlayOptions: DASHBOARD_OVERLAY_OPTIONS` to `ctx.ui.custom()`. Pi ignores overlay sizing when `overlay` is omitted.
- Preserve `showAgentsMenu()`, `runAgentsMenuAction()`, `runAgentsMenuSettingsFlow()`, `SETTINGS_MENU_ITEMS`, `renderRow()`, all `RuntimeDeps` calls, settings parsers, and notification text.
- Preserve current bounded navigation: Up stops at the first row and Down stops at the last row. Do not add wrapping, search, filtering, or new shortcuts.
- Preserve immediate delete behavior. A confirmation dialog would be a separate behavior change and is outside this visual migration.
- Keep creation, settings input, and markdown editing on Pi's native `ctx.ui.input()` and `ctx.ui.editor()` APIs. The custom menu contains no focusable child, so do not add `Focusable` or manual focus forwarding.
- Keep the non-custom `ctx.ui.select()` fallback unchanged.
- Existing repository-wide Biome diagnostics are out of scope; do not edit unrelated files to silence them.

---

### Task 1: Migrate the Shared Rows Menu to the Dashboard Overlay

**Files:**

- Modify: `tests/agents-menu.test.ts`
- Modify: `src/tui/agents-menu.ts`

**Interfaces:**

- Consumes:
  - `DASHBOARD_OVERLAY_OPTIONS: OverlayOptions`
  - `DASHBOARD_MAX_HEIGHT_RATIO = 0.85`
  - `MIN_DASHBOARD_FRAME_WIDTH = 7`
  - `fitDashboardViewport(lines, selectedLine, height, offset)`
  - `renderDashboardFrame(lines, width, theme)`
  - `renderDashboardTooSmall(width, height, theme)`
- Preserves:
  - `showRowsMenu<T>(ctx, title, rows, footer): Promise<T | undefined>`
  - every exported symbol and caller-visible result from `src/tui/agents-menu.ts`
- Local layout contract:
  - `MENU_CHROME_ROWS = 8`: four frame rows plus title, two separators, and one footer row
  - `MIN_MENU_DASHBOARD_ROWS = 9`: chrome plus one selectable body row
  - body height is `targetRows - MENU_CHROME_ROWS`

- [ ] **Step 1: Extend the test harness to expose the custom component and overlay options.**

  In `tests/agents-menu.test.ts`, import the installed width helper and shared options:

  ```ts
  import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
  import {
    type Component,
    type OverlayOptions,
    type TUI,
    visibleWidth,
  } from "@earendil-works/pi-tui";
  import { DASHBOARD_OVERLAY_OPTIONS } from "../src/tui/dashboard-style.js";
  ```

  Replace the one-off `MenuFactory` inside `driveOverrideEdit()` with file-level harness types that capture the same component shape Pi receives:

  ```ts
  type MenuComponent = Component & { handleInput(data: string): void };

  type MenuFactory = (
    tui: TUI,
    theme: ReturnType<typeof createTheme>["theme"],
    keyboard: KeybindingsManager,
    done: (value: undefined) => void,
  ) => MenuComponent;

  type CustomOptions = {
    overlay?: boolean;
    overlayOptions?: OverlayOptions | (() => OverlayOptions);
  };

  const TEST_PATHS = {
    userAgentsDir: "/path/that/does/not/exist/user-agents",
    bundledAgentsDir: "/path/that/does/not/exist/bundled-agents",
  } as ResolvedPaths;
  ```

  Move the existing local `paths` value to `TEST_PATHS`. Add this driver for nested menus:

  ```ts
  type TestTui = {
    terminal: { columns: number; rows: number };
    requestRender: ReturnType<typeof vi.fn>;
  };

  type MenuScript = (
    component: MenuComponent,
    tui: TestTui,
    capture: () => void,
  ) => void;

  function createCustomDriver(
    scripts: MenuScript[],
    terminalRows = 40,
    width = 80,
  ) {
    const renders: string[][] = [];
    const options: CustomOptions[] = [];
    let invocation = 0;

    const custom = async (
      factory: MenuFactory,
      customOptions?: CustomOptions,
    ): Promise<void> => {
      const script = scripts[invocation++];
      if (!script) throw new Error(`Missing menu script ${invocation}`);

      await new Promise<void>((resolveDone) => {
        const tui: TestTui = {
          terminal: { columns: width, rows: terminalRows },
          requestRender: vi.fn(),
        };
        const component = factory(
          tui as unknown as TUI,
          createTheme().theme,
          {} as KeybindingsManager,
          () => resolveDone(),
        );
        options.push(customOptions ?? {});
        script(component, tui, () => renders.push(component.render(width)));
      });
    };

    return { custom, options, renders };
  }
  ```

  Each script must call Enter or Escape so its custom-menu promise resolves. It can call `capture()` before or after input to retain the render needed by the assertion.

  Keep `driveOverrideEdit()` on top of this driver so the existing catalog/edit/error assertions remain unchanged.

- [ ] **Step 2: Add failing overlay, frame, and footer regressions.**

  Add a root-menu test at width `80` and terminal height `40`. Close it with Escape after capturing the first render, then assert:

  ```ts
  expect(lines[0]).toMatch(/^┏━/);
  expect(lines.at(-1)).toMatch(/━┛$/);
  expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true);
  expect(lines.join("\n")).toContain("▸ Agents (0)");
  expect(lines.join("\n")).toContain("↑/↓ Select");
  expect(lines.join("\n")).toContain("Enter Choose");
  expect(lines.join("\n")).toContain("Esc Close");
  expect(customOptions).toEqual({
    overlay: true,
    overlayOptions: DASHBOARD_OVERLAY_OPTIONS,
  });
  ```

  This must inspect the options object, not only `DASHBOARD_OVERLAY_OPTIONS`, because Pi applies `overlayOptions` only when `overlay: true` is present.

- [ ] **Step 3: Add failing viewport and resize regressions.**

  Use a catalog with twelve entries and terminal height `14`, which yields an eleven-row overlay and a three-row body viewport. Script the root menu to press Enter, then script the catalog menu with eleven Down inputs before rendering it. Assert the selected twelfth agent is visible and the first agent is not. Send eleven Up inputs, render again, and assert the first selected agent is visible.

  Use Pi-compatible encodings in the driver:

  ```ts
  const KITTY_DOWN = "\x1b[1;1B";
  const KITTY_UP = "\x1b[1;1A";
  const CSI_U_ENTER = "\x1b[13u";
  const CSI_U_ESCAPE = "\x1b[27u";
  ```

  Add a resize case that selects a lower catalog row, renders at terminal height `14`, changes `tui.terminal.rows` to `3`, renders at width `30`, then restores height `14` and width `80`. Assert:

  ```ts
  expect(tinyLines).toHaveLength(2); // floor(3 * 0.85)
  expect(tinyLines.every((line) => visibleWidth(line) === 30)).toBe(true);
  expect(tinyLines.join("\n")).toContain("Esc");
  expect(restoredLines.join("\n")).toContain("▸ agent-12");
  ```

  Finish each scripted catalog flow with CSI-u Escape, then provide one final root-menu script that also sends CSI-u Escape. Assert `showAgentsMenu()` resolves. The second Escape is required because closing the catalog returns to the root menu; together they prove the fallback does not trap keyboard input or orphan the parent menu.

- [ ] **Step 4: Preserve action and native-dialog coverage.**

  Retain the current override-edit test and record call order around `done()` and `ctx.ui.editor()`. Assert the action overlay closes before the native editor opens; do not assert or implement manual focus mutation.

  Import `runAgentsMenuAction` and add two direct delegation regressions:

  ```ts
  test("create keeps the native input/editor workflow", async () => {
    const input = vi
      .fn()
      .mockResolvedValueOnce("planner")
      .mockResolvedValueOnce("Plans work")
      .mockResolvedValueOnce("read, bash")
      .mockResolvedValueOnce("provider/model")
      .mockResolvedValueOnce("high")
      .mockResolvedValueOnce("worker");
    const editor = vi.fn().mockResolvedValue("Plan carefully.");
    const discovery = { agents: [], diagnostics: [] };
    const created: AgentDefinition = {
      name: "planner",
      description: "Plans work",
      tools: ["read", "bash"],
      subagentAgents: ["worker"],
      systemPrompt: "Plan carefully.",
      sourcePath: `${TEST_PATHS.userAgentsDir}/planner.md`,
    };
    const createAgentFile = vi.fn(() => created);

    await runAgentsMenuAction(
      { kind: "create-agent" },
      { ui: { input, editor, notify: vi.fn() } } as never,
      {
        resolvePaths: vi.fn(() => TEST_PATHS),
        discoverAgents: vi.fn(() => discovery),
        discoverToolNames: vi.fn(() => ["read", "bash"]),
        createAgentFile,
      } as unknown as RuntimeDeps,
    );

    expect(createAgentFile).toHaveBeenCalledWith(
      TEST_PATHS,
      {
        name: "planner",
        filenameSlug: undefined,
        description: "Plans work",
        tools: ["read", "bash"],
        model: "provider/model",
        thinking: "high",
        subagentAgents: ["worker"],
        systemPrompt: "Plan carefully.",
      },
      discovery,
      ["read", "bash"],
    );
  });

  test("delete keeps the existing immediate RuntimeDeps action", async () => {
    const deleteUserAgentOverride = vi.fn();

    await runAgentsMenuAction(
      { kind: "delete-override", agentName: "planner" },
      { ui: { notify: vi.fn() } } as never,
      {
        resolvePaths: vi.fn(() => TEST_PATHS),
        deleteUserAgentOverride,
      } as unknown as RuntimeDeps,
    );

    expect(deleteUserAgentOverride).toHaveBeenCalledWith(TEST_PATHS, "planner");
  });
  ```

  Reuse the existing `paths` fixture shape rather than introducing a second fixture module.

- [ ] **Step 5: Run the focused test file and confirm only the new presentation assertions fail.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/agents-menu.test.ts
  ```

  Expected: the new frame, viewport, fallback, and overlay-option assertions fail because `showRowsMenu()` is still unframed and does not pass custom options. Existing behavior tests and the new direct create/delete delegation tests pass.

- [ ] **Step 6: Replace the custom `Container` rendering with the shared dashboard renderer.**

  In `src/tui/agents-menu.ts`, remove `Container` and `Text` from the Pi/TUI import. Add:

  ```ts
  import {
    DASHBOARD_MAX_HEIGHT_RATIO,
    DASHBOARD_OVERLAY_OPTIONS,
    MIN_DASHBOARD_FRAME_WIDTH,
    fitDashboardViewport,
    renderDashboardFrame,
    renderDashboardTooSmall,
  } from "./dashboard-style.js";

  const MENU_CHROME_ROWS = 8;
  const MIN_MENU_DASHBOARD_ROWS = MENU_CHROME_ROWS + 1;
  const MENU_KEY_HINTS = "↑/↓ Select • Enter Choose • Esc Close";
  ```

  Inside the custom branch of `showRowsMenu()`:
  - retain `selectedIndex` and `selectedValue`,
  - add `let viewportOffset = 0`,
  - calculate the target height from `tui.terminal.rows`,
  - render only the selected-aware body through `fitDashboardViewport()`, and
  - place the key hints before optional caller context so narrow terminals keep the controls visible.

  Use this exact render structure:

  ```ts
  const maxRows = Math.max(
    1,
    Math.floor(tui.terminal.rows * DASHBOARD_MAX_HEIGHT_RATIO),
  );
  const targetRows =
    maxRows < MIN_MENU_DASHBOARD_ROWS
      ? maxRows
      : Math.min(maxRows, MENU_CHROME_ROWS + Math.max(1, renderedRows.length));

  if (
    width < MIN_DASHBOARD_FRAME_WIDTH ||
    targetRows < MIN_MENU_DASHBOARD_ROWS
  ) {
    return renderDashboardTooSmall(width, targetRows, theme);
  }

  const bodyLines = renderedRows.map((row, index) =>
    renderRow(theme, row, index === selectedIndex),
  );
  const viewport = fitDashboardViewport(
    bodyLines,
    selectedIndex,
    targetRows - MENU_CHROME_ROWS,
    viewportOffset,
  );
  viewportOffset = viewport.offset;
  const footerText = footer ? `${MENU_KEY_HINTS} • ${footer}` : MENU_KEY_HINTS;

  return renderDashboardFrame(
    [
      theme.fg("accent", theme.bold(title)),
      "",
      ...viewport.lines,
      "",
      theme.fg("dim", footerText),
    ],
    width,
    theme,
  );
  ```

  Add this exact second argument to the existing `ctx.ui.custom()` call:

  ```ts
  {
    overlay: true,
    overlayOptions: DASHBOARD_OVERLAY_OPTIONS,
  }
  ```

  In `showAgentsBrowser()`, replace the duplicated default key-hint footer with `undefined`; keep only the diagnostic context:

  ```ts
  catalog.userDiagnostics.length > 0
    ? `${catalog.userDiagnostics.length} invalid user agent file(s) skipped`
    : undefined;
  ```

  Do not change any other caller footer. The shared renderer prepends key hints and preserves each caller's path, count, or scope context after them.

- [ ] **Step 7: Run focused tests and typecheck.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/agents-menu.test.ts \
    tests/agents.test.ts
  mise exec node@24.15.0 -- pnpm typecheck
  git diff --check
  ```

  Expected: all commands exit `0`. The frame has exact visible widths, both scrolling directions keep selection visible, tiny terminals remain escapable, and existing agent persistence tests pass.

---

### Task 2: Verify the Phase as a User-Visible Migration

**Files:**

- Verify only: `src/tui/agents-menu.ts`
- Verify only: `tests/agents-menu.test.ts`

**Interfaces:**

- Produces no new runtime interface.
- Accepts the phase only when the focused tests, full repository check, diff validation, and manual `/agents` smoke path all pass.

- [ ] **Step 1: Run the complete repository check with the required runtime and isolated Git config.**

  Run:

  ```bash
  mise exec node@24.15.0 -- env GIT_CONFIG_GLOBAL=/dev/null pnpm check
  ```

  Expected: exit `0`; all Vitest files pass. `GIT_CONFIG_GLOBAL=/dev/null` prevents the host's commit-signing configuration from breaking temporary Git repositories created by worktree and watchdog tests. Existing Biome warnings and infos may still be printed; do not fix them in this phase.

- [ ] **Step 2: Inspect the final diff for scope and whitespace errors.**

  Run:

  ```bash
  git status --short
  git diff -- src/tui/agents-menu.ts tests/agents-menu.test.ts
  git diff --check
  ```

  Expected: the implementation diff touches only `src/tui/agents-menu.ts` and `tests/agents-menu.test.ts`, and `git diff --check` exits `0`. The plan file may remain as a separate unstaged planning change; do not include it in the implementation commit.

- [ ] **Step 3: Smoke-test the native dialog handoff in Pi.**

  Start a local extension session:

  ```bash
  mise exec node@24.15.0 -- pi -e ./src/index.ts
  ```

  In the session:
  1. Open `/agents` at a normal terminal size and confirm the centered heavy frame, visible `▸` selection, footer hints, and preserved path/count context.
  2. Resize the terminal until the fallback appears; confirm Escape closes it, then restore the terminal and reopen `/agents`.
  3. Open the agent catalog and scroll past the viewport in both directions; confirm the selected row remains visible.
  4. Choose `Create new agent`, then cancel the first native input.
  5. Open a global override, choose `Edit`, then cancel the native markdown editor.
  6. Open Settings, enter a setting's native input, cancel it, and return through every menu with Escape.

  Expected: each custom menu closes before Pi opens a native dialog; canceling a native dialog returns to the correct menu without stale focus or an orphaned overlay.

- [ ] **Step 4: Commit the verified migration.**

  ```bash
  git add src/tui/agents-menu.ts tests/agents-menu.test.ts
  git commit -m "feat: migrate agents menu to dashboard overlay"
  ```

  Do not stage the plan file during implementation; it belongs to the planning change that precedes this phase.
