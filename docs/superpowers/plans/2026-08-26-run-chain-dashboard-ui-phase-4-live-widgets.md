# Phase 4: Live Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the persistent AgentWidget and ChainWidget with the dashboard hierarchy while preserving placement and lifecycle, honoring Pi's component width, and bounding each widget to 12 rows.

**Architecture:** Keep both widgets' existing state selection, timers, registration, invalidation, and cleanup. Change only width-aware render composition: an open dashboard heading, prefixed body rows, and a summary footer; reuse Pi/TUI truncation and the existing viewport helper instead of adding another renderer.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui@0.84.3`, Vitest, pnpm, Node `24.15.0`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

**Prerequisite:** Phase 3 dashboard foundation is merged at `23ea3a2`.

**Usable result:** Running agents and chains display a compact, width-safe dashboard above the editor without flooding the terminal.

## Global Constraints

- Keep AgentWidget and ChainWidget above the editor under their existing `agents` and `chain` widget keys.
- Preserve manager state, filtering, status text, timers, spinner cadence, task ordering, completion behavior, subscriptions, invalidation, and cleanup.
- Preserve AgentWidget's 12-row maximum; apply the same 12-row maximum to ChainWidget because Pi does not cap custom component widgets.
- Use the width passed to `Component.render(width)`, not `tui.terminal.columns`.
- Normalize embedded CR/LF runs, truncate with `truncateToWidth(text, width, "")`, and assert widths with `visibleWidth()`.
- Use only the active Pi theme roles already used by the widgets: `accent`, `success`, `warning`, `error`, `muted`, and `dim`.
- Do not add a dependency, shared widget abstraction, palette, setting, frame component, or pi-status runtime import.
- Keep `renderFinishedLine()` and `statusIcon()` status semantics unchanged.

## Reference Evidence

- Pi `v0.84.3`: `packages/coding-agent/src/core/extensions/types.ts` defines component widgets as `render(width)`, while `interactive-mode.ts` caps only string-array widgets.
- pi-status: `src/tui/overlay-render.ts` and `src/tui/dashboard-layout.ts` establish ANSI-visible truncation, CR/LF normalization, and selected-row-aware viewport fitting. Reuse the local Phase 3 equivalent; do not port pi-status themes or state.
- nicobailon-pi-subagents: `src/tui/fleet-status.ts` renders from the supplied component width and bounds the live roster explicitly.
- tintinweb-pi-subagents: `src/ui/agent-widget.ts` is the closest rendering ancestor, and `test/agent-widget.test.ts` demonstrates that queue visibility and overflow accounting need dedicated regressions. Do not port its unrelated lifecycle or color features.

---

### Task 1: Make AgentWidget width-aware and restyle it

**Files:**

- Modify: `src/tui/agent-widget.ts`
- Test: `tests/agent-widget.test.ts`

**Interfaces:**

- Change the local `UICtx.setWidget()` component contract from `render(): string[]` to `render(width: number): string[]`.
- Change private rendering to `renderWidget(width: number, theme: Theme): string[]`.
- Preserve the public `AgentWidget` constructor and methods.
- Produce at most 12 rows: one heading, up to 10 body rows, and one summary footer.

- [ ] **Step 1: Update the test capture helper to exercise Pi's render width.**

  Import `visibleWidth` and change `captureRender()` so the mock terminal width can disagree with the allocated component width:

  ```ts
  function captureRender(
    ctx: ReturnType<typeof makeMockUICtx>,
    theme: Theme,
    width = 200,
    terminalColumns = 200,
  ): string[] {
    const calls = ctx.setWidget.mock.calls as Array<
      [
        string,
        (
          | ((
              tui: unknown,
              theme: Theme,
            ) => {
              render(width: number): string[];
            })
          | undefined
        ),
        unknown,
      ]
    >;
    const factory = calls.find(([key]) => key === "agents")?.[1];
    if (!factory) return [];
    const tui = {
      terminal: { columns: terminalColumns },
      requestRender: vi.fn(),
    };
    return factory(tui, theme).render(width);
  }
  ```

