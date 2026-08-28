# Phase 9: Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the completed run-chain input repair and dashboard migration, then prove the integrated result is ready for release without changing product behavior.

**Architecture:** Treat Phase 9 as a documentation-and-verification boundary. Update only the existing user documentation, run focused and repository-wide gates under the supported Node runtime, audit the cumulative Phase 1–8 diff from the pre-implementation merge, and finish with a modern-terminal acceptance matrix.

**Tech Stack:** Markdown, Node.js `24.15.0`, pnpm `11.24.0`, Biome `2.5.10`, TypeScript `7.0.2`, Vitest `4.1.11`, Pi/TUI `0.84.3`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

**Parent plan:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md` (read-only; do not modify).

**Prerequisite:** Phases 1–8 are merged. The product baseline is Phase 8 merge `5a3faea`; the cumulative implementation baseline is planning merge `30c53a1`.

**Usable result:** Users can understand the current chain and dashboard interactions, all automated release gates pass under the supported runtime, the cumulative diff preserves public contracts and package boundaries, and the manual terminal matrix has recorded evidence.

## Global Constraints

- Modify only `README.md` and `CHANGELOG.md`. This plan file is a planning change and is not part of the implementation commit.
- Do not change production code, tests, dependencies, lockfiles, workflows, commands, flags, schemas, tool contracts, agent definitions, settings, or UI placement in this phase.
- If verification exposes a product defect, stop and report the failing command or interaction. Amend the owning Phase 2–8 plan and add a focused regression there instead of improvising a Phase 9 fix.
- Retain wildcard Pi peer dependencies and the documented Pi `0.84.3+` and Node.js `24.15.0+` requirements.
- Use Pi's active theme only. Do not add a pi-status dependency, palette/config system, cross-extension import, or cross-extension read.
- Preserve `/run-chain`, `/chain`, `/agents`, `--yes`, `--bg`, chain schemas, tool contracts, agent definitions, settings formats, and widget placement.
- Keep Pi's native input/editor dialogs for chain edits, agent creation, agent editing, and steering.
- Treat a failed automated or manual check as a release blocker. Do not weaken checks or mark unavailable manual checks as passed.
- Do not commit unless the user authorizes it; when authorized, use the checkpoint in Task 5.

## Current Repository Evidence

- The branch starts from Phase 8 merge `5a3faea` before this plan-only edit.
- `package.json` already provides `check`, `pack:dry-run`, and `release:check`; reuse them instead of adding scripts.
- The active shell may be Node `23.11.0`, below the declared engine. Run release proof through `mise exec node@24.15.0`.
- `tests/worktree.test.ts` and `tests/watchdog.test.ts` create temporary Git repositories. In restricted environments, disable commit signing only for child processes with `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, and `GIT_CONFIG_VALUE_0`.
- At planning time, the corrected release gate passed `57` test files and `1,359` tests and produced the `@pi-vault/pi-subagents@0.4.0` dry-run package. Implementation must rerun it.
- Biome currently exits successfully with existing warnings. New failures or a non-zero exit block release; unrelated warning cleanup is out of scope.

## Reference Decisions

- Pi `/Users/lanh/Developer/pi-packages/pi` at tag `v0.84.3` (`4e58f324f`) is the host contract. Its release pipeline builds, checks, tests, validates artifacts, and smoke-tests entry points before publishing. Its TUI owns legacy/CSI-u key normalization, native `Input`, overlay focus, and the `--extension`/`-e` local launch flag.
- pi-status `/Users/lanh/Developer/pi-vault/pi-status` at tag `v0.5.0` (`b47dadc`) is the closest local phase pattern. Its historical docs/verification phases run focused tests before `release:check`, require Node `>=24.15.0`, inspect package contents and repository scope, keep references read-only, and record an explicit interactive matrix.
- nicobailon/pi-subagents `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` at tag `v0.51.0` (`10f69cdfd`) runs unit, integration, and end-to-end suites before provenance publishing. This plan keeps the equivalent full-suite-before-package boundary through `release:check`.
- tintinweb/pi-subagents `/Users/lanh/Developer/pi-packages/tintinweb-pi-subagents` at tag `v0.17.1` (`0a3864077`) gates publish on lint, typecheck, tests, and a clean build, and tests both its supported Pi floor and a forward canary. This repository retains its tested `0.84.3` baseline; Phase 9 does not add a new compatibility matrix.
- All four repositories are read-only references. Reuse their verification principles, not their product code, automation, palettes, or configuration.

