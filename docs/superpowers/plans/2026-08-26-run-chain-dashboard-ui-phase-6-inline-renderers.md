# Phase 6: Inline Renderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give subagent calls/results, completion notifications, watchdog warnings, and intercom requests one compact header-metadata-content hierarchy without changing their runtime contracts.

**Architecture:** Keep Pi `0.84.3`'s native tool and custom-message shells. Centralize text composition in `src/tui/render.ts` with two private string helpers; `src/index.ts` remains registration and fallback wiring. Existing payloads, custom message types, expanded detail fields, and delivery behavior remain unchanged.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent@0.84.3`, `@earendil-works/pi-tui@0.84.3`, Vitest, pnpm, Node `24.15.0`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

**Prerequisite:** Phase 5 is merged; this branch starts from `2d27361`.

**Usable result:** Every pi-subagents-owned inline surface uses the same compact visual hierarchy while retaining Pi's native shell, expansion behavior, payload, and delivery semantics.

## Global Constraints

- Modify only `src/tui/render.ts`, `src/index.ts`, `tests/render.test.ts`, `tests/notification-renderer.test.ts`, and `tests/index.test.ts`.
- Verify, but do not modify, `src/core/watchdog-render.ts`, `tests/watchdog-render.test.ts`, and `tests/intercom.test.ts` unless a failing regression proves the existing contract is wrong.
- Preserve tool call/result payloads, `pi-subagent-result`, `subagent-notification`, `watchdog-warning`, and `intercom-request` custom types, `display`, `deliverAs`, and `triggerTurn` values.
- Preserve collapsed/expanded result content, the five-item collapsed activity cap, the 30-line expanded notification cap, transcript/session/artifact paths, stderr, exit code, stop reason, watchdog evidence/action/category, and intercom request details.
- Use only Pi theme roles available at `v0.84.3`: `accent`, `success`, `error`, `warning`, `toolTitle`, `muted`, and `dim`. Remove the current untyped `cyan` use from intercom rendering.
- Keep Pi's native tool `Box` and custom-message shell. Do not add a card, frame, `renderShell: "self"`, palette, setting, dependency, or exported generic UI abstraction.
- Tests assert plain semantic structure or theme-role markers, never ANSI escape sequences.
- Existing repository-wide Biome warnings are out of scope; do not edit unrelated files to silence them.

## Reference Decisions

- `/Users/lanh/Developer/pi-packages/pi` at tag `v0.84.3`: custom tool renderers are already composed inside Pi's default `Box`; message renderers return a component. Phase 6 supplies content only and must not draw another shell.
- `/Users/lanh/Developer/pi-vault/pi-status` at `b47dadc`: use active-theme semantic roles and dim `·` separators. Do not import its palette, statusbar state, frame, or configuration.
- `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` at `2e23ae7`: follow its compact icon + bold subject + status pattern, one indented activity/content branch, semantic success/error/warning states, and bounded metadata.
- `/Users/lanh/Developer/pi-packages/tintinweb-pi-subagents` at `86c72ae`: retain the proven completion-notification structure—header, stats, collapsed/expanded result preview, optional transcript—and grouped notification behavior.

## Presentation Contract

All surfaces use the same logical rows; absent metadata rows are omitted rather than rendered blank.

```text
<semantic icon> <bold subject> <status>
  <metadata part> · <metadata part>
  ⎿  <preview or content>
```

Status presentation is fixed:

| Surface state                            | Icon | Icon role | Status role          |
| ---------------------------------------- | ---: | --------- | -------------------- |
| Subagent tool call                       |  `●` | `accent`  | `accent` (`running`) |
| Result `success`                         |  `✓` | `success` | `success`            |
| Result `error`, `timeout`, `aborted`     |  `✗` | `error`   | `error`              |
| Result `steered`                         |  `■` | `warning` | `warning`            |
| Result `background`                      |  `●` | `accent`  | `accent`             |
| Completion `completed`, `steered`        |  `✓` | `success` | `dim`                |
| Completion `error`, `stopped`, `aborted` |  `✗` | `error`   | `dim`                |
| Watchdog blocker                         |  `⚠` | `error`   | `error`              |
| Watchdog concern                         |  `⚠` | `warning` | `warning`            |
| Intercom request                         |  `◆` | `accent`  | `dim`                |

## File Structure

