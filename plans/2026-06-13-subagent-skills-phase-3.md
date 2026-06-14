# Phase 3: Skill Injection at Spawn Time

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the skill-loader into `executeSubagent` so that resolved skill content is appended to the system prompt file before spawning the child process. This makes the feature live.

**Architecture:** A `buildSkillSuffix` helper in `subagent.ts` reads the agent's `skills` config, calls into `skill-loader.ts` to resolve content, and returns a markdown string appended to the prompt. The prompt file is written with the combined content.

**Tech Stack:** TypeScript, vitest.

**Prerequisite:** Phase 2 (skills field + skill-loader module) must be merged first.

---

## File Map

| File                     | Action | Responsibility                                        |
| ------------------------ | ------ | ----------------------------------------------------- |
| `src/core/subagent.ts`   | Modify | Add `buildSkillSuffix`, inject into prompt file write |
| `tests/subagent.test.ts` | Modify | Integration test for skill injection                  |

---

### Task 1: Add `buildSkillSuffix` and wire into prompt write

**Files:**

- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Add import for skill-loader**

At the top of `src/core/subagent.ts`, add with the other local imports:

```typescript
import { discoverAvailableSkills, preloadSkills } from "./skill-loader.js";
```

- [ ] **Step 2: Add `buildSkillSuffix` helper**

Add after the imports, before any existing constants or functions:

```typescript
function buildSkillSuffix(
  skills: AgentDefinition["skills"],
  cwd: string,
): string {
  if (skills === false) return "";

  let skillNames: string[];
  if (Array.isArray(skills)) {
    skillNames = skills;
  } else {
    // undefined or true = discover all available
    skillNames = discoverAvailableSkills(cwd);
  }

  if (skillNames.length === 0) return "";

  const loaded = preloadSkills(skillNames, cwd);
  const sections = loaded
    .filter((s) => !s.content.startsWith("(Skill"))
    .map((s) => `\n# Preloaded Skill: ${s.name}\n\n${s.content}`);

  return sections.length > 0 ? `\n${sections.join("\n")}` : "";
}
```

- [ ] **Step 3: Replace the prompt file write block**

In `src/core/subagent.ts`, find the block around line 902-909:

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
const skillSuffix = buildSkillSuffix(resolvedAgent.skills, effectiveCwd);
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

- [ ] **Step 5: Run existing tests**

Run: `pnpm test -- tests/subagent.test.ts`
Expected: All existing tests PASS (they don't set `skills` so `buildSkillSuffix` returns `""` for all).

- [ ] **Step 6: Commit**

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
```

---

### Task 2: Integration test for skill injection

**Files:**

- Modify: `tests/subagent.test.ts`

This test verifies that when an agent has `skills: ["test-skill"]`, the prompt file written by `executeSubagent` contains the skill content. The test creates a temp directory with a skill file, then runs `executeSubagent` with a mock runtime that captures the written prompt.

- [ ] **Step 1: Read the existing test patterns**

Read `tests/subagent.test.ts` to identify:

1. How `SubagentRuntimeDeps` is mocked (look for `createSubagentRuntimeDeps` or the runtime override pattern)
2. How `executeSubagent` is called (what arguments it needs)
3. How `writeFile` is intercepted to check prompt content

The test needs to match the exact patterns already used in this file.

- [ ] **Step 2: Add the integration test**

Add a new test in the appropriate describe block. The exact shape depends on the mocking pattern found in Step 1, but the structure is:

```typescript
test("injects preloaded skills into the system prompt file", async () => {
  // 1. Create temp dir with a skill file
  const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-skills-"));
  const skillsDir = join(cwd, ".pi", "skills");
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, "test-skill.md"), "# Test Skill\nDo TDD.");

  // 2. Create an agent with skills: ["test-skill"]
  // (Use the resolved agent format from the test file)

  // 3. Execute with a mock runtime that captures writeFile calls
  let writtenPrompt = "";
  // Override writeFile to capture the prompt content

  // 4. Assert the prompt contains both base + skill
  expect(writtenPrompt).toContain("You are Worker.");
  expect(writtenPrompt).toContain("# Preloaded Skill: test-skill");
  expect(writtenPrompt).toContain("Do TDD.");

  // 5. Cleanup
  rmSync(cwd, { recursive: true, force: true });
});
```

Adapt imports (`mkdtempSync`, `mkdirSync`, `writeFileSync`, `rmSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`) — check if they're already imported in the test file.

- [ ] **Step 3: Add test for `skills: false` suppressing injection**

```typescript
test("skills: false suppresses skill injection", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-no-skills-"));
  const skillsDir = join(cwd, ".pi", "skills");
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(
    join(skillsDir, "unwanted.md"),
    "# Unwanted\nShould not appear.",
  );

  // Create agent with skills: false
  // Execute with mock runtime

  // Assert prompt does NOT contain skill content
  expect(writtenPrompt).toContain("You are Worker.");
  expect(writtenPrompt).not.toContain("Preloaded Skill");
  expect(writtenPrompt).not.toContain("Unwanted");

  rmSync(cwd, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/subagent.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/subagent.test.ts
git commit -m "test: verify skill injection and suppression in subagent prompts

Integration tests confirm:
- Agent with skills: ['test-skill'] gets skill content in prompt file
- Agent with skills: false gets no skill injection
```

---

### Task 3: Final verification

- [ ] **Step 1: Run full check suite**

Run: `pnpm check`
Expected: lint, typecheck, and all tests PASS.

- [ ] **Step 2: Manual smoke test**

Create a test skill file and verify it appears in a subagent's prompt:

```bash
mkdir -p .pi/skills
echo "# Test Skill\nAlways use TDD." > .pi/skills/test-tdd.md
```

Then run a subagent (e.g. via the `/agents` command) and verify the system prompt file in `/tmp/pi-subagents-*/` contains the skill content. Clean up:

```bash
rm -rf .pi/skills/test-tdd.md
```

- [ ] **Step 3: Review git log**

Run: `git log --oneline -5`
Expected: Clean commits for this phase.
