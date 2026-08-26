# Phase 2: Chain Input Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make /run-chain and /chain previews respond to modern CSI-u/Kitty keyboard input and prevent a failed preview from launching a chain.

**Architecture:** Replace raw byte comparisons in ChainClarifyComponent with the Pi/TUI matchesKey() and native Input primitives, forward focus through Focusable, and gate the shared slash-chain preview to TUI mode. Preserve the current preview appearance; dashboard styling starts in Phase 3.

**Tech Stack:** TypeScript, @earendil-works/pi-ai@0.84.3, @earendil-works/pi-coding-agent@0.84.3, @earendil-works/pi-tui@0.84.3, Vitest, pnpm, Node 24.15.0.

**Spec:** docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design

## Global Constraints

- Keep the Pi development packages and lockfile at 0.84.3.
- Preserve /run-chain, /chain, prompt-workflow execution, --yes, --bg, schemas, and ChainClarifyResult.
- Use the exact preview condition ctx.mode === "tui" && !bg && !yes in executeSlashChain().
- A normal cancel (undefined result or { action: "cancel" }) returns silently and does not dispatch.
- A synchronous or rejected preview failure reports one visible pi-subagent-result error and does not dispatch.
- Do not introduce dashboard primitives, frame glyphs, viewport logic, or visual changes; those belong to Phase 3.
- The separate clarify path in src/core/subagent.ts is out of scope because it has a different structured tool-result contract.
- Run automated checks with Node 24.15.0; the current shell is Node 23.11.0 and is below the package engine requirement.

---

## Current repository fit

- src/tui/chain-clarify.ts currently has a raw switch over legacy bytes and a hand-rolled edit buffer. Its 22 tests cover only legacy input.
- executeSlashChain() in src/core/slash-chain.ts is the shared path for /chain, /run-chain, and prompt-workflow callers. Its preview currently checks only !bg && !yes, and a rejected ctx.ui.custom() promise escapes before dispatch.
- tests/slash-chain.test.ts already owns executor integration and manager spawn assertions. tests/core/chain-clarify-integration.test.ts currently owns only stripExecutionFlags() coverage, so it remains unchanged unless a command-boundary regression is strictly needed.
- The Phase 1 dependency baseline is already merged at HEAD aee51bc; all three Pi development packages and the lockfile resolve to 0.84.3.

## Reference alignment

- /Users/lanh/Developer/pi-packages/pi, tag v0.84.3: packages/tui/src/keys.ts supplies matchesKey() and isKeyRelease(); packages/tui/src/components/input.ts supplies setValue(), onSubmit, onEscape, focused, and CSI-u text decoding; the extension-input and llama/ui examples forward wrapper focus to their active Input; ExtensionContext.mode is tui, rpc, json, or print.
- /Users/lanh/Developer/pi-vault/pi-status: src/tui/dashboard.ts demonstrates matchesKey() plus Input/Focusable. src/tui/overlay-render.ts and src/tui/dashboard-layout.ts are presentation references for Phase 3 only.
- /Users/lanh/Developer/pi-packages/nicobailon-pi-subagents: src/tui/fleet.ts and src/slash/slash-commands.ts confirm release-safe key handling and the custom-component boundary; no chain-preview implementation exists there.
- /Users/lanh/Developer/pi-packages/tintinweb-pi-subagents: src/ui/fleet-list.ts uses matchesKey()/isKeyRelease() at an input boundary; its fleet state is unrelated to this phase.

### Task 1: Reproduce modern input failures

**Files:**

- Test: tests/chain-clarify.test.ts

**Interfaces:**

- Use the existing makeComponent() helper and ChainClarifyComponent constructor. Do not change production code in this task.

- [ ] **Step 1: Add the failing CSI-u action tests.**

  Keep the legacy tests and add these exact cases:

  ```ts
  test("CSI-u Enter key returns run action", () => {
    const { component, result } = makeComponent([
      { agent: "scout", task: "analyze" },
    ]);
    component.handleInput("\x1b[13u");
    expect(result.value?.action).toBe("run");
  });

  test("CSI-u j moves the selection", () => {
    const { component } = makeComponent([
      { agent: "scout", task: "analyze" },
      { agent: "planner", task: "plan" },
    ]);
    component.handleInput("\x1b[106u");
    expect(
      component
        .render(80)
        .some((line) => line.includes(">") && line.includes("planner")),
    ).toBe(true);
  });

  test("CSI-u b returns background action", () => {
    const { component, result } = makeComponent([
      { agent: "scout", task: "analyze" },
    ]);
    component.handleInput("\x1b[98u");
    expect(result.value?.action).toBe("bg");
  });
  ```

- [ ] **Step 2: Add the release-event regression.**

  Send "\x1b[13;1:3u" to a fresh component and assert result.value is still undefined. This must remain true after matchesKey() is introduced, so a Kitty key release cannot confirm the chain.

