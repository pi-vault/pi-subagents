# Phase 3: Dashboard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one local dashboard renderer and use it for every `ChainClarifyComponent` presentation without changing chain execution or editing behavior.

**Architecture:** A dependency-free `dashboard-style.ts` owns shared overlay options, an ANSI-safe heavy frame, selected-row viewport fitting, and a bounded small-terminal fallback. `ChainClarifyComponent` remains the single preview/editor used by slash chains and structured subagent clarification; only the slash-chain caller supplies overlay options.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui@0.84.3`, Vitest, pnpm, Node `24.15.0`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

**Prerequisite:** Phase 2 chain input repair is merged at `3408875`.

**Usable result:** Sequential, static-parallel, and dynamic-parallel chain previews render inside a responsive pi-status-inspired frame while retaining Phase 2 input, focus, editing, cancellation, and dispatch behavior.

## Global Constraints

- Keep the three Pi development packages and lockfile resolved at `0.84.3`.
- Use only Pi's active theme; add no palette, setting, config file, pi-status dependency, or shared package.
- Preserve `/run-chain`, `/chain`, prompt workflows, `--yes`, `--bg`, chain schemas, tool contracts, agent definitions, and settings formats.
- Preserve `ChainClarifyResult = { action: "run" | "cancel" | "bg"; steps: ChainStep[] }`.
- Preserve Phase 2's `matchesKey()`, key-release guard, native `Input`, focus forwarding, cursor positioning, and preview-failure behavior.
- Keep static and dynamic parallel steps read-only.
- Center slash-chain overlays at `92%` width and `85%` maximum height.
- Use Pi/TUI's `truncateToWidth()` and `visibleWidth()` for terminal width calculations.
- Do not replace the renderer with `Box` or `ScrollView`; neither owns this component's selected logical-step mapping or required heavy-frame geometry.

---

### Task 1: Add ANSI-safe dashboard primitives

**Files:**

- Create: `src/tui/dashboard-style.ts`
- Create: `tests/dashboard-style.test.ts`

**Interfaces:**

- Consumes: `OverlayOptions`, `truncateToWidth()`, and `visibleWidth()` from `@earendil-works/pi-tui`; `Theme` from `src/tui/agent-widget.ts`.
- Produces:

  ```ts
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

- [ ] **Step 1: Write the failing primitive tests.**

  Create `tests/dashboard-style.test.ts` with a plain theme and an ANSI theme. Cover these exact contracts:

  ```ts
  import { visibleWidth } from "@earendil-works/pi-tui";
  import { describe, expect, test } from "vitest";
  import {
    dashboardContentWidth,
    fitDashboardViewport,
    MIN_DASHBOARD_FRAME_WIDTH,
    renderDashboardFrame,
    renderDashboardTooSmall,
  } from "../src/tui/dashboard-style.js";

  const plainTheme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const ansiTheme = {
    fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[39m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };

  test("renders a heavy frame at the requested visible width", () => {
    const lines = renderDashboardFrame(["Header", "Body"], 24, plainTheme);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(`┏${"━".repeat(22)}┓`);
    expect(lines.at(-1)).toBe(`┗${"━".repeat(22)}┛`);
    expect(lines.every((line) => visibleWidth(line) === 24)).toBe(true);
    expect(dashboardContentWidth(24)).toBe(18);
  });

  test("preserves visible width with ANSI and embedded newlines", () => {
    const lines = renderDashboardFrame(["one\r\ntwo"], 24, ansiTheme);
    expect(lines.some((line) => line.includes("\x1b[31m"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) === 24)).toBe(true);
    expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
  });

  test("preserves the complete seven-column minimum", () => {
    expect(MIN_DASHBOARD_FRAME_WIDTH).toBe(7);
    expect(renderDashboardFrame(["x"], 7, plainTheme)).toEqual([
      "┏━━━━━┓",
      "┃     ┃",
      "┃  x  ┃",
      "┃     ┃",
      "┗━━━━━┛",
    ]);
  });

  test("keeps selection visible without unnecessary offset jumps", () => {
    const lines = ["0", "1", "2", "3", "4"];
    expect(fitDashboardViewport(lines, 4, 3, 0)).toEqual({
      lines: ["2", "3", "4"],
      offset: 2,
    });
    expect(fitDashboardViewport(lines, 2, 3, 1)).toEqual({
      lines: ["1", "2", "3"],
      offset: 1,
    });
    expect(fitDashboardViewport(["0", "1"], 1, 3, 99)).toEqual({
      lines: ["0", "1", ""],
      offset: 0,
    });
    expect(fitDashboardViewport(lines, 2, 0, 1)).toEqual({
      lines: [],
      offset: 0,
    });
  });

  test("renders a bounded small-terminal escape message", () => {
    const lines = renderDashboardTooSmall(30, 3, plainTheme);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => visibleWidth(line) === 30)).toBe(true);
    expect(lines.join("\n")).toContain("Esc");
  });
  ```