- Modify `src/tui/render.ts`: own the two private hierarchy helpers plus subagent, notification, watchdog, and intercom text builders.
- Modify `src/index.ts`: delegate watchdog and intercom message callbacks to the builders; preserve fallback behavior and delivery wiring.
- Modify `tests/render.test.ts`: exact subagent status matrix, metadata order, expanded detail preservation, watchdog, and intercom builder regressions.
- Modify `tests/notification-renderer.test.ts`: exact notification hierarchy plus existing status, cap, transcript, and grouped-result coverage.
- Modify `tests/index.test.ts`: prove all four custom renderers remain registered and watchdog/intercom registrations use the new output.

---

### Task 1: Normalize Subagent Calls, Results, and Completion Notifications

**Files:**

- Modify: `tests/render.test.ts`
- Modify: `tests/notification-renderer.test.ts`
- Modify: `src/tui/render.ts:16-269`

**Interfaces:**

- Preserves:
  - `buildSubagentCallText(args, theme): string`
  - `buildSubagentResultText(content, details, expanded, theme): string`
  - `renderSubagentCall(args, theme): Text`
  - `renderSubagentResult(result, options, theme): Text`
  - `renderSubagentMessage(message, options, theme): Text`
  - `buildNotificationText(details, expanded, theme): string`
  - `toSubagentCommandMessage(result): SubagentCommandMessage`
- Adds only private helpers:

  ```ts
  function statusHeader(icon: string, subject: string, status: string): string;
  function metadataLine(parts: readonly string[]): string;
  ```

- The helpers receive already-themed header fragments or raw metadata text. They do not import or capture a theme.

- [ ] **Step 1: Add a semantic-role theme and exact call/result status regressions.**

  In `tests/render.test.ts`, keep the existing no-ANSI `theme` for content assertions and add:

  ```ts
  const semanticTheme = {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<b>${text}</b>`,
  };
  ```

  Replace the loose call-header test with exact hierarchy assertions:

  ```ts
  test("renders a running call with metadata before the task preview", () => {
    const lines = buildSubagentCallText(
      {
        agent: "Scout",
        task: "Inspect repo structure and summarize findings in a compact report.",
        cwd: "/repo/worktree",
      },
      theme,
    ).split("\n");

    expect(lines).toEqual([
      "● Scout running",
      "  cwd /repo/worktree",
      "  ⎿  Inspect repo structure and summarize findings in a compact report.",
    ]);
  });
  ```

  Add role assertions that do not depend on terminal escape codes:

  ```ts
  test("uses Pi semantic roles for a running call", () => {
    const firstLine = buildSubagentCallText(
      { agent: "Scout", task: "Inspect" },
      semanticTheme,
    ).split("\n")[0];

    expect(firstLine).toBe(
      "<accent>●</accent> <toolTitle><b>Scout</b></toolTitle> <accent>running</accent>",
    );
  });

  test.each([
    ["success", "✓", "success"],
    ["error", "✗", "error"],
    ["timeout", "✗", "error"],
    ["aborted", "✗", "error"],
    ["steered", "■", "warning"],
  ] as const)(
    "renders %s with the expected icon and role",
    (status, icon, role) => {
      const firstLine = buildSubagentResultText(
        "output",
        createDetails({ status }),
        false,
        semanticTheme,
      ).split("\n")[0];

      expect(firstLine).toContain(`<${role}>${icon}</${role}>`);
      expect(firstLine).toContain("<toolTitle><b>Scout</b></toolTitle>");
      expect(firstLine).toContain(`<${role}>${status}</${role}>`);
    },
  );
  ```

- [ ] **Step 2: Add exact collapsed, background, and fallback regressions.**

  Replace the loose collapsed-result header/metadata assertions with:

  ```ts
  test("renders collapsed result metadata in a stable order", () => {
    const lines = buildSubagentResultText(
      "final answer",
      createDetails(),
      false,
      theme,
    ).split("\n");

    expect(lines).toEqual([
      "✓ Scout success",
      "  openai/gpt-5 · 321ms · 12/8 tok · 2 turns · session /sessions/child/run-0/session.jsonl",
      "  ⎿  tools read done, bash done, write done, edit done, find done",
    ]);
    expect(lines.join("\n")).not.toContain("read start");
    expect(lines.join("\n")).not.toContain("final output:");
  });

  test("renders a background result with agent identity and optional id", () => {
    expect(
      buildSubagentResultText(
        "Agent started in background",
        createDetails({ status: "background", agentId: "agent-123" }),
        false,
        theme,
      ),
    ).toBe("● Scout background\n  id agent-123");
    expect(
      buildSubagentResultText(
        "Agent started in background",
        createDetails({ status: "background", agentId: undefined }),
        false,
        theme,
      ),
    ).toBe("● Scout background");
  });

  test("uses the accent role for a background result", () => {
    const firstLine = buildSubagentResultText(
      "Agent started in background",
      createDetails({ status: "background", agentId: "agent-123" }),
      false,
      semanticTheme,
    ).split("\n")[0];

    expect(firstLine).toContain("<accent>●</accent>");
    expect(firstLine).toContain("<accent>background</accent>");
  });

  test("keeps raw content when result details are unavailable", () => {
    expect(
      buildSubagentResultText("plain output", undefined, false, theme),
    ).toBe("plain output");
    expect(buildSubagentResultText("", undefined, false, theme)).toBe(
      "(no output)",
    );
  });
  ```

  Retain the expanded test and all assertions for task, cwd, source, max turns, thinking, duration, usage, stop reason, exit code, child session directory/path, artifact paths, recent tools, stderr, and final output. Update only its first-line expectation to `✗ Scout error`.

- [ ] **Step 3: Lock the completion hierarchy without weakening existing behavior coverage.**

  In `tests/notification-renderer.test.ts`, add this exact collapsed contract:

  ```ts
  it("renders header, metadata, and collapsed preview in order", () => {
    const lines = buildNotificationText(
      makeDetails({ maxTurns: 30 }),
      false,
      makeTheme(),
    ).split("\n");

    expect(lines).toEqual([
      "✓ Fix the login bug completed",
      "  ↻3≤30 · 5 tool uses · 12.3k token · 11.2s",
      "  ⎿  Fixed the authentication issue",
    ]);
  });
  ```

  Keep the existing completed/error/aborted/stopped/steered, singular tool use, preview truncation, 30-line expanded cap, transcript, zero-stats, max-turns, and grouped-notification tests. The grouped test must still build both entries and assert both subjects and both icons.

- [ ] **Step 4: Run the focused tests and confirm presentation-only failures.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/render.test.ts \
    tests/notification-renderer.test.ts
  ```

  Expected: the new exact hierarchy and status-role tests fail against the old subagent output. Existing expanded-detail, notification cap, transcript, grouping, and envelope tests still pass.