- [ ] **Step 3: Run the red test.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/chain-clarify.test.ts
  ```

  Expected: the three CSI-u action tests fail against the raw switch; the release test may already pass because the raw switch ignores that sequence.

### Task 2: Repair input and focus at the boundary

**Files:**

- Modify: src/tui/chain-clarify.ts
- Test: tests/chain-clarify.test.ts

**Interfaces:**

- ChainClarifyComponent continues to expose the existing constructor, handleInput(), invalidate(), render(), and ChainClarifyResult variants.
- ChainClarifyComponent additionally implements Focusable through a focused getter/setter and keeps one native Input instance for edit mode.

- [ ] **Step 1: Replace the raw input boundary with Pi/TUI primitives.**

  Use the installed 0.84.3 API:

  ```ts
  import {
    Input,
    isKeyRelease,
    Key,
    matchesKey,
    type Component,
    type Focusable,
    type TUI,
  } from "@earendil-works/pi-tui";

  private input = new Input();
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  dispose(): void {
    this.input.focused = false;
    this.input.onSubmit = undefined;
    this.input.onEscape = undefined;
  }
  ```

  Make the class implement Component and Focusable. At the start of handleInput(), return when isKeyRelease(data) is true. In list mode use matchesKey(data, Key.enter), Key.escape, Key.up, and Key.down plus matchesKey(data, "j"), "k", "q", "b", "e", and "m". Preserve the current bounds, actions, result shapes, requestRender() calls, render wording, and > selection marker.

- [ ] **Step 2: Delegate edit behavior to the native Input.**

  Keep the existing edit-task/edit-model mode state and override maps, but remove editBuffer and its manual mutation from handleInput(). When entering edit mode, seed the native input without sending the seed through key handling:

  ```ts
  this.input.setValue(
    mode === "edit-task"
      ? (this.taskOverrides.get(this.selectedIndex) ?? seq.task ?? "")
      : (this.modelOverrides.get(this.selectedIndex) ?? seq.model ?? ""),
  );
  this.input.onSubmit = (value) => {
    if (this.mode === "edit-task") {
      this.taskOverrides.set(this.selectedIndex, value);
    } else {
      this.modelOverrides.set(this.selectedIndex, value);
    }
    this.mode = "list";
    this.tui.requestRender();
  };
  this.input.onEscape = () => {
    this.mode = "list";
    this.tui.requestRender();
  };
  ```

  Forward all edit-mode data other than the release guard to input.handleInput(data). Render input.render(width) in the existing edit layout so the native cursor marker, cursor movement, deletion, paste, submit, and escape behavior come from Pi/TUI. Do not add frames, the Phase 3 selection glyph, viewport scrolling, or a dashboard footer.

- [ ] **Step 3: Replace tests that assert the hand-rolled cursor.**

  Retain the existing edit/result/parallel coverage, but assert the edited value rather than the old trailing underscore. Add focused cases for CSI-u printable text (for example "\x1b[104u" and "\x1b[105u"), Kitty arrow aliases "\x1b[1;1B" and "\x1b[1;1A", native backspace "\x7f", CSI-u Enter submit, Escape discard, and focus propagation:

  ```ts
  component.handleInput("e");
  component.handleInput("\x1b[104u");
  component.handleInput("\x1b[105u");
  component.handleInput("\x7f");
  component.focused = true;
  expect(component.render(80).join("\n")).toContain(CURSOR_MARKER);
  ```

  Also assert focused=false removes the marker, parallel steps remain read-only, legacy keys remain supported, and the release event never resolves the component.

- [ ] **Step 4: Run the focused green checks.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/chain-clarify.test.ts
  mise exec node@24.15.0 -- pnpm typecheck
  ```

  Expected: all legacy and CSI-u component tests pass and the component remains type-safe against Pi/TUI 0.84.3.

### Task 3: Gate previews and fail closed

**Files:**

- Modify: src/core/slash-chain.ts
- Test: tests/slash-chain.test.ts

**Interfaces:**

- Keep executeSlashChain() parameters, command registration, dispatch functions, and pi-subagent-result message shape unchanged.
- Test the shared executeSlashChain() boundary once; /chain and /run-chain both delegate to it, so duplicate command fixtures add no coverage. Retain the existing /run-chain saved-chain materialization test.

