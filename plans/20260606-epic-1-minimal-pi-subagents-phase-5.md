# Phase 5: Recursion And Nested Delegation

## Summary

Phase 5 adds controlled nested delegation. Agents that explicitly include `subagent` in their tool list can delegate to allowed child agents, bounded by configured recursion depth and coordinated through temp-root runtime state.

Pi-usable result:

- `worker` can delegate to allowed child agents such as `scout` or `researcher`.
- Disallowed or too-deep delegation fails clearly.

## Implementation Changes

- Add temp-root nested runtime state under:
  `$TMPDIR/pi-subagents-<scope>/nested-subagent-events/...`
  and `$TMPDIR/pi-subagents-<scope>/nested-subagent-runs/...`.
- Track current depth, max depth, child-agent allowlist, and nested run routing in that runtime state.
- Enforce `maxRecursiveLevel`, default `2`.
- Apply `subagent_agents` from agent frontmatter to nested child exposure.
- Load this extension in child runs only when:
  the agent explicitly has `subagent` in its tool list and recursion depth still allows it.
- Nested state may flow through extension-controlled runtime files and tightly-scoped child env vars that point to those temp-root routes.

## Test Plan

- Verify temp-root nested runtime state is created and consumed for nested runs.
- Verify `maxRecursiveLevel` blocks further delegation when the cap is reached.
- Verify `subagent_agents` restricts child selection.
- Verify agents without `subagent` in their tool list cannot recurse.
- Verify nested runs still persist child sessions and final outputs correctly.

## Assumptions

- Phase 5 still uses the same foreground model as Phase 4.
- No background execution, steering, or resume support is introduced.
