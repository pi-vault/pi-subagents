# Phase 3: Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents persistent per-agent memory that survives across sessions. Agents accumulate role-specific knowledge in a scoped MEMORY.md file.

**Architecture:** A pure module `src/core/memory.ts` that resolves memory directories, reads MEMORY.md safely (using Phase 1's safe-fs), and builds a prompt injection block. Injected into the system prompt by `agent-runner.ts` at the end (append position). Read-write mode for agents with write/edit tools; read-only mode otherwise.

**Tech Stack:** TypeScript, Vitest, Node.js `fs` + `path`

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md` (Phase 3 section)

**Dependencies:** Phase 1 (safe-fs) must be completed first.

---

## File Map

| File                       | Action | Responsibility                                                                    |
| -------------------------- | ------ | --------------------------------------------------------------------------------- |
| `src/core/memory.ts`       | Create | `parseMemoryConfig`, `resolveMemoryDir`, `readMemoryFile`, `buildMemoryInjection` |
| `tests/memory.test.ts`     | Create | Unit tests for all functions                                                      |
| `src/shared/types.ts`      | Modify | Add `memory` field to `AgentDefinition`                                           |
| `src/core/agent-format.ts` | Modify | Parse `memory` from frontmatter                                                   |
| `src/core/agent-runner.ts` | Modify | Inject memory block into system prompt                                            |

---

### Task 1: Add `memory` type to `AgentDefinition`

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add memory config type and field**

Add to `src/shared/types.ts` (near the top, before `AgentDefinition`):

```typescript
export type MemoryScope = "user" | "project" | "local";

export interface AgentMemoryConfig {
  scope: MemoryScope;
  path: string;
}
```

Add to `AgentDefinition` interface:

```typescript
export interface AgentDefinition {
  // ... existing fields ...
  memory?: AgentMemoryConfig;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (field is optional, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(memory): add AgentMemoryConfig type to AgentDefinition"
```

---

### Task 2: Write failing tests for `parseMemoryConfig`

**Files:**

- Create: `tests/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { parseMemoryConfig } from "../src/core/memory.js";

describe("parseMemoryConfig", () => {
  it("parses valid config with scope and path", () => {
    expect(
      parseMemoryConfig({ scope: "project", path: "security-reviewer" }),
    ).toEqual({ scope: "project", path: "security-reviewer" });
  });

  it("accepts all three scopes", () => {
    expect(parseMemoryConfig({ scope: "user", path: "a" })?.scope).toBe("user");
    expect(parseMemoryConfig({ scope: "project", path: "a" })?.scope).toBe(
      "project",
    );
    expect(parseMemoryConfig({ scope: "local", path: "a" })?.scope).toBe(
      "local",
    );
  });

  it("returns undefined for null/undefined", () => {
    expect(parseMemoryConfig(null)).toBeUndefined();
    expect(parseMemoryConfig(undefined)).toBeUndefined();
  });

  it("returns undefined for non-object", () => {
    expect(parseMemoryConfig("project")).toBeUndefined();
    expect(parseMemoryConfig(42)).toBeUndefined();
  });

  it("returns undefined for invalid scope", () => {
    expect(parseMemoryConfig({ scope: "global", path: "x" })).toBeUndefined();
  });

  it("returns undefined when path is missing or empty", () => {
    expect(parseMemoryConfig({ scope: "project" })).toBeUndefined();
    expect(parseMemoryConfig({ scope: "project", path: "" })).toBeUndefined();
  });

  it("returns undefined for path with unsafe characters", () => {
    expect(
      parseMemoryConfig({ scope: "project", path: "../escape" }),
    ).toBeUndefined();
    expect(
      parseMemoryConfig({ scope: "project", path: "foo/bar" }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/memory.test.ts`
Expected: FAIL — module `../src/core/memory.js` does not exist

- [ ] **Step 3: Implement `parseMemoryConfig`**

Create `src/core/memory.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isUnsafeName, resolveContained, safeReadFile } from "./safe-fs.js";
import type { AgentMemoryConfig, MemoryScope } from "../shared/types.js";

const VALID_SCOPES: ReadonlySet<string> = new Set(["user", "project", "local"]);

/**
 * Parse memory config from agent frontmatter.
 * Returns undefined if invalid.
 */
export function parseMemoryConfig(raw: unknown): AgentMemoryConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  if (typeof r.scope !== "string" || !VALID_SCOPES.has(r.scope))
    return undefined;
  if (typeof r.path !== "string" || !r.path) return undefined;

  // Path must be a single safe segment (no slashes, no traversal)
  if (isUnsafeName(r.path)) return undefined;

  return { scope: r.scope as MemoryScope, path: r.path };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/memory.ts tests/memory.test.ts
git commit -m "feat(memory): add parseMemoryConfig"
```

---

### Task 3: Write failing tests for `resolveMemoryDir`

**Files:**

- Modify: `tests/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/memory.test.ts`:

```typescript
import { resolveMemoryDir } from "../src/core/memory.js";
import { mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("resolveMemoryDir", () => {
  const tmp = mkdtempSync(join(tmpdir(), "memory-resolve-"));

  it("resolves project scope to .pi/agent-memory/<path>/", () => {
    const result = resolveMemoryDir("project", "reviewer", tmp);
    expect(result).toHaveProperty("dir");
    expect((result as { dir: string }).dir).toBe(
      join(tmp, ".pi", "agent-memory", "reviewer"),
    );
  });

  it("resolves local scope to .pi/agent-memory-local/<path>/", () => {
    const result = resolveMemoryDir("local", "reviewer", tmp);
    expect(result).toHaveProperty("dir");
    expect((result as { dir: string }).dir).toBe(
      join(tmp, ".pi", "agent-memory-local", "reviewer"),
    );
  });

  it("resolves user scope to ~/.pi/agent-memory/<path>/", () => {
    const result = resolveMemoryDir("user", "reviewer", tmp);
    expect(result).toHaveProperty("dir");
    // User scope uses getAgentDir() or ~/.pi/agent-memory/
    const dir = (result as { dir: string }).dir;
    expect(dir).toContain("agent-memory");
    expect(dir).toContain("reviewer");
  });

  it("returns error for unsafe path", () => {
    const result = resolveMemoryDir("project", "../escape", tmp);
    expect(result).toHaveProperty("error");
  });

  it("returns error when root is a symlink", () => {
    const realDir = join(tmp, "real-pi");
    mkdirSync(join(realDir, "agent-memory"), { recursive: true });
    const symPi = join(tmp, "sym-project", ".pi");
    mkdirSync(join(tmp, "sym-project"), { recursive: true });
    symlinkSync(realDir, symPi);
    const result = resolveMemoryDir(
      "project",
      "test",
      join(tmp, "sym-project"),
    );
    expect(result).toHaveProperty("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/memory.test.ts`
Expected: FAIL — `resolveMemoryDir` not exported

- [ ] **Step 3: Implement `resolveMemoryDir`**

Add to `src/core/memory.ts`:

```typescript
/**
 * Resolve memory directory with security checks.
 * Returns { dir } on success or { error } on failure.
 */
export function resolveMemoryDir(
  scope: MemoryScope,
  scopedPath: string,
  cwd: string,
): { dir: string } | { error: string } {
  // Validate path segment
  if (isUnsafeName(scopedPath)) {
    return { error: `Unsafe memory path: "${scopedPath}"` };
  }

  let rootDir: string;
  switch (scope) {
    case "user":
      rootDir = join(getAgentDir(), "agent-memory");
      break;
    case "project":
      rootDir = join(cwd, ".pi", "agent-memory");
      break;
    case "local":
      rootDir = join(cwd, ".pi", "agent-memory-local");
      break;
  }

  // Check if .pi directory itself is a symlink (project/local scopes)
  if (scope !== "user") {
    const piDir = join(cwd, ".pi");
    if (existsSync(piDir)) {
      const { isSymlink } = require("./safe-fs.js");
      if (isSymlink(piDir)) {
        return { error: `.pi directory is a symlink — refusing memory access` };
      }
    }
  }

  const resolved = resolveContained(rootDir, scopedPath);
  if (!resolved) {
    return { error: `Memory path "${scopedPath}" escapes root directory` };
  }

  return { dir: resolved };
}
```

Wait — we can't use `require` in an ESM module. Let me fix that:

```typescript
import {
  isSymlink,
  resolveContained,
  safeReadFile,
  isUnsafeName,
} from "./safe-fs.js";
```

The import is already at the top. The implementation should be:

```typescript
export function resolveMemoryDir(
  scope: MemoryScope,
  scopedPath: string,
  cwd: string,
): { dir: string } | { error: string } {
  if (isUnsafeName(scopedPath)) {
    return { error: `Unsafe memory path: "${scopedPath}"` };
  }

  let rootDir: string;
  switch (scope) {
    case "user":
      rootDir = join(getAgentDir(), "agent-memory");
      break;
    case "project":
      rootDir = join(cwd, ".pi", "agent-memory");
      break;
    case "local":
      rootDir = join(cwd, ".pi", "agent-memory-local");
      break;
  }

  // Check if .pi directory itself is a symlink (project/local scopes)
  if (scope !== "user") {
    const piDir = join(cwd, ".pi");
    if (existsSync(piDir) && isSymlink(piDir)) {
      return { error: `.pi directory is a symlink — refusing memory access` };
    }
  }

  const resolved = resolveContained(rootDir, scopedPath);
  if (!resolved) {
    return { error: `Memory path "${scopedPath}" escapes root directory` };
  }

  return { dir: resolved };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/memory.ts tests/memory.test.ts
git commit -m "feat(memory): add resolveMemoryDir with security checks"
```

---

### Task 4: Write failing tests for `readMemoryFile`

**Files:**

- Modify: `tests/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/memory.test.ts`:

```typescript
import { readMemoryFile } from "../src/core/memory.js";

describe("readMemoryFile", () => {
  const tmp = mkdtempSync(join(tmpdir(), "memory-read-"));

  it("returns null when MEMORY.md does not exist", () => {
    const result = readMemoryFile(join(tmp, "nonexistent"));
    expect(result).toBeNull();
  });

  it("reads a normal MEMORY.md file", () => {
    const dir = join(tmp, "agent1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "MEMORY.md"), "# Notes\n- item 1\n- item 2\n");
    const result = readMemoryFile(dir);
    expect(result).not.toBeNull();
    expect(result).not.toBe("unsafe");
    expect((result as { contents: string }).contents).toBe(
      "# Notes\n- item 1\n- item 2\n",
    );
    expect((result as { contents: string; truncated: boolean }).truncated).toBe(
      false,
    );
  });

  it("returns 'unsafe' when MEMORY.md is a symlink", () => {
    const dir = join(tmp, "agent2");
    mkdirSync(dir, { recursive: true });
    const realFile = join(tmp, "real-memory.md");
    writeFileSync(realFile, "secret");
    symlinkSync(realFile, join(dir, "MEMORY.md"));
    const result = readMemoryFile(dir);
    expect(result).toBe("unsafe");
  });

  it("truncates at 200 lines", () => {
    const dir = join(tmp, "agent3");
    mkdirSync(dir, { recursive: true });
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(dir, "MEMORY.md"), lines.join("\n"));
    const result = readMemoryFile(dir) as {
      contents: string;
      truncated: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.contents.split("\n").length).toBeLessThanOrEqual(201); // 200 lines + possible trailing
  });

  it("truncates at 16KB", () => {
    const dir = join(tmp, "agent4");
    mkdirSync(dir, { recursive: true });
    // Write 20KB of content in <200 lines (long lines)
    const longLine = "x".repeat(1000);
    const lines = Array.from({ length: 50 }, () => longLine);
    writeFileSync(join(dir, "MEMORY.md"), lines.join("\n"));
    const result = readMemoryFile(dir) as {
      contents: string;
      truncated: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.contents.length).toBeLessThanOrEqual(16384 + 100); // small tolerance for split
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/memory.test.ts`
Expected: FAIL — `readMemoryFile` not exported

- [ ] **Step 3: Implement `readMemoryFile`**

Add to `src/core/memory.ts`:

```typescript
export type MemoryFileResult =
  | { contents: string; truncated: boolean }
  | "unsafe"
  | null;

const MAX_LINES = 200;
const MAX_BYTES = 16_384;

/**
 * Read MEMORY.md safely (symlink rejection, line/byte limit).
 */
export function readMemoryFile(memoryDir: string): MemoryFileResult {
  const filePath = join(memoryDir, "MEMORY.md");
  const contents = safeReadFile(filePath);

  if (contents === undefined) {
    // Distinguish: file doesn't exist vs exists but unsafe
    if (!existsSync(filePath)) return null;
    return "unsafe";
  }

  // Apply limits
  let truncated = false;
  let result = contents;

  // Byte limit first
  if (result.length > MAX_BYTES) {
    result = result.slice(0, MAX_BYTES);
    truncated = true;
  }

  // Line limit
  const lines = result.split("\n");
  if (lines.length > MAX_LINES) {
    result = lines.slice(0, MAX_LINES).join("\n");
    truncated = true;
  }

  return { contents: result, truncated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/memory.ts tests/memory.test.ts
git commit -m "feat(memory): add readMemoryFile with truncation limits"
```

---

### Task 5: Write failing tests for `buildMemoryInjection`

**Files:**

- Modify: `tests/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/memory.test.ts`:

```typescript
import { buildMemoryInjection } from "../src/core/memory.js";

describe("buildMemoryInjection", () => {
  const tmp = mkdtempSync(join(tmpdir(), "memory-inject-"));

  it("returns read-write block when hasWriteTools is true", () => {
    const dir = join(tmp, "rw-agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "MEMORY.md"), "# My notes\n- thing 1\n");

    const result = buildMemoryInjection(
      "Scout",
      { scope: "project", path: "rw-agent" },
      tmp,
      true,
    );
    expect(result).toContain("# Persistent agent memory");
    expect(result).toContain("# My notes");
    expect(result).toContain("append a concise dated entry");
    expect(result).not.toContain("read-only");
  });

  it("returns read-only block when hasWriteTools is false and file exists", () => {
    const dir = join(tmp, "ro-agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "MEMORY.md"), "# Existing\n");

    const result = buildMemoryInjection(
      "Reader",
      { scope: "project", path: "ro-agent" },
      tmp,
      false,
    );
    expect(result).toContain("read-only");
    expect(result).toContain("# Existing");
  });

  it("returns empty string when read-only and no MEMORY.md exists", () => {
    const result = buildMemoryInjection(
      "NoFile",
      { scope: "project", path: "no-file-agent" },
      tmp,
      false,
    );
    expect(result).toBe("");
  });

  it("returns create-prompt when read-write and no MEMORY.md exists", () => {
    const result = buildMemoryInjection(
      "NewAgent",
      { scope: "project", path: "new-agent" },
      tmp,
      true,
    );
    expect(result).toContain("No MEMORY.md exists yet");
    expect(result).toContain("create it");
  });

  it("notes truncation when file is large", () => {
    const dir = join(tmp, "big-agent");
    mkdirSync(dir, { recursive: true });
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    writeFileSync(join(dir, "MEMORY.md"), lines.join("\n"));

    const result = buildMemoryInjection(
      "Big",
      { scope: "project", path: "big-agent" },
      tmp,
      true,
    );
    expect(result).toContain("truncated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/memory.test.ts`
Expected: FAIL — `buildMemoryInjection` not exported

- [ ] **Step 3: Implement `buildMemoryInjection`**

Add to `src/core/memory.ts`:

```typescript
/**
 * Build prompt injection block for agent memory.
 * Returns empty string if read-only mode and no MEMORY.md exists.
 */
export function buildMemoryInjection(
  agentName: string,
  config: AgentMemoryConfig,
  cwd: string,
  hasWriteTools: boolean,
): string {
  const dirResult = resolveMemoryDir(config.scope, config.path, cwd);
  if ("error" in dirResult) return ""; // silently skip on resolution error

  const { dir } = dirResult;
  const fileResult = readMemoryFile(dir);

  // Read-only mode: skip entirely if no file
  if (!hasWriteTools) {
    if (fileResult === null || fileResult === "unsafe") return "";
    const { contents, truncated } = fileResult;
    const truncNote = truncated ? "\n(truncated at 200 lines / 16KB)" : "";
    return [
      "# Persistent agent memory (read-only)",
      "",
      `Memory scope: ${config.scope}`,
      "You have read-only access to memory. You can reference existing memories but cannot create or modify them.",
      "",
      "## Current MEMORY.md",
      "---",
      contents + truncNote,
      "---",
    ].join("\n");
  }

  // Read-write mode
  let memorySection: string;
  if (fileResult === null) {
    memorySection =
      "No MEMORY.md exists yet. You may create it to begin accumulating notes.";
  } else if (fileResult === "unsafe") {
    memorySection = "(MEMORY.md exists but is unsafe — skipped)";
  } else {
    const { contents, truncated } = fileResult;
    const truncNote = truncated ? "\n(truncated at 200 lines / 16KB)" : "";
    memorySection = contents + truncNote;
  }

  return [
    "# Persistent agent memory",
    "",
    `You have a durable, role-specific memory at: ${dir}/MEMORY.md`,
    `Memory scope: ${config.scope}`,
    "",
    "Read this file at the start of a task to recall accumulated role notes.",
    "When you produce durable, reusable role knowledge, append a concise dated entry.",
    "Only persist generally reusable knowledge, not one-off task details or secrets.",
    "Keep MEMORY.md under 200 lines — store detailed content in separate files and link from the index.",
    "",
    "## Current MEMORY.md",
    "---",
    memorySection,
    "---",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/memory.ts tests/memory.test.ts
git commit -m "feat(memory): add buildMemoryInjection with read-write/read-only modes"
```

---

### Task 6: Parse `memory` from agent frontmatter

**Files:**

- Modify: `src/core/agent-format.ts`

- [ ] **Step 1: Add memory parsing to agent frontmatter parser**

Find where other optional frontmatter fields are parsed in `agent-format.ts` (look for where `disallowedTools`, `toolBudget`, etc. are extracted from the parsed YAML). Add:

```typescript
import { parseMemoryConfig } from "./memory.js";

// In the function that builds AgentDefinition from parsed frontmatter:
memory: parseMemoryConfig(frontmatter.memory),
```

- [ ] **Step 2: Run existing agent-format tests**

Run: `pnpm test -- tests/agent-format.test.ts`
Expected: All existing tests still pass

- [ ] **Step 3: Commit**

```bash
git add src/core/agent-format.ts
git commit -m "feat(memory): parse memory config from agent frontmatter"
```

---

### Task 7: Inject memory block in agent-runner.ts

**Files:**

- Modify: `src/core/agent-runner.ts`

- [ ] **Step 1: Add memory injection after system prompt build**

In `src/core/agent-runner.ts`, after `buildAgentPrompt()` returns the system prompt (around line 204), append the memory block:

```typescript
import { buildMemoryInjection } from "./memory.js";

// After: const systemPrompt = buildAgentPrompt(agentDef, ...);
// Add memory injection
let finalSystemPrompt = systemPrompt;
if (agentDef.memory) {
  const effectivelyHas = (name: string) =>
    allowedTools.includes(name) &&
    !(agentDef.disallowedTools ?? []).includes(name);
  const hasWriteTools = effectivelyHas("write") || effectivelyHas("edit");
  const memoryBlock = buildMemoryInjection(
    agentDef.name,
    agentDef.memory,
    options.cwd,
    hasWriteTools,
  );
  if (memoryBlock) {
    finalSystemPrompt = systemPrompt + "\n\n" + memoryBlock;
  }
}
```

Then use `finalSystemPrompt` instead of `systemPrompt` in the `ResourceLoader` override:

```typescript
systemPromptOverride: () => finalSystemPrompt,
```

- [ ] **Step 2: Emit notification for local scope first creation**

Add after the memory injection (only for local scope when directory is being created for the first time):

```typescript
// This will be handled by the existing sendMessage in subagent.ts if needed.
// The memory.ts module doesn't create directories itself — the agent does via write tool.
// No change needed here for the notification — it's handled at the extension level.
```

Actually, the notification for `.gitignore` is emitted at the extension level (index.ts) when we detect a local memory directory creation. This integration is lightweight and can be added later if needed. For now, the memory module does not create directories.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/core/agent-runner.ts
git commit -m "feat(memory): inject memory block into agent system prompt"
```

---

### Task 8: Typecheck and lint

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: fix lint/type issues from memory integration"
```
