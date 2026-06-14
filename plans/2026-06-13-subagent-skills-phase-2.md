# Phase 2: Skills Field + Skill-Loader Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `skills` field to agent definitions and create a standalone skill-loader module that resolves skill markdown files from the filesystem. The feature is "dark" — skills are parseable and round-trip through the serializer, but are not injected at runtime yet.

**Architecture:** The `skills` frontmatter field accepts: empty (inherit all), `none`/`false` (disable), `all`/`true` (explicit inherit), or a comma-separated list of names. A new `src/core/skill-loader.ts` module searches filesystem paths in precedence order (project `.pi/skills` → `.agents/skills` → user-level) for flat `.md` files or `<name>/SKILL.md` directory skills, with BFS for nested category directories. Symlinks are rejected for security.

**Tech Stack:** TypeScript, Node.js fs APIs, vitest. No new dependencies.

**Prerequisite:** Phase 1 (`disabled` → `enabled` refactor) must be merged first.

---

## File Map

| File                         | Action | Responsibility                                                                                                |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`        | Modify | Add `skills` field to `AgentDefinition` and `AgentCreationInput`                                              |
| `src/core/agents.ts`         | Modify | Parse `skills` from frontmatter, serialize in `createAgentMarkdown`, pass through in `exportAgentToUserScope` |
| `src/core/skill-loader.ts`   | Create | Skill resolution: search paths, BFS, symlink rejection, name validation                                       |
| `tests/skill-loader.test.ts` | Create | Unit tests for skill-loader                                                                                   |
| `tests/agents.test.ts`       | Modify | Tests for skills field parsing and serialization                                                              |
| `agents/planner.md`          | Modify | Add `skills:` field                                                                                           |
| `agents/researcher.md`       | Modify | Add `skills:` field                                                                                           |
| `agents/reviewer.md`         | Modify | Add `skills:` field                                                                                           |
| `agents/scout.md`            | Modify | Add `skills:` field                                                                                           |
| `agents/worker.md`           | Modify | Add `skills:` field                                                                                           |

---

### Task 1: Add `skills` field to types

**Files:**

- Modify: `src/shared/types.ts:32-43`
- Modify: `src/shared/types.ts:55-65`

- [ ] **Step 1: Add `skills` to `AgentDefinition`**

In `src/shared/types.ts`, add after `enabled?: boolean;` (line 40):

```typescript
  skills?: string[] | boolean;
```

The full interface becomes:

```typescript
export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: string;
  subagentAgents: string[];
  timeoutMs?: number;
  enabled?: boolean;
  skills?: string[] | boolean;
  systemPrompt: string;
  sourcePath: string;
}
```

Semantics:

- `undefined` — inherit all available skills from parent
- `string[]` — preload only these named skills
- `true` — explicitly inherit all (same as undefined, for clarity in agent files)
- `false` — no skills injected

- [ ] **Step 2: Add `skills` to `AgentCreationInput`**

In `src/shared/types.ts`, add after `timeoutMs?: number;` (line 63):

```typescript
  skills?: string[] | boolean;
