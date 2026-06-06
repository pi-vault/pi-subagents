# Phase 4: Foreground Subagent Execution

## Summary

Phase 4 adds the first executable subagent path. The extension registers the `subagent` tool and `/agent` command, spawns a foreground child `pi` process, and returns the child's final text.

Pi-usable result:

- `/agent` can run a discovered agent in the foreground.
- Parent agents can call `subagent` and receive final assistant text.

## Implementation Changes

- Register the `subagent` tool with:
  `{ agent, task, cwd? }`.
- Register `/agent <agent> <task...>` and route it through the same execution path.
- Resolve the selected agent from runtime discovery.
- Spawn an isolated child `pi` process in JSON mode with:
  explicit tool allowlist, system prompt file, model flag, thinking flag, and no inherited session state.
- Persist the child JSON event stream or transcript under `$PI_CODING_AGENT_DIR/cache/pi-subagents`.
- Return only the child final assistant text as the parent-visible result.
- Keep usage, duration, stderr, exit code, and transcript path as structured metadata for rendering/debugging.

## Test Plan

- Verify `subagent` and `/agent` are registered.
- Verify unknown agents fail clearly before spawn.
- Verify spawn arguments include the selected tools, prompt file, and execution flags.
- Verify child final assistant text is the only parent-visible result content.
- Verify transcript files are written under `$PI_CODING_AGENT_DIR/cache/pi-subagents`.
- Verify non-zero exits surface stderr and exit metadata.

## Assumptions

- Phase 4 remains foreground-only.
- Nested delegation is not enabled yet; an agent can execute but not recursively spawn child subagents.
