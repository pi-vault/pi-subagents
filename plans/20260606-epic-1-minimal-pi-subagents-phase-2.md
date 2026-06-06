# Phase 2: Bundled Agents And Discovery

## Summary

Phase 2 adds bundled default agents plus deterministic markdown discovery and parsing. The package ships starter agents in its own `agents/` folder, and `/agents` becomes a real listing command backed by runtime agent discovery.

Pi-usable result:

- After install, Pi has usable default agents.
- `/agents` lists discovered agents from the user directory plus bundled fallbacks.

## Implementation Changes

- Add bundled default agent files:
  `agents/scout.md`, `agents/worker.md`, `agents/researcher.md`, and `agents/planner.md`.
- Add agent discovery logic, preferably in `src/agents.ts`, that reads `*.md` files from:
  the user agent directory at `<agentDir>/agents` and the package-bundled `agents/` directory.
- Parse only simple frontmatter between leading `---` delimiters, followed by the markdown body as the agent system prompt.
- Support frontmatter fields:
  `name`, `description`, `tools`, `model`, `thinking`, `subagent_agents`, and `timeout_ms`.
- Treat `name` and `description` as required non-empty strings.
- Treat `tools` and `subagent_agents` as normalized trimmed string arrays, accepting either comma-separated text or string arrays.
- Treat `timeout_ms` as an optional positive finite number.
- Record the markdown body as `systemPrompt`.
- Skip invalid agent files and return diagnostics that include the skipped file path and the reason it was skipped.
- Upgrade `/agents` to list discovered agents with:
  name, description, tools, model, thinking, child allowlist, and source path.
- Keep `/agents` as a text listing command in this phase. Do not add tool-registry validation, creation flow, editing, or execution behavior here.
- Resolve discovery precedence as:
  user agents first, bundled agents second, with duplicate names preferring the user agent.
- Make discovery output deterministic by sorting filenames within each source directory before parsing.
- Extend the runtime dependency seam so command tests can inject agent discovery results.

## Test Plan

- Verify bundled default agents exist in the extension `agents/` folder.
- Verify bundled agents are discoverable without copying them into the user agent directory.
- Verify duplicate names prefer the user agent over the bundled fallback.
- Verify missing user agent directories do not fail discovery.
- Verify malformed frontmatter, missing required fields, invalid arrays, and invalid `timeout_ms` are skipped clearly.
- Verify the markdown body is preserved as `systemPrompt`.
- Verify `/agents` lists discovered agents and skipped-file diagnostics with expected metadata and deterministic ordering.
- Re-run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.

## Assumptions

- Listing agents is enough to make this phase useful even though agents cannot be executed yet.
- Source paths shown by `/agents` are the absolute paths used during discovery.