```

The full interface becomes:

```typescript
export interface AgentCreationInput {
  name?: string;
  filenameSlug?: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: string;
  subagentAgents: string[];
  timeoutMs?: number;
  skills?: string[] | boolean;
  systemPrompt: string;
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — new optional fields don't break anything.

---

### Task 2: Parse `skills` in the agent parser

**Files:**

- Modify: `src/core/agents.ts`

- [ ] **Step 1: Add skills parsing after the `enabled` block**

In `src/core/agents.ts`, add after the `enabled` parsing block (which ends around line 333 after Phase 1) and before the `return { ok: true, agent: {...} }` statement:

```typescript
let skills: string[] | boolean | undefined;
if (frontmatter.skills !== undefined) {
  if (typeof frontmatter.skills === "string") {
    const raw = frontmatter.skills.trim().toLowerCase();
    if (raw === "none" || raw === "false") {
      skills = false;
    } else if (raw === "true" || raw === "all") {
      skills = true;
    } else if (raw === "") {
      skills = undefined;
    } else {
      // Comma-separated list (use original case, not lowered)
      const parsed = parseStringArray(frontmatter.skills, "skills");
      if (!parsed.ok) {
        return {
          ok: false,
          diagnostic: { path: filePath, reason: parsed.reason },
        };
      }
      skills = parsed.value.length > 0 ? parsed.value : undefined;
    }
  } else if (Array.isArray(frontmatter.skills)) {
    const parsed = parseStringArray(frontmatter.skills, "skills");
    if (!parsed.ok) {
      return {
        ok: false,
        diagnostic: { path: filePath, reason: parsed.reason },
      };
    }
    skills = parsed.value.length > 0 ? parsed.value : undefined;
  }
}
```

- [ ] **Step 2: Add `skills` to the return object**

In the return statement of `parseAgentFile`, add `skills,` after `enabled,`:

```typescript
return {
  ok: true,
  agent: {
    name,
    description,
    tools: tools.value,
    model,
    thinking,
    subagentAgents: subagentAgents.value,
    timeoutMs,
    enabled,
    skills,
    systemPrompt,
    sourcePath: filePath,
  },
};
```

- [ ] **Step 3: Add `skills` serialization to `createAgentMarkdown`**

In `src/core/agents.ts`, in the `createAgentMarkdown` function, add before `frontmatter.push("---", systemPrompt);` (line 448):

```typescript
if (input.skills === false) {
  frontmatter.push("skills: none");
} else if (input.skills === true) {
  frontmatter.push("skills: all");
} else if (Array.isArray(input.skills) && input.skills.length > 0) {
  frontmatter.push(`skills: ${input.skills.join(", ")}`);
}
```

- [ ] **Step 4: Pass `skills` through in `exportAgentToUserScope`**

In `src/core/agents.ts`, in the `exportAgentToUserScope` function (around line 465), add `skills: agent.skills,` to the `createAgentMarkdown` call:

```typescript
const markdown = createAgentMarkdown({
  name: agent.name,
  description: agent.description,
  tools: agent.tools,
  model: agent.model,
  thinking: agent.thinking,
  subagentAgents: agent.subagentAgents,
  timeoutMs: agent.timeoutMs,
  skills: agent.skills,
  systemPrompt: agent.systemPrompt,
});
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Run existing tests**

Run: `pnpm test`
Expected: All PASS — the new field is optional and doesn't change existing behavior.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/core/agents.ts
git commit -m "feat: add skills field to AgentDefinition and parser

Parse skills from frontmatter:
- empty/omitted: undefined (inherit all)
- 'none'/'false': false (no skills)
- 'all'/'true': true (explicit inherit)
- comma-separated list: string[]

Serialize in createAgentMarkdown. Round-trips through parse/serialize.
Not wired to runtime yet.
```

---

### Task 3: Add tests for skills field parsing and serialization

**Files:**

- Modify: `tests/agents.test.ts`

- [ ] **Step 1: Add parsing tests**

Add after the backward compat tests added in Phase 1 (at end of the describe block):

```typescript
test("parses skills as comma-separated list", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "skills: tdd, writing-go",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { skills: ["tdd", "writing-go"] },
  });
});

test("parses skills: none as false", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "skills: none",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { skills: false },
  });
});

test("parses skills: all as true", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "skills: all",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { skills: true },
  });
});

test("parses empty skills as undefined (inherit all)", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "skills:",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { skills: undefined },
  });
});

test("createAgentMarkdown serializes skills as comma-separated list", () => {
  const markdown = createAgentMarkdown({
    description: "Does work",
    tools: ["read"],
    subagentAgents: [],
    skills: ["tdd", "writing-go"],
    systemPrompt: "Do work.",
  });

  expect(markdown).toContain("skills: tdd, writing-go");
});

test("createAgentMarkdown serializes skills: none for false", () => {
  const markdown = createAgentMarkdown({
    description: "Does work",
    tools: ["read"],
    subagentAgents: [],
    skills: false,
    systemPrompt: "Do work.",
  });

  expect(markdown).toContain("skills: none");
});

test("createAgentMarkdown omits skills when undefined", () => {
  const markdown = createAgentMarkdown({
    description: "Does work",
    tools: ["read"],
    subagentAgents: [],
    systemPrompt: "Do work.",
  });

  expect(markdown).not.toContain("skills");
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test -- tests/agents.test.ts`
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/agents.test.ts
git commit -m "test: add tests for skills field parsing and serialization

Covers comma-separated list, 'none', 'all', empty, and
createAgentMarkdown serialization for each variant.
```

---

### Task 4: Create skill-loader module — tests first

**Files:**

- Create: `tests/skill-loader.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/skill-loader.test.ts`:

```typescript
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  discoverAvailableSkills,
  preloadSkills,
} from "../src/core/skill-loader.js";

