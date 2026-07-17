# Settings Consolidation Design

## Goal

Replace the duplicate configuration readers with one settings resolver, preserve valid legacy settings, and make Max Recursive Level effective at startup and after menu edits.

## Non-goals

- No migration command or legacy-file rewrite.
- No new configuration framework or dependency.
- No command or tool-shape changes. Existing setting labels, edit prompts, and successful-notification text stay unchanged; the approved scope selector is new.
- No changes to specialized `toolBudget`, `modelScope`, or Watchdog policy beyond routing them through the unified resolver.
- No project settings read or write before Pi marks the active project trusted.

## Resolver API

`src/core/settings.ts` is the only settings reader and writer. `src/core/config.ts`, `SubagentsConfig`, and `LoadedConfig` are removed after callers migrate.

```ts
export type SettingsScope = "project" | "global";

export type EditableSettingKey =
  | "maxConcurrent"
  | "maxRecursiveLevel"
  | "defaultMaxTurns"
  | "graceTurns"
  | "defaultJoinMode"
  | "maxSpawnsPerSession"
  | "widgetMode"
  | "fleetView";

export function loadSettings(
  cwd: string = process.cwd(),
  scope: SettingsScope = "global",
): SubagentsSettings;

export async function saveSetting(
  cwd: string,
  scope: SettingsScope,
  key: EditableSettingKey,
  value: unknown,
): Promise<boolean>;
```

`SubagentsSettings` uses canonical `maxConcurrent` naming. Its primitive runtime fields resolve to complete defaults; specialized object settings remain optional.

| Setting | Default |
| --- | --- |
| `maxConcurrent` | `3` |
| `maxRecursiveLevel` | `3` |
| `defaultMaxTurns` | `0` |
| `graceTurns` | `5` |
| `defaultJoinMode` | `smart` |
| `maxSpawnsPerSession` | `40` |
| `widgetMode` | `background` |
| `fleetView` | `true` |

`toolBudget`, `modelScope`, and Watchdog settings remain absent unless configured; their existing consumers supply specialized defaults or validation.

## Paths, scopes, and precedence

Settings resolve in this order, with later valid fields winning:

1. built-in defaults;
2. legacy global settings at `resolvePaths().configPath`;
3. canonical global settings at `getAgentDir()/subagents.json`;
4. project settings at `join(cwd, CONFIG_DIR_NAME, "subagents.json")`.

The legacy path must use `resolvePaths()` without `cwd`. The argument to `resolvePaths` is a Pi agent directory, not a project working directory.

Scope controls the highest included layer:

- omitted scope or `"global"`: stop after canonical global and exclude project settings;
- `"project"`: include all four layers.

The global-only default prevents a caller without a Pi context from accidentally honoring project configuration. A caller may request `"project"` only after checking `ctx.isProjectTrusted()`. Project paths use Pi's exported `CONFIG_DIR_NAME`; `.pi` is never hardcoded.

Global saves always target the canonical global file. Trusted project saves target the project file. The legacy file is read-only compatibility input.

## Normalization and validation

Each file is parsed and normalized independently before merging. Legacy `maxConcurrency` maps to canonical `maxConcurrent`. Invalid fields are omitted from their layer so they do not erase valid lower-precedence values.

Primitive values use one policy regardless of source:

| Setting | Valid value |
| --- | --- |
| `maxConcurrent` | integer from 1 through 1024 |
| `maxRecursiveLevel` | integer of at least 1 |
| `defaultMaxTurns` | integer of at least 0 |
| `graceTurns` | integer of at least 0 |
| `maxSpawnsPerSession` | integer from 0 through 10000 |
| `defaultJoinMode` | `async`, `group`, or `smart` |
| `widgetMode` | `all`, `background`, or `off` |
| `fleetView` | boolean |

This intentionally stops accepting legacy negative, fractional, and out-of-range numbers outside the supported domains. `maxSpawnsPerSession: 0` remains valid and means block all spawns.

Existing specialized validation remains authoritative:

- `modelScope` uses `parseModelScopeConfig`;
- Watchdog settings use `parseWatchdogConfig`;
- `toolBudget` receives its existing structural object check and remains deeply validated by `validateToolBudget` at its current use sites.

These specialized object settings are readable from files but are not writable through the menu-focused `saveSetting` API.

## Saving

`saveSetting` validates the requested value and passes the absolute target path to Pi's `withFileMutationQueue`. The queue covers directory creation, reading, parsing, changing one canonical key, and writing, so concurrent in-process edits cannot lose sibling changes.

- Missing files and parent directories are created.
- Invalid values return `false` without writing.
- Unsupported keys from JavaScript or casted callers return `false` without writing.
- Filesystem failures return `false`.
- A malformed or non-object existing target returns `false` and remains untouched because a single-setting edit must not destroy data it cannot preserve.
- Live runtime state changes only after a successful save.
- No new locking dependency is added; the implementation uses Pi's public file-mutation primitive.

