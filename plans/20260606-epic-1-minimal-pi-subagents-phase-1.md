# Phase 1: Repo Setup And Loadable Extension

## Summary

Phase 1 sets up the repository as a valid Pi package and proves Pi can load the extension entrypoint. This phase does not run subagents yet, but it must leave behind a loadable extension with one minimal command for smoke testing.

Pi-usable result:

- Pi can load the extension from this repo.
- `/agents` is available and confirms the extension is active.

## Implementation Changes

- Add package scaffolding:
  `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/release.yml`, `src/index.ts`, `src/config.ts`, `src/paths.ts`, `src/types.ts`, and `tests/`.
- Configure `package.json` following the same Pi package shape used by `pi-status`, while keeping this repo's chosen phase-1 baseline:
  `keywords`, `scripts`, `pi.extensions`, `files`, `engines`, `peerDependencies`, and local `devDependencies`.
- Add GitHub workflows following the same split used by `pi-status`:
  `quality.yml` for push/pull-request validation and `release.yml` for tag-based publish checks.
- Keep the current phase-1 toolchain baseline explicit:
  `node >=22.19.0`, `@earendil-works/pi-coding-agent ^0.78.1`, `@earendil-works/pi-tui ^0.78.1`, `@biomejs/biome ^2.4.16`, `typescript ^6.0.3`, and `vitest ^4.1.7`.
- Configure `pnpm-workspace.yaml` for the current dependency graph, including `allowBuilds` entries for `@google/genai`, `esbuild`, and `protobufjs`.
- Keep `biome.json` aligned with the current repo setup:
  schema `2.4.16`, TypeScript/test file includes, and the explicit JavaScript formatter block already used in this repo.
- Keep workflow behavior aligned with the current `pi-status` pattern:
  `pnpm/action-setup@v4` with pnpm `11.3.0`, `actions/setup-node@v4` with Node `22`, `pnpm install --frozen-lockfile`, quality steps split into `lint`, `typecheck`, and `test`, plus a release workflow that runs `pnpm check`, `pnpm run pack:dry-run`, verifies `v<package.json version>` tag parity, and publishes to npm with provenance.
- Implement path resolution through Pi's `getAgentDir()`.
- Implement config loading from `<agentDir>/extensions/subagents.json`.
- Support config defaults for:
  `maxConcurrency`, `maxRecursiveLevel`, and `defaultTimeoutMs`.
- Register a minimal `/agents` command that prints:
  extension loaded status, resolved config path, resolved user agents directory, resolved bundled agents directory, and resolved transcript/cache directory.
- Keep the command diagnostic-only in this phase. No agent discovery, no creation flow, and no `subagent` tool yet.

## Test Plan

- Typecheck with `tsc --noEmit`.
- Verify `package.json` exposes the extension via `pi.extensions` and includes the expected packaged files/scripts, engine floor, and peer dependencies.
- Verify the checked-in lockfile and `pnpm-workspace.yaml` remain consistent with the chosen phase-1 toolchain and build-script allowances.
- Verify `.github/workflows/quality.yml` and `.github/workflows/release.yml` match the intended `pi-status`-style triggers and commands.
- Verify Pi can load the extension entrypoint without throwing.
- Verify config defaults are used when `subagents.json` is missing.
- Verify `/agents` is registered and returns the resolved paths.

## Assumptions

- A phase counts as Pi-usable if Pi can load the extension and expose at least one working command.
- Phase 1 intentionally stops before agent discovery so the package/setup work stays small and verifiable.