describe("skill-loader", () => {
  let tmpDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-skill-test-"));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(tmpDir, "user-agent-dir");
  });

  afterEach(() => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const piSkillsDir = () => join(tmpDir, ".pi", "skills");
  const agentsSkillsDir = () => join(tmpDir, ".agents", "skills");
  const userSkillsDir = () => join(process.env.PI_CODING_AGENT_DIR!, "skills");

  function writeFlat(root: string, name: string, content: string) {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, `${name}.md`), content);
  }

  function writeSkillDir(root: string, name: string, content: string) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
  }

  describe("preloadSkills", () => {
    test("returns empty array for empty skill list", () => {
      expect(preloadSkills([], tmpDir)).toEqual([]);
    });

    test("loads a flat .md skill from .pi/skills", () => {
      writeFlat(
        piSkillsDir(),
        "api-conventions",
        "# API Conventions\nUse REST.",
      );
      const result = preloadSkills(["api-conventions"], tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("api-conventions");
      expect(result[0].content).toContain("API Conventions");
    });

    test("loads a directory skill with SKILL.md from .pi/skills", () => {
      writeSkillDir(piSkillsDir(), "writing-go", "# Writing Go\nUse gofmt.");
      const result = preloadSkills(["writing-go"], tmpDir);
      expect(result[0].content).toContain("Writing Go");
    });

    test("loads from .agents/skills", () => {
      writeSkillDir(agentsSkillsDir(), "rust-idioms", "# Rust Idioms");
      const result = preloadSkills(["rust-idioms"], tmpDir);
      expect(result[0].content).toContain("Rust Idioms");
    });

    test("loads from user-level agentDir/skills", () => {
      writeFlat(userSkillsDir(), "shell-tips", "use rg");
      const result = preloadSkills(["shell-tips"], tmpDir);
      expect(result[0].content).toBe("use rg");
    });

    test("prefers .pi/skills over .agents/skills", () => {
      writeFlat(piSkillsDir(), "shared", "from-pi");
      writeFlat(agentsSkillsDir(), "shared", "from-agents");
      expect(preloadSkills(["shared"], tmpDir)[0].content).toBe("from-pi");
    });

    test("prefers project scope over user scope", () => {
      writeFlat(piSkillsDir(), "shared", "project");
      writeFlat(userSkillsDir(), "shared", "user");
      expect(preloadSkills(["shared"], tmpDir)[0].content).toBe("project");
    });

    test("finds nested directory skills via BFS", () => {
      writeSkillDir(
        join(piSkillsDir(), "dev-tools"),
        "modern-cli",
        "# Modern CLI",
      );
      expect(preloadSkills(["modern-cli"], tmpDir)[0].content).toContain(
        "Modern CLI",
      );
    });

    test("does not descend into a skill directory", () => {
      writeSkillDir(piSkillsDir(), "outer", "outer-skill");
      writeSkillDir(join(piSkillsDir(), "outer"), "inner", "hidden");
      expect(preloadSkills(["inner"], tmpDir)[0].content).toContain(
        "not found",
      );
    });

    test("skips node_modules", () => {
      writeSkillDir(join(piSkillsDir(), "node_modules", "pkg"), "leaked", "no");
      expect(preloadSkills(["leaked"], tmpDir)[0].content).toContain(
        "not found",
      );
    });

    test("skips dotfile directories", () => {
      writeSkillDir(join(piSkillsDir(), ".hidden"), "buried", "no");
      expect(preloadSkills(["buried"], tmpDir)[0].content).toContain(
        "not found",
      );
    });

    test("returns fallback for missing skills", () => {
      const result = preloadSkills(["nonexistent"], tmpDir);
      expect(result[0].name).toBe("nonexistent");
      expect(result[0].content).toContain("not found");
    });

    test("loads multiple skills", () => {
      writeFlat(piSkillsDir(), "a", "Content A");
      writeSkillDir(piSkillsDir(), "b", "Content B");
      const result = preloadSkills(["a", "b"], tmpDir);
      expect(result[0].content).toBe("Content A");
      expect(result[1].content).toContain("Content B");
    });

    test("rejects path traversal names", () => {
      expect(preloadSkills(["../../etc/passwd"], tmpDir)[0].content).toContain(
        "skipped",
      );
      expect(preloadSkills(["sub/dir"], tmpDir)[0].content).toContain(
        "skipped",
      );
      expect(preloadSkills(["sub\\dir"], tmpDir)[0].content).toContain(
        "skipped",
      );
    });

    test("rejects dotfile skill names", () => {
      expect(preloadSkills([".hidden"], tmpDir)[0].content).toContain(
        "skipped",
      );
    });

    test("rejects empty skill names", () => {
      expect(preloadSkills([""], tmpDir)[0].content).toContain("skipped");
    });

    test("rejects names exceeding 128 characters", () => {
      const longName = "a".repeat(129);
      expect(preloadSkills([longName], tmpDir)[0].content).toContain("skipped");
    });

    test("rejects symlinked skill files", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const secret = join(tmpDir, "secret.md");
      writeFileSync(secret, "TOP SECRET");
      symlinkSync(secret, join(piSkillsDir(), "evil.md"));
      const result = preloadSkills(["evil"], tmpDir);
      expect(result[0].content).toContain("not found");
      expect(result[0].content).not.toContain("TOP SECRET");
    });

    test("rejects symlinked skill directories", () => {
      mkdirSync(piSkillsDir(), { recursive: true });
      const realDir = join(tmpDir, "real-skill");
      mkdirSync(realDir, { recursive: true });
      writeFileSync(join(realDir, "SKILL.md"), "TOP SECRET");
      symlinkSync(realDir, join(piSkillsDir(), "evil-dir"));
      const result = preloadSkills(["evil-dir"], tmpDir);
      expect(result[0].content).toContain("not found");
    });

    test("rejects symlinked skill root directory", () => {
      const realRoot = join(tmpDir, "elsewhere");
      mkdirSync(realRoot, { recursive: true });
      writeFileSync(join(realRoot, "leaked.md"), "TOP SECRET");
      mkdirSync(join(tmpDir, ".pi"), { recursive: true });
      symlinkSync(realRoot, piSkillsDir());
      const result = preloadSkills(["leaked"], tmpDir);
      expect(result[0].content).toContain("not found");
    });
  });

  describe("discoverAvailableSkills", () => {
    test("returns empty array when no skills exist", () => {
      expect(discoverAvailableSkills(tmpDir)).toEqual([]);
    });

    test("discovers flat and directory skills", () => {
      writeFlat(piSkillsDir(), "alpha", "A");
      writeSkillDir(piSkillsDir(), "beta", "B");
      const skills = discoverAvailableSkills(tmpDir);
      expect(skills).toContain("alpha");
      expect(skills).toContain("beta");
    });

    test("deduplicates skills across scopes", () => {
      writeFlat(piSkillsDir(), "shared", "project");
      writeFlat(userSkillsDir(), "shared", "user");
      const skills = discoverAvailableSkills(tmpDir);
      expect(skills.filter((s) => s === "shared")).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/skill-loader.test.ts`
Expected: FAIL — cannot find module `../src/core/skill-loader.js`.

---

### Task 5: Implement skill-loader module

**Files:**

- Create: `src/core/skill-loader.ts`

- [ ] **Step 1: Write the implementation**

Create `src/core/skill-loader.ts`:

```typescript
import type { Dirent } from "node:fs";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface PreloadedSkill {
  name: string;
  content: string;
}

export function preloadSkills(
  skillNames: string[],
  cwd: string,
): PreloadedSkill[] {
  return skillNames.map((name) => ({
    name,
    content: loadSkillContent(name, cwd),
  }));
}

export function discoverAvailableSkills(cwd: string): string[] {
  const seen = new Set<string>();
  for (const root of getSearchRoots(cwd)) {
    collectSkillNames(root, seen);
  }
  return [...seen].sort();
}

function getSearchRoots(cwd: string): string[] {
  return [
    join(cwd, ".pi", "skills"),
    join(cwd, ".agents", "skills"),
    join(getAgentDir(), "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".pi", "skills"),
  ];
}

function isUnsafeName(name: string): boolean {
  if (!name || name.length > 128) return true;
  if (name.startsWith(".")) return true;
  if (/[/\\]/.test(name)) return true;
  if (name.includes("..")) return true;
  if (/\s/.test(name)) return true;
  return false;
}

function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function safeReadFile(filePath: string): string | undefined {
  if (isSymlink(filePath)) return undefined;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function loadSkillContent(name: string, cwd: string): string {
  if (isUnsafeName(name)) {
    return `(Skill "${name}" skipped: name contains unsafe characters)`;
  }
  for (const root of getSearchRoots(cwd)) {
    const content = findInRoot(root, name);
    if (content !== undefined) return content;
  }
  return `(Skill "${name}" not found in .pi/skills/, .agents/skills/, or global skill locations)`;
}

function findInRoot(root: string, name: string): string | undefined {
  if (isSymlink(root)) return undefined;
  if (!existsSync(root)) return undefined;

  // Flat file at root level
  const flatPath = join(root, `${name}.md`);
  const flat = safeReadFile(flatPath)?.trim();
  if (flat !== undefined) return flat;

  // Directory skill at root level
  const dirPath = join(root, name);
  if (!isSymlink(dirPath)) {
    const dirContent = safeReadFile(join(dirPath, "SKILL.md"))?.trim();
    if (dirContent !== undefined) return dirContent;
  }

  // BFS for nested directory skills in category folders
  return findSkillBFS(root, name);
}

function findSkillBFS(root: string, name: string): string | undefined {
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

      const skillMd = join(entryPath, "SKILL.md");
      const hasSkillMd = existsSync(skillMd) && !isSymlink(skillMd);

      if (hasSkillMd) {
        // This directory IS a skill
        if (entry.name === name) {
          const content = safeReadFile(skillMd)?.trim();
          if (content !== undefined) return content;
        }
        // Don't descend into skill directories
        continue;
      }

      // Category directory — descend
      queue.push(entryPath);
    }
  }
  return undefined;
}

function collectSkillNames(root: string, seen: Set<string>): void {
  if (isSymlink(root)) return;
  if (!existsSync(root)) return;

  // Flat files at root level
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const entryPath = join(root, entry.name);
      if (isSymlink(entryPath)) continue;
      const skillName = entry.name.slice(0, -3);
      if (!isUnsafeName(skillName)) seen.add(skillName);
    }
  }

  // BFS for directory skills
  const queue: string[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;

    let dirEntries: Dirent[];
    try {
      dirEntries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const entryPath = join(current, entry.name);
      if (isSymlink(entryPath)) continue;

      const skillMd = join(entryPath, "SKILL.md");
      if (existsSync(skillMd) && !isSymlink(skillMd)) {
        if (!isUnsafeName(entry.name)) seen.add(entry.name);
        continue;
      }

      queue.push(entryPath);
    }
  }
}
```

- [ ] **Step 2: Run skill-loader tests**

Run: `pnpm test -- tests/skill-loader.test.ts`
Expected: All PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/skill-loader.ts tests/skill-loader.test.ts
git commit -m "feat: add skill-loader module for resolving skills from filesystem

Search paths in precedence order:
1. <cwd>/.pi/skills
2. <cwd>/.agents/skills
3. <agentDir>/skills
4. ~/.agents/skills
5. ~/.pi/skills

Supports flat .md files and <name>/SKILL.md directory skills.
BFS for nested category directories. Rejects symlinks, path traversal,
dotfiles, and node_modules for security.
```

---

### Task 6: Add `skills:` to bundled agent files

**Files:**

- Modify: `agents/planner.md`
- Modify: `agents/researcher.md`
- Modify: `agents/reviewer.md`
- Modify: `agents/scout.md`
- Modify: `agents/worker.md`

The `skills:` field with an empty value means "inherit all available skills from parent." Each file gets one new line in the frontmatter.

- [ ] **Step 1: Add `skills:` to `agents/planner.md`**

Add `skills:` before `timeout_ms: 600000` (line 13):

```markdown
---
name: planner
description: Planning agent for breaking work into small, verifiable steps.
tools:
  - read
  - bash
model: default
thinking: medium
subagent_agents:
  - scout
  - researcher
  - worker
skills:
timeout_ms: 600000
---
```

- [ ] **Step 2: Add `skills:` to `agents/researcher.md`**

Add `skills:` before `timeout_ms: 600000` (line 9):

```markdown
---
name: researcher
description: Research agent for evidence gathering, code reading, and tradeoff analysis.
tools:
  - read
  - bash
model: default
thinking: high
skills:
timeout_ms: 600000
---
```

- [ ] **Step 3: Add `skills:` to `agents/reviewer.md`**

Add `skills:` before `timeout_ms: 600000` (line 12):

```markdown
---
name: reviewer
description: Read-only review agent for finding defects, regressions, and missing tests.
tools:
  - read
  - bash
  - subagent
model: default
thinking: high
subagent_agents:
  - scout
skills:
timeout_ms: 600000
---
```

- [ ] **Step 4: Add `skills:` to `agents/scout.md`**

Add `skills:` before `timeout_ms: 600000` (line 12):

```markdown
---
name: scout
description: Fast scout for locating files, entry points, and likely change surfaces.
tools:
  - bash
  - read
  - subagent
model: default
thinking: low
subagent_agents:
  - scout
skills:
timeout_ms: 600000
---
```

- [ ] **Step 5: Add `skills:` to `agents/worker.md`**

Add `skills:` before `timeout_ms: 600000` (line 16):

```markdown
---
name: worker
description: Focused implementation agent for contained code changes and targeted verification.
tools:
  - read
  - edit
  - write
  - bash
  - subagent
model: default
thinking: medium
subagent_agents:
  - scout
  - researcher
  - worker
skills:
timeout_ms: 600000
---
```

- [ ] **Step 6: Verify bundled agents parse**

Run: `pnpm test -- tests/agents.test.ts -t "bundled default agent files exist"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/
git commit -m "feat: add skills: field to all bundled agent definitions

Empty skills: means inherit all available skills (the default).
No behavior change until skill injection is wired in Phase 3.
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full check suite**

Run: `pnpm check`
Expected: lint, typecheck, and all tests PASS.

- [ ] **Step 2: Review git log**

Run: `git log --oneline -5`
Expected: Clean commits for this phase only.