## File Map

- Modify: `README.md` — document chain preview controls, dashboard menu navigation, ChainWidget, FleetList, and conversation controls.
- Modify: `CHANGELOG.md` — add the unreleased CSI-u fix, dashboard migration, and tested Pi baseline.
- Verify: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `biome.json`, both workflows, migrated source files, and existing tests.
- Read only: the parent plan and four reference repositories.

---

### Task 1: Document the shipped interaction contract

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: merged `/run-chain`, `/chain`, `/agents`, AgentWidget, ChainWidget, FleetList, and ConversationViewer behavior.
- Produces: user-facing instructions only; no new command, keybinding, setting, or compatibility promise.

- [ ] **Step 1: Document the foreground chain preview.**

  After the saved-chain example and before `### Chain Status and Cancellation`, add:

  ```markdown
  Foreground `/chain` and `/run-chain` commands open a preview in TUI sessions. Use `↑`/`↓` or `j`/`k` to select a step, `e` to edit its task, `m` to edit its model, `Enter` to run, `b` to run in the background, and `q`/`Esc` to cancel. Pass `--yes` to skip the preview or `--bg` to start in the background immediately.
  ```

  Keep the existing examples. Do not describe a preview in print/RPC modes.

- [ ] **Step 2: Document `/agents` navigation.**

  After `**Back** returns to the parent menu.`, add:

  ```markdown
  The dashboard menu uses `↑`/`↓` to navigate, `Enter` to select, and `Esc` to go back. Agent creation and markdown editing continue to use Pi's native input and editor dialogs.
  ```

- [ ] **Step 3: Replace the TUI surface summary.**

  Replace the `## UI: Widget, Fleet, And Conversation Viewer` section through its final summary sentence with:

  ```markdown
  ## UI: Widgets, Fleet, And Conversation Viewer

  Four TUI surfaces sync with running agents and chains:

  - **AgentWidget** — above-editor activity for agents; respects `widgetMode`.
  - **ChainWidget** — above-editor progress for active background chains.
  - **FleetList** — below-editor navigator for in-flight agents; toggle with `fleetView`. At an empty prompt, press `↓` or `←` to enter the list, use `↑`/`↓` to select, `Enter` to open a conversation, and `Esc` to return to the prompt.
  - **ConversationViewer** — live transcript overlay. Use `↑`/`↓`, `j`/`k`, or page keys to scroll; `Enter` to steer a running agent; `x` twice to stop it; and `q`/`Esc` to close.

  The surfaces follow Pi's active theme. Narrow terminals show a bounded fallback and recover when resized.
  ```

  Do not claim mouse support, search, custom palettes, or behavior absent from the merged code.

- [ ] **Step 4: Add the unreleased changelog entry.**

  Insert above `## [0.4.0]`:

  ```markdown
  ## Unreleased

  ### Fixed

  - Handle legacy and CSI-u/Kitty keyboard input in the foreground chain preview so `/chain` and `/run-chain` can be confirmed, edited, backgrounded, or cancelled in modern terminals.

  ### Changed

  - Align pi-subagents-owned overlays, widgets, fleet navigation, conversation viewing, and inline status rendering with a compact dashboard hierarchy that follows Pi's active theme.
  - Raise the tested Pi development baseline to `0.84.3`; Pi `0.84.3+` and Node.js `24.15.0+` are required.
  ```

- [ ] **Step 5: Review the documentation diff.**

  ```bash
  git diff -- README.md CHANGELOG.md
  git diff --check -- README.md CHANGELOG.md
  ```

  Expected: only the text above appears, existing install requirements remain, and the whitespace check exits zero.

---

### Task 2: Run focused and complete automated gates

**Files:** Verify all package, source, test, and package-output files.

**Interfaces:**

- Consumes: existing `check`, `pack:dry-run`, and `release:check` scripts.
- Produces: focused, full-suite, dependency, and package evidence under the supported runtime.