- [ ] **Step 2: Add failing dashboard grammar and summary tests without removing lifecycle coverage.**

  Keep every existing test. Add focused cases that lock these contracts:

  ```ts
  it("renders the live-agent dashboard hierarchy", () => {
    const manager = makeMockManager([
      makeRecord({
        type: "worker",
        description: "implement phase four",
        status: "running",
        turnCount: 2,
        live: { activeTools: ["read"], responseText: "" },
      }),
      makeRecord({ id: "queued", status: "queued" }),
    ]);
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(manager);
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme(), 100);
    expect(lines[0]).toBe("╭─ ✦ AGENTS");
    expect(lines[1]).toMatch(/^│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] worker  implement phase four · /);
    expect(lines[2]).toContain("│   ⎿ reading…");
    expect(lines.at(-1)).toBe("╰─ 1 running · 1 queued");
    widget.dispose();
  });

  it("keeps queue totals visible when active rows fill the widget", () => {
    const agents = [
      ...Array.from({ length: 7 }, (_, index) =>
        makeRecord({ id: `run-${index}`, status: "running" }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        makeRecord({ id: `queue-${index}`, status: "queued" }),
      ),
    ];
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(makeMockManager(agents));
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme(), 100);
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe("╰─ 7 running · 3 queued · +2 more");
    widget.dispose();
  });

  it("renders a finished-only dashboard", () => {
    const agent = makeRecord({
      id: "finished",
      status: "completed",
      completedAt: Date.now(),
    });
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(makeMockManager([agent]));
    widget.markFinished(agent.id);
    widget.setUICtx(ctx);
    widget.update();

    const lines = captureRender(ctx, makeMockTheme(), 100);
    expect(lines[0]).toBe("╭─ ✦ AGENTS");
    expect(lines[1]).toMatch(/^│ ✓ scout  do the thing · /);
    expect(lines.at(-1)).toBe("╰─ 1 finished");
    widget.dispose();
  });
  ```

