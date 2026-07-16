# Agent Persistence Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent module the only owner of Agent catalog precedence and user-override reads and writes.

**Architecture:** Add three plain core operations for catalog discovery, exact override reads, and validated override updates. Then wire those operations through RuntimeDeps and delete the Agents menu's duplicate filesystem and parser work. Runtime first-definition-wins precedence is authoritative; normal menu labels, notifications, ordering, and edit behavior remain unchanged.

**Tech Stack:** TypeScript, Node.js 24 filesystem/path APIs, Vitest, Biome, Pi TUI.

---

## Prerequisites

Read the approved design before editing code:

- `docs/superpowers/specs/2026-07-15-agent-persistence-deepening-design.md`

Work in the current branch and preserve unrelated changes. Run Git-backed tests and commits with process-local signing disabled:

```bash
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=commit.gpgsign
export GIT_CONFIG_VALUE_0=false
```

## File map

- `src/core/agents.ts`: owns safe catalog discovery, precedence, exact override reads, and validated writes.
- `tests/agents.test.ts`: proves catalog, path-safety, and no-write-on-invalid-edit behavior.
- `src/shared/runtime-deps.ts`: exposes the three core operations to adapters.
- `src/index.ts`: wires production core functions into RuntimeDeps.
- `src/tui/agents-menu.ts`: renders catalog data and delegates edit persistence.
- `tests/agents-menu.test.ts`: proves the menu works through mocked core operations with nonexistent paths.
- `tests/index.test.ts`: keeps the shared RuntimeDeps test factory complete.

## Commit sequence

1. `refactor: add agent catalog seam`
2. `refactor: delegate agents menu persistence`

### Task 1: Add the tested Agent catalog and override seam

**Files:**

- Modify: `src/core/agents.ts`
- Modify: `tests/agents.test.ts`

- [ ] **Step 1: Add failing catalog and override tests**

In `tests/agents.test.ts`, add `symlinkSync` to the `node:fs` import and add these core imports:

```ts
discoverAgentCatalog,
readUserAgentOverride,
updateUserAgentOverride,
```

Add this helper after `createValidInput`:

```ts
function agentMarkdown(
  name: string,
  description: string,
  enabled?: boolean,
): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "tools: read",
    ...(enabled === undefined ? [] : [`enabled: ${enabled}`]),
    "---",
    `${name} prompt`,
    "",
  ].join("\n");
}
```

Add a new `describe("agent catalog and override persistence", ...)` block after the existing discovery tests:

```ts
describe("agent catalog and override persistence", () => {
  test("returns sorted bundled, override, disabled, and user-only entries with first-definition precedence", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-catalog-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.bundledAgentsDir, "planner.md"),
      agentMarkdown("planner", "Bundled planner"),
    );
    writeFileSync(
      join(paths.bundledAgentsDir, "scout.md"),
      agentMarkdown("scout", "Bundled scout"),
    );
    writeFileSync(
      join(paths.userAgentsDir, "a-scout.md"),
      agentMarkdown("Scout", "User scout"),
    );
    writeFileSync(
      join(paths.userAgentsDir, "b-planner.md"),
      agentMarkdown("planner", "Disabled planner", false),
    );
    writeFileSync(
      join(paths.userAgentsDir, "c-custom.md"),
      agentMarkdown("custom", "User only"),
    );
    writeFileSync(
      join(paths.userAgentsDir, "z-scout.md"),
      agentMarkdown("scout", "Later duplicate"),
    );

    const catalog = discoverAgentCatalog(paths);

    expect(catalog.entries).toMatchObject([
      { name: "custom", state: "override", override: { description: "User only" } },
      {
        name: "planner",
        state: "disabled",
        bundled: { description: "Bundled planner" },
        override: { description: "Disabled planner", enabled: false },
      },
      {
        name: "Scout",
        state: "override",
        bundled: { description: "Bundled scout" },
        override: { description: "User scout" },
      },
    ]);
    expect(catalog.userDiagnostics).toEqual([
      {
        path: join(paths.userAgentsDir, "z-scout.md"),
        reason: 'duplicate agent name "scout" skipped; first definition wins',
      },
    ]);
    expect(catalog.bundledDiagnostics).toEqual([]);
  });

  test("separates unsafe, unreadable, symlink, and malformed diagnostics by scope", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-catalog-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.userAgentsDir, "bad name.md"),
      agentMarkdown("bad", "Unsafe filename"),
    );
    mkdirSync(join(paths.userAgentsDir, "broken.md"));
    const outside = join(rootDir, "outside.md");
    writeFileSync(outside, agentMarkdown("outside", "Outside"));
    symlinkSync(outside, join(paths.userAgentsDir, "linked.md"));
    writeFileSync(
      join(paths.bundledAgentsDir, "malformed.md"),
      "---\nname: malformed\ntools: read\n---\nBody\n",
    );

    const catalog = discoverAgentCatalog(paths);

    expect(catalog.entries).toEqual([]);
    expect(catalog.userDiagnostics).toEqual([
      { path: join(paths.userAgentsDir, "bad name.md"), reason: "unsafe filename" },
      { path: join(paths.userAgentsDir, "broken.md"), reason: "unreadable or symlink" },
      { path: join(paths.userAgentsDir, "linked.md"), reason: "unreadable or symlink" },
    ]);
    expect(catalog.bundledDiagnostics).toEqual([
      {
        path: join(paths.bundledAgentsDir, "malformed.md"),
        reason: "missing required non-empty description",
      },
    ]);
  });

  test("reads exact override Markdown and validates paths and edits before writing", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-override-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    const sourcePath = join(paths.userAgentsDir, "scout.md");
    const original = `${agentMarkdown("scout", "Original scout")}\n`;
    writeFileSync(sourcePath, original);

    const nestedDir = join(paths.userAgentsDir, "nested");
    mkdirSync(nestedDir);
    const nestedPath = join(nestedDir, "scout.md");
    writeFileSync(nestedPath, original);
    const outsidePath = join(rootDir, "outside.md");
    writeFileSync(outsidePath, original);
    const linkedPath = join(paths.userAgentsDir, "linked.md");
    symlinkSync(outsidePath, linkedPath);

    expect(readUserAgentOverride(paths, sourcePath)).toBe(original);
    expect(() => readUserAgentOverride(paths, nestedPath)).toThrow(
      "invalid user agent override path",
    );
    expect(() => readUserAgentOverride(paths, outsidePath)).toThrow(
      "invalid user agent override path",
    );
    expect(() => readUserAgentOverride(paths, linkedPath)).toThrow(
      "user agent override is missing, unreadable, or symlinked",
    );
    expect(() =>
      readUserAgentOverride(paths, join(paths.userAgentsDir, "missing.md")),
    ).toThrow("user agent override is missing, unreadable, or symlinked");

    expect(() =>
      updateUserAgentOverride(
        paths,
        sourcePath,
        "---\nname: scout\ntools: read\n---\nInvalid\n",
      ),
    ).toThrow("missing required non-empty description");
    expect(readFileSync(sourcePath, "utf8")).toBe(original);

    const edited = agentMarkdown("RenamedScout", "Edited scout");
    const saved = updateUserAgentOverride(paths, sourcePath, edited);
    expect(saved).toMatchObject({
      name: "RenamedScout",
      description: "Edited scout",
      sourcePath,
    });
    expect(readFileSync(sourcePath, "utf8")).toBe(edited);
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail for the missing API**

```bash
pnpm vitest run tests/agents.test.ts
```

Expected: FAIL during import/type transformation because `discoverAgentCatalog`, `readUserAgentOverride`, and `updateUserAgentOverride` are not exported.

- [ ] **Step 3: Add the minimal catalog implementation**

In `src/core/agents.ts`, add `dirname` to the `node:path` import. Add these exported types and functions immediately after `discoverAgents`:

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

function indexCatalogAgents(
  discovery: AgentDiscoveryResult,
): Map<string, AgentDefinition> {
  const indexed = new Map<string, AgentDefinition>();
  for (const agent of discovery.agents) {
    const name = normalizeNameForComparison(agent.name);
    if (indexed.has(name)) {
      discovery.diagnostics.push({
        path: agent.sourcePath,
        reason: `duplicate agent name "${agent.name}" skipped; first definition wins`,
      });
      continue;
    }
    indexed.set(name, agent);
  }
  return indexed;
}

export function discoverAgentCatalog(paths: ResolvedPaths): AgentCatalog {
  const user = discoverAgentsFromDirectory(paths.userAgentsDir);
  const bundled = discoverAgentsFromDirectory(paths.bundledAgentsDir);
  const userByName = indexCatalogAgents(user);
  const bundledByName = indexCatalogAgents(bundled);
  const names = [...new Set([...userByName.keys(), ...bundledByName.keys()])]
    .sort((left, right) => left.localeCompare(right));

  const entries = names.map((name): AgentCatalogEntry => {
    const override = userByName.get(name);
    const bundledAgent = bundledByName.get(name);
    if (override?.enabled === false) {
      return {
        name: override.name,
        state: "disabled",
        bundled: bundledAgent,
        override,
      };
    }
    if (override) {
      return {
        name: override.name,
        state: "override",
        bundled: bundledAgent,
        override,
      };
    }
    return {
      name: bundledAgent?.name ?? name,
      state: "bundled",
      bundled: bundledAgent,
    };
  });

  return {
    entries,
    userDiagnostics: user.diagnostics,
    bundledDiagnostics: bundled.diagnostics,
  };
}
```

