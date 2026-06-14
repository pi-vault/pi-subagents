# Subagent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `skills` field to agent definitions that preloads named skills into agent system prompts at spawn time, with inheritance from parent when unspecified.

**Architecture:** A new `skill-loader.ts` module searches filesystem paths (project then user scope) for skill markdown files. The `skills` frontmatter field controls which skills are injected: omitted means inherit all, explicit list means only those, `none` means none. Skills are appended to the system prompt temp file before spawning the child pi process.

**Tech Stack:** TypeScript, Node.js fs APIs, vitest for testing. No new dependencies.

---

## File Map

| File                         | Action | Responsibility                                             |
| ---------------------------- | ------ | ---------------------------------------------------------- |
| `src/shared/types.ts`        | Modify | Add `skills` field to types, rename `disabled` → `enabled` |
| `src/core/agents.ts`         | Modify | Parse/serialize `skills` and `enabled` fields              |
| `src/core/skill-loader.ts`   | Create | Skill resolution from filesystem search paths              |
| `src/core/subagent.ts`       | Modify | Inject resolved skills into system prompt at spawn         |
| `agents/planner.md`          | Modify | All fields explicit with defaults                          |
| `agents/researcher.md`       | Modify | All fields explicit with defaults                          |
| `agents/reviewer.md`         | Modify | All fields explicit with defaults                          |
| `agents/scout.md`            | Modify | All fields explicit with defaults                          |
| `agents/worker.md`           | Modify | All fields explicit with defaults                          |
| `tests/skill-loader.test.ts` | Create | Skill loader unit tests                                    |
| `tests/agents.test.ts`       | Modify | Tests for `skills` and `enabled` fields                    |
| `tests/subagent.test.ts`     | Modify | Test skill injection into system prompt                    |

---

### Task 1: Rename `disabled` → `enabled` in Types

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Update `AgentDefinition` interface**

Replace `disabled?: boolean` with `enabled?: boolean` in `src/shared/types.ts`:

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

The `skills` field semantics:

- `undefined` — inherit all enabled skills from parent
- `string[]` — preload only these named skills
- `true` — explicitly inherit all (same as undefined, for clarity)
- `false` — no skills injected

- [ ] **Step 2: Add `skills` to `AgentCreationInput`**

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

- [ ] **Step 3: Run typecheck to see what breaks**

Run: `pnpm typecheck`
Expected: Multiple type errors in files referencing `disabled`.

---

### Task 2: Update Agent Parser for `enabled` and `skills`

**Files:**

- Modify: `src/core/agents.ts`

- [ ] **Step 1: Update `parseAgentFile` to handle `enabled` (with `disabled` backward compat)**

In `src/core/agents.ts`, replace the `disabled` parsing block (around line 321-324) with:

```typescript
let enabled: boolean | undefined;
if (frontmatter.enabled !== undefined) {
  const raw =
    typeof frontmatter.enabled === "string"
      ? frontmatter.enabled.trim().toLowerCase()
      : "";
  enabled = raw !== "false";
} else if (frontmatter.disabled !== undefined) {
  // Backward compat: support legacy `disabled: true` in user files
  const raw =
    typeof frontmatter.disabled === "string"
      ? frontmatter.disabled.trim().toLowerCase()
      : "";
  enabled = raw !== "true";
}
```

- [ ] **Step 2: Parse the `skills` frontmatter field**

Add after the `enabled` parsing block:

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
      // Comma-separated list
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

- [ ] **Step 3: Update the return object**

Replace `disabled,` with `enabled,` and add `skills,` in the return statement:

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

- [ ] **Step 4: Update `discoverAgents` to use `enabled` instead of `disabled`**

In the `discoverAgents` function, replace `if (agent.disabled)` with:

```typescript
if (agent.enabled === false) {
  blockedNames.add(comparisonName);
  continue;
}
```

- [ ] **Step 5: Update `createAgentMarkdown` to serialize `enabled` and `skills`**

Add `skills` to the function parameter interface reference in `AgentCreationInput` (already done in Task 1). Update the serializer body:

```typescript
export function createAgentMarkdown(input: AgentCreationInput): string {
  const name = normalizeOptionalString(input.name);
  const description = input.description.trim();
  const tools = uniqueStrings(
    input.tools.map((value) => value.trim()).filter(Boolean),
  );
  const model = normalizeOptionalString(input.model);
  const thinking = normalizeOptionalString(input.thinking);
  const subagentAgents = uniqueStrings(
    input.subagentAgents.map((value) => value.trim()).filter(Boolean),
  );
  const systemPrompt = input.systemPrompt.replace(/\r\n/g, "\n").trim();

  const frontmatter = ["---"];
  if (name) {
    frontmatter.push(`name: ${name}`);
  }
  frontmatter.push(`description: ${description}`);
  frontmatter.push(serializeStringList("tools", tools));
  if (model && model.toLowerCase() !== "default") {
    frontmatter.push(`model: ${model}`);
  }
  if (thinking) {
    frontmatter.push(`thinking: ${thinking}`);
  }
  if (subagentAgents.length > 0) {
    frontmatter.push(`subagent_agents: ${subagentAgents.join(", ")}`);
  }
  if (input.timeoutMs !== undefined) {
    frontmatter.push(`timeout_ms: ${input.timeoutMs}`);
  }
  if (input.skills === false) {
    frontmatter.push("skills: none");
  } else if (input.skills === true) {
    frontmatter.push("skills: all");
  } else if (Array.isArray(input.skills) && input.skills.length > 0) {
    frontmatter.push(`skills: ${input.skills.join(", ")}`);
  }
  frontmatter.push("---", systemPrompt);

  return `${frontmatter.join("\n")}\n`;
}
```

- [ ] **Step 6: Update `disableAgentInUserScope` to use `enabled: false`**

Replace `"disabled: true"` with `"enabled: false"` in the `disableAgentInUserScope` function:

```typescript
const markdown = [
  "---",
  `name: ${agent.name}`,
  `description: ${agent.description}`,
  "tools:",
  "enabled: false",
  "---",
  agent.systemPrompt.trim(),
  "",
].join("\n");
```

- [ ] **Step 7: Update `exportAgentToUserScope` to pass `skills`**

In the `exportAgentToUserScope` function, add `skills` to the `createAgentMarkdown` call:

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

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: Remaining errors only in `src/tui/agents-menu.ts` (referencing `disabled`).

---

### Task 3: Update Agents Menu for `enabled`

**Files:**

- Modify: `src/tui/agents-menu.ts`

- [ ] **Step 1: Replace `disabled` references with `enabled`**

Find the line referencing `overrideAgent?.disabled` and change to `overrideAgent?.enabled === false`. The `state` enum value `"disabled"` stays the same — it's a UI label, not tied to the field name.

Replace:

```typescript
      if (overrideAgent?.disabled) {
```

With:

```typescript
      if (overrideAgent?.enabled === false) {
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts src/core/agents.ts src/tui/agents-menu.ts
git commit -m "refactor: rename disabled → enabled, add skills field to AgentDefinition

Support both `enabled` and legacy `disabled` in frontmatter parsing for
backward compatibility. The serializer now always emits `enabled`.

Add `skills` field to AgentDefinition and AgentCreationInput with
tintinweb-style semantics: undefined = inherit all, string[] = specific
skills, true = explicitly all, false = none.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 4: Create Skill Loader Module

**Files:**

- Create: `src/core/skill-loader.ts`

- [ ] **Step 1: Write the failing test file**

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

    test("loads from .agents/skills (Agent Skills spec)", () => {
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

    test("prefers project over user scope", () => {
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

    test("does not descend into a skill directory (skills don't nest)", () => {
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
Expected: FAIL — module not found.

- [ ] **Step 3: Write the skill-loader implementation**

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
  const roots = getSearchRoots(cwd);
  for (const root of roots) {
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
  const roots = getSearchRoots(cwd);
  for (const root of roots) {
    const content = findInRoot(root, name);
    if (content !== undefined) return content;
  }
  return `(Skill "${name}" not found in .pi/skills/, .agents/skills/, or global skill locations)`;
}

function findInRoot(root: string, name: string): string | undefined {
  if (isSymlink(root)) return undefined;
  if (!existsSync(root)) return undefined;

  // Try flat file first
  const flatPath = join(root, `${name}.md`);
  const flat = safeReadFile(flatPath)?.trim();
  if (flat !== undefined) return flat;

  // Try directory skill at root level
  const dirSkill = join(root, name, "SKILL.md");
  if (!isSymlink(join(root, name))) {
    const dirContent = safeReadFile(dirSkill)?.trim();
    if (dirContent !== undefined) return dirContent;
  }

  // BFS for nested directory skills
  return findSkillDirectory(root, name);
}

function findSkillDirectory(root: string, name: string): string | undefined {
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const entryPath = join(current, entry.name);
      if (isSymlink(entryPath)) continue;

      const skillMd = join(entryPath, "SKILL.md");
      const hasSkillMd = existsSync(skillMd) && !isSymlink(skillMd);

      if (hasSkillMd) {
        if (entry.name === name) {
          const content = safeReadFile(skillMd)?.trim();
          if (content !== undefined) return content;
        }
        // Skills don't nest — don't descend into a skill directory
        continue;
      }

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
      const skillName = entry.name.slice(0, -3); // strip .md
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
        continue; // Don't descend into skill dirs
      }

      queue.push(entryPath);
    }
  }
}
```

- [ ] **Step 4: Run skill-loader tests**

