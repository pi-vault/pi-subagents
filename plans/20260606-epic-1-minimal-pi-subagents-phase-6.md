# Phase 6: Rendering, Errors, And Full Verification

## Summary

Phase 6 finishes the Epic 1 user experience. It adds implementation-defined rendering hooks, completes structured diagnostics, and closes the verification matrix so the extension is ready for normal Pi use.

Pi-usable result:

- Pi users can inspect subagent runs, child sessions, tool activity, and failures without reading raw implementation internals.
- The extension is complete for Epic 1 scope.

## Implementation Changes

- Add a concrete renderer module, preferably `src/render.ts`, for shared subagent call/result formatting.
- Register `renderCall` and `renderResult` on the `subagent` tool so tool executions render through Pi's native tool renderer hooks.
- Register `pi.registerMessageRenderer("pi-subagent-result", ...)` so `/agent` uses the same result rendering path as the tool.
- Extend `SubagentExecutionDetails` with:
  `status: "success" | "error" | "timeout" | "aborted"`.
- Extend `SubagentExecutionDetails` with bounded `recentToolActivity` parsed from child JSON stdout events:
  use `tool_execution_start` and `tool_execution_end`, keep only the most recent 10 entries, and store short previews rather than full payloads.
- Keep the parent-visible result content unchanged:
  successful runs return only the child final assistant text, and failed runs return only the surfaced failure text.
- Keep existing structured metadata and make it renderer-visible:
  usage, duration, child session dir/path, model name, stop reason, stderr, exit code, and source path.
- Render collapsed results with:
  status, agent name, model when known, duration, token/turn usage, child session path, and up to 5 recent tool activity labels.
- Render expanded results with:
  task, cwd, source path, timeout, stop reason, exit code, stderr when present, child session dir/path, all retained recent tool activity, and the final output text.
- Keep observability strict:
  every run persists an inspectable native child Pi session.
- Do not add background jobs, parallel/chain execution modes, project-local agents, or management UI beyond the existing list/create flow.

## Test Plan

- Verify `registerSubagentTool` registers renderer hooks for `subagent`.
- Verify `registerAgentCommand` or extension bootstrap registers the `pi-subagent-result` message renderer.
- Verify collapsed and expanded render states from synthetic `SubagentExecutionDetails`.
- Verify `renderCall` includes the selected agent, task preview, and `cwd` when present.
- Verify child `tool_execution_start` and `tool_execution_end` events populate bounded `recentToolActivity`.
- Verify renderer/debug metadata does not leak into the successful parent-visible result text.
- Verify each major failure mode has a clear surfaced error and the expected `details.status`:
  unknown agent, invalid task, timeout, abort, spawn failure, and non-zero child exit.
- Verify end-to-end Pi behavior for:
  bundled discovery, `/agents`, `/agent`, `subagent`, child-session persistence, and nested delegation.
- Run `pnpm test`, `pnpm run typecheck`, and `pnpm run lint`.

## Assumptions

- Expanded output means preserving and displaying the child's final text in the expanded renderer; this phase does not depend on non-obvious internal Markdown components.
- Recent tool activity is derived from child JSON stdout events, not reconstructed from the persisted child session file.
- This phase completes the original Epic 1 scope without adding background jobs, project-local agents, or management UI beyond list/create.
