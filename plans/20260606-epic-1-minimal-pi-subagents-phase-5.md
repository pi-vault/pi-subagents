# Phase 5: Recursion And Nested Delegation

## Summary

Phase 5 adds controlled nested delegation. Agents that explicitly include `subagent` in their tool list can delegate to allowed child agents, bounded by configured recursion depth.

Pi-usable result:

- `worker` can delegate to allowed child agents such as `scout` or `researcher`.
- Disallowed or too-deep delegation fails clearly.

## Implementation Changes

- Add per-run runtime context files under `$PI_CODING_AGENT_DIR/cache/pi-subagents/runtime`.
- Track current depth, max depth, and child-agent allowlist in the runtime context.
- Enforce `maxRecursiveLevel`, default `2`.
- Apply `subagent_agents` from agent frontmatter to nested child exposure.
- Load this extension in child runs only when:
  the agent explicitly has `subagent` in its tool list and recursion depth still allows it.
- Keep the no-new-env-vars rule:
  nested state flows only through extension-controlled runtime files.

## Test Plan

- Verify runtime context files are written and consumed for nested runs.
- Verify `maxRecursiveLevel` blocks further delegation when the cap is reached.
- Verify `subagent_agents` restricts child selection.
- Verify agents without `subagent` in their tool list cannot recurse.
- Verify nested runs still persist transcripts and final outputs correctly.

## Assumptions

- Phase 5 still uses the same foreground model as Phase 4.
- No background execution, steering, or resume support is introduced.
