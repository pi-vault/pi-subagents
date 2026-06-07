# Phase 6: Rendering, Errors, And Full Verification

## Summary

Phase 6 finishes the Epic 1 user experience. It hardens error handling, improves observability, and completes the verification matrix so the extension is ready for normal Pi use.

Pi-usable result:

- Pi users can inspect results, child sessions, and failures without reading raw implementation internals.
- The extension is complete for Epic 1 scope.

## Implementation Changes

- Add compact rendering for subagent calls and results.
- Surface structured metadata:
  status, usage, duration, child session dir/path, recent tool activity, model name, stderr, and exit code.
- Support expandable final markdown output while keeping final assistant text as the parent-visible result.
- Harden errors for:
  unknown agent, invalid config, unknown tool, missing child extension availability, timeout, abort, spawn failure, and non-zero child exit.
- Keep observability strict:
  every run persists an inspectable native child Pi session.

## Test Plan

- Verify collapsed and expanded render states.
- Verify renderer/debug metadata does not leak into the parent-visible result text.
- Verify each major failure mode has a clear surfaced error.
- Verify end-to-end Pi use for:
  bundled discovery, `/agents`, `/agent`, `subagent`, child-session persistence, and nested delegation.
- Run manual validation on the default agents:
  `scout`, `planner`, `researcher`, and `worker`.

## Assumptions

- This phase completes the original Epic 1 scope without adding background jobs, project-local agents, or management UI beyond list/create.
