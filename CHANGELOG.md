# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-07-17

### Added

- **Chains.** Multi-agent execution: sequential/parallel steps via `/chain`, run saved chains with `/run-chain`, append steps to running chains with `chain_append` on the `subagent` tool. Background chains with `--bg`; live chain status via `/chain status` and `/chain cancel`.
- **Nested delegation.** Child agents can spawn further child agents through `subagent` tool injection with bounded recursion and `max_depth` frontmatter.
- **Intercom.** Bidirectional child↔parent communication: children use `contact_supervisor` to request decisions or report progress; parents reply with the `intercom` tool.
- **Wait tool.** Block the calling agent (or tool call) until one, any, or all background agents finish.
- **Agent memory.** Persistent, scope-aware memory via `memory:` frontmatter with user, project, and local scopes, read-write and read-only modes, and a `.gitignore` warning for local scope.
- **Model scope enforcement.** `modelScope` setting with glob-based allowlist; violations are an error for explicit overrides or a warning for inherited models.
- **Tool budgets.** Soft/hard tool-use limits with configurable blocked tools, enforced per agent. Set via `tool_budget` frontmatter or the `toolBudget` setting.
- **Spawn limits.** `maxSpawnsPerSession` caps total spawned agents per session; `max_depth` limits recursion depth. Budget checked before parallel chain steps.
- **Watchdog.** Optional adversarial reviewer at agent-end boundaries. Reviews git diffs or turn deltas, emits severity-categorized warnings, supports auto-follow steering with stalemate detection, child-agent override, LSP diagnostics, and model recommendation via `/watchdog recommend-model`.
- **Prompt workflows.** Markdown templates with arg substitution (`$1`, `$@`), executed via `/prompt-workflow <name> [args]`. Chain workflows together with `/chain-prompts workflow-a -> workflow-b -- args`.
- **Cross-extension RPC.** Event-bus handlers (`subagents:rpc:ping`, `spawn`, `stop`, `status`, `steer`) so other Pi extensions can control subagents without importing the package.
- **Safe-fs discovery.** Symlink rejection, unsafe-name checks, and path-containment validation for agent and chain discovery.
- **Live activity recording.** `AgentRecord.live` tracks active tools and response text in real time, consumed by the widget, fleet, and conversation viewer.
- **Chain definition consolidation.** Output binding validation, field rejection for misplaced chain fields, `ChainStepConfig` normalization, and `.chain.md`/`.chain.json` serializer.
- **Worktree improvements.** Per-task cwd conflict detection, `node_modules` linking, setup hooks, synthetic paths, and conflict detection.

### Changed

- Upgraded `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `@earendil-works/pi-ai` to `^0.80.10`.
- Upgraded `typebox` to `^1.3.6` and `vitest` to `^4.1.10`.
- Settings consolidation: `modelScope`, `watchdog`, `maxSpawnsPerSession` added to settings JSON; project-scoped settings now correctly override global defaults.
- `/agents` menu extended: diagnostics display, agent catalog entries, full frontmatter editing (memory, tool budgets, intercom, etc.).
- Chain expression parser ported to quote/paren-aware tokenizer; `,` inline config extended with `count`, `phase`, `label`, `reads`, `outputMode`, `skills`, `acceptance`.
- Agent frontmatter parsing and serialization extended for `max_depth`, `memory`, `intercom`, `tool_budget`.
- Slash `/chain` enhanced with `--yes` auto-confirm, `--bg` background execution, and subcommands for `status`/`cancel`.
- `maxConcurrent` backfilled from legacy `maxConcurrency` key; `timeout_ms` now fully ignored (removed since 0.3.0).

### Fixed

- Agent lifecycle: centralised transitions close gaps for background-chain lifecycle, activity-state cleanup, and TUI tracking.
- Watchdog: auto-follow re-review uses fresh diff and local dedup set; LSP client uses `path.delimiter` for cross-platform PATH resolution; shell injection guards in `computeChangeSignature`.
- Intercom: widened `execute` parameter type for tool-def compatibility.
- Safe-fs: TOCTOU limitation documented; unused `readFileSync` import removed; skill-loader migrated to shared safe-fs helpers.
- Memory: handle JSON-string frontmatter values; add `checkLocalMemoryGitignore` warning.
- Model scope: optional chaining guard; enforcement wired into chain execution path.
- Tool budget: severity default; `tool_call` testability; duplicate test file removed.
- Chain execution: floor concurrency limits to one; guard cleanup in dynamic parallel; background chain dispatch invokes `registerExternalRecord`.
- Top-level agents no longer self-restrict `allowedAgents` when spawning children.

### Compatibility

- Node.js requirement remains `>=24.15.0`.
- `timeout_ms` frontmatter (deprecated since 0.3.0) is now fully ignored; migrate to `max_turns`.

## [0.3.0] - 2026-07-05 - 2026-06-14

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
