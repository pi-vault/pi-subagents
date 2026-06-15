# Changelog

All notable changes to this project will be documented in this file.

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