- [ ] **Step 3: Add failing allocated-width and dynamic-text safety tests.**

  Use an ANSI theme and widths that are smaller than `tui.terminal.columns`:

  ```ts
  it("uses the allocated width and keeps every row single-line", () => {
    const ansiTheme: Theme = {
      fg: (_color, text) => `\x1b[31m${text}\x1b[39m`,
      bold: (text) => `\x1b[1m${text}\x1b[22m`,
    };
    const agent = makeRecord({
      description: "a long description\r\nwith a second line",
      status: "running",
    });
    const ctx = makeMockUICtx();
    const widget = new AgentWidget(makeMockManager([agent]));
    widget.setUICtx(ctx);
    widget.update();

    for (const width of [0, 1, 12, 40]) {
      const lines = captureRender(ctx, ansiTheme, width, 200);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
    }
    widget.dispose();
  });
  ```

  Expected failure before implementation: rows use the 200-column terminal width, the old heading is rendered, and no footer summary exists.

- [ ] **Step 4: Run the AgentWidget tests and confirm presentation-only failures.**

  Run:

  ```bash
  pnpm vitest run tests/agent-widget.test.ts
  ```

  Expected: the new grammar, footer, width, and row-cap assertions fail; existing lifecycle, filtering, status, and linger assertions pass.

- [ ] **Step 5: Implement the minimum width-aware composition.**

  In `src/tui/agent-widget.ts`:
  1. Keep `MAX_WIDGET_LINES = 12`; derive a 10-row body budget by reserving one heading and one footer row.
  2. Make the widget component callback `render: (width) => this.renderWidget(width, theme)`.
  3. Inside `renderWidget()`, clamp width with `Math.max(0, Math.floor(width))` and use one local closure that replaces CR/LF runs and calls `truncateToWidth(line, safeWidth, "")`.
  4. Render the heading as `╭─ ✦ AGENTS` using `accent` while active and `dim` when finished-only.
  5. Render each running agent as an atomic two-row unit:

     ```text
     │ <spinner> <bold agent>  <muted description> · <dim existing stats>
     │   ⎿ <dim existing activity>
     ```

  6. Render each visible finished agent as one `│ ` row using the unchanged `renderFinishedLine()` output.
  7. Do not render a separate queued body row. Put all non-zero totals in the footer in `running`, `queued`, `finished` order, using existing total counts rather than visible-row counts.
  8. Fill the body in the existing priority order: complete running pairs first, then finished rows. Never split a running pair. Append `+N more` to the footer when running or finished agents were omitted.
  9. Truncate heading, body, and footer with the same local width closure before returning them.

  Do not change `update()`, `onTurnStart()`, `markFinished()`, timers, status text, registration, invalidation, or disposal.

- [ ] **Step 6: Run focused verification.**

  Run:

  ```bash
  pnpm vitest run tests/agent-widget.test.ts
  pnpm typecheck
  git diff --check
  ```

  Expected: all AgentWidget tests pass, the component typechecks with `render(width)`, and the diff has no whitespace errors.

- [ ] **Step 7: Commit the AgentWidget change.**

  ```bash
  git add src/tui/agent-widget.ts tests/agent-widget.test.ts
  git commit -m "feat: restyle live agent widget"
  ```

---

### Task 2: Bound and restyle ChainWidget

**Files:**

- Modify: `src/tui/chain-widget.ts`
- Test: `tests/chain-widget.test.ts`

**Interfaces:**

- Consume `fitDashboardViewport()` from `src/tui/dashboard-style.ts`.
- Change `renderLines()` to `renderLines(snapshot: WorkflowGraphSnapshot, theme: Theme, width: number): string[]`.
- Keep `update()`, `clear()`, `dispose()`, `statusIcon()`, snapshot types, widget key, and placement unchanged.
- Produce at most 12 rows: one heading, up to 10 selected-aware body rows, and one summary footer.

- [ ] **Step 1: Add a helper that renders the registered component at an explicit width.**

  Extend the test context so it retains the factory, then render it with a terminal width that differs from the component width:

  ```ts
  function renderRegisteredWidget(
    ctx: ReturnType<typeof mockUICtx>,
    width: number,
    terminalColumns = 200,
  ): string[] {
    const factory = ctx.widgets.get("chain") as
      | ((
          tui: unknown,
          theme: Theme,
        ) => {
          render(width: number): string[];
        })
      | undefined;
    if (!factory) return [];
    return factory(
      { terminal: { columns: terminalColumns }, requestRender() {} },
      mockTheme(),
    ).render(width);
  }
  ```

- [ ] **Step 2: Replace loose render assertions with failing exact hierarchy tests.**

  Keep lifecycle tests and status/error coverage. Update direct `renderLines()` calls to pass a width and add:

  ```ts
  test("renders sequential progress with a dashboard summary", () => {
    const widget = new ChainWidget();
    const lines = widget.renderLines(
      makeSnapshot({
        nodes: [
          {
            id: "step-0",
            kind: "step",
            label: "Scan files",
            status: "completed",
            flatIndex: 0,
            stepIndex: 0,
          },
          {
            id: "step-1",
            kind: "step",
            label: "Create plan",
            status: "running",
            flatIndex: 1,
            stepIndex: 1,
          },
          {
            id: "step-2",
            kind: "step",
            label: "Implement",
            status: "pending",
            flatIndex: 2,
            stepIndex: 2,
          },
        ],
        currentNodeId: "step-1",
      }),
      mockTheme(),
      100,
    );

    expect(lines[0]).toBe("╭─ ✦ CHAIN · test-chain");
    expect(lines[1]).toBe("│ [1/3] ✓ Scan files");
    expect(lines[2]).toMatch(/^│ \[2\/3\] [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Create plan$/);
    expect(lines[3]).toBe("│ [3/3] ○ Implement");
    expect(lines.at(-1)).toBe("╰─ 1 completed · 1 running · 1 pending");
  });

  const parallelSnapshot = makeSnapshot({
    nodes: [
      {
        id: "step-0",
        kind: "parallel-group",
        label: "Parallel group (2)",
        status: "running",
        stepIndex: 0,
        children: [
          {
            id: "step-0-agent-0",
            kind: "agent",
            label: "Worker A",
            status: "completed",
            flatIndex: 0,
            stepIndex: 0,
          },
          {
            id: "step-0-agent-1",
            kind: "agent",
            label: "Worker B",
            status: "running",
            flatIndex: 1,
            stepIndex: 0,
          },
        ],
      },
    ],
    currentNodeId: "step-0-agent-1",
  });

  test("keeps parallel children under their parent row", () => {
    const lines = new ChainWidget().renderLines(
      parallelSnapshot,
      mockTheme(),
      100,
    );
    expect(
      lines.some(
        (line) => line.startsWith("│ [1/1]") && line.includes("Parallel group"),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) => line.startsWith("│   ├─") && line.includes("Worker A"),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) => line.startsWith("│   └─") && line.includes("Worker B"),
      ),
    ).toBe(true);
  });
  ```

- [ ] **Step 3: Add failing row-cap, active-row visibility, and width tests.**

  ```ts
  const longLabelSnapshot = makeSnapshot({
    nodes: [
      {
        id: "step-0",
        kind: "step",
        label: "long label\r\nsecond line",
        status: "running",
        flatIndex: 0,
        stepIndex: 0,
      },
    ],
    currentNodeId: "step-0",
  });

  test("caps output while keeping the active row visible", () => {
    const nodes = Array.from({ length: 15 }, (_, index) => ({
      id: `step-${index}`,
      kind: "step" as const,
      label: `Step ${index}`,
      status:
        index < 12
          ? ("completed" as const)
          : index === 12
            ? ("running" as const)
            : ("pending" as const),
      flatIndex: index,
      stepIndex: index,
    }));
    const lines = new ChainWidget().renderLines(
      makeSnapshot({ nodes, currentNodeId: "step-12" }),
      mockTheme(),
      60,
    );

    expect(lines).toHaveLength(12);
    expect(lines.join("\n")).toContain("Step 12");
    expect(lines.join("\n")).not.toContain("Step 0");
    expect(lines.at(-1)).toContain("+5 more");
  });

  test("uses the component width rather than terminal columns", () => {
    const widget = new ChainWidget();
    const ctx = mockUICtx();
    widget.setUICtx(ctx);
    widget.update(longLabelSnapshot);

    for (const width of [0, 1, 12, 40]) {
      const lines = renderRegisteredWidget(ctx, width, 200);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
    }
    widget.dispose();
  });

  test("measures ANSI output by visible width", () => {
    const ansiTheme: Theme = {
      fg: (_color, text) => `\x1b[31m${text}\x1b[39m`,
      bold: (text) => `\x1b[1m${text}\x1b[22m`,
    };
    const lines = new ChainWidget().renderLines(
      longLabelSnapshot,
      ansiTheme,
      40,
    );
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
    expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
  });
  ```

  Expected failure before implementation: ChainWidget has no heading/footer grammar, active-row viewport, or component-width rendering.

- [ ] **Step 4: Run the ChainWidget tests and confirm presentation-only failures.**

  Run:

  ```bash
  pnpm vitest run tests/chain-widget.test.ts
  ```

  Expected: the new hierarchy, cap, viewport, and width assertions fail; registration, clearing, empty-snapshot, parallel, phase, and error behavior remains green.

- [ ] **Step 5: Implement the bounded width-aware composition.**

  In `src/tui/chain-widget.ts`:
  1. Add a local `MAX_WIDGET_LINES = 12` and derive a 10-row body budget.
  2. Build body rows as `{ nodeId: string; text: string }` so `snapshot.currentNodeId` maps to the row that must remain visible.
  3. Render top-level rows as `│ [index/total] <existing status icon> <label>`. Preserve dim phase metadata and error coloring.
  4. Render parallel children as `│   ├─ <existing status icon> <label>` and `│   └─ ...`; assign each child row its child ID.
  5. Call `fitDashboardViewport()` with the selected row index, `Math.min(bodyRows.length, 10)`, and offset `0`. This reuses the Phase 3 algorithm without adding persistent viewport state or padding short widgets.
  6. Count footer statuses from top-level `snapshot.nodes` in this fixed order: `completed`, `running`, `pending`, `failed`, `paused`, `skipped`, `stopped`. Omit zero counts and append `+N more` when body rows fall outside the viewport.
  7. Render `╭─ ✦ CHAIN · <runId>` as the heading and the status totals as the `╰─` footer.
  8. Normalize CR/LF and truncate every returned row with `truncateToWidth(line, safeWidth, "")`.
  9. Change the registered component to `render: (width) => this.renderLines(this.snapshot, theme, width)` and remove the `tui.terminal.columns` truncation map.

  Do not add viewport state, change snapshot generation, or modify any lifecycle method.

- [ ] **Step 6: Run focused and full verification.**

  Run:

  ```bash
  pnpm vitest run tests/agent-widget.test.ts tests/chain-widget.test.ts
  pnpm check
  git diff --check
  ```

  Expected: both widget suites and the complete repository check pass; each returned widget row is single-line and no wider than its allocated component width.

- [ ] **Step 7: Commit the ChainWidget change.**

  ```bash
  git add src/tui/chain-widget.ts tests/chain-widget.test.ts
  git commit -m "feat: restyle live chain widget"
  ```