The existing success and invalid-input notifications remain unchanged. A write failure produces one error notification and does not apply the requested value in memory.

## Runtime data flow

`RuntimeDeps` replaces `loadConfig` and `saveConfig` with the unified persistence seams and owns the active session snapshot:

```ts
settings: SubagentsSettings;
refreshSettings(cwd: string, projectTrusted: boolean): void;
```

`createRuntimeDeps` bootstraps global settings only. `registerSubagentsExtension` handles every `session_start` and calls `refreshSettings(ctx.cwd, ctx.isProjectTrusted())`. Refresh includes the project layer only when trusted, then updates manager limits, join mode, widget/fleet state, Watchdog configuration, and parent tool-budget state.

All execution adapters consume `deps.settings`; they do not resolve settings from their execution cwd. Trust belongs to the active Pi project. A subagent pointed at another directory must not activate that directory's project settings.

The parent `tool_call` handler is always registered and consults mutable active budget state, allowing a trusted project budget to become effective after the global bootstrap. Watchdog callbacks also consult the current runtime; refresh disposes and replaces the runtime when its resolved configuration changes.

`applySettings` gains a `setMaxDepth` applier. The separate startup `loadConfig(...).maxSpawnsPerSession` read is removed.

## Settings menu

Entering Settings asks for scope once and reuses it until the user leaves the settings visit. Trusted projects offer Project, Global, and Back. Untrusted projects omit Project and explain in the selector footer that project settings require trust.

For each edit, the menu:

1. loads settings for the selected scope, requesting Project only from a trusted context;
2. keeps the existing labels, prompts, and formatting while making primitive input validation match the resolver table;
3. awaits a single-field `saveSetting` call;
4. on success, calls `refreshSettings(ctx.cwd, ctx.isProjectTrusted())` to recompute effective state;
5. on failure, leaves runtime state unchanged and shows one write-error notification;
6. reloads the selected scope for the next menu rendering.

Refreshing effective state instead of applying the raw edited value preserves precedence: editing Global cannot override a higher-priority Project value. The menu and writer share `EditableSettingKey`; the internal key changes from `maxConcurrency` to `maxConcurrent`, while the user-facing “Max Concurrency” text stays unchanged.

## Migration surface

The caller migration includes every active `loadConfig` or `saveConfig` consumer:

- `src/index.ts`
- `src/core/subagent.ts`
- `src/core/slash-chain.ts`
- `src/core/child-subagent-tool.ts`
- `src/core/rpc.ts`
- `src/tui/agents-menu.ts`
- `src/shared/runtime-deps.ts`
- `tests/_test-helpers.ts`

The old bulk `saveSettings` API is also removed. `tests/config.test.ts` is deleted, and its still-relevant cases move to `tests/settings.test.ts` so removed APIs do not retain misleading tests.

## Verification

Resolver tests cover:

- complete defaults;
- all four precedence layers;
- legacy key aliasing;
- uniform primitive validation;
- invalid higher-layer fallthrough;
- `maxSpawnsPerSession: 0`;
- global-by-default and explicit project scope resolution;
- project paths derived from a mocked non-default `CONFIG_DIR_NAME`;
- missing, malformed, and non-object files;
- single-key saves preserving sibling and unknown keys;
- concurrent single-key saves preserving both changes;
- table-driven writes for all eight editable keys;
- unsupported keys returning `false` without modifying the target;
- invalid and malformed-target saves leaving files untouched.

Tests mock `getAgentDir` to a temporary directory and never read or write real user settings.

Caller tests cover:

- startup application of recursion, concurrency, and spawn limits;
- trusted `session_start` merging project settings from `ctx.cwd`;
- untrusted `session_start` never reading project settings;
- a child execution cwd never activating another project's settings;
- trusted project tool-budget and Watchdog activation;
- one scope selection reused across multiple menu edits;
- untrusted menus never requesting project reads or writes;
- global edits retaining effective project overrides;
- runtime refresh only after a successful save;
- unchanged subagent, child-agent, RPC, slash-Chain, menu, and index behavior.

Implementation uses two commits:

1. `refactor: unify settings resolution`
2. `refactor: migrate settings callers`

Focused suites run after each commit. Final verification runs TypeScript, lint for every touched file, and `pnpm check`.

## Success criteria

- One resolver defines precedence, validation, and scoped writes.
- The writer accepts only the eight menu-editable primitive keys.
- Valid legacy settings continue to work without modifying the legacy file.
- Global and project settings use identical primitive semantics.
- Project settings are read and written only through a trusted Pi context.
- Project paths respect Pi's `CONFIG_DIR_NAME`.
- All adapters consume one active session snapshot, regardless of child execution cwd.
- Max Recursive Level affects startup and live menu edits.
- No references to `config.ts`, `loadConfig`, `saveConfig`, `saveSettings`, `SubagentsConfig`, or `LoadedConfig` remain.
- The complete repository check passes.
