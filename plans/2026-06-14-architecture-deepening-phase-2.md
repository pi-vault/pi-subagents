# Phase 2: Collapse BFS Traversals in Skill-Loader

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 4 duplicated BFS implementations in `src/core/skill-loader.ts` with a single `walkSkillTree(root, visitor)` function that owns traversal, security guards, and skill classification. The public API remains unchanged.

**Architecture:** The file currently has 4 functions (`findSkillBFS`, `collectSkillNames`, `findSkillPathBFS`, `collectSkillPaths`) that all implement the same BFS pattern with slightly different "what to do when a skill is found" logic. We extract the shared traversal into `walkSkillTree` and rewrite each caller as a thin visitor callback.

**Tech Stack:** TypeScript, Node.js fs APIs, vitest. No new dependencies.

---

## File Map

| File | Action | Responsibility |
| ---- | ------ | -------------- |
| `src/core/skill-loader.ts` | Modify | Add `SkillEntry` type and `walkSkillTree` utility; rewrite 4 BFS functions + 2 "InRoot" functions to use it |
| `tests/skill-loader.test.ts` | Modify | Add dedicated `walkSkillTree` test suite |

---

### Task 1: Extract `walkSkillTree` utility

**Files:**
- Modify: `src/core/skill-loader.ts`

- [ ] **Step 1: Add the `SkillEntry` type after the existing interfaces (after line 15)**

  ```typescript
  type SkillEntry =
    | { kind: "flat"; name: string; filePath: string }
    | { kind: "directory"; name: string; dirPath: string; skillMdPath: string };
  ```

  This is an internal (non-exported) type for now. It will be exported in Step 4 for testing.

- [ ] **Step 2: Add the `walkSkillTree` function (insert after `isSymlink` helper, around line 83)**

  Place it after the low-level helpers (`isUnsafeName`, `isSymlink`, `safeReadFile`) but before the higher-level functions that will consume it.

  ```typescript
  /**
   * BFS walk over a skill root directory. Visits flat .md files at the root level,
   * then descends into subdirectories. Directories containing SKILL.md are skills;
   * directories without are categories (descended into).
   *
   * The visitor receives each discovered SkillEntry. Return `true` to stop early.
   */
  export function walkSkillTree(
    root: string,
    visitor: (entry: SkillEntry) => boolean,
  ): void {
    if (isSymlink(root)) return;
    if (!existsSync(root)) return;

    // Phase 1: Flat .md files at root level
    let rootEntries: Dirent[];
    try {
      rootEntries = readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of rootEntries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      const filePath = join(root, entry.name);
      if (isSymlink(filePath)) continue;
      const name = entry.name.slice(0, -3); // strip .md
      if (isUnsafeName(name)) continue;
      const stop = visitor({ kind: "flat", name, filePath });
      if (stop) return;
    }

    // Phase 2: BFS over directories
    const queue: string[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;

      let entries: Dirent[];
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const entryPath = join(current, entry.name);
        if (isSymlink(entryPath)) continue;

        const skillMdPath = join(entryPath, "SKILL.md");
        const hasSkillMd = existsSync(skillMdPath) && !isSymlink(skillMdPath);

        if (hasSkillMd) {
          // This directory IS a skill
          if (!isUnsafeName(entry.name)) {
            const stop = visitor({
              kind: "directory",
              name: entry.name,
              dirPath: entryPath,
              skillMdPath,
            });
            if (stop) return;
          }
          // Don't descend into skill directories
          continue;
        }

        // Category directory - descend
        queue.push(entryPath);
      }
    }
  }
  ```

  Key design decisions:
  - `isUnsafeName` check happens inside `walkSkillTree` so callers don't need to repeat it
  - Flat files are visited before BFS directories (preserving existing priority: flat files found first at root level)
  - The `entries.sort()` preserves deterministic ordering from the existing BFS implementations (lines 139, 261)

- [ ] **Step 3: Export `SkillEntry` type for test access**

  Add `SkillEntry` to the module's exports so tests can reference the type:

  ```typescript
  export type { SkillEntry };
  // or simply: export type SkillEntry = ...
  ```

  Since the existing test file imports from `../src/core/skill-loader.js`, this keeps things testable without a separate test-utils file.

- [ ] **Step 4: Verify the file compiles**

  ```bash
  pnpm typecheck
  ```

  At this point `walkSkillTree` exists but nothing calls it yet. The 4 old BFS functions still exist. No behavior change.

