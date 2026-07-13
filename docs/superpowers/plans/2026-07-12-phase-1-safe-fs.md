# Phase 1: Security Hardening (safe-fs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create reusable safe filesystem helpers that protect agent/chain/skill discovery from path traversal and symlink attacks.

**Architecture:** A single pure module `src/core/safe-fs.ts` with four exported functions. No dependencies on other project modules. Integration into `agents.ts` discovery replaces raw `readFileSync` calls with `safeReadFile` and validates filenames. `skill-loader.ts` local copies are replaced with imports from the shared module.

**Tech Stack:** TypeScript, Node.js `fs` + `path`, Vitest

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md` (Phase 1 section)

**Reference implementations:**
- `tintinweb-pi-subagents`: `src/memory.ts` (isSymlink, safeReadFile, isUnsafeName), `src/skill-loader.ts` (symlink-aware skill tree walk)
- `nicobailon-pi-subagents`: `src/agents/agent-memory.ts` (resolveMemoryDir with realpath containment, O_NOFOLLOW), `src/runs/background/fleet-view.ts` (pathWithin containment check)
- `pi` core: `packages/coding-agent/src/utils/paths.ts` (getCwdRelativePath rejects `..` traversals)

---

## File Map

| File                    | Action | Responsibility                                                       |
| ----------------------- | ------ | -------------------------------------------------------------------- |
| `src/core/safe-fs.ts`   | Create | `isSymlink`, `safeReadFile`, `isUnsafeName`, `resolveContained`      |
| `tests/safe-fs.test.ts` | Create | Unit tests for all four helpers + integration tests                   |
| `src/core/agents.ts`    | Modify | Use `safeReadFile` + `isUnsafeName` in agent and chain discovery     |
| `src/core/skill-loader.ts` | Modify | Replace local `isSymlink`/`safeReadFile`/`isUnsafeName` with imports |

---

### Task 1: Implement `isSymlink` with tests

**Files:**

- Create: `src/core/safe-fs.ts`
- Create: `tests/safe-fs.test.ts`

- [ ] **Step 1: Create `src/core/safe-fs.ts` with `isSymlink`**

```typescript
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Returns true if the path is a symlink (via lstatSync).
 * Returns false on any error (ENOENT, EACCES, etc).
 */
export function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Write tests in `tests/safe-fs.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { isSymlink } from "../src/core/safe-fs.js";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("isSymlink", () => {
  const tmp = mkdtempSync(join(tmpdir(), "safe-fs-"));
  const realFile = join(tmp, "real.txt");
  const link = join(tmp, "link.txt");

  writeFileSync(realFile, "hello");
  symlinkSync(realFile, link);

  it("returns false for a regular file", () => {
    expect(isSymlink(realFile)).toBe(false);
  });

  it("returns true for a symlink", () => {
    expect(isSymlink(link)).toBe(true);
  });

  it("returns false for a nonexistent path", () => {
    expect(isSymlink(join(tmp, "nope.txt"))).toBe(false);
  });

  it("returns false for a directory", () => {
    const dir = join(tmp, "subdir");
    mkdirSync(dir, { recursive: true });
    expect(isSymlink(dir)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/safe-fs.test.ts`
Expected: All `isSymlink` tests PASS

- [ ] **Step 4: Commit**

```
feat(safe-fs): add isSymlink helper
```

---

### Task 2: Implement `safeReadFile` with tests

**Files:**

- Modify: `src/core/safe-fs.ts`
- Modify: `tests/safe-fs.test.ts`

- [ ] **Step 1: Add `safeReadFile` to `src/core/safe-fs.ts`**

```typescript
/**
 * Reads a file, rejecting symlinks. Returns undefined if unsafe or missing.
 */
export function safeReadFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  if (isSymlink(filePath)) return undefined;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Add tests**

```typescript
import { safeReadFile } from "../src/core/safe-fs.js";