- [ ] **Step 2: Run the tests and confirm the missing-module failure.**

  ```bash
  pnpm vitest run tests/dashboard-style.test.ts
  ```

  Expected: FAIL because `src/tui/dashboard-style.ts` does not exist.

- [ ] **Step 3: Implement the minimal shared renderer.**

  In `src/tui/dashboard-style.ts`, use two columns of horizontal padding and these exact fixed values:

  ```ts
  const PADDING_X = 2;
  const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

  export const DASHBOARD_MAX_HEIGHT_RATIO = 0.85;
  export const MIN_DASHBOARD_FRAME_WIDTH = 7;
  export const DASHBOARD_OVERLAY_OPTIONS: OverlayOptions = {
    anchor: "center",
    width: "92%",
    maxHeight: "85%",
  };
  ```

  `dashboardContentWidth(width)` returns `max(1, floor(width) - 6)`. The internal padding helper replaces embedded CR/LF runs with one space, truncates with an empty ellipsis, and pads using `visibleWidth()`.

  `renderDashboardFrame()` emits the top border, one blank row, all content rows, one blank row, and the bottom border. Color frame glyphs with `theme.fg("border", glyph)` and clamp every row to the requested visible width.

  `fitDashboardViewport()` follows the pi-status algorithm: clamp height and offset, move only when the selected line is above or below the visible range, slice the visible lines, and pad short content with empty rows.

  `renderDashboardTooSmall()` clamps dimensions to at least `1`, returns exactly that many fixed-width rows, and places `theme.fg("accent", "Terminal too small · Esc")` on the middle row.