---

### Task 2: Rewrite public functions to use `walkSkillTree`

**Files:**
- Modify: `src/core/skill-loader.ts`

- [ ] **Step 1: Rewrite `findInRoot` (lines 105-123) and delete `findSkillBFS` (lines 125-166)**

  Replace `findInRoot` with:

  ```typescript
  function findInRoot(root: string, name: string): string | undefined {
    let result: string | undefined;
    walkSkillTree(root, (entry) => {
      if (entry.name !== name) return false;
      if (entry.kind === "flat") {
        result = safeReadFile(entry.filePath)?.trim();
      } else {
        result = safeReadFile(entry.skillMdPath)?.trim();
      }
      return result !== undefined; // stop if we found content
    });
    return result;
  }
  ```

  Delete `findSkillBFS` entirely (lines 125-166). It is no longer called.

- [ ] **Step 2: Rewrite `collectSkillNames` (lines 168-218)**

  Replace with:

  ```typescript
  function collectSkillNames(root: string, seen: Set<string>): void {
    walkSkillTree(root, (entry) => {
      seen.add(entry.name);
      return false; // continue collecting
    });
  }
  ```

  This replaces 50 lines with 5.

- [ ] **Step 3: Rewrite `findPathInRoot` (lines 228-245) and delete `findSkillPathBFS` (lines 247-282)**

  Replace `findPathInRoot` with:

  ```typescript
  function findPathInRoot(root: string, name: string): string | undefined {
    let result: string | undefined;
    walkSkillTree(root, (entry) => {
      if (entry.name !== name) return false;
      result = entry.kind === "flat" ? entry.filePath : entry.dirPath;
      return true; // stop - found it
    });
    return result;
  }
  ```

  Delete `findSkillPathBFS` entirely (lines 247-282).

- [ ] **Step 4: Rewrite `collectSkillPaths` (lines 284-338)**

  Replace with:

  ```typescript
  function collectSkillPaths(root: string, seen: Map<string, string>): void {
    walkSkillTree(root, (entry) => {
      if (!seen.has(entry.name)) {
        const path = entry.kind === "flat" ? entry.filePath : entry.dirPath;
        seen.set(entry.name, path);
      }
      return false; // continue collecting
    });
  }
  ```

- [ ] **Step 5: Verify compilation and all existing tests pass**

  ```bash
  pnpm typecheck && pnpm test
  ```

  All 302 lines of existing tests in `tests/skill-loader.test.ts` must pass unchanged. This is the critical regression gate - the public interface (`preloadSkills`, `discoverAvailableSkills`, `resolveSkillPaths`, `discoverAvailableSkillPaths`) behavior is identical.

- [ ] **Step 6: Run lint**

  ```bash
  pnpm lint
  ```

  Fix any formatting issues (unused imports from deleted functions, etc.). The `Dirent` type import should still be needed by `walkSkillTree`.

---

### Task 3: Add direct `walkSkillTree` tests

**Files:**
- Modify: `tests/skill-loader.test.ts`

- [ ] **Step 1: Import `walkSkillTree` and `SkillEntry` in the test file**

  Add to the existing import (line 11-16):

  ```typescript
  import {
    discoverAvailableSkillPaths,
    discoverAvailableSkills,
    preloadSkills,
    resolveSkillPaths,
    walkSkillTree,
  } from "../src/core/skill-loader.js";
  import type { SkillEntry } from "../src/core/skill-loader.js";
  ```