- [ ] **Step 4: Add exact override reads and validated writes**

Add this private validator and the two public operations after `discoverAgentCatalog`:

```ts
function requireUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
): { filePath: string; markdown: string } {
  const filePath = resolve(sourcePath);
  const fileName = basename(filePath);
  if (
    dirname(filePath) !== resolve(paths.userAgentsDir) ||
    !fileName.endsWith(".md") ||
    isUnsafeName(fileName.slice(0, -3))
  ) {
    throw new Error("invalid user agent override path");
  }

  const markdown = safeReadFile(filePath);
  if (markdown === undefined) {
    throw new Error("user agent override is missing, unreadable, or symlinked");
  }
  return { filePath, markdown };
}

export function readUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
): string {
  return requireUserAgentOverride(paths, sourcePath).markdown;
}

export function updateUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
  markdown: string,
): AgentDefinition {
  const { filePath } = requireUserAgentOverride(paths, sourcePath);
  const parsed = parseAgentContent(filePath, markdown);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostic.reason);
  }
  writeFileSync(filePath, markdown, "utf8");
  return parsed.agent;
}
```

- [ ] **Step 5: Run the focused core checks**

```bash
pnpm vitest run tests/agents.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/agents.ts tests/agents.test.ts
```

Expected: all Agent tests pass, typechecking succeeds, and touched-file lint reports no errors.

- [ ] **Step 6: Commit the core seam**

```bash
git add src/core/agents.ts tests/agents.test.ts
git commit -m "refactor: add agent catalog seam"
```

Expected: one commit containing only the core catalog/persistence seam and its tests.

### Task 2: Delegate the Agents menu through RuntimeDeps

**Files:**

- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/index.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `tests/agents-menu.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add a failing menu delegation test**

In `tests/agents-menu.test.ts`, replace the existing shared-types and
Agents-menu imports with:

```ts
import type {
  AgentDefinition,
  ResolvedPaths,
  SubagentsConfig,
} from "../src/shared/types.js";
import {
  SETTINGS_MENU_ITEMS,
  renderRow,
  showAgentsMenu,
} from "../src/tui/agents-menu.js";
```

Add this test after the row-rendering tests:

```ts
test("catalog display and override editing delegate through RuntimeDeps", async () => {
  const paths = {
    userAgentsDir: "/path/that/does/not/exist/user-agents",
    bundledAgentsDir: "/path/that/does/not/exist/bundled-agents",
  } as ResolvedPaths;
  const sourcePath = `${paths.userAgentsDir}/planner.md`;
  const original = "original Markdown\n";
  const edited = "edited Markdown\n";
  const override: AgentDefinition = {
    name: "planner",
    description: "Plans work",
    tools: ["read"],
    subagentAgents: [],
    systemPrompt: "Plan",
    sourcePath,
  };
  const catalog = {
    entries: [
      {
        name: "planner",
        state: "override" as const,
        override,
      },
    ],
    userDiagnostics: [{ path: `${paths.userAgentsDir}/bad.md`, reason: "invalid" }],
    bundledDiagnostics: [],
  };
  const discoverAgentCatalog = vi.fn(() => catalog);
  const readUserAgentOverride = vi.fn(() => original);
  const updateUserAgentOverride = vi.fn(() => override);
  const deps = {
    resolvePaths: () => paths,
    discoverAgentCatalog,
    readUserAgentOverride,
    updateUserAgentOverride,
  } as unknown as RuntimeDeps;
  const inputs = ["\r", "\r", "\r", "\x1b", "\x1b"];
  const renders: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];

  type MenuFactory = (
    tui: { requestRender(): void },
    theme: {
      fg(color: string, text: string): string;
      bold(text: string): string;
    },
    keyboard: unknown,
    done: (value: undefined) => void,
  ) => {
    render(width: number): string[];
    handleInput(data: string): void;
  };

  await showAgentsMenu(
    {
      ui: {
        custom: async (factory: unknown) => {
          await new Promise<void>((resolveDone) => {
            const component = (factory as MenuFactory)(
              { requestRender() {} },
              {
                fg: (_color, text) => text,
                bold: (text) => text,
              },
              undefined,
              () => resolveDone(),
            );
            renders.push(component.render(120).join("\n"));
            component.handleInput(inputs.shift() ?? "\x1b");
          });
        },
        editor: async () => edited,
        notify: (message: string, level: string) => {
          notifications.push({ message, level });
        },
      },
    } as never,
    deps,
  );

  expect(discoverAgentCatalog).toHaveBeenCalledWith(paths);
  expect(readUserAgentOverride).toHaveBeenCalledWith(paths, sourcePath);
  expect(updateUserAgentOverride).toHaveBeenCalledWith(paths, sourcePath, edited);
  expect(renders.join("\n")).toContain("Agents (1)");
  expect(renders.join("\n")).toContain("planner  [global override]");
  expect(renders.join("\n")).toContain("1 invalid user agent file(s) skipped");
  expect(notifications).toContainEqual({
    message: `Updated "planner" at ${sourcePath}`,
    level: "info",
  });
});
```

- [ ] **Step 2: Run the menu test and verify it fails against direct filesystem discovery**

```bash
pnpm vitest run tests/agents-menu.test.ts
```

Expected: FAIL because `showAgentsMenu` ignores the mocked catalog and finds zero entries at the nonexistent paths; the mocked read and update operations are not called.

- [ ] **Step 3: Expose and wire the core operations**

In `src/shared/runtime-deps.ts`, add this type import:

```ts
import type { AgentCatalog } from "../core/agents.js";
```

Add these required fields immediately after `discoverAgents` in `RuntimeDeps`:

```ts
discoverAgentCatalog: (paths: ResolvedPaths) => AgentCatalog;
readUserAgentOverride: (paths: ResolvedPaths, sourcePath: string) => string;
updateUserAgentOverride: (
  paths: ResolvedPaths,
  sourcePath: string,
  markdown: string,
) => AgentDefinition;
```

In `src/index.ts`, add the three functions to the existing import from `./core/agents.js`:

```ts
discoverAgentCatalog,
readUserAgentOverride,
updateUserAgentOverride,
```

Add them to the `deps: RuntimeDeps` object immediately after `discoverAgents`:

```ts
discoverAgentCatalog,
readUserAgentOverride,
updateUserAgentOverride,
```

In `tests/index.test.ts`, add these fields to the object returned by `createMenuDeps` immediately after `discoverAgents`:

```ts
discoverAgentCatalog: () => ({
  entries: [],
  userDiagnostics: [],
  bundledDiagnostics: [],
}),
readUserAgentOverride: () => "",
updateUserAgentOverride: () => primaryAgent,
```

- [ ] **Step 4: Remove menu-owned persistence and delegate editing**

In `src/tui/agents-menu.ts`:

1. Remove the `node:fs`, `node:path`, and `parseAgentContent` imports.
2. Remove `AgentDefinition`, `AgentDiscoveryDiagnostic`, and `ResolvedPaths` from the shared-type import.
3. Add this type import:

```ts
import type { AgentCatalogEntry } from "../core/agents.js";
```

4. Delete the local `AgentMenuEntry` type, `readAgentFiles`, `normalizeName`, and `buildAgentMenuEntries`.
5. Change `describeAgentEntry`, its return type, and the `entry` parameter of
   `showAgentActions` to use `AgentCatalogEntry`.
6. Replace `editOverrideAgent` with:

```ts
async function editOverrideAgent(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  entry: AgentCatalogEntry,
): Promise<void> {
  const sourcePath = entry.override?.sourcePath;
  if (!sourcePath) {
    ctx.ui.notify(`No global override found for "${entry.name}"`, "warning");
    return;
  }

  try {
    const paths = deps.resolvePaths();
    const current = deps.readUserAgentOverride(paths, sourcePath);
    const edited = await ctx.ui.editor(`Edit ${entry.name}`, current);
    if (edited === undefined || edited === current) {
      return;
    }

    deps.updateUserAgentOverride(paths, sourcePath, edited);
    ctx.ui.notify(`Updated "${entry.name}" at ${sourcePath}`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not save agent: ${message}`, "error");
  }
}
```

Change the Edit branch in `showAgentActions` to pass `deps`:

```ts
if (choice === "edit") {
  await editOverrideAgent(ctx, deps, entry);
  return;
}
```

Replace `showAgentsBrowser` with:

```ts
async function showAgentsBrowser(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  while (true) {
    const paths = deps.resolvePaths();
    const catalog = deps.discoverAgentCatalog(paths);
    const choice = await showRowsMenu(
      ctx,
      "Agents",
      [
        ...catalog.entries.map((entry) => ({
          ...describeAgentEntry(entry),
          value: entry,
        })),
        { label: "Back", value: undefined, kind: "back" },
      ],
      catalog.userDiagnostics.length > 0
        ? `${catalog.userDiagnostics.length} invalid user agent file(s) skipped`
        : "↑/↓ move • Enter select • Esc close",
    );

    if (!choice) {
      return;
    }

    await showAgentActions(ctx, deps, choice);
  }
}
```

Replace `showAgentsMenu` with:

```ts
export async function showAgentsMenu(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  while (true) {
    const paths = deps.resolvePaths();
    const catalog = deps.discoverAgentCatalog(paths);
    const choice = await showRowsMenu(
      ctx,
      "pi-subagents agents",
      [
        { label: `Agents (${catalog.entries.length})`, value: "agents" },
        { label: "Create new agent", value: "create" },
        { label: "Settings", value: "settings" },
      ],
      `${catalog.entries.length} visible agent(s) • ${paths.userAgentsDir}`,
    );

    if (!choice) {
      return;
    }

    if (choice === "agents") {
      await showAgentsBrowser(ctx, deps);
      continue;
    }
    if (choice === "create") {
      await runAgentsMenuAction({ kind: "create-agent" }, ctx, deps);
      continue;
    }
    if (choice === "settings") {
      await runAgentsMenuAction({ kind: "open-settings" }, ctx, deps);
    }
  }
}
```

- [ ] **Step 5: Add menu error-boundary coverage**

Replace the delegation test from Step 1 with this shared driver and two tests:

```ts
async function driveOverrideEdit(updateError?: Error) {
  const paths = {
    userAgentsDir: "/path/that/does/not/exist/user-agents",
    bundledAgentsDir: "/path/that/does/not/exist/bundled-agents",
  } as ResolvedPaths;
  const sourcePath = `${paths.userAgentsDir}/planner.md`;
  const original = "original Markdown\n";
  const edited = "edited Markdown\n";
  const override: AgentDefinition = {
    name: "planner",
    description: "Plans work",
    tools: ["read"],
    subagentAgents: [],
    systemPrompt: "Plan",
    sourcePath,
  };
  const catalog = {
    entries: [
      {
        name: "planner",
        state: "override" as const,
        override,
      },
    ],
    userDiagnostics: [
      { path: `${paths.userAgentsDir}/bad.md`, reason: "invalid" },
    ],
    bundledDiagnostics: [],
  };
  const discoverAgentCatalog = vi.fn(() => catalog);
  const readUserAgentOverride = vi.fn(() => original);
  const updateUserAgentOverride = vi.fn(() => {
    if (updateError) {
      throw updateError;
    }
    return override;
  });
  const deps = {
    resolvePaths: () => paths,
    discoverAgentCatalog,
    readUserAgentOverride,
    updateUserAgentOverride,
  } as unknown as RuntimeDeps;
  const inputs = ["\r", "\r", "\r", "\x1b", "\x1b"];
  const renders: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];

  type MenuFactory = (
    tui: { requestRender(): void },
    theme: {
      fg(color: string, text: string): string;
      bold(text: string): string;
    },
    keyboard: unknown,
    done: (value: undefined) => void,
  ) => {
    render(width: number): string[];
    handleInput(data: string): void;
  };

  await showAgentsMenu(
    {
      ui: {
        custom: async (factory: unknown) => {
          await new Promise<void>((resolveDone) => {
            const component = (factory as MenuFactory)(
              { requestRender() {} },
              {
                fg: (_color, text) => text,
                bold: (text) => text,
              },
              undefined,
              () => resolveDone(),
            );
            renders.push(component.render(120).join("\n"));
            component.handleInput(inputs.shift() ?? "\x1b");
          });
        },
        editor: async () => edited,
        notify: (message: string, level: string) => {
          notifications.push({ message, level });
        },
      },
    } as never,
    deps,
  );

  return {
    catalog,
    deps,
    discoverAgentCatalog,
    edited,
    notifications,
    paths,
    readUserAgentOverride,
    renders,
    sourcePath,
    updateUserAgentOverride,
  };
}

test("catalog display and override editing delegate through RuntimeDeps", async () => {
  const result = await driveOverrideEdit();

  expect(result.discoverAgentCatalog).toHaveBeenCalledWith(result.paths);
  expect(result.readUserAgentOverride).toHaveBeenCalledWith(
    result.paths,
    result.sourcePath,
  );
  expect(result.updateUserAgentOverride).toHaveBeenCalledWith(
    result.paths,
    result.sourcePath,
    result.edited,
  );
  expect(result.renders.join("\n")).toContain("Agents (1)");
  expect(result.renders.join("\n")).toContain(
    "planner  [global override]",
  );
  expect(result.renders.join("\n")).toContain(
    "1 invalid user agent file(s) skipped",
  );
  expect(result.notifications).toContainEqual({
    message: `Updated "planner" at ${result.sourcePath}`,
    level: "info",
  });
});

test("override update errors use the existing save notification", async () => {
  const result = await driveOverrideEdit(new Error("invalid edit"));

  expect(result.notifications).toContainEqual({
    message: "Could not save agent: invalid edit",
    level: "error",
  });
});
```

- [ ] **Step 6: Run focused adapter checks**

```bash
pnpm vitest run tests/agents-menu.test.ts tests/index.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/runtime-deps.ts src/index.ts src/tui/agents-menu.ts tests/agents-menu.test.ts tests/index.test.ts
```

Expected: both test files pass, typechecking succeeds, and touched-file lint reports no errors.

- [ ] **Step 7: Run the complete Phase 2 and repository verification**

```bash
pnpm vitest run tests/agents.test.ts tests/agents-menu.test.ts tests/index.test.ts
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm check
git diff --check
```

Expected: all focused tests and the full repository suite pass with zero failures. Existing whole-repository Biome warnings may remain, but this phase introduces no new touched-file warnings. The diff has no whitespace errors.

- [ ] **Step 8: Commit the adapter migration**

```bash
git add src/shared/runtime-deps.ts src/index.ts src/tui/agents-menu.ts tests/agents-menu.test.ts tests/index.test.ts
git commit -m "refactor: delegate agents menu persistence"
```

Expected: the second commit contains only RuntimeDeps wiring, menu delegation, and adapter tests. `src/tui/agents-menu.ts` no longer imports `node:fs`, `node:path`, or Agent Markdown parsing.
