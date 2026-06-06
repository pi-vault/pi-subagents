# Phase 1: Repo Setup And Loadable Extension

## Summary

Phase 1 sets up the repository as a valid Pi extension package and proves Pi can load it. This phase does not run subagents yet, but it must leave behind a loadable extension with one minimal command for smoke testing.

Pi-usable result:

- Pi can load the extension from this repo.
- `/agents` is available and confirms the extension is active.

## Implementation Changes

- Add package scaffolding:
  `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `src/index.ts`, `src/config.ts`, `src/types.ts`, and `tests/`.
- Configure `package.json` with the Pi extension entrypoint and required Pi peer dependencies.
- Implement config loading from `$PI_CODING_AGENT_DIR/extensions/subagents.json`.
- Support config defaults for:
  `maxConcurrency`, `maxRecursiveLevel`, and `defaultTimeoutMs`.
- Register a minimal `/agents` command that prints:
  extension loaded status, resolved config path, resolved agent directory, and resolved transcript/cache directory.
- Keep the command diagnostic-only in this phase. No agent discovery, no creation flow, and no `subagent` tool yet.

## Test Plan

- Typecheck with `tsc --noEmit`.
- Verify Pi can load the extension entrypoint without throwing.
- Verify config defaults are used when `subagents.json` is missing.
- Verify `/agents` is registered and returns the resolved paths.

## Assumptions

- A phase counts as Pi-usable if Pi can load the extension and expose at least one working command.
- Phase 1 intentionally stops before agent discovery so the package/setup work stays small and verifiable.
