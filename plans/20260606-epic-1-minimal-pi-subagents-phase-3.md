# Phase 3: Tool Discovery And Agent Creation

## Summary

Phase 3 makes agent management practical by discovering available tools from Pi and allowing users to create new markdown agents from inside Pi.

Pi-usable result:

- `/agents` lists current agents and can create a new valid agent file.
- Created agents are immediately discoverable by Pi.

## Implementation Changes

- Discover tool names by merging Pi built-ins with tools from Pi's runtime registry, for example `pi.getAllTools()`.
- Treat built-in Pi tools as:
  `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.
- Use the merged tool list for tool-name validation.
- Extend `/agents` with a create flow that writes a new markdown agent file into the user agent directory at `<agentDir>/agents`.
- Create flow fields:
  `name`, `description`, `tools`, optional `model`, optional `thinking`, optional `subagent_agents`, optional `timeout_ms`, and markdown body.
- Reject duplicate agent names.
- Do not add edit or delete actions in this phase.

## Test Plan

- Verify tool discovery merges built-ins with runtime-registered tools and deduplicates names.
- Verify unknown tool names are rejected during agent creation.
- Verify `/agents` create writes valid markdown with the expected frontmatter/body shape.
- Verify created agents appear in `/agents` listing without restarting Pi.
- Verify duplicate names are rejected cleanly.

## Assumptions

- Pi's runtime registry is available when the extension loads.
- Agent editing continues to happen by directly modifying markdown files outside the command.
