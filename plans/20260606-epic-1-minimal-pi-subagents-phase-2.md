# Phase 2: Bundled Agents, Install Copy, And Discovery

## Summary

Phase 2 adds the bundled default agents and runtime discovery. Pi install copies the extension's `agents/` folder into `$PI_CODING_AGENT_DIR/agents`, and `/agents` becomes a real listing command.

Pi-usable result:

- After install, Pi has usable default agents.
- `/agents` lists discovered agents from the runtime directory.

## Implementation Changes

- Add bundled default agent files:
  `agents/scout.md`, `agents/worker.md`, `agents/researcher.md`, and `agents/planner.md`.
- Add install-time copy behavior through Pi's extension install lifecycle:
  copy missing files from bundled `agents/` into `$PI_CODING_AGENT_DIR/agents`, create the target directory if needed, and never overwrite existing files.
- Implement markdown frontmatter parsing for runtime agent files in `$PI_CODING_AGENT_DIR/agents`.
- Support frontmatter fields:
  `name`, `description`, `tools`, `model`, `thinking`, `subagent_agents`, and `timeout_ms`.
- Upgrade `/agents` to list discovered agents with:
  name, description, tools, model, thinking, child allowlist, and source path.
- Keep runtime discovery single-source:
  only `$PI_CODING_AGENT_DIR/agents` is scanned during normal use.

## Test Plan

- Verify bundled default agents exist in the extension `agents/` folder.
- Verify install copies missing bundled agents into `$PI_CODING_AGENT_DIR/agents`.
- Verify install skips existing files without overwriting them.
- Verify malformed markdown is rejected or skipped clearly.
- Verify `/agents` lists the discovered runtime agents with expected metadata.

## Assumptions

- Pi provides an install lifecycle hook capable of copying bundled assets.
- Listing agents is enough to make this phase useful even though agents cannot be executed yet.
