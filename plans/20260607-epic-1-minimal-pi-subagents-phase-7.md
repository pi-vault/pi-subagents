# Phase 7: Slash Reliability, Model Inheritance, Runtime Artifacts, And Bundled Agent Refresh

## Summary

Phase 7 hardens the extension for real use after the initial Epic 1 implementation. It focuses on four concrete gaps discovered in the current codebase: `/agent` reliability, parent-model inheritance, runtime artifact placement, and the quality of the bundled agent loadout.

Pi-usable result:

- `/agent` runs through a runtime-backed execution path that behaves reliably in active Pi sessions.
- Agents without an explicit frontmatter model inherit the main session model.
- Runtime subagent artifacts are stored in a deterministic `subagent-artifacts` layout instead of the current temp-scoped nested runtime paths.
- The bundled agent set is upgraded and now includes `reviewer`.

## Implementation Changes

- Fix `/agent` by replacing the direct command execution path with a small slash-command bridge:
  the command handler should emit a request, the active extension runtime should execute the subagent, and the result should come back through the existing `pi-subagent-result` message renderer.
- Preserve the current `/agent <agent> <task...>` user syntax and the current visible result shape.
- Surface a visible error when no active runtime bridge can service the slash request, rather than failing silently or depending on fragile command-context execution.

- Refactor model selection so missing or blank frontmatter `model` means inherit the parent session model from `ctx.model`.
- Treat legacy `model: default` as a compatibility alias for inheritance during parsing and execution, but stop emitting it in newly created or bundled agent files.
- Replace the current `getCliModel()` logic with effective model resolution:
  explicit agent model wins; otherwise inherit the parent model; if neither exists, omit `--model`.
- Pass the inherited parent model to the child Pi process via `--model` so the child actually uses the same model as the main session.

- Replace the current nested runtime temp-root placement for `nested-subagent-events`, `nested-subagent-runs`, `route.json`, and `runtime.json`.
- Add a dedicated runtime-artifacts path helper modeled after nicobailon’s `subagent-artifacts` behavior.
- When a parent session file exists, store runtime artifacts under `<session-dir>/subagent-artifacts`.
- When no parent session file exists, store runtime artifacts under `$PI_CODING_AGENT_DIR/cache/pi-subagents/subagent-artifacts`.
- Keep the artifact layout the same in both roots so debug/runtime files have one consistent structure regardless of session persistence.
- Keep `runtimeCacheDir` as the resolved fallback cache root reported by the extension.
- Do not add retention or cleanup behavior in this phase; scope is limited to path/layout migration.

- Increase `DEFAULT_CONFIG.maxRecursiveLevel` from `2` to `3`.
- Update config/status output, tests, and docs to reflect the new recursion default.

- Refactor the bundled agent markdown files to use stronger, more role-specific prompts rather than the current minimal placeholders.
- Ship bundled agents:
  `scout`, `planner`, `researcher`, `worker`, and new `reviewer`.
- Make bundled agents inherit the parent model by default by removing explicit `model` frontmatter.
- Keep the bundled set compatible with tools this package already guarantees; do not introduce mandatory external tool dependencies in this phase.
- Make bundled `reviewer` read-only by default with a toolset equivalent to local review/exploration needs.

- Merge `agents/README.md` into the root `README.md` and remove the separate agent-directory README.
- Update the root README to document:
  bundled agents, inherited-model behavior, new recursion default, and runtime artifact locations.

## Test Plan

- Verify `/agent` uses the bridge path and still produces a visible `pi-subagent-result` message.
- Verify `/agent` reports a visible bridge/runtime error when no active extension context is available.
- Verify missing frontmatter `model` inherits the parent session model.
- Verify explicit frontmatter `model` still overrides the parent session model.
- Verify legacy `model: default` behaves as inheritance.
- Verify child spawn arguments include inherited `--model` when appropriate and omit it when neither agent nor parent model is known.
- Verify persisted-session runs place runtime artifacts under `<session-dir>/subagent-artifacts`.
- Verify non-persisted runs place runtime artifacts under `$PI_CODING_AGENT_DIR/cache/pi-subagents/subagent-artifacts`.
- Verify nested runtime files are created under the new artifact roots rather than `$TMPDIR`.
- Verify default config now reports `maxRecursiveLevel=3`.
- Verify bundled agent discovery expects `reviewer.md` and all bundled markdown parses successfully without explicit model frontmatter.
- Run `pnpm test`, `pnpm run typecheck`, and `pnpm run lint`.

## Assumptions

- `/agent` is kept as a slash command; only its internal execution path changes.
- Session-scoped `subagent-artifacts` is the desired primary runtime location, following nicobailon’s model.
- The fallback artifact root is not OS temp; it is `$PI_CODING_AGENT_DIR/cache/pi-subagents/subagent-artifacts`.
- Bundled agents should all inherit the main session model by default.
- `reviewer` is intentionally bundled as a read-only review agent in this repo’s starter set.