Run: `pnpm test -- tests/skill-loader.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/skill-loader.ts tests/skill-loader.test.ts
git commit -m "feat: add skill-loader module for resolving and preloading skills

Searches filesystem paths in precedence order:
1. <cwd>/.pi/skills
2. <cwd>/.agents/skills
3. <agentDir>/skills
4. ~/.agents/skills
5. ~/.pi/skills

Supports flat .md files and <name>/SKILL.md directory skills.
BFS for nested directory skills. Rejects symlinks, path traversal,
dotfiles, and node_modules for security.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 5: Integrate Skill Injection into `executeSubagent`

**Files:**

- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Add import for skill-loader**

At the top of `src/core/subagent.ts`, add:

```typescript
import { discoverAvailableSkills, preloadSkills } from "./skill-loader.js";
```

- [ ] **Step 2: Add skill injection helper**

Add a helper function near the top of the file (after imports, before the constants):

```typescript
function buildSkillSuffix(agent: AgentDefinition, cwd: string): string {
  const skills = agent.skills;

  // false = no skills
  if (skills === false) return "";

  let skillNames: string[];
  if (Array.isArray(skills)) {
    // Explicit list
    skillNames = skills;
  } else {
    // undefined or true = inherit all available
    skillNames = discoverAvailableSkills(cwd);
  }

  if (skillNames.length === 0) return "";

  const loaded = preloadSkills(skillNames, cwd);
  const sections = loaded
    .filter((s) => !s.content.startsWith("(Skill"))
    .map((s) => `\n# Preloaded Skill: ${s.name}\n${s.content}`);

  return sections.length > 0 ? `\n${sections.join("\n")}` : "";
}
```

- [ ] **Step 3: Inject skills into the system prompt file**

In the `executeSubagent` function, locate the block that writes the prompt file (around line 902-908):

```typescript
if (resolvedAgent.systemPrompt.trim()) {
  promptDir = runtime.mkdtemp(join(tmpdir(), "pi-subagents-"));
  promptPath = join(
    promptDir,
    `${resolvedAgent.name.replace(/[^A-Za-z0-9_-]+/g, "_").toLowerCase()}.md`,
  );
  runtime.writeFile(promptPath, resolvedAgent.systemPrompt);
}
```

Replace with:

```typescript
const skillSuffix = buildSkillSuffix(resolvedAgent, effectiveCwd);
const fullPrompt = resolvedAgent.systemPrompt.trim() + skillSuffix;
if (fullPrompt) {
  promptDir = runtime.mkdtemp(join(tmpdir(), "pi-subagents-"));
  promptPath = join(
    promptDir,
    `${resolvedAgent.name.replace(/[^A-Za-z0-9_-]+/g, "_").toLowerCase()}.md`,
  );
  runtime.writeFile(promptPath, fullPrompt);
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/subagent.ts
git commit -m "feat: inject preloaded skills into subagent system prompts

At spawn time, resolves skills based on the agent's skills config:
- undefined/true: discovers all available skills and injects them
- string[]: preloads only the named skills
- false: no skills injected

Skills are appended to the system prompt as markdown sections:
  # Preloaded Skill: <name>
  <content>

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 6: Update Bundled Agent Markdown Files

**Files:**

- Modify: `agents/planner.md`
- Modify: `agents/researcher.md`
- Modify: `agents/reviewer.md`
- Modify: `agents/scout.md`
- Modify: `agents/worker.md`

- [ ] **Step 1: Rewrite `agents/planner.md`**

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
timeout_ms: 180000
enabled: true
skills:
---

You are Planner.

Turn broad requests into a short execution plan with explicit assumptions, ordered steps, risks, and verification points.
Prefer the smallest reversible approach that can still solve the task.
Do not implement changes yourself; focus on clarity, sequencing, and tradeoffs.
```

- [ ] **Step 2: Rewrite `agents/researcher.md`**

```markdown
---
name: researcher
description: Research agent for evidence gathering, code reading, and tradeoff analysis.
tools:
  - read
  - bash
model: default
thinking: high
subagent_agents:
timeout_ms: 180000
enabled: true
skills:
---

You are Researcher.

Gather the most relevant facts before implementation.
Read code, tests, docs, and configs carefully, then return concise findings, constraints, and tradeoffs.
Prefer evidence over guesses and call out uncertainty when context is missing.
```

- [ ] **Step 3: Rewrite `agents/reviewer.md`**

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
timeout_ms: 180000
enabled: true
skills:
---

You are Reviewer.

Review code and plans critically without making changes.
Prioritize correctness issues, regressions, unsafe assumptions, and missing verification.
Be concise, specific, and evidence-based.
```

- [ ] **Step 4: Rewrite `agents/scout.md`**

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
timeout_ms: 120000
enabled: true
skills:
---

You are Scout.

Quickly map the workspace, identify the most relevant files, and summarize where deeper work should happen.
Prefer breadth first, then highlight the smallest useful next actions.
Do not make code changes.
```

- [ ] **Step 5: Rewrite `agents/worker.md`**

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
timeout_ms: 300000
enabled: true
skills:
---

You are Worker.

Make the minimum necessary code changes to complete the task.
Match existing style, avoid unrelated refactors, and verify the narrowest meaningful checks before finishing.
Use child agents only when they clearly reduce risk or context load.
```

- [ ] **Step 6: Commit**

```bash
git add agents/
git commit -m "refactor: make all agent markdown fields explicit with defaults

Every bundled agent now declares all fields:
- name, description, tools, model, thinking
- subagent_agents, timeout_ms, enabled, skills

Empty skills: field means inherit all available skills from parent.
enabled: true is the explicit default.
model: default is explicit (no behavior change — parsed as undefined).

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 7: Update Existing Tests

**Files:**

- Modify: `tests/agents.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Fix `tests/agents.test.ts` — `disableAgentInUserScope` test**

Find the test around line 598 that checks `disabled.disabled` and update:

```typescript
const disabled = disableAgentInUserScope(paths, before, "Scout");
expect(disabled.enabled).toBe(false);
```

- [ ] **Step 2: Fix `tests/index.test.ts` — mock `disableAgentInUserScope`**

Find line 92 that returns `{ ...discovery.agents[0]!, disabled: true }` and update:

```typescript
    disableAgentInUserScope: () => ({ ...discovery.agents[0]!, enabled: false }),
```

- [ ] **Step 3: Add agent parsing tests for `skills` field**

Add to `tests/agents.test.ts` in the `"agent discovery"` describe block:

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

test("parses enabled: true", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "enabled: true",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { enabled: true },
  });
});