- [ ] **Step 5: Add the two private helpers and use them in all three builders.**

  Add below `RenderTheme` in `src/tui/render.ts`:

  ```ts
  function statusHeader(icon: string, subject: string, status: string): string {
    return [icon, subject, status].filter((part) => part.trim()).join(" ");
  }

  function metadataLine(parts: readonly string[]): string {
    const text = parts.filter((part) => part.trim()).join(" · ");
    return text ? `  ${text}` : "";
  }
  ```

  Implement `buildSubagentCallText()` with this order:

  ```ts
  const lines = [
    statusHeader(
      theme.fg("accent", "●"),
      theme.fg("toolTitle", theme.bold(args.agent || "...")),
      theme.fg("accent", "running"),
    ),
  ];
  const metadata = metadataLine([args.cwd?.trim() ? `cwd ${args.cwd}` : ""]);
  if (metadata) lines.push(theme.fg("dim", metadata));
  lines.push(
    theme.fg("dim", `  ⎿  ${previewText(args.task, MAX_TASK_PREVIEW)}`),
  );
  return lines.join("\n");
  ```

  In `buildSubagentResultText()`:
  - Keep the no-details return unchanged.
  - Render `background` as the fixed two-row form, omitting the metadata row when `agentId` is absent.
  - Map `success`, `error`, `timeout`, `aborted`, and `steered` exactly as the presentation table specifies.
  - Build collapsed metadata from model, duration, input/output token count, turns, and session path; `metadataLine()` filters an absent model or path.
  - Keep only the last five activity labels and render them as the indented `⎿` row.
  - In expanded mode, use the same status header, then retain every existing detail and final-output row. Indentation may change; labels and values may not.

  In `buildNotificationText()`:
  - Replace only the hand-built first line and stats join with `statusHeader()` and `metadataLine()`.
  - Apply `theme.fg("dim", ...)` to the complete metadata row so separators use the active theme.
  - Preserve preview limits, expanded content, transcript rendering, status wording, and grouped composition.

