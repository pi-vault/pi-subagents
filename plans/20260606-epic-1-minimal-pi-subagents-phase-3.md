# Phase 3: Tool Discovery And Agent Creation

## Summary

Phase 3 makes agent management practical by validating tools against Pi's runtime registry and allowing users to create new markdown agents from inside Pi, building on the discovery and listing work from Phase 2.

Pi-usable result:

- `/agents` keeps the Phase 2 listing behavior.
- `/agents:add` can create a new valid agent file through a minimal interactive flow.
- Created agents are immediately discoverable by Pi.

## Implementation Changes

- Discover tool names by merging Pi built-ins with tools from Pi's runtime registry via `pi.getAllTools()`.
- Treat built-in Pi tools as:
  `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.
- Deduplicate and sort the merged tool list before using it for validation and display.
- Extend the runtime dependency seam so tests can inject discovered tool names and creation helpers without depending on live Pi runtime state.
- Extend `/agents:add` with an interactive flow that writes a new markdown agent file into the user agent directory at `<agentDir>/agents`.
- Create flow fields:
  optional `name`, `description`, `tools`, optional `model`, optional `thinking`, optional `subagent_agents`, optional `timeout_ms`, and markdown body.
- Validate creation inputs before writing:
  non-empty `description` and markdown body; `name`, when provided, restricted to `^[A-Za-z0-9_-]+$`; known tool names only; `subagent_agents` must reference discovered agents; `timeout_ms` must be a positive finite number.
- Preserve the submitted `name` in frontmatter when provided, allowing lowercase or capitalized names.
- If frontmatter `name` is missing or empty, inherit the agent name from the lowercase markdown filename stem.
- Derive the markdown filename from the submitted `name.toLowerCase()` when `name` is provided; otherwise prompt for a lowercase filename slug. Require the final filename slug to match `^[a-z0-9_-]+$`.
- Reject duplicate agent names based on current discovery results.
- Serialize created agents deterministically as `<agentDir>/agents/<lowercase-name>.md` with single-line frontmatter fields, comma-separated arrays, and a trailing newline.
- Create the user agent directory if missing, and use exclusive create semantics so existing files are not overwritten.
- Keep discovery parsing schema-only in this phase; invalid tool names in existing hand-written agent files are not treated as discovery errors yet.
- Do not add edit or delete actions in this phase.

## Test Plan

- Verify tool discovery merges built-ins with runtime-registered tools and deduplicates names.
- Verify merged tool names are sorted deterministically.
- Verify unknown tool names are rejected during agent creation.
- Verify invalid names, invalid `subagent_agents`, empty required fields, and invalid `timeout_ms` are rejected during agent creation.
- Verify capitalized frontmatter names are preserved while the markdown filename is lowercase.
- Verify missing frontmatter `name` inherits the agent name from the markdown filename stem.
- Verify `/agents:add` writes valid markdown with the expected frontmatter/body shape.
- Verify created agents appear in `/agents` listing without restarting Pi.
- Verify duplicate names are rejected cleanly.
- Verify command tests can mock the interactive inputs and editor body.

## Assumptions

- Pi's runtime registry is available when `/agents:add` runs.
- `/agents` with no arguments remains the listing command for backward compatibility.
- Agent markdown filenames are lowercase slugs; frontmatter `name` can preserve user casing when present and falls back to the filename stem when omitted.
- Agent editing continues to happen by directly modifying markdown files outside the command.
