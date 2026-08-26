# Phase 1: Complete Dependency Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update every direct development dependency to the approved latest stable version and align the repository metadata, CI runtime, documentation, and lockfile without changing product behavior.

**Architecture:** Treat the dependency set as one atomic toolchain baseline. Resolve the eight direct development dependencies together, keep the three Pi peer dependencies wildcarded, and update only metadata that must agree with the new versions. The exact dependency set has already passed an isolated Node `24.15.0` compatibility probe, so product source and tests remain unchanged.

**Tech Stack:** Node.js `24.15.0+`, pnpm `11`, TypeScript `7.0.2`, Vitest `4.1.11`, Biome `2.5.10`, TypeBox `1.3.19`, Pi/TUI `0.84.3`.

**Spec:** `docs/superpowers/plans/2026-08-26-run-chain-dashboard-ui.md#approved-design`

## Global Constraints

- Use the exact local Pi release tag `v0.84.3` in `/Users/lanh/Developer/pi-packages/pi` as the compatibility reference; do not copy from its unreleased `main` branch.
- The tested Pi/TUI baseline is exactly `0.84.3`; retain wildcard Pi peer dependencies and document Pi `0.84.3+` for users.
- Update all eight direct development dependencies to the exact caret ranges listed in Task 1.
- Retain the existing Node engine requirement `>=24.15.0` and make both CI workflows test that runtime.
- Do not change commands, schemas, settings, rendering, interaction behavior, runtime dependencies, or product source/tests.
- Do not add pi-status or any other dependency.
- Keep the parent plan and Phases 2–9 unchanged.
- If the verified dependency set requires a product source change during implementation, stop and report the difference instead of expanding this phase.

---

## Audited Dependency Set

These were the npm `latest` versions and exact publication dates when this plan was approved on 2026-08-26:

| Package                           |   Current |   Target | Published (UTC) |
| --------------------------------- | --------: | -------: | --------------- |
| `@earendil-works/pi-ai`           | `0.80.10` | `0.84.3` | 2026-08-24      |
| `@earendil-works/pi-coding-agent` | `0.80.10` | `0.84.3` | 2026-08-24      |
| `@earendil-works/pi-tui`          | `0.80.10` | `0.84.3` | 2026-08-24      |
| `@biomejs/biome`                  |   `2.5.4` | `2.5.10` | 2026-08-21      |
| `@types/node`                     |  `26.1.1` | `26.3.0` | 2026-08-24      |
| `typebox`                         |   `1.3.6` | `1.3.19` | 2026-08-25      |
| `typescript`                      |   `6.0.3` |  `7.0.2` | 2026-07-08      |
| `vitest`                          |  `4.1.10` | `4.1.11` | 2026-08-18      |

Sources: npm package metadata and the local Pi `v0.84.3` changelogs. TypeScript `7.0.2` is intentionally included despite being a compiler major: this repository invokes only `tsc`, does not import the unavailable TypeScript 7 compiler API, and the isolated all-target probe passed typechecking and the complete test suite.

## File Structure

- Modify `package.json`: declare the eight approved direct development dependency ranges; leave engines and peer dependencies unchanged.
- Modify `pnpm-lock.yaml`: resolve the declared versions and their transitive graph.
- Modify `biome.json`: match the configuration schema URL to Biome `2.5.10`.
- Modify `pnpm-workspace.yaml`: remove the inert Pi `0.80.10` release-age exclusions.
- Modify `.github/workflows/quality.yml`: run quality checks on Node `24.15.0`.
- Modify `.github/workflows/release.yml`: build and publish on Node `24.15.0`.
- Modify `README.md`: state the tested Pi and Node prerequisites at the install boundary.

### Task 1: Update and verify the complete dependency baseline

**Files:**

- Modify: `package.json:50-63`
- Modify: `pnpm-lock.yaml`
- Modify: `biome.json:2`
- Modify: `pnpm-workspace.yaml:5-9`
- Modify: `.github/workflows/quality.yml:22-27`
- Modify: `.github/workflows/release.yml:23-29`
- Modify: `README.md:10-16`
- Test: all files under `tests/` through `pnpm check`

**Interfaces:**

- Consumes: npm-published direct dependencies and the Pi `v0.84.3` release contracts.
- Produces: a lockfile and CI baseline in which Pi packages resolve to `0.84.3`, Biome to `2.5.10`, Node types to `26.3.0`, TypeBox to `1.3.19`, TypeScript to `7.0.2`, and Vitest to `4.1.11`.
- Public APIs/types: none; the three Pi `peerDependencies` remain `"*"`.

- [ ] **Step 1: Verify the supported toolchain and clean baseline.**

  Run:

  ```bash
  node --version
  pnpm --version
  git status --short
  ```

  Expected: Node is `v24.15.0` or newer, pnpm is major version `11`, and the status contains no unexpected implementation changes. If the active Node is older, use the repository owner's installed runtime for subsequent commands:

  ```bash
  mise exec node@24.15.0 -- node --version
  ```

  Expected: `v24.15.0`.

