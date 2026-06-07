# Phase 5: Recursion And Nested Delegation

## Summary

Phase 5 adds controlled nested delegation. Agents that explicitly include `subagent` in their tool list can delegate to allowed child agents, bounded by configured recursion depth and coordinated through scoped temp-root runtime state.

Pi-usable result:

- `worker` can delegate to allowed child agents such as `scout` or `researcher`.
- Disallowed or too-deep delegation fails clearly.

## Implementation Changes

- Keep `runtimeCacheDir` unchanged as a reported agent-cache path. Do not use `<agentDir>/cache` for cross-process routing.
- Add a scoped temp root:
  `$TMPDIR/pi-subagents-<scope>`,
  where `<scope>` resolves from `process.getuid()`, username, home directory, then `shared`.
- Store nested event routes under:
  `$TMPDIR/pi-subagents-<scope>/nested-subagent-events/<rootRunId>-<capabilityToken>/`.
- Store per-run nested runtime state under:
  `$TMPDIR/pi-subagents-<scope>/nested-subagent-runs/<rootRunId>/<runId>/runtime.json`.
- Track current depth, max depth, child-agent allowlist, selected parent run id, selected root run id, and nested route file locations through that runtime state plus tightly-scoped child env vars.
- Enforce `maxRecursiveLevel`, default `2`.
- Use depth semantics where the top-level parent starts at depth `0` and the first nested child runs at depth `1`.
- Only load this extension into a child run when both conditions hold:
  the selected agent explicitly has `subagent` in its tool list, and current depth is still below `maxRecursiveLevel`.
- Preserve Phase 4 behavior for non-recursive child runs:
  keep `--no-extensions`, strip `subagent` from `--tools`, and keep the same foreground session/output model.
- When recursion is enabled for a child run, pass `--extension <this extension>` and child env vars:
  `PI_SUBAGENT_CHILD`,
  `PI_SUBAGENT_FANOUT_CHILD`,
  `PI_SUBAGENT_RUN_ID`,
  `PI_SUBAGENT_DEPTH`,
  `PI_SUBAGENT_MAX_DEPTH`,
  `PI_SUBAGENT_ALLOWED_AGENTS`,
  `PI_SUBAGENT_RUNTIME_STATE`,
  and the nested route vars
  `PI_SUBAGENT_PARENT_EVENT_SINK`,
  `PI_SUBAGENT_PARENT_CONTROL_INBOX`,
  `PI_SUBAGENT_PARENT_ROOT_RUN_ID`,
  `PI_SUBAGENT_PARENT_RUN_ID`,
  `PI_SUBAGENT_PARENT_CHILD_INDEX`,
  `PI_SUBAGENT_PARENT_DEPTH`,
  `PI_SUBAGENT_PARENT_PATH`,
  `PI_SUBAGENT_PARENT_CAPABILITY_TOKEN`.
- Enforce recursion inside the `subagent` tool at execution time:
  reject when current depth is `>= maxRecursiveLevel`,
  reject when the requested child agent is not in the effective allowlist,
  and treat an empty allowlist as no child delegation allowed.
- Apply `subagent_agents` from the selected agent frontmatter as the next child process allowlist.
- Update the bundled `worker` agent so it explicitly includes `subagent` in `tools` and allows `scout,researcher`, matching the user-facing result for this phase.
- Keep Phase 5 foreground-only. Do not add background jobs, management actions, resume, or richer nested rendering in this phase.

## Test Plan

- Update config tests so default `maxRecursiveLevel` is `2`.
- Verify scoped temp-root runtime state is created under:
  `nested-subagent-events`,
  `nested-subagent-runs`,
  `route.json`,
  and `runtime.json`.
- Verify recursive-capable agents receive `--extension`, include `subagent` in `--tools`, and get the expected `PI_SUBAGENT_*` env contract.
- Verify agents without `subagent` keep Phase 4 spawn behavior and cannot recurse.
- Verify `maxRecursiveLevel` blocks delegation when current depth reaches the cap.
- Verify `subagent_agents` restricts child selection with case-insensitive agent matching.
- Verify an empty `subagent_agents` allowlist blocks child delegation.
- Verify nested runs still persist child sessions and final outputs correctly.
- Run `pnpm test` and `pnpm run typecheck`. Run `pnpm run lint` if implementation touches formatting-sensitive code.

## Assumptions

- Phase 5 still uses the same foreground model as Phase 4.
- Nested event files exist for routing and verification only in this phase.
- No background execution, steering, status UI, or resume support is introduced.
