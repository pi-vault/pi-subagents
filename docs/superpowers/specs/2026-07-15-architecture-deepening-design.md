# Architecture Deepening Design

## Goal

Deepen the existing Agent, Chain, Watchdog, configuration, and presentation modules while preserving user-facing commands, tool shapes, files, and rendered output.

## Phases

1. Move child Watchdog policy into the Watchdog runtime and delete the external one-caller resolver.
2. Put Agent persistence behind the Agent module so the TUI delegates reads and writes.
3. Consolidate settings resolution and writes behind one settings module.
4. Replace parallel activity maps with one live Agent record per running Agent.
5. Normalize Chain definitions once before command and tool adapters execute them.
6. Replace the spawn dependency bag and centralize Agent lifecycle transitions.

Each phase is independently usable and keeps the extension passing its focused checks before the next phase begins.

## Compatibility

- Preserve command names, tool parameter wire shapes, notification text, settings values, files, and TUI rendering.
- Canonical settings writes use the Pi global settings location for global scope and `.pi/subagents.json` for project scope.
- Legacy global settings remain readable indefinitely.
- The settings menu asks for project or global scope once per menu visit.
- Max Recursive Level becomes effective through the unified settings path; no other behavior change is approved.

## Settings Precedence

Resolve settings in this order, with later values winning:

1. built-in defaults;
2. legacy global settings;
3. canonical Pi global settings;
4. project settings.

## Constraints

- Reuse existing modules and dependencies.
- Delete replaced implementation instead of retaining compatibility wrappers.
- Do not introduce a framework, migration command, or speculative extension point.
