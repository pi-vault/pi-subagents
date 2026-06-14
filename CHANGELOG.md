# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-06-14

### Added

- Added an interactive `/agents` menu for managing bundled agents and global overrides.
- Added live slash-card rendering and deferred slash state handling to keep foreground `/agent` runs visible and responsive.
- Added `skills:` support in agent definitions, including explicit skill lists, `all`, and `none`.
- Added runtime skill resolution and child-process skill injection via `--skill` flags.
- Added tests covering agents menu behavior, rendering updates, skill loading, config parsing, and subagent execution.

### Changed

- Replaced the older CLI-style add-agent flow with the interactive `/agents` management workflow.
- Renamed agent override semantics from `disabled` to `enabled`.
- Refined the subagent UI refresh flow to reduce noisy updates while preserving live progress.
- Updated the README to reflect the current supported command surface and the `v0.2.0` feature set.

### Fixed

- Fixed child-process skill handling so `skills: false` and omitted skills both suppress inherited skills correctly.
- Fixed foreground agent rendering to keep slash agent cards live during quiet periods.
- Fixed menu selection handling to guard against an undefined selection result during release prep.

## [0.1.0] - 2026-06-07

### Added

- Initial public release of `@pi-vault/pi-subagents`.
- Bundled `scout`, `planner`, `researcher`, `worker`, and `reviewer` agents.
- Foreground subagent execution, nested delegation support, runtime artifacts, and packaged extension loading.
