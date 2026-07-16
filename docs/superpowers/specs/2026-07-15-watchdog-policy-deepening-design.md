# Watchdog Policy Deepening Design

## Goal

Make the Watchdog runtime own child-policy selection without changing current review, warning, or auto-follow behavior.

## Current Behavior to Preserve

- The parent Watchdog configuration reviews an ended Agent when child policy does not apply.
- When child policy is enabled for an Agent type, its model and thinking values override the parent defaults in this order: per-Agent override, child default, parent default.
- An Agent type with `children.overrides[type].enabled: false` falls back to the parent review.
- Child-policy warnings use the `watchdog/child` label and include `source: "child"`; parent warnings keep their existing label and omit `source`.
- Auto-follow is available for parent reviews and remains disabled for child-policy reviews.
- Reviewer failures remain non-fatal.

## Design

Add a `WatchdogSubject` containing the ended Agent's `id`, `type`, and `cwd`. Change `WatchdogRuntime.handleAgentEnd` to accept this subject.

Keep policy resolution private to `watchdog.ts`. For each subject, the runtime selects a review configuration and a `"parent" | "child"` source. Child selection copies only the resolved model and thinking values onto the parent configuration; all other Watchdog settings remain unchanged.

Extend the existing injected `runReview` test seam with the selected `WatchdogConfig` as its fourth argument. This makes model and thinking selection observable without exporting the resolver or adding a new abstraction.

Extend `onWarnings` with the review source as its third argument. `index.ts` remains responsible for rendering and delivering warnings, using that source to preserve the existing parent and child payloads.

The runtime skips auto-follow when the selected source is `"child"`. This preserves the behavior of the current temporary child runtime, which is created without a `resumeAgent` callback.

## Adapter Changes

`index.ts` creates one Watchdog runtime and calls it with the Agent subject. It no longer resolves child configuration or creates temporary child runtimes. After migration, delete `src/core/watchdog-child.ts`.

The adapter keeps a single warning callback. It derives the current label and optional `source` field from the source supplied by the runtime. Runtime call failures use the existing non-fatal logging path.

## Testing

Move child-policy cases into `tests/watchdog.test.ts` and exercise them through `handleAgentEnd(subject)`:

- parent defaults when child policy is disabled;
- child defaults;
- per-Agent model and thinking overrides;
- disabled child override falling back to parent;
- one child warning callback with `source: "child"`;
- child reviews do not invoke auto-follow;
- parent auto-follow behavior remains covered.

Delete `tests/watchdog-child.test.ts` only after its policy cases are represented in the runtime tests. Focused tests must run with the process-local Git configuration that disables commit signing for temporary repositories.

## Documentation Task

Phase 1 retains the standalone documentation commit. `CONTEXT.md` records only the Agent, Chain, and Watchdog vocabulary. The architecture design record takes its six phases, compatibility decisions, and settings precedence from `docs/superpowers/plans/2026-07-15-architecture-deepening.md`.

## Commit Boundaries

1. `docs: record architecture deepening design`
2. `refactor: deepen watchdog runtime policy`

Each commit must pass its documented focused checks and remain independently usable.
