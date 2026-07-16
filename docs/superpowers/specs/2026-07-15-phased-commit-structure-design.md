# Phased Commit Structure Design

## Goal

Make every task in the architecture-deepening phase plans a green, independently reviewable Git commit while keeping the six approved phases and the original parent plan unchanged.

## Decisions

- A failing test is local red-phase evidence only. It is never committed without the minimal implementation that makes it pass.
- Each refactor phase has two green tasks: first the deep module seam and its focused tests, then caller migration, adapter simplification, and deletion of replaced code.
- Phase 1 additionally has a documentation task because the context glossary and approved architecture record are independently useful.
- Every task ends with focused tests, TypeScript checking, touched-file linting, and exactly one commit.
- Every phase plan repeats its own ordered commit sequence near the top, so it is executable without consulting the phase index.
- The phase index lists all twelve commits in execution order. Phase gates remain unchanged.

## Commit Sequence

1. `docs: record architecture deepening design`
2. `refactor: deepen watchdog runtime policy`
3. `refactor: add agent catalog seam`
4. `refactor: delegate agents menu persistence`
5. `refactor: add unified settings resolver`
6. `refactor: migrate settings callers`
7. `refactor: add agent live record`
8. `refactor: migrate tui activity state`
9. `refactor: add chain definition normalizer`
10. `refactor: route chain adapters through normalizer`
11. `refactor: replace spawn dependency bag`
12. `refactor: centralize agent lifecycle transitions`

## Per-Phase Commit Sequences

- **Phase 1 — Watchdog:** `docs: record architecture deepening design`, then `refactor: deepen watchdog runtime policy`.
- **Phase 2 — Agent persistence:** `refactor: add agent catalog seam`, then `refactor: delegate agents menu persistence`.
- **Phase 3 — Settings:** `refactor: add unified settings resolver`, then `refactor: migrate settings callers`.
- **Phase 4 — Activity:** `refactor: add agent live record`, then `refactor: migrate tui activity state`.
- **Phase 5 — Chain definitions:** `refactor: add chain definition normalizer`, then `refactor: route chain adapters through normalizer`.
- **Phase 6 — Agent lifecycle:** `refactor: replace spawn dependency bag`, then `refactor: centralize agent lifecycle transitions`.

## Boundaries

- The existing `2026-07-15-architecture-deepening.md` plan remains unchanged.
- No implementation code changes in this planning update.
- The final verification remains at the end of Phase 6; individual commits still run their focused checks.
