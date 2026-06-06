# Phase 2: Bundled Agents And Discovery

## Summary

Phase 2 adds the bundled default agents and runtime discovery. The package ships starter agents in its own `agents/` folder, and `/agents` becomes a real listing command.

Pi-usable result:

- After install, Pi has usable default agents.
- `/agents` lists discovered agents from the user directory plus bundled fallbacks.

## Implementation Changes

- Add bundled default agent files:
  `agents/scout.md`, `agents/worker.md`, `agents/researcher.md`, and `agents/planner.md`.
- Implement markdown frontmatter parsing for both:
  the user agent directory at `<agentDir>/agents` and the package-bundled `agents/` directory.
- Support frontmatter fields:
  `name`, `description`, `tools`, `model`, `thinking`, `subagent_agents`, and `timeout_ms`.
- Upgrade `/agents` to list discovered agents with:
  name, description, tools, model, thinking, child allowlist, and source path.
- Resolve discovery precedence as:
  user agents first, bundled agents second, with duplicate names preferring the user agent.

## Test Plan

- Verify bundled default agents exist in the extension `agents/` folder.
- Verify bundled agents are discoverable without copying them into the user agent directory.
- Verify duplicate names prefer the user agent over the bundled fallback.
- Verify malformed markdown is rejected or skipped clearly.
- Verify `/agents` lists the discovered runtime agents with expected metadata.

## Assumptions

- Listing agents is enough to make this phase useful even though agents cannot be executed yet.