- [ ] **Step 6: Run focused tests and typecheck.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/render.test.ts \
    tests/notification-renderer.test.ts
  mise exec node@24.15.0 -- pnpm typecheck
  git diff --check
  ```

  Expected: all commands exit `0`; exact hierarchy tests pass and expanded data remains present.

- [ ] **Step 7: Commit the shared inline hierarchy.**

  ```bash
  git add src/tui/render.ts tests/render.test.ts tests/notification-renderer.test.ts
  git commit -m "refactor: normalize subagent inline hierarchy"
  ```

### Task 2: Delegate Watchdog and Intercom Rendering to the Shared Hierarchy

**Files:**

- Modify: `tests/render.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/index.ts:1-46,365-420,579-597`

**Interfaces:**

- Add surface-specific internal-module exports:

  ```ts
  export function buildWatchdogWarningText(
    details: WatchdogWarningInput,
    expanded: boolean,
    theme: RenderTheme,
  ): string;

  export function buildIntercomRequestText(
    details: IntercomRequest,
    theme: RenderTheme,
  ): string;
  ```

- `WatchdogWarningInput` remains defined by `src/core/watchdog-render.ts`.
- `IntercomRequest` remains defined by `src/core/intercom.ts`.
- `src/index.ts` continues to own message registration, no-details fallbacks, and `Text` construction.

- [ ] **Step 1: Add exact watchdog and intercom builder regressions.**

  Import `buildWatchdogWarningText` and `buildIntercomRequestText` in `tests/render.test.ts`, then add:

  ```ts
  test("renders a collapsed blocker as header, metadata, and summary", () => {
    const text = buildWatchdogWarningText(
      {
        severity: "blocker",
        summary: "Null pointer dereference",
        evidence: "src/foo.ts:42",
        recommendedAction: "Add null check",
        category: "correctness",
        state: "displayed",
        agentId: "agent-xyz",
      },
      false,
      theme,
    );

    expect(text.split("\n")).toEqual([
      "⚠ Watchdog Blocker displayed",
      "  correctness · agent agent-xyz",
      "  ⎿  Null pointer dereference",
    ]);
  });

  test("preserves expanded watchdog evidence and action", () => {
    const text = buildWatchdogWarningText(
      {
        severity: "concern",
        summary: "Missing test coverage",
        evidence: "src/bar.ts",
        recommendedAction: "Add unit test",
        category: "test-gap",
        autoFollowAttempt: 2,
      },
      true,
      theme,
    );

    expect(text).toContain("⚠ Watchdog Concern auto-follow attempt 2");
    expect(text).toContain("Evidence: src/bar.ts");
    expect(text).toContain("Recommended action: Add unit test");
    expect(text).toContain("Category: test-gap");
  });

  test.each([
    ["stale", "stale"],
    ["failed", "failed review"],
    ["stalemate", "stalemate"],
  ] as const)("preserves the %s watchdog state label", (state, label) => {
    const firstLine = buildWatchdogWarningText(
      {
        severity: "blocker",
        summary: "Review stopped",
        evidence: "src/foo.ts:42",
        recommendedAction: "Inspect manually",
        category: "correctness",
        state,
      },
      false,
      theme,
    ).split("\n")[0];

    expect(firstLine).toContain(label);
  });

  test("renders intercom reason, request metadata, and message", () => {
    const text = buildIntercomRequestText(
      {
        id: "request-1",
        agentId: "agent-1",
        agentName: "Scout",
        reason: "need_decision",
        message: "Which file should I change?",
        expectsReply: true,
        createdAt: 1,
      },
      theme,
    );

    expect(text.split("\n")).toEqual([
      "◆ Scout need decision",
      "  agent agent-1 · request request-1 · reply requested",
      "  ⎿  Which file should I change?",
    ]);
  });

  test("labels non-blocking intercom updates without a reply promise", () => {
    const text = buildIntercomRequestText(
      {
        id: "request-2",
        agentId: "agent-1",
        agentName: "Scout",
        reason: "progress_update",
        message: "Halfway done",
        expectsReply: false,
        createdAt: 2,
      },
      theme,
    );

    expect(text).toContain("◆ Scout progress update");
    expect(text).toContain("no reply needed");
  });
  ```

  Add semantic-theme checks that blocker uses `error`, concern uses `warning`, and intercom uses `accent`; do not inspect ANSI sequences.

- [ ] **Step 2: Extend the registration test to cover every owned custom renderer.**

  In the existing `loads without throwing and registers the subagent result message renderer` test in `tests/index.test.ts`, replace the single-type assertion with:

  ```ts
  expect(renderers.map(({ customType }) => customType)).toEqual(
    expect.arrayContaining([
      "pi-subagent-result",
      "subagent-notification",
      "watchdog-warning",
      "intercom-request",
    ]),
  );
  expect(
    renderers.every(({ renderer }) => typeof renderer === "function"),
  ).toBe(true);
  ```

  In the same test, cast only the two callbacks under test:

  ```ts
  type TestRenderer = (
    message: { content: string; details?: unknown },
    options: { expanded: boolean },
    theme: {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    },
  ) => { render(width: number): string[] } | undefined;

  const rendererTheme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const rendererByType = new Map(
    renderers.map(({ customType, renderer }) => [
      customType,
      renderer as TestRenderer,
    ]),
  );
  ```

  Invoke `watchdog-warning` with the blocker fixture from Step 1 and assert rendered text contains `⚠ Watchdog Blocker displayed`, `correctness`, and `Null pointer dereference`. Invoke `intercom-request` with the intercom fixture from Step 1 and assert rendered text contains `◆ Scout need decision`, `reply requested`, and `Which file should I change?`.

- [ ] **Step 3: Run the regressions and confirm the missing-builder failures.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/render.test.ts \
    tests/index.test.ts \
    tests/watchdog-render.test.ts \
    tests/intercom.test.ts
  ```

  Expected: `tests/render.test.ts` fails because the new builders are not exported, and the new `tests/index.test.ts` output assertions fail against the old callbacks. Existing watchdog formatter, intercom manager/tool, and renderer-registration assertions remain green.