- [ ] **Step 2: Record the pre-update verification result.**

  Run with Git signing disabled only for child processes that create temporary repositories:

  ```bash
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgsign \
  GIT_CONFIG_VALUE_0=false \
  mise exec node@24.15.0 -- pnpm check
  ```

  Expected: Biome lint and `tsc --noEmit` complete, then all `56` test files and `1,276` tests pass. Existing Biome warnings are allowed because the current `lint` script does not treat warnings as errors. If this baseline fails for a reason other than environment configuration, record the failure and stop rather than folding an unrelated fix into this phase.

- [ ] **Step 3: Update all direct development dependency declarations and the lockfile.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm add -D \
    @earendil-works/pi-ai@0.84.3 \
    @earendil-works/pi-coding-agent@0.84.3 \
    @earendil-works/pi-tui@0.84.3 \
    @biomejs/biome@2.5.10 \
    @types/node@26.3.0 \
    typebox@1.3.19 \
    typescript@7.0.2 \
    vitest@4.1.11 \
    --lockfile-only
  ```

  Expected: `package.json` contains exactly these ranges:

  ```json
  {
    "devDependencies": {
      "@biomejs/biome": "^2.5.10",
      "@earendil-works/pi-ai": "^0.84.3",
      "@earendil-works/pi-coding-agent": "^0.84.3",
      "@earendil-works/pi-tui": "^0.84.3",
      "@types/node": "^26.3.0",
      "typebox": "^1.3.19",
      "typescript": "^7.0.2",
      "vitest": "^4.1.11"
    }
  }
  ```

  Leave `engines.node` as `">=24.15.0"` and leave all three Pi peer dependencies as `"*"`.

- [ ] **Step 4: Synchronize the Biome configuration schema.**

  In `biome.json`, change only the schema URL:

  ```json
  "$schema": "https://biomejs.dev/schemas/2.5.10/schema.json"
  ```

  Do not run `biome migrate`; the current configuration is valid and only its schema version is stale.

- [ ] **Step 5: Remove the inert release-age exclusions.**

  Delete this complete block from `pnpm-workspace.yaml`:

  ```yaml
  minimumReleaseAgeExclude:
    - "@earendil-works/pi-agent-core@0.80.10"
    - "@earendil-works/pi-ai@0.80.10"
    - "@earendil-works/pi-coding-agent@0.80.10"
    - "@earendil-works/pi-tui@0.80.10"
  ```

  Expected: `pnpm-workspace.yaml` retains only the existing `allowBuilds` mapping. Do not replace the entries with `0.84.3`; no `minimumReleaseAge` policy is configured, so the exclusions have no effect.

- [ ] **Step 6: Align both CI workflows with the declared Node engine.**

  In `.github/workflows/quality.yml` and `.github/workflows/release.yml`, change the existing setup-node input to:

  ```yaml
  node-version: "24.15.0"
  ```

  Leave action versions, pnpm `11.3.0`, triggers, caching, commands, permissions, and release steps unchanged.

- [ ] **Step 7: Document the tested host boundary.**

  In `README.md`, insert this exact sentence immediately after `## Install` and before the install command:

  ```markdown
  Requires Pi 0.84.3+ and Node.js 24.15.0+.
  ```

  Do not document dashboard behavior in this phase.

- [ ] **Step 8: Install exactly from the regenerated lockfile.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm install --frozen-lockfile
  ```

  Expected: installation succeeds without changing `package.json` or `pnpm-lock.yaml` further.

- [ ] **Step 9: Verify versions and eliminate stale declarations.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm list --depth 0
  rg -n '0\.80\.10|2\.5\.4|26\.1\.1|1\.3\.6|6\.0\.3|4\.1\.10' \
    package.json pnpm-lock.yaml pnpm-workspace.yaml biome.json
  ```

  Expected: `pnpm list` reports the eight exact resolved versions from Step 3. The `rg` command exits with status `1` and prints no matches, proving the superseded direct versions and stale configuration values are absent.

- [ ] **Step 10: Run the complete post-update verification.**

  Run:

  ```bash
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgsign \
  GIT_CONFIG_VALUE_0=false \
  mise exec node@24.15.0 -- pnpm check
  ```

  Expected: Biome no longer reports a schema-version mismatch, TypeScript `7.0.2` typechecking succeeds, and all `56` test files and `1,276` tests pass. No product source/test edits are permitted to obtain this result.

- [ ] **Step 11: Verify the package boundary.**

  Run:

  ```bash
  mise exec node@24.15.0 -- pnpm run pack:dry-run
  ```

  Expected: the dry run succeeds and includes `src/`, bundled agents, bundled chains, `LICENSE`, `CHANGELOG.md`, and `README.md`; it does not include tests or planning documents.

- [ ] **Step 12: Audit whitespace and exact scope.**

  Run:

  ```bash
  git diff --check
  git diff --stat
  git diff -- \
    package.json \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    biome.json \
    README.md \
    .github/workflows/quality.yml \
    .github/workflows/release.yml
  git status --short
  ```

  Expected: no whitespace errors; only the seven named dependency-baseline files are modified; commands, schemas, settings, UI code, runtime code, tests, `peerDependencies`, and `engines.node` are unchanged.

- [ ] **Step 13: Commit the atomic baseline.**

  ```bash
  git add \
    package.json \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    biome.json \
    README.md \
    .github/workflows/quality.yml \
    .github/workflows/release.yml
  git commit -m "chore: update development dependencies"
  ```