describe("safeReadFile", () => {
  const tmp = mkdtempSync(join(tmpdir(), "safe-fs-read-"));
  const realFile = join(tmp, "content.txt");
  const linkToFile = join(tmp, "linked.txt");

  writeFileSync(realFile, "file content here");
  symlinkSync(realFile, linkToFile);

  it("reads a normal file", () => {
    expect(safeReadFile(realFile)).toBe("file content here");
  });

  it("returns undefined for a symlink", () => {
    expect(safeReadFile(linkToFile)).toBeUndefined();
  });

  it("returns undefined for a nonexistent file", () => {
    expect(safeReadFile(join(tmp, "missing.txt"))).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/safe-fs.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```
feat(safe-fs): add safeReadFile helper
```

---

### Task 3: Implement `isUnsafeName` with tests

**Files:**

- Modify: `src/core/safe-fs.ts`
- Modify: `tests/safe-fs.test.ts`

- [ ] **Step 1: Add `isUnsafeName` to `src/core/safe-fs.ts`**

```typescript
const SAFE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Returns true if name is unsafe for path construction.
 * Unsafe means: empty, too long, contains NUL, or fails the safe character set.
 * The regex rejects "." and ".." implicitly (must start with alphanumeric).
 */
export function isUnsafeName(name: string): boolean {
  if (!name || name.length > 128) return true;
  if (name.includes("\x00")) return true;
  return !SAFE_NAME_REGEX.test(name);
}
```

- [ ] **Step 2: Add tests**

```typescript
import { isUnsafeName } from "../src/core/safe-fs.js";

describe("isUnsafeName", () => {
  it("allows simple alphanumeric names", () => {
    expect(isUnsafeName("scout")).toBe(false);
    expect(isUnsafeName("SecurityReviewer")).toBe(false);
    expect(isUnsafeName("agent01")).toBe(false);
  });

  it("allows dots, hyphens, underscores after first char", () => {
    expect(isUnsafeName("my-agent")).toBe(false);
    expect(isUnsafeName("my_agent")).toBe(false);
    expect(isUnsafeName("my.agent")).toBe(false);
    expect(isUnsafeName("a.b-c_d")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isUnsafeName("")).toBe(true);
  });

  it("rejects names longer than 128 chars", () => {
    expect(isUnsafeName("a".repeat(129))).toBe(true);
    expect(isUnsafeName("a".repeat(128))).toBe(false);
  });

  it("rejects names with NUL byte", () => {
    expect(isUnsafeName("foo\x00bar")).toBe(true);
  });

  it("rejects names starting with non-alphanumeric", () => {
    expect(isUnsafeName(".hidden")).toBe(true);
    expect(isUnsafeName("-dashed")).toBe(true);
    expect(isUnsafeName("_under")).toBe(true);
  });

  it("rejects dot and dot-dot (implicit via regex)", () => {
    expect(isUnsafeName(".")).toBe(true);
    expect(isUnsafeName("..")).toBe(true);
  });

  it("rejects path separators", () => {
    expect(isUnsafeName("foo/bar")).toBe(true);
    expect(isUnsafeName("foo\\bar")).toBe(true);
  });

  it("rejects spaces and special characters", () => {
    expect(isUnsafeName("foo bar")).toBe(true);
    expect(isUnsafeName("foo@bar")).toBe(true);
    expect(isUnsafeName("foo:bar")).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/safe-fs.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```
feat(safe-fs): add isUnsafeName helper
```

---

### Task 4: Implement `resolveContained` with tests

**Files:**

- Modify: `src/core/safe-fs.ts`
- Modify: `tests/safe-fs.test.ts`

- [ ] **Step 1: Add `resolveContained` to `src/core/safe-fs.ts`**

```typescript
/**
 * Resolves path segments within root. Returns undefined if result escapes root
 * or if any existing intermediate segment is a symlink.
 *
 * Rejects: ".." and "." segments, absolute segments, segments containing
 * path separators or colons, and NUL bytes.
 */
export function resolveContained(
  root: string,
  ...segments: string[]
): string | undefined {
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return undefined;
    if (seg.startsWith("/") || seg.startsWith("\\")) return undefined;
    if (seg.includes("/") || seg.includes("\\")) return undefined;
    if (seg.includes(":")) return undefined;
    if (seg.includes("\0")) return undefined;
  }

  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, ...segments);

  // Ensure resolved path starts with root + separator (or equals root)
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + sep)
  ) {
    return undefined;
  }

  // Check intermediate segments for symlinks (only existing ones)
  const relativePart = resolved.slice(normalizedRoot.length + 1);
  if (!relativePart) return resolved;

  const parts = relativePart.split(sep);
  let current = normalizedRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    current = resolve(current, parts[i]);
    if (existsSync(current) && isSymlink(current)) {
      return undefined;
    }
  }

  return resolved;
}
```

Note: The original plan used `seg.includes("..")` which would reject legitimate filenames like `foo..bar`. Fixed to use exact `seg === ".."` match. Added `seg.includes("/")` and `seg.includes("\\")` to catch embedded separators (e.g. `"sub/../../etc"` as a single segment).

- [ ] **Step 2: Add tests**

```typescript
import { resolveContained } from "../src/core/safe-fs.js";

