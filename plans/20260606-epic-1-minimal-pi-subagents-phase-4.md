# Phase 4: Foreground Subagent Execution

## Summary

Phase 4 adds the first executable subagent path. The extension registers the `subagent` tool and `/agent` command, spawns a foreground child `pi` process in JSON print mode, persists a native child Pi session JSONL under the relevant project session directory, and returns the child's final assistant text.

Pi-usable result:

- `/agent` can run a discovered agent in the foreground.
- Parent agents can call `subagent` and receive final assistant text.

## Implementation Changes

- Register the `subagent` tool with:
  `{ agent, task, cwd? }`.
- Register `/agent <agent> <task...>` and route it through the same execution path.
- Resolve the selected agent from runtime discovery with case-insensitive matching.
- Reject missing `agent`, missing `task`, and unknown agents before spawn, including available agent names in errors.
- Spawn an isolated child `pi` process with:
  `--mode json -p --no-extensions`,
  plus `--session <child-session-path>`, `--name <agent label>`,
  and `--tools`, `--model`, `--thinking`, and `--append-system-prompt <temp-file>` when configured for the selected agent.
- Resolve the child Pi invocation from the current process when possible, otherwise fall back to `pi`.
- Use the delegated `cwd` when provided, otherwise the parent session `cwd`.
- Persist the child run as a native Pi session JSONL using a nicobailon-style exact child session file:
  `<parent-session-dir>/<parent-session-stem>/<run-id>/run-0/session.jsonl`.
- When the parent session is not persisted, fall back to a unique temp child session root:
  `$TMPDIR/pi-subagent-session-XXXXXX/<run-id>/run-0/session.jsonl`.
- Parse child stdout JSON as a live stream only:
  use assistant `message_end` events for final text, usage, stop reason, model, and error metadata.
- Expose child-session metadata in structured details with:
  `childSessionDir` for the run directory and required `childSessionPath` for the exact `session.jsonl` file.
- Stop manually persisting raw stdout JSON event logs in Phase 4.
- Enforce timeout using `timeout_ms` or `defaultTimeoutMs`, terminating with `SIGTERM` and then `SIGKILL` after a short grace period.
- Keep nested delegation disabled in Phase 4:
  do not load this extension into the child and do not expose `subagent` in child runs yet.
- `/agent` uses the same execution path as the tool but emits a visible custom message instead of a model-visible tool result.

## Test Plan

- Verify `subagent` and `/agent` are registered.
- Verify empty task and unknown agents fail clearly before spawn.
- Verify spawn arguments include `--mode json`, `-p`, `--no-extensions`, `--session <childSessionPath>`, selected tools, prompt file, model, thinking, and execution flags.
- Verify spawn arguments do not include `--session-dir` or `--session-id`.
- Verify child final assistant text is the only parent-visible result content.
- Verify child session files are written under the relevant project session directory using the child-session layout.
- Verify `childSessionDir`, required `childSessionPath`, usage, stop reason, and model stay in structured metadata rather than result text.
- Verify raw stdout JSON is parsed live but not manually persisted as a separate transcript artifact.
- Verify persisted parent sessions use the `<parent-session-stem>/<run-id>/run-0/session.jsonl` layout.
- Verify no-session parent fallback uses the `$TMPDIR/pi-subagent-session-XXXXXX/<run-id>/run-0/session.jsonl` layout.
- Verify non-zero exits, aborts, and timeouts surface stderr and exit metadata.

## Assumptions

- Phase 4 remains foreground-only.
- Nested delegation is not enabled yet; an agent can execute but not recursively spawn child subagents.
- If the implementation uses `Type.Object` for the tool schema, add `typebox` as a direct dependency instead of relying on transitive availability.
