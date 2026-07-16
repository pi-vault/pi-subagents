# Agent Persistence Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent module the only owner of Agent catalog precedence and override persistence.

**Architecture:** First add and test the Agent catalog seam without changing the menu. Then migrate the menu to that seam and delete its duplicate filesystem work.

**Tech Stack:** TypeScript, Vitest, Pi TUI.

---

## Commit sequence

1. `refactor: add agent catalog seam`
2. `refactor: delegate agents menu persistence`

### Task 1: Add the Agent catalog seam

**Files:**
- Modify: `src/core/agents.ts`
- Modify: `tests/agents.test.ts`

- [ ] **Step 1: Write failing core tests**

Test bundled, override, and disabled precedence; unsafe/unreadable diagnostics; invalid Markdown rejected without a write; and a valid override returned after save.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/agents.test.ts
```

Expected: failure because the catalog and validated edit operations do not exist.

- [ ] **Step 3: Implement the tested core seam**

```ts
export interface AgentCatalogEntry {
  name: string;
  state: "bundled" | "override" | "disabled";
  bundled?: AgentDefinition;
  override?: AgentDefinition;
}

export function discoverAgentCatalog(
  paths: ResolvedPaths,
): { entries: AgentCatalogEntry[]; diagnostics: AgentDiscoveryDiagnostic[] };

export function updateUserAgentOverride(
  paths: ResolvedPaths,
  sourcePath: string,
  markdown: string,
): AgentDefinition;
```

Use `safeReadFile`, `parseAgentContent`, and existing user-over-bundled precedence. Require a real user override path beneath `paths.userAgentsDir` and validate content before `writeFileSync`.

- [ ] **Step 4: Verify and commit the green core task**

```bash
pnpm vitest run tests/agents.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/agents.ts tests/agents.test.ts
git add src/core/agents.ts tests/agents.test.ts
git commit -m "refactor: add agent catalog seam"
```

Expected: the new seam is usable and tested while all existing menu behavior remains intact.

### Task 2: Delegate the Agents menu through the core seam

**Files:**
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/tui/agents-menu.ts`
- Modify: `tests/agents-menu.test.ts`

- [ ] **Step 1: Write a failing menu delegation test**

Supply mocked catalog/edit operations through RuntimeDeps. Assert menu entries come from those operations and the menu performs no direct file read, parse, or write.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/agents-menu.test.ts
```

Expected: failure because the menu still owns `node:fs`, parser aliases, `readAgentFiles`, and `buildAgentMenuEntries`.

- [ ] **Step 3: Migrate the adapter**

Expose the catalog/edit operations through RuntimeDeps and route menu display/edit flows through them. Delete direct filesystem/parser imports and duplicate catalog functions; preserve labels and notification text.

- [ ] **Step 4: Verify and commit the green adapter task**

```bash
pnpm vitest run tests/agents-menu.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/runtime-deps.ts src/tui/agents-menu.ts tests/agents-menu.test.ts
git add src/shared/runtime-deps.ts src/tui/agents-menu.ts tests/agents-menu.test.ts
git commit -m "refactor: delegate agents menu persistence"
```

Expected: the Agents menu remains fully usable and its persistence knowledge is concentrated in the Agent module.
