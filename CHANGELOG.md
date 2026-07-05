# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-07-05

### Added

- In-process `AgentManager` and `AgentRunner` that own agent lifecycle, concurrency, and execution policy; replaces the previous child-process spawning model.
- Background execution: agents can run asynchronously via `run_in_background`, return an agent ID immediately, and report completion through a queued follow-up notification.
- New `get_subagent_result` tool: check the status of a background agent and retrieve its result (with optional `wait` and `verbose` flags).
- New `steer_subagent` tool: redirect a running background agent with a follow-up message.
- `resume` parameter on the `subagent` tool: re-enter a previously completed or steered agent with new instructions.
- Concurrency queue with `maxConcurrent` setting; queued agents wait for an open slot instead of spawning unbounded children.
- Git worktree isolation via `isolation: worktree`; the agent runs in a temporary worktree and the resulting branch/diff is recorded on the agent record.
- `GroupJoinManager` and `smart` join mode: detect parallel agents fired in the same batch and emit a single grouped completion notification instead of N individual nudges.
- Per-agent JSONL output streaming for background agents; conversation is appended incrementally to a session file referenced in the completion notification.
- Persistent settings module with project + global merge: `~/.pi/agent/subagents.json` and `.pi/subagents.json`.
- New `defaultJoinMode` setting (`async`, `group`, or `smart`) for the agents menu and subagent tool.
- `AgentWidget`: live activity sidebar rendered above the editor while foreground or background agents are running.
- `FleetList`: below-editor navigator listing all in-flight agents with status, tool activity, and turn count.
- `ConversationViewer` overlay (Ctrl/Cmd+O) for inspecting the full transcript of any agent record.
- `widgetMode` (`all`, `background`, `off`) and `fleetView` settings exposed in the `/agents` menu.
- `prompt_mode` frontmatter field (`replace` default, or `append` to layer on top of the parent prompt).
- `max_turns` frontmatter field: turn-based limit that replaces the deprecated `timeout_ms`.
- `inherit_context`, `run_in_background`, `isolated`, `isolation: worktree`, `extensions` (true/false/list), and `disallowed_tools` frontmatter fields.
- `extensions` policy in the subagent tool: pass `true` to keep all, `false`/`none` to drop extension/MCP tools, or a comma-separated allowlist.
- Model resolver with exact `provider/id` matching and fuzzy matching on common names (e.g. `haiku`, `sonnet`).
- Bundled `agents/` now declare explicit `tools`, `subagent_agents`, and bounded `max_turns`.

### Changed

- Foreground `/agent` runs now stream live tool activity into the editor and surface turn count, thinking level, and steered status in the result card.
- `/agents` menu reorganised: agent rows show status, model, and tools; settings rows expose concurrency, default join mode, widget mode, and fleet view.
- `subagent` tool schema now exposes all the new parameters listed above; previously-stubbed parameters (`run_in_background`, `resume`, `isolation`) are fully wired.
- Notifications deduplicated via `sendNudge`; `get_subagent_result` cancels a pending nudge to avoid duplicate delivery.
- Updated bundled `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `@earendil-works/pi-ai` to `^0.80.3`.
- Updated `typebox` to `^1.3.3`.

### Removed

- Deprecated `timeout_ms` frontmatter field; use `max_turns` instead.
- Deprecated `defaultTimeoutMs` config field; replaced by `defaultMaxTurns` + `graceTurns`.
- Removed child-process spawn path and the env-variable protocol used to carry nested execution context between processes.

### Fixed

- Reject `resume()` for running or queued agents to prevent double-prompting.
- Clear pending batch state on dispose so a stopped tracker cannot leak into the next session.
- Track background agent activity so the widget/fleet reflect running background work, not only foreground runs.
- Deduplicate `extensions` allowlist when serialising agent definitions.
- Addressed code review findings from the in-process runner migration (input sanitisation, error propagation, record cleanup on abort).

### Compatibility

- Node.js requirement is `>=24.15.0`.
- User agents that still set `timeout_ms` are accepted on load but the value is ignored; migrate to `max_turns`.

## [0.2.1] - 2026-06-14

### Changed

- Updated `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to `0.79.3`.
- Updated `typebox` to `1.2.10`.
- Rewrote the README around install, `/agent`, `/agents`, bundled agents, and user override workflows.

### Internal

- Split subagent execution responsibilities into dedicated artifact storage and process spawning modules.
- Encapsulated nested execution context handling behind a focused environment-variable protocol.
- Extracted agent frontmatter parsing and merged skill-tree traversal logic to simplify internal maintenance.
- Unified execution state handling for deferred slash requests and foreground run updates.

### Fixed

- Deduplicated serialized `skills` values when writing agent definitions.
- Addressed follow-up code review issues in the extracted subagent execution modules.

## [0.2.0] - 2026-06-14

### Added

- Added an interactive `/agents` menu for managing bundled agents and global overrides.
- Added live slash-card rendering and deferred slash request restoration so foreground `/agent` runs stay visible and responsive.
- Added `skills:` support in agent definitions, including explicit skill lists plus `all` and `none`.
- Added runtime skill resolution and child-process skill injection via `--skill` flags.
- Added test coverage for agent menu flows, rendering updates, skill loading, config parsing, and subagent execution behavior.

### Changed

- Replaced the older CLI-style add-agent flow with the interactive `/agents` management workflow.
- Renamed agent override semantics from `disabled` to `enabled`.
- Refined foreground UI refresh behavior to reduce noisy updates while keeping live progress visible.
- Updated bundled agent definitions to declare explicit skill policies.

### Fixed

- Fixed child-process skill handling so omitted skills and `skills: none` both suppress inherited skills correctly.
- Fixed foreground agent rendering so slash agent cards stay live during quiet periods.
- Fixed menu selection handling to guard against an undefined selection result.

## [0.1.0] - 2026-06-07

### Added

- Initial public release of `@pi-vault/pi-subagents`.
- Bundled `scout`, `planner`, `researcher`, `worker`, and `reviewer` agents.
- Added discovered agent loading, packaged extension registration, and subagent configuration support.
- Added foreground subagent execution, nested delegation support, runtime artifacts, and TUI result rendering.