- [ ] **Step 4: Run the primitive tests and typecheck.**

  ```bash
  pnpm vitest run tests/dashboard-style.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: all primitive tests pass and every rendered row has the requested ANSI-visible width.

- [ ] **Step 5: Commit the reusable foundation.**

  ```bash
  git add src/tui/dashboard-style.ts tests/dashboard-style.test.ts
  git commit -m "feat: add dashboard ui primitives"
  ```

---

### Task 2: Render the shared chain preview and editor

**Files:**

- Modify: `src/tui/chain-clarify.ts`
- Modify: `tests/chain-clarify.test.ts`

**Interfaces:**

- Consumes: all exports from `src/tui/dashboard-style.ts` except `DASHBOARD_OVERLAY_OPTIONS`.
- Preserves: the `ChainClarifyComponent` constructor, `Component`/`Focusable` behavior, `ChainClarifyResult`, native `Input`, and all Phase 2 keys and callbacks.
- Produces: a framed list/editor bounded by `tui.terminal.rows` whose selected logical step remains visible.

- [ ] **Step 1: Give each test component a configurable terminal height.**

  Replace the shared partial `mockTui` with a `makeComponent()`-local TUI containing:

  ```ts
  const tui = {
    requestRender,
    terminal: { columns: 80, rows: terminalRows },
  } as unknown as TUI;
  ```

  Add `terminalRows = 40` as the final `makeComponent()` parameter so resize cases do not mutate shared test state.

- [ ] **Step 2: Add failing dashboard render regressions.**

  Keep all current tests and add cases that assert:

  ```ts
  test("renders a framed preview with footer and visible selection", () => {
    const { component } = makeComponent([
      { agent: "scout", task: "analyze" },
      { agent: "worker", task: "change" },
    ]);
    const lines = component.render(80);
    expect(lines[0]).toContain("┏");
    expect(lines.at(-1)).toContain("┗");
    expect(lines.find((line) => line.includes("scout"))).toContain("▸");
    expect(lines.join("\n")).toContain("Enter Run");
    expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true);
  });

  test("scrolls the complete selected sequential step into view", () => {
    const steps = Array.from({ length: 8 }, (_, index) => ({
      agent: `agent-${index}`,
      task: `task-${index}`,
      model: `model-${index}`,
    }));
    const { component } = makeComponent(steps, undefined, 13);
    for (let index = 1; index < steps.length; index++)
      component.handleInput("j");
    const output = component.render(80).join("\n");
    expect(output).toContain("▸ [8/8] agent-7");
    expect(output).toContain("task-7");
    expect(output).toContain("model-7");
    expect(output).not.toContain("agent-0");
  });

  test("renders bounded width and height fallbacks", () => {
    expect(
      makeComponent(undefined, undefined, 10).component.render(30).join("\n"),
    ).toContain("Esc");
    expect(makeComponent().component.render(6).join("\n")).not.toContain("┏");
  });

  test("renders static and dynamic parallel agents read-only", () => {
    const { component } = makeComponent([
      { parallel: [{ agent: "scout" }, { agent: "worker" }] },
      {
        expand: { from: { output: "items", path: "$.items" } },
        parallel: { agent: "reviewer", task: "review {{item}}" },
        collect: { as: "reviews" },
      },
    ]);
    const output = component.render(100).join("\n");
    expect(output).toContain("Parallel · scout, worker");
    expect(output).toContain("Dynamic parallel · reviewer");
    component.handleInput("e");
    expect(component.render(100).join("\n")).not.toContain("Edit Task");
  });
  ```

  Also assert task/model edit modes retain the heavy frame and native input, and a task containing `"first\nsecond"` produces no embedded CR/LF in any returned row. Update existing marker assertions from `>` to `▸`.

- [ ] **Step 3: Run the component test and confirm only new layout assertions fail.**

  ```bash
  pnpm vitest run tests/chain-clarify.test.ts
  ```

  Expected: Phase 2 interaction tests pass; frame, viewport, marker, parallel-label, and fallback assertions fail.

- [ ] **Step 4: Build logical list rows and selected-line metadata.**

  Add a component-level `viewportOffset = 0`. Render sequential steps as three-row blocks:

  ```text
  ▸ [1/N] scout
      Task   analyze
      Model  (inherit)
  ```

  Preserve the existing `* ` prefix for task/model overrides. Separate logical steps with one blank row between steps, with no trailing separator. For the selected sequential step, pass the model row index to `fitDashboardViewport()` so a three-row viewport contains its marker, task, and model together.

  Render static parallel groups as one row:

  ```text
  ▸ [2/N] Parallel · scout, worker
  ```

  Render dynamic parallel groups as one row:

  ```text
  ▸ [3/N] Dynamic parallel · reviewer
  ```

  Discriminate dynamic groups first with `"expand" in step`; otherwise an object with `"parallel" in step` is the static group whose `parallel` value is an array. Both variants ignore `e` and `m`, preserving read-only behavior.

- [ ] **Step 5: Apply the chain-specific height budget.**

  Keep these values private to `chain-clarify.ts`:

  ```ts
  const DASHBOARD_CHROME_ROWS = 8;
  const MIN_CHAIN_DASHBOARD_ROWS = 11;
  ```

  Calculate:

  ```ts
  const maxRows = Math.max(
    1,
    Math.floor(this.tui.terminal.rows * DASHBOARD_MAX_HEIGHT_RATIO),
  );
  const targetRows =
    maxRows < MIN_CHAIN_DASHBOARD_ROWS
      ? maxRows
      : Math.min(
          maxRows,
          DASHBOARD_CHROME_ROWS + Math.max(3, logicalBody.lines.length),
        );
  ```

  Return `renderDashboardTooSmall(width, targetRows, theme)` when `width < 7` or `targetRows < 11`. Otherwise give `targetRows - 8` rows to `fitDashboardViewport()`, store its returned offset, and frame:

  ```text
  Chain Preview · N steps

  <viewport>

  ↑/↓ Select • e Edit task • m Edit model • Enter Run • b Background • q/Esc Cancel
  ```

- [ ] **Step 6: Frame native edit mode without changing input behavior.**

  Render `Edit Task` or `Edit Model`, a three-row viewport containing `input.render(dashboardContentWidth(width))`, and `Enter Submit • Esc Cancel` through the same height/fallback/frame path. Do not replace the native input or change its submit, escape, focus, or disposal callbacks.

- [ ] **Step 7: Run component and primitive verification.**

  ```bash
  pnpm vitest run tests/dashboard-style.test.ts tests/chain-clarify.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: all existing input/edit tests and all new responsive-layout tests pass.