- [ ] **Step 4: Implement the two surface-specific builders in `src/tui/render.ts`.**

  Import `formatWatchdogWarningText` and the `WatchdogWarningInput` type from `../core/watchdog-render.js`, and import `IntercomRequest` as a type from `../core/intercom.js`.

  `buildWatchdogWarningText()` must:
  - derive `Watchdog Blocker` or `Watchdog Concern` from `severity`;
  - preserve state wording: `displayed`, `stale`, `failed review`, `stalemate`, and `auto-follow attempt N`;
  - use `statusHeader()` for the first row;
  - use `metadataLine()` for category and optional agent id;
  - show the summary as the collapsed `⎿` row;
  - in expanded mode, append the existing `Evidence:`, `Recommended action:`, and `Category:` values returned by `formatWatchdogWarningText()`.

  `buildIntercomRequestText()` must use this exact structure:

  ```ts
  const metadata = metadataLine([
    `agent ${details.agentId}`,
    `request ${details.id}`,
    details.expectsReply ? "reply requested" : "no reply needed",
  ]);
  return [
    statusHeader(
      theme.fg("accent", "◆"),
      theme.fg("toolTitle", theme.bold(details.agentName)),
      theme.fg("dim", details.reason.replaceAll("_", " ")),
    ),
    theme.fg("dim", metadata),
    theme.fg("dim", `  ⎿  ${details.message}`),
  ].join("\n");
  ```

  Do not render `createdAt` or `interview`; they remain in `details` exactly as before and were not previously displayed.

- [ ] **Step 5: Replace only watchdog/intercom text assembly in `src/index.ts`.**

  Update imports:
  - remove `Container` and `Spacer` from `@earendil-works/pi-tui`;
  - remove the direct `formatWatchdogWarningText` import;
  - import `buildWatchdogWarningText` and `buildIntercomRequestText` from `./tui/render.js`.

  Keep the watchdog fallback for malformed or missing details:

  ```ts
  const fallback =
    typeof (msg as { content?: string }).content === "string"
      ? (msg as { content: string }).content
      : "";
  if (!d?.summary) return new Text(fallback, 0, 0);
  return new Text(
    buildWatchdogWarningText(
      d as Parameters<typeof buildWatchdogWarningText>[0],
      opts.expanded ?? false,
      theme,
    ),
    0,
    0,
  );
  ```

  Keep the intercom no-details fallback as an empty `Text`, then delegate valid details:

  ```ts
  if (!d) return new Text("", 0, 0);
  return new Text(buildIntercomRequestText(d, theme), 0, 0);
  ```

  Do not change any `sendMessage()` call, custom type, details object, delivery option, watchdog runtime callback, or intercom manager callback.