- [ ] **Step 1: Add a TUI factory test that exercises CSI-u confirmation.**

  In the existing executeSlashChain validation tests, create a ui.custom spy that captures its options, invokes the supplied factory with a minimal TUI/theme/keybinding fixture, sends "\x1b[13u" to the returned component, and resolves through the supplied done callback. With ctx.mode set to "tui", assert a valid chain calls manager.spawnAndWait exactly once, ui.custom receives overlay: true, and overlayOptions remains { anchor: "center", width: 84, maxHeight: "80%" } with no dashboard-specific options.

  The fixture shape is:

  ```ts
  let seenOptions: { overlay?: boolean; overlayOptions?: unknown };
  const custom = vi.fn(
    (
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: ClarifyResult) => void,
      ) => ChainClarifyComponent,
      options: { overlay?: boolean; overlayOptions?: unknown },
    ) => {
      seenOptions = options;
      return new Promise<ClarifyResult>((resolve) => {
        const component = factory(
          { requestRender: vi.fn() } as TUI,
          {
            fg: (_name: string, text: string) => text,
            bold: (text: string) => text,
          } as Theme,
          {} as KeybindingsManager,
          resolve,
        );
        component.handleInput("\x1b[13u");
      });
    },
  );
  ```

  Add these type-only imports to the test:

  ```ts
  import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
  import type { TUI } from "@earendil-works/pi-tui";
  import type {
    ChainClarifyComponent,
    ChainClarifyResult,
  } from "../src/tui/chain-clarify.js";
  import type { Theme } from "../src/tui/agent-widget.js";
  ```

  Use the existing createDeps(), AgentManager, completedRecord(), and model registry setup from nearby tests rather than adding a new helper file.

- [ ] **Step 2: Add no-dispatch cancellation and failure tests.**

  Cover this exact matrix with manager spies:
  - custom resolves { action: "cancel", steps }: no spawn, no fire-and-forget, no pi-subagent-result message.
  - custom resolves undefined: no spawn, no fire-and-forget, no pi-subagent-result message.
  - custom rejects new Error("preview failed"): executeSlashChain() resolves without throwing, no spawn, no fire-and-forget, and exactly one message matches:

    ```ts
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "pi-subagent-result",
        content: expect.stringContaining("preview failed"),
        display: true,
      }),
    );
    ```

  - custom synchronously throws new Error("preview failed"): the same one-message/no-dispatch assertions as the rejected promise case.

- [ ] **Step 3: Add mode and flag bypass assertions.**

  Add mode: "rpc" to a valid no-flag case and assert the chain executes while ui.custom is not called. Update the existing preview test named preflights only the final clarification edit to use mode: "tui". In TUI mode, assert yes=true bypasses preview and preserves foreground spawn, while bg=true bypasses preview and preserves fire-and-forget dispatch. Keep the existing saved-chain materialization test unchanged.

- [ ] **Step 4: Implement the single shared gate and error boundary.**

  Replace the current !bg && !yes condition with this exact policy, retaining the existing final normalization and dispatch blocks after the preview:

  ```ts
  if (ctx.mode === "tui" && !bg && !yes) {
    const { ChainClarifyComponent } = await import("../tui/chain-clarify.js");
    let result: ClarifyResult | undefined;
    try {
      result = await ctx.ui.custom(
        (tui, theme, _kb, done) =>
          new ChainClarifyComponent(tui, theme, chain, done),
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" },
        },
      );
    } catch (error) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: error instanceof Error ? error.message : String(error),
        display: true,
      });
      return;
    }
    if (!result || result.action === "cancel") return;
    try {
      chain = normalizeAndPreflight(result.steps);
    } catch (error) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: error instanceof Error ? error.message : String(error),
        display: true,
      });
      return;
    }
    if (result.action === "bg") bg = true;
  }
  ```

  Catch only the custom call inside the preview branch. Report synchronous factory throws and rejected custom promises through the existing visible result shape, before final preflight or dispatch. Keep cancellation silent.

- [ ] **Step 5: Run the integration checks.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run tests/chain-clarify.test.ts tests/slash-chain.test.ts tests/core/chain-clarify-integration.test.ts
  ```

  Expected: CSI-u confirmation reaches the first child, cancellation and both failure forms cannot dispatch, non-TUI/--yes/--bg paths bypass the preview, and existing flag/materialization coverage remains green.

### Task 4: Verify and commit

- [ ] **Step 1: Run the full checks.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm check
  git diff --check
  ```

  If temporary-repository tests inherit a user-level commit.gpgsign setting, rerun the same check with GIT_CONFIG_GLOBAL=/dev/null; do not change repository or global Git configuration.

- [ ] **Step 2: Perform the terminal-only manual check.**

  In a CSI-u/Kitty-capable terminal, run /run-chain and /chain. Verify arrows, j/k, editing, native backspace/cursor behavior, Escape cancel, reopen, Enter confirmation, and b background action. Record the manual check as unavailable rather than passing when no such terminal is available.

- [ ] **Step 3: Review the implementation diff.**

  Confirm the implementation changes only src/tui/chain-clarify.ts, src/core/slash-chain.ts, tests/chain-clarify.test.ts, and tests/slash-chain.test.ts. Do not modify tests/core/chain-clarify-integration.test.ts unless a narrowly justified command-boundary regression is added.

- [ ] **Step 4: Commit the implementation.**

  ```bash
  git add src/tui/chain-clarify.ts src/core/slash-chain.ts tests/chain-clarify.test.ts tests/slash-chain.test.ts
  git commit -m "fix: support modern chain preview input"
  ```