describe("resolveContained", () => {
  const tmp = mkdtempSync(join(tmpdir(), "safe-fs-resolve-"));
  const nested = join(tmp, "sub", "deep");
  mkdirSync(nested, { recursive: true });

  it("resolves a simple relative path within root", () => {
    const result = resolveContained(tmp, "sub", "deep");
    expect(result).toBe(join(tmp, "sub", "deep"));
  });

  it("resolves a single segment", () => {
    const result = resolveContained(tmp, "sub");
    expect(result).toBe(join(tmp, "sub"));
  });

  it("returns undefined when segments contain ..", () => {
    expect(resolveContained(tmp, "sub", "..", "..", "etc")).toBeUndefined();
  });

  it("returns undefined for absolute segment", () => {
    expect(resolveContained(tmp, "/etc/passwd")).toBeUndefined();
  });

  it("returns undefined for segment with colon", () => {
    expect(resolveContained(tmp, "C:foo")).toBeUndefined();
  });

  it("returns undefined when segment is ..", () => {
    expect(resolveContained(tmp, "..", "other")).toBeUndefined();
  });

  it("returns undefined for segment with embedded separator", () => {
    expect(resolveContained(tmp, "sub/../etc")).toBeUndefined();
    expect(resolveContained(tmp, "sub\\..\\etc")).toBeUndefined();
  });

  it("returns undefined for segment with NUL byte", () => {
    expect(resolveContained(tmp, "foo\x00bar")).toBeUndefined();
  });

  it("allows names containing consecutive dots (not traversal)", () => {
    // "foo..bar" is a valid filename, not a traversal
    const result = resolveContained(tmp, "foo..bar");
    expect(result).toBe(join(tmp, "foo..bar"));
  });

  it("returns undefined when intermediate is a symlink", () => {
    const realDir = join(tmp, "real-dir");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "target.txt"), "ok");
    const symlinkDir = join(tmp, "sym-dir");
    symlinkSync(realDir, symlinkDir);
    expect(resolveContained(tmp, "sym-dir", "target.txt")).toBeUndefined();
  });

  it("allows non-existent paths that don't escape root", () => {
    const result = resolveContained(tmp, "new-dir", "new-file.md");
    expect(result).toBe(join(tmp, "new-dir", "new-file.md"));
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/safe-fs.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```
feat(safe-fs): add resolveContained helper
```

---

### Task 5: Integrate safe-fs into agent and chain discovery

**Files:**

- Modify: `src/core/agents.ts`
- Modify: `tests/safe-fs.test.ts` (add integration tests)

- [ ] **Step 1: Add integration tests**

Add to `tests/safe-fs.test.ts`:

```typescript
import { discoverAgents } from "../src/core/agents.js";
import type { ResolvedPaths } from "../src/shared/types.js";

describe("integration: discovery ignores unsafe files", () => {
  it("discoverAgents skips symlinked .md files with diagnostic", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "safe-fs-integration-"));
    const bundledDir = join(rootDir, "bundled-agents");
    mkdirSync(bundledDir, { recursive: true });

    // Write a real agent file
    writeFileSync(
      join(bundledDir, "worker.md"),
      "---\nname: worker\ndescription: Does work\ntools: read\n---\nDo work\n",
    );

    // Create a symlink masquerading as an agent
    const outsideFile = join(rootDir, "secret.txt");
    writeFileSync(outsideFile, "---\nname: evil\ndescription: Evil\ntools: bash\n---\nEvil\n");
    symlinkSync(outsideFile, join(bundledDir, "evil.md"));

    const paths: ResolvedPaths = {
      agentDir: join(rootDir, "agent"),
      configPath: join(rootDir, "agent", "extensions", "subagents.json"),
      userAgentsDir: join(rootDir, "agent", "agents"),
      bundledAgentsDir: bundledDir,
      sessionsDir: join(rootDir, "agent", "sessions"),
      userChainsDir: join(rootDir, "agent", "chains"),
      bundledChainsDir: join(rootDir, "bundled-chains"),
      userPromptsDir: join(rootDir, "agent", "prompts"),
      bundledPromptsDir: join(rootDir, "bundled-prompts"),
    };

    const result = discoverAgents(paths);

    // Real agent is discovered
    expect(result.agents.map((a) => a.name)).toContain("worker");
    // Symlinked file is not discovered as an agent
    expect(result.agents.map((a) => a.name)).not.toContain("evil");
    // Diagnostic is emitted
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: "unreadable or symlink" }),
    );
  });

  it("discoverAgents skips files with unsafe base names", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "safe-fs-integration-"));
    const bundledDir = join(rootDir, "bundled-agents");
    mkdirSync(bundledDir, { recursive: true });

    writeFileSync(
      join(bundledDir, "worker.md"),
      "---\nname: worker\ndescription: Does work\ntools: read\n---\nDo work\n",
    );
    writeFileSync(
      join(bundledDir, ".hidden.md"),
      "---\nname: hidden\ndescription: Hidden\ntools: bash\n---\nHidden\n",
    );

    const paths: ResolvedPaths = {
      agentDir: join(rootDir, "agent"),
      configPath: join(rootDir, "agent", "extensions", "subagents.json"),
      userAgentsDir: join(rootDir, "agent", "agents"),
      bundledAgentsDir: bundledDir,
      sessionsDir: join(rootDir, "agent", "sessions"),
      userChainsDir: join(rootDir, "agent", "chains"),
      bundledChainsDir: join(rootDir, "bundled-chains"),
      userPromptsDir: join(rootDir, "agent", "prompts"),
      bundledPromptsDir: join(rootDir, "bundled-prompts"),
    };

    const result = discoverAgents(paths);

    expect(result.agents.map((a) => a.name)).toEqual(["worker"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: "unsafe filename" }),
    );
  });
});
```

- [ ] **Step 2: Modify `discoverAgentsFromDirectory` in `agents.ts`**

Add import at top of file:

```typescript
import { isUnsafeName, safeReadFile } from "./safe-fs.js";
```

Replace the for-loop body in `discoverAgentsFromDirectory` (lines 79-87):

Before:
```typescript
  for (const fileName of fileNames) {
    const filePath = resolve(directory, fileName);
    const parsed = parseAgentContent(filePath, readFileSync(filePath, "utf8"));
    if (parsed.ok) {
      agents.push(parsed.agent);
    } else {
      diagnostics.push(parsed.diagnostic);
    }
  }
```

After:
```typescript
  for (const fileName of fileNames) {
    const baseName = fileName.slice(0, -3); // strip .md
    if (isUnsafeName(baseName)) {
      diagnostics.push({
        path: resolve(directory, fileName),
        reason: "unsafe filename",
      });
      continue;
    }
    const filePath = resolve(directory, fileName);
    const content = safeReadFile(filePath);
    if (content === undefined) {
      diagnostics.push({ path: filePath, reason: "unreadable or symlink" });
      continue;
    }
    const parsed = parseAgentContent(filePath, content);
    if (parsed.ok) {
      agents.push(parsed.agent);
    } else {
      diagnostics.push(parsed.diagnostic);
    }
  }
```

- [ ] **Step 3: Modify `discoverChainsFromDirectory` in `agents.ts`**

Replace the for-loop body in `discoverChainsFromDirectory` (lines 311-341):

Before:
```typescript
  for (const fileName of fileNames) {
    const filePath = resolve(directory, fileName);
    try {
      const content = readFileSync(filePath, "utf8");
      const config = fileName.endsWith(".chain.json")
        ? parseJsonChain(filePath, content)
        : parseChain(filePath, content);
      ...
```

After:
```typescript
  for (const fileName of fileNames) {
    const filePath = resolve(directory, fileName);
    const content = safeReadFile(filePath);
    if (content === undefined) {
      diagnostics.push({ filePath, error: "unreadable or symlink" });
      continue;
    }
    try {
      const config = fileName.endsWith(".chain.json")
        ? parseJsonChain(filePath, content)
        : parseChain(filePath, content);
      ...
```

- [ ] **Step 4: Remove unused `readFileSync` import if no longer needed**

Check if `readFileSync` is still used elsewhere in `agents.ts`. It is still used in the chain discovery `try` block — but after this change it's no longer needed. Remove from the import statement if unused (keep `existsSync`, `readdirSync`, etc.).

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All existing tests pass. New integration tests pass.

- [ ] **Step 6: Commit**

```
feat(safe-fs): harden agent and chain discovery against symlinks and traversal
```

---

### Task 6: Consolidate skill-loader.ts local helpers

**Files:**

- Modify: `src/core/skill-loader.ts`

- [ ] **Step 1: Replace local helpers with imports**

In `src/core/skill-loader.ts`, remove the local implementations of `isSymlink` (lines 46-52), `safeReadFile` (lines 54-61), and `isUnsafeName` (lines 37-44). Replace with a single import:

```typescript
import { isSymlink, isUnsafeName, safeReadFile } from "./safe-fs.js";
```

Note: The local `isUnsafeName` in `skill-loader.ts` has slightly different rules (allows leading underscore implicitly via different logic). Verify that the shared version's stricter rules don't break skill discovery for legitimate skill names. The shared version requires `^[a-zA-Z0-9]` as first char — this matches the tintinweb reference and is the intended behavior (leading-dot names are hidden files, leading-underscore names are unconventional for skills).

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass. Skill-loader tests (if any) still pass since the behavior is equivalent for valid skill names.

- [ ] **Step 3: Commit**

```
refactor(skill-loader): use shared safe-fs helpers instead of local copies
```

---

### Task 7: Typecheck, lint, and final verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors (fix any Biome issues)

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 4: Final commit (if any fixes needed)**

```
chore: fix lint/type issues from safe-fs integration
```