- [ ] **Step 6: Run renderer, contract, and type checks.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/render.test.ts \
    tests/notification-renderer.test.ts \
    tests/watchdog-render.test.ts \
    tests/intercom.test.ts \
    tests/index.test.ts
  mise exec node@24.15.0 -- pnpm typecheck
  git diff --check
  ```

  Expected: all commands exit `0`; all four renderer registrations work, fallback content is preserved, and watchdog/intercom runtime contracts remain unchanged.

- [ ] **Step 7: Commit watchdog and intercom delegation.**

  ```bash
  git add src/tui/render.ts src/index.ts tests/render.test.ts tests/index.test.ts
  git commit -m "refactor: align watchdog and intercom rendering"
  ```

### Task 3: Verify the Complete Inline Renderer Phase

**Files:**

- Verify only: `src/tui/render.ts`
- Verify only: `src/index.ts`
- Verify only: `tests/render.test.ts`
- Verify only: `tests/notification-renderer.test.ts`
- Verify only: `tests/index.test.ts`
- Verify only: `tests/watchdog-render.test.ts`
- Verify only: `tests/intercom.test.ts`

**Interfaces:**

- Produces no new extension API contract, setting, custom type, command, schema, or dependency. The two new exports are surface-specific builders inside the existing internal render module.
- Accepts the phase only when focused tests, the complete repository check, diff validation, and a rendered TUI smoke path pass.

- [ ] **Step 1: Run the complete repository check with the required runtime and isolated Git config.**

  Run:

  ```bash
  mise exec node@24.15.0 -- env GIT_CONFIG_GLOBAL=/dev/null pnpm check
  ```

  Expected: exit `0`; all Vitest files pass. Existing Biome warnings and infos may be printed; do not modify unrelated files.

- [ ] **Step 2: Inspect the final diff for scope and whitespace.**

  Run:

  ```bash
  git status --short
  git diff --name-only 2d27361..HEAD
  git diff --stat 2d27361..HEAD
  git diff 2d27361..HEAD -- \
    src/tui/render.ts \
    src/index.ts \
    tests/render.test.ts \
    tests/notification-renderer.test.ts \
    tests/index.test.ts
  git diff --check 2d27361..HEAD
  git diff --check
  ```

  Expected: committed changes since the Phase 5 merge contain only the five allowed implementation files plus this Phase 6 plan if it was committed separately. No payload construction, delivery option, manager, watchdog runtime, intercom manager, schema, or dependency changes appear.

- [ ] **Step 3: Smoke-test the native-shell rendering in Pi.**

  Start a local extension session:

  ```bash
  mise exec node@24.15.0 -- pi -e ./src/index.ts
  ```

  In the session:
  1. Run `/agent Scout inspect the inline renderer files`; verify the native Pi tool shell remains, the call shows `● Scout running`, and the settled result shows the correct semantic icon/status.
  2. Toggle tool expansion; verify collapsed metadata stays one bounded row and expanded task, paths, recent tools, diagnostics, and final output remain available.
  3. Start one background Scout task and let it complete; verify the background result includes its agent id and the completion notification shows header, stats, preview, and transcript when present.
  4. Trigger one child `need_decision` intercom request; verify agent, readable reason, request metadata, and message are visible, then reply with the existing intercom tool.
  5. Switch between two Pi themes; verify all surfaces follow the active theme and no nested card/frame appears.

  Expected: presentation changes only; messages still deliver and interactions still use Pi's native shells and expansion behavior.

- [ ] **Step 4: Record verification and ensure the worktree is clean after commits.**

  Run:

  ```bash
  git log -2 --oneline
  git status --short --branch
  ```

  Expected: the two phase commits are present and no implementation files remain modified. The plan file may remain as the separate planning change that preceded implementation.

## Completion Criteria

- Subagent call and every `SubagentExecutionDetails.status` use the fixed semantic icon/status mapping.
- Collapsed metadata uses one dim `·`-separated row; absent values do not leave blank rows or separators.
- Expanded subagent results retain all task, model, thinking, usage, tool activity, diagnostic, session, artifact, stderr, and final-output fields.
- Completion notifications retain every status, statistic, preview cap, transcript, and grouped entry.
- Watchdog warnings retain severity, state, summary, evidence, recommended action, category, and agent id.
- Intercom requests retain reason, message, reply requirement, request id, agent id, and delivery behavior.
- Pi's active theme and native tool/custom-message shells remain the only styling and framing sources.
- Focused renderer/contract tests, `pnpm check`, `git diff --check`, and the TUI smoke path pass.
