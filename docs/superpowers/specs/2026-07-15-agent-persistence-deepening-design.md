# Agent Persistence Deepening Design

## Goal

Make the Agent module the only owner of Agent catalog precedence and user-override persistence while preserving the Agents menu's normal labels, notifications, ordering, and edit experience.

## Scope

This phase centralizes catalog discovery plus override reads and writes. It does not change agent creation, export, disable, delete, settings, command names, tool shapes, or Agent Markdown format.

The only approved edge-case behavior change is duplicate precedence: when multiple user files define the same normalized Agent name, the first filename in deterministic discovery order wins. This matches runtime discovery, so the menu shows the Agent that can actually execute.

## Core API

`src/core/agents.ts` will export the catalog types and three operations:

```ts
export interface AgentCatalogEntry {
  name: string;
  state: "bundled" | "override" | "disabled";
  bundled?: AgentDefinition;
  override?: AgentDefinition;
}

export interface AgentCatalog {
  entries: AgentCatalogEntry[];
  userDiagnostics: AgentDiscoveryDiagnostic[];
  bundledDiagnostics: AgentDiscoveryDiagnostic[];
}

export function discoverAgentCatalog(paths: ResolvedPaths): AgentCatalog;

export function readUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
): string;

export function updateUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
  markdown: string,
): AgentDefinition;
```

The implementation will reuse the existing safe directory scan, `safeReadFile`, and `parseAgentContent`. Shared private scanning or indexing may be extracted only where both `discoverAgents` and `discoverAgentCatalog` use it. The existing `discoverAgents` API and result ordering remain unchanged.

## Catalog Semantics

Catalog names are compared case-insensitively after trimming. Entries are sorted by normalized name for the menu.

- A valid user definition overrides a bundled definition with the same name.
- A user definition with `enabled: false` produces a `disabled` entry and blocks its bundled definition.
- A valid user definition without a bundled counterpart still produces an `override` entry.
- A bundled definition without a user counterpart produces a `bundled` entry.
- The first valid definition in each scope wins; later duplicates produce diagnostics.
- Unsafe filenames, malformed Markdown, symlinks, and unreadable files are skipped rather than thrown from catalog discovery.

User and bundled diagnostics remain separate. The menu uses `userDiagnostics.length`, preserving its existing `invalid user agent file(s) skipped` footer. Bundled diagnostics remain available to core callers without changing that footer.

## Override Persistence

Both override operations accept only an existing direct `.md` child of `paths.userAgentsDir`. Paths outside that directory, nested paths, missing files, symlinks, and unreadable files are rejected.

`readUserAgentOverride` returns the exact file text so comments, formatting, field order, and trailing whitespace remain intact in the editor.

`updateUserAgentOverride` parses the proposed Markdown before writing. Invalid Markdown throws the parser reason and leaves the existing file byte-for-byte unchanged. Valid Markdown is written once and the parsed `AgentDefinition` is returned. Renaming the Agent in frontmatter remains allowed because the current editor permits it.

The existing filesystem TOCTOU limitation documented in `safe-fs.ts` remains accepted; this phase does not add platform-specific file-descriptor handling or atomic-write machinery.

## TUI and Dependency Flow

`RuntimeDeps` gains required catalog, override-read, and override-update operations. `createRuntimeDeps` in `src/index.ts` wires the core functions, and test dependency factories provide explicit fakes.

For each Agents menu render, the TUI resolves paths once and calls `discoverAgentCatalog`. It renders the returned entries and user diagnostic count without reading directories or parsing Markdown.

When Edit is selected, the TUI calls `readUserAgentOverride` at action time, passes the exact text to the editor, and calls `updateUserAgentOverride` only when the text changed. Existing success and error notification text remains unchanged. Core errors are caught at the menu boundary as they are today.

## Tests

Core tests cover:

- bundled, override, disabled, and user-only entries;
- deterministic sorting and first-definition-wins duplicate handling;
- unsafe, malformed, symlinked, and unreadable discovery inputs;
- exact Markdown reads;
- rejection of missing, nested, symlinked, and outside-directory override paths;
- invalid edits leaving the original file unchanged;
- valid edits writing once and returning the saved Agent.

Menu tests use nonexistent filesystem paths and mocked RuntimeDeps operations. They drive catalog display and the Edit action, proving that catalog contents, editor input, updates, labels, notifications, ordering, and footer text come through the Agent-module seam. If the menu retains direct filesystem access, these tests fail against the nonexistent paths.

The existing `tests/index.test.ts` RuntimeDeps factory is updated for the required operations. Typechecking verifies production wiring in `src/index.ts`.

## Files and Commit Boundaries

The implementation touches only:

- `src/core/agents.ts`
- `tests/agents.test.ts`
- `src/shared/runtime-deps.ts`
- `src/index.ts`
- `src/tui/agents-menu.ts`
- `tests/agents-menu.test.ts`
- `tests/index.test.ts`

Use two implementation commits: first the tested core seam, then RuntimeDeps and TUI delegation. No persistence class, repository framework, new dependency, compatibility wrapper, or unrelated refactor is added.

## Verification

Run focused Agent and menu tests, TypeScript typechecking, and lint on every touched file. Then run the full repository check with process-local Git signing disabled, as required by the architecture phase overview.
