# Phase 8: Pi Session Artifacts And Source Layout Refactor

## Summary

Phase 8 replaces current `subagent-artifacts` handling with nicobailon-style per-run artifact files, verified against:

`/Users/lanh/Developer/dotfiles/configs/pi/sessions/--Users-lanh-Developer-pi-vault-pi-status--`

Observed layout:

- Parent session folder: `$PI_CODING_AGENT_DIR/sessions/<pi-encoded-cwd>/`
- Artifact folder: `$PI_CODING_AGENT_DIR/sessions/<pi-encoded-cwd>/subagent-artifacts/`
- Child sessions: `$PI_CODING_AGENT_DIR/sessions/<pi-encoded-cwd>/<parent-session-stem>/<runId>/run-<index>/session.jsonl`
- Artifact files: `{runId}_{agent}_{index}_input.md`, `{runId}_{agent}_{index}_output.md`, `{runId}_{agent}_{index}_meta.json`

## Key Changes

- Add `src/shared/artifacts.ts` with nicobailon-style helpers:
  `resolvePiEncodedSessionDir`, `getArtifactsDir`, `getArtifactPaths`, `ensureArtifactsDir`, `writeArtifact`, `writeMetadata`.
- Implement Pi cwd encoding locally because `getDefaultSessionDir` exists in Pi internals but is not exported by `@earendil-works/pi-coding-agent`:
  resolve cwd, strip one leading `/` or `\`, replace `/`, `\`, and `:` with `-`, then wrap with `--`.
- Resolve artifact root as:
  parent session exists: `<parent-session-dir>/subagent-artifacts`.
  no parent session: `$PI_CODING_AGENT_DIR/sessions/<pi-encoded-current-working-directory>/subagent-artifacts`.
- Example:
  cwd `/Users/lanh/Developer/pi-vault/pi-subagents` resolves to `$PI_CODING_AGENT_DIR/sessions/--Users-lanh-Developer-pi-vault-pi-subagents--/subagent-artifacts`.
- Store per-run artifact files as:
  `{runId}_{safeAgent}_{index}_input.md`, `{runId}_{safeAgent}_{index}_output.md`, `{runId}_{safeAgent}_{index}_meta.json`.
- Keep JSONL artifact support optional/reserved, but do not require it for this phase because the verified real run did not show per-run artifact JSONL files.
- Preserve nested runtime directories under the same artifact root:
  `nested-subagent-events/` and `nested-subagent-runs/`.
- Keep child session placement aligned with the verified layout:
  parent session exists: `<parent-session-dir>/<parent-session-stem>/<runId>/run-0/session.jsonl`.
  no parent session: `<pi-encoded-cwd-session-dir>/<synthetic-parent-session-stem>/<runId>/run-0/session.jsonl`.
- Extend execution details with optional `artifactPaths`.
- Write artifacts for success and failure:
  input contains delegated task context, output contains final surfaced output or failure text, metadata contains run id, agent, task, status/error, model, timing, usage, exit code, stop reason, cwd, child session path, and timestamp.

## Source Layout

- Keep `src/index.ts` as the package entrypoint, but make it a thin extension bootstrap.
- Move registration and command code into `src/extension/index.ts`.
- Move runtime/domain modules into:
  `src/core/subagent.ts`, `src/core/agents.ts`, `src/core/config.ts`, `src/core/paths.ts`.
- Move shared types and helpers into:
  `src/shared/types.ts`, `src/shared/artifacts.ts`.
- Move rendering into:
  `src/tui/render.ts`.
- Update imports and tests without changing command names, tool names, slash syntax, or parent-visible result content.

## Test Plan

- Verify parent-session runs write artifacts under `<parent-session-dir>/subagent-artifacts`.
- Verify no-parent-session runs write artifacts under `$PI_CODING_AGENT_DIR/sessions/<pi-encoded-cwd>/subagent-artifacts`.
- Verify cwd `/Users/lanh/Developer/pi-vault/pi-subagents` encodes to `--Users-lanh-Developer-pi-vault-pi-subagents--`.
- Verify artifact names include run id, safe agent name, and run index.
- Verify input, output, and metadata files are written on success.
- Verify output and metadata files are written on error, timeout, abort, and spawn failure where result construction occurs.
- Verify nested runtime files still resolve under the same `subagent-artifacts` root.
- Verify no artifacts are written under `$PI_CODING_AGENT_DIR/cache` or OS temp.
- Verify moved modules still load through `src/index.ts`.
- Run `pnpm test`, `pnpm run typecheck`, and `pnpm run lint`.

## Assumptions

- Use the verified Pi cwd encoding formula rather than deep-importing Pi internals.
- Phase 8 adopts nicobailon’s artifact file shape and session-folder placement, but not async, chain, cleanup, or model fallback features.
- `.last-cleanup` was observed in nicobailon artifacts, but cleanup/retention remains out of scope for this phase.