- [ ] **Step 1: Verify the execution environment.**

  ```bash
  mise exec node@24.15.0 -- node --version
  pnpm --version
  git branch --show-current
  git status --short
  ```

  Expected: Node `v24.15.0`, pnpm major `11`, the Phase 9 branch, and only approved documentation/plan changes.

- [ ] **Step 2: Install from the committed lockfile.**

  ```bash
  mise exec node@24.15.0 -- pnpm install --frozen-lockfile
  ```

  Expected: exit zero without changing `package.json` or `pnpm-lock.yaml`.

- [ ] **Step 3: Run focused migration suites.**

  ```bash
  mise exec node@24.15.0 -- pnpm vitest run \
    tests/chain-clarify.test.ts \
    tests/slash-chain.test.ts \
    tests/dashboard-style.test.ts \
    tests/agent-widget.test.ts \
    tests/chain-widget.test.ts \
    tests/agents-menu.test.ts \
    tests/render.test.ts \
    tests/notification-renderer.test.ts \
    tests/fleet-list.test.ts \
    tests/conversation-viewer.test.ts \
    tests/index.test.ts
  ```

  Expected: every selected suite passes with zero failures and no new skips.

- [ ] **Step 4: Run the complete release gate with child Git signing disabled.**

  ```bash
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgsign \
  GIT_CONFIG_VALUE_0=false \
  mise exec node@24.15.0 -- pnpm run release:check
  ```

  Expected: Biome exits zero, `tsc --noEmit` passes, all `57` Vitest files and `1,359` tests pass, and the package dry run exits zero. Existing Biome warnings are allowed; new failures are not.

- [ ] **Step 5: Verify dependency health.**

  ```bash
  mise exec node@24.15.0 -- pnpm audit --audit-level high
  mise exec node@24.15.0 -- pnpm dedupe --check
  ```

  Expected: no High/Critical advisory and no deduplicatable lockfile entries. A registry failure is unavailable evidence, not a pass.

- [ ] **Step 6: Inspect package contents.**

  Verify the dry-run output contains `package.json`, README, changelog, license, all five bundled agents, both bundled chains, and `src/tui/dashboard-style.ts` with `src/`. It must not contain `tests/`, workflows, planning docs, local config, or reference files.

---

### Task 3: Audit cumulative scope and contracts

**Files:** Verify the cumulative diff from `30c53a1` through the working tree and all four references.

**Interfaces:**

- Consumes: approved scope and preserved-contract list.
- Produces: evidence that Phases 1–8 changed only intended paths.

- [ ] **Step 1: Inspect the cumulative migration, not the branch-local diff.**

  ```bash
  git diff --check 30c53a1
  git diff --stat 30c53a1
  git diff --name-status 30c53a1
  ```

  Expected: whitespace exits zero. Product changes are limited to dependency/CI metadata, `src/core/slash-chain.ts`, `src/index.ts`, the owned `src/tui/` surfaces and `dashboard-style.ts`, their tests, README, and changelog. Planning documents may also differ but are not packaged.

- [ ] **Step 2: Prove schemas, definitions, and settings are unchanged.**

  ```bash
  git diff --quiet 30c53a1 -- \
    agents \
    chains \
    src/shared/types.ts \
    src/core/agent-format.ts \
    src/core/agents.ts \
    src/core/chain-serializer.ts \
    src/core/chain-settings.ts \
    src/core/settings.ts \
    src/core/child-subagent-tool.ts
  ```

  Expected: status `0` and no output, proving bundled definitions, formats, shared types, and settings remain unchanged.

- [ ] **Step 3: Review command and wiring boundaries.**

  ```bash
  git diff 30c53a1 -- src/core/slash-chain.ts src/index.ts
  ```

  Expected: `slash-chain.ts` changes only TUI preview gating, safe preview failure, and shared overlay options. `index.ts` changes only renderer delegation. Registration names, flags, execution/preflight semantics, payloads, and contracts remain intact.

- [ ] **Step 4: Confirm the pi-status boundary with FFF.**

  Use the `fff` content-search tool once with bare query `pi-status` from this repository.

  Expected: matches only in README acknowledgement and planning/reference text; none in `package.json`, `pnpm-lock.yaml`, or `src/`.