- [ ] **Step 2: Add `describe("walkSkillTree", ...)` test suite**

  Add after the existing `describe("discoverAvailableSkillPaths", ...)` block (after line 301). Tests to include:

  ```typescript
  describe("walkSkillTree", () => {
    test("visits flat .md files at root level", () => {
      writeFlat(piSkillsDir(), "alpha", "A");
      writeFlat(piSkillsDir(), "beta", "B");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.kind === "flat")).toBe(true);
      expect(entries.map((e) => e.name).sort()).toEqual(["alpha", "beta"]);
    });

    test("visits directory skills with SKILL.md", () => {
      writeSkillDir(piSkillsDir(), "debug", "# Debug");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("directory");
      if (entries[0].kind === "directory") {
        expect(entries[0].name).toBe("debug");
        expect(entries[0].skillMdPath).toBe(
          join(piSkillsDir(), "debug", "SKILL.md"),
        );
      }
    });

    test("visits nested directory skills inside category folders", () => {
      const category = join(piSkillsDir(), "dev-tools");
      writeSkillDir(category, "linting", "# Lint");
      writeSkillDir(category, "testing", "# Test");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries.map((e) => e.name).sort()).toEqual(["linting", "testing"]);
    });

    test("stops early when visitor returns true", () => {
      writeFlat(piSkillsDir(), "aaa", "A");
      writeFlat(piSkillsDir(), "bbb", "B");
      writeFlat(piSkillsDir(), "ccc", "C");
      const visited: string[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        visited.push(entry.name);
        return visited.length >= 2; // stop after 2
      });
      expect(visited).toHaveLength(2);
    });

    test("skips symlinked files", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const real = join(tmpDir, "real.md");
      writeFileSync(real, "SECRET");
      symlinkSync(real, join(piSkillsDir(), "evil.md"));
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips symlinked directories", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const realDir = join(tmpDir, "real-skill");
      mkdirSync(realDir, { recursive: true });
      writeFileSync(join(realDir, "SKILL.md"), "SECRET");
      symlinkSync(realDir, join(piSkillsDir(), "evil-dir"));
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips dotfile directories", () => {
      writeSkillDir(join(piSkillsDir(), ".hidden"), "secret", "no");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips node_modules directories", () => {
      writeSkillDir(
        join(piSkillsDir(), "node_modules", "pkg"),
        "leaked",
        "no",
      );
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("does not descend into skill directories", () => {
      writeSkillDir(piSkillsDir(), "outer", "outer-content");
      writeSkillDir(join(piSkillsDir(), "outer"), "inner", "inner-content");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries.map((e) => e.name)).toEqual(["outer"]);
    });

    test("returns nothing for non-existent root", () => {
      const entries: SkillEntry[] = [];
      walkSkillTree(join(tmpDir, "nope"), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("returns nothing for symlinked root", () => {
      const realRoot = join(tmpDir, "real-root");
      mkdirSync(realRoot, { recursive: true });
      writeFileSync(join(realRoot, "skill.md"), "content");
      const symRoot = join(tmpDir, "sym-root");
      symlinkSync(realRoot, symRoot);
      const entries: SkillEntry[] = [];
      walkSkillTree(symRoot, (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });

    test("skips names that fail isUnsafeName validation", () => {
      // Create a flat file with a dot-prefixed name
      mkdirSync(piSkillsDir(), { recursive: true });
      writeFileSync(join(piSkillsDir(), ".hidden.md"), "content");
      const entries: SkillEntry[] = [];
      walkSkillTree(piSkillsDir(), (entry) => {
        entries.push(entry);
        return false;
      });
      expect(entries).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 3: Run full verification**

  ```bash
  pnpm typecheck && pnpm test && pnpm lint
  ```

  All tests pass. The new `walkSkillTree` tests exercise the traversal in isolation. The existing tests confirm no regression in the public API.

---

## Summary of changes

| Metric | Before | After |
| ------ | ------ | ----- |
| Lines in `skill-loader.ts` | 338 | ~160 (estimated) |
| BFS implementations | 4 | 1 (`walkSkillTree`) |
| Security guard locations | 4 (duplicated per BFS) | 1 (centralized in `walkSkillTree`) |
| Direct walk tests | 0 | ~12 |
| Public API changes | - | None |

## Risks and notes

- **Ordering subtlety:** The existing `findSkillBFS` and `findSkillPathBFS` sort entries (`entries.sort(...)`) but `collectSkillNames` and `collectSkillPaths` do not. The unified `walkSkillTree` sorts in the BFS phase (matching the "find" functions). This is a minor behavioral change for `collectSkillNames`/`collectSkillPaths` but has no observable effect since those functions already use `Set`/`Map` (unordered) and the callers sort the final output.
- **Flat file ordering:** The existing `collectSkillNames` iterates flat files in readdir order (unsorted). `walkSkillTree` preserves this (no sort on flat files). The existing `findInRoot` also uses unsorted readdir for flat files. This matches.
- **Early-exit correctness:** The `findInRoot` rewrite finds the *first* matching skill by name across flat+BFS. This preserves the existing priority: flat files at root are checked first (before BFS descends into categories), matching the original `findInRoot` logic (lines 109-122).