test("parses enabled: false", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "enabled: false",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { enabled: false },
  });
});

test("supports legacy disabled: true (backward compat)", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "disabled: true",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { enabled: false },
  });
});
```

- [ ] **Step 4: Add `createAgentMarkdown` test for skills serialization**

Add in the `"createAgentMarkdown"` describe block (or the general test area):

```typescript
test("createAgentMarkdown serializes skills as comma-separated list", () => {
  const markdown = createAgentMarkdown({
    name: "worker",
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
    name: "worker",
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
    name: "worker",
    description: "Does work",
    tools: ["read"],
    subagentAgents: [],
    systemPrompt: "Do work.",
  });

  expect(markdown).not.toContain("skills");
});
```

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/agents.test.ts tests/index.test.ts
git commit -m "test: add tests for skills field parsing and enabled/disabled compat

Tests cover:
- skills as comma-separated list, 'none', 'all', empty
- enabled: true/false
- Legacy disabled: true backward compat
- createAgentMarkdown serialization for skills

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 8: Add Subagent Integration Test for Skill Injection

**Files:**

- Modify: `tests/subagent.test.ts`

- [ ] **Step 1: Find the mock/spy pattern in subagent tests**

Read `tests/subagent.test.ts` to understand how `SubagentRuntimeDeps` is mocked (it uses `createSubagentRuntimeDeps()` overrides with a fake `writeFile`).

- [ ] **Step 2: Add test verifying skill content in prompt file**

Add a test that verifies when an agent has `skills: ["test-skill"]`, the written prompt file includes the skill content. This requires setting up a skill file in the test's temp directory. Add to the subagent test file:

```typescript
test("injects preloaded skills into the system prompt file", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-skills-"));
  const skillsDir = join(cwd, ".pi", "skills");
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, "test-skill.md"), "# Test Skill\nDo TDD.");

  const agent: AgentDefinition = {
    name: "worker",
    description: "Does work",
    tools: ["read"],
    subagentAgents: [],
    skills: ["test-skill"],
    systemPrompt: "You are Worker.",
    sourcePath: "/agents/worker.md",
  };

  let writtenPrompt = "";
  const mockRuntime = {
    ...createSubagentRuntimeDeps(),
    writeFile: (path: string, content: string) => {
      writtenPrompt = content;
      writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
    },
    spawnChild: createMockSpawnChild({ exitCode: 0, stdout: "" }),
  };

  // Execute with the skill-bearing agent
  // (Exact call depends on how the test file sets up discovery/paths)
  // The key assertion is:
  expect(writtenPrompt).toContain("# Preloaded Skill: test-skill");
  expect(writtenPrompt).toContain("Do TDD.");
  expect(writtenPrompt).toContain("You are Worker.");

  rmSync(cwd, { recursive: true, force: true });
});
```

Note: The exact test shape depends on the existing mock patterns in `tests/subagent.test.ts`. Adapt the mock spawn/runtime setup to match what's already there. The critical assertion is that `writtenPrompt` contains both the base system prompt AND the skill injection.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/subagent.test.ts
git commit -m "test: verify skill injection into subagent system prompt

Integration test confirms that when an agent has skills: ['test-skill'],
the written prompt file contains both the base system prompt and the
injected skill content as a markdown section.

Generated with [Devin](https://cli.devin.ai/docs)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full check suite**

Run: `pnpm check`
Expected: lint, typecheck, and all tests PASS.

- [ ] **Step 2: Verify bundled agent files parse correctly**

Run: `pnpm test -- tests/agents.test.ts -t "bundled default agent files exist"`
Expected: PASS — confirms all 5 agent files parse without diagnostics.

- [ ] **Step 3: Review git log**

Run: `git log --oneline -10`
Expected: Clean commit history showing the incremental feature work.