- [ ] **Step 5: Confirm references remain untouched.**

  ```bash
  git -C /Users/lanh/Developer/pi-packages/pi status --short
  git -C /Users/lanh/Developer/pi-vault/pi-status status --short
  git -C /Users/lanh/Developer/pi-packages/nicobailon-pi-subagents status --short
  git -C /Users/lanh/Developer/pi-packages/tintinweb-pi-subagents status --short
  ```

  Expected: no output. Record any pre-existing change; never stage or modify it.

---

### Task 4: Run the modern-terminal acceptance matrix

**Files:** None.

**Interfaces:**

- Consumes: the local extension through Pi `0.84.3+` in a CSI-u/Kitty-capable TUI.
- Produces: terminal name/version, Pi version, dimensions, and pass/fail evidence for every row.

- [ ] **Step 1: Launch the local extension.**

  ```bash
  pi --extension ./src/index.ts
  ```

  Use Ghostty, Kitty, or another terminal with CSI-u/Kitty input enabled. Record `pi --version`, terminal name/version, and dimensions.

- [ ] **Step 2: Verify foreground preview and cancellation.**

  Run `/run-chain implement -- inspect this repository`. Navigate with arrows and `j`/`k`; edit task and model; cancel with Escape; reopen; confirm with Enter.

  Expected: each key acts once, edits use native input, cancel launches nothing, reopening starts cleanly, and confirmation launches the first agent.

- [ ] **Step 3: Verify background and preview-skip paths.**

  Reopen and press `b`, then run once with `--yes` and once with `--bg`.

  Expected: `b` and `--bg` return a chain ID and update ChainWidget; `--yes` skips preview; no path launches twice.

- [ ] **Step 4: Verify `/agents` and native dialogs.**

  Navigate list/detail/settings, start and cancel create input, open and cancel markdown editing, then return to the prompt.

  Expected: menu keys stay responsive, selection remains visible, and native dialog focus restores correctly.

- [ ] **Step 5: Verify FleetList and ConversationViewer.**

  Start a background agent. At an empty prompt enter FleetList with `↓` or `←`, navigate, and open the agent. Scroll with line/page keys, steer once, press `x` twice to stop, and Escape to close.

  Expected: FleetList consumes keys only while the prompt editor has focus, the viewer remains live, steering appears, stop requires confirmation, and closing restores prompt focus.

- [ ] **Step 6: Verify resize and themes.**

  Resize below the dashboard minimum and restore the original size. Switch between at least two Pi themes.

  Expected: bounded fallback, recovery without losing meaningful selection/scroll state, width-safe lines, and legible active-theme rendering.

- [ ] **Step 7: Record results.**

  Record every row as pass/fail in the handoff. Include exact failures. An unavailable manual environment remains unavailable and prevents claiming full release readiness.

---

### Task 5: Commit documentation when authorized

**Files:** Commit `README.md` and `CHANGELOG.md` only.

**Interfaces:**

- Consumes: successful Tasks 1–4.
- Produces: one documentation-only commit and a complete handoff.

- [ ] **Step 1: Recheck the final diff.**

  ```bash
  git diff --check
  git diff -- README.md CHANGELOG.md
  git status --short
  ```

  Expected: only approved docs are pending for implementation. The plan may appear only if its planning change was not committed separately.

- [ ] **Step 2: Commit only with explicit authorization.**

  ```bash
  git add README.md CHANGELOG.md
  git commit -m "docs: document dashboard ui migration"
  ```

  Do not stage the plan file with the implementation commit.

- [ ] **Step 3: Prepare the handoff.**

  Report focused/full test results, dependency audit/dedupe, package contents, cumulative contract audit, reference status, terminal/Pi versions, and every manual outcome. State unavailable evidence and remaining risk explicitly.

## Completion Criteria

- README and changelog match shipped behavior and compatibility.
- Focused suites and supported-runtime `release:check` pass.
- High/Critical audit and lockfile dedupe pass.
- Dry-run package contents are correct.
- The cumulative `30c53a1` diff is scope-correct and public contracts/placements are preserved.
- No pi-status runtime dependency/read exists; references remain untouched.
- Every terminal acceptance row passes with environment evidence.
- Only authorized documentation files are committed; unavailable checks are never reported as passed.