- [ ] **Step 8: Commit the chain renderer migration.**

  ```bash
  git add src/tui/chain-clarify.ts tests/chain-clarify.test.ts
  git commit -m "feat: render chain preview as dashboard"
  ```

---

### Task 3: Use shared slash-chain overlay options

**Files:**

- Modify: `src/core/slash-chain.ts`
- Modify: `tests/slash-chain.test.ts`

**Interfaces:**

- Consumes: `DASHBOARD_OVERLAY_OPTIONS` from `src/tui/dashboard-style.ts`.
- Preserves: the Phase 2 condition `ctx.mode === "tui" && !bg && !yes`, cancellation, rejected-preview reporting, and manager dispatch.
- Leaves unchanged: `src/core/subagent.ts`; its structured clarification path shares the component renderer but remains a non-overlay custom UI with the same result contract.

- [ ] **Step 1: Update the existing overlay-options regression.**

  In `confirms a TUI preview through CSI-u input`, replace the literal expectation with:

  ```ts
  expect(seenOptions).toEqual({
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "92%",
      maxHeight: "85%",
    },
  });
  ```

- [ ] **Step 2: Run the slash-chain test and confirm the old dimensions fail.**

  ```bash
  pnpm vitest run tests/slash-chain.test.ts
  ```

  Expected: the overlay-options assertion receives `{ width: 84, maxHeight: "80%" }`; confirmation, cancellation, rejection, RPC, `--yes`, and `--bg` tests remain green.

- [ ] **Step 3: Replace literal dimensions with the shared constant.**

  Import `DASHBOARD_OVERLAY_OPTIONS` and pass:

  ```ts
  {
    overlay: true,
    overlayOptions: DASHBOARD_OVERLAY_OPTIONS,
  }
  ```

  Do not change the preview condition, error boundary, normalization, or dispatch flow.

- [ ] **Step 4: Run focused verification.**

  ```bash
  pnpm vitest run \
    tests/dashboard-style.test.ts \
    tests/chain-clarify.test.ts \
    tests/slash-chain.test.ts \
    tests/core/chain-clarify-integration.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: all focused tests pass and production changes are limited to the renderer, chain presentation, and shared slash-chain overlay options.

- [ ] **Step 5: Run the full repository check.**

  In a sandbox where inherited Git signing blocks temporary test repositories, run:

  ```bash
  env GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=commit.gpgsign \
    GIT_CONFIG_VALUE_0=false \
    pnpm check
  ```

  Otherwise run `pnpm check` normally. Expected: 56 existing test files and 1,293 existing tests plus the new Phase 3 tests pass; existing non-fatal Biome warnings may remain unchanged.

- [ ] **Step 6: Perform interactive TUI verification.**

  Open `/run-chain` with one sequential step, a long sequential chain, a static parallel group, and a dynamic parallel group. At normal and undersized terminal dimensions verify selection, task/model editing, run, background, cancel, resize, and fallback behavior. If no interactive TUI is available, record that manual visual verification was not run.

- [ ] **Step 7: Commit the overlay wiring.**

  ```bash
  git add src/core/slash-chain.ts tests/slash-chain.test.ts
  git commit -m "feat: use dashboard chain overlay"
  ```

## Out of Scope

- Do not modify `tests/core/chain-clarify-integration.test.ts`; Phase 2 already placed command-to-component coverage in `tests/slash-chain.test.ts`.
- Do not alter the structured subagent clarification call site, chain preflight, execution, managers, widgets, `/agents`, fleet, inline renderers, or conversation viewer.
- Do not add height-budget exports for later phases; each later surface has different fixed chrome and can consume the shared ratio, frame, viewport, and fallback directly.
