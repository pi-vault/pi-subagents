# Skill Injection via CLI Flags

**Date:** 2026-06-14
**Status:** Approved
**Scope:** Refactor skill injection to use host `--skill <path>` flags instead of prompt file appending

## Problem

The current implementation appends skill content directly to the system prompt file via `buildSkillSuffix`. This has two issues:

1. The host pi process has its own independent skill discovery that loads skills into the child's context regardless of pi-subagents' `skills` field. Setting `skills: false` didn't actually suppress skills until we added `--no-skills`.
2. We're reimplementing skill loading (reading content, formatting as markdown sections) when the host already has a native mechanism for this (`--skill <path>`).

## Solution

Use `--no-skills` + `--skill <path>` CLI flags to delegate skill loading to the host while maintaining full control over which skills are provided.

- pi-subagents becomes a skill **selector** (resolves which skills an agent should have)
- The host becomes the skill **loader** (reads content, formats, injects into context)

## Architecture

### skill-loader.ts

Add path-resolution exports alongside the existing content-loading ones:

```typescript
export interface ResolvedSkill {
  name: string;
  path: string; // absolute path — file for flat skills, directory for SKILL.md skills
}

export function resolveSkillPaths(names: string[], cwd: string): ResolvedSkill[];
export function discoverAvailableSkillPaths(cwd: string): ResolvedSkill[];
```

- `resolveSkillPaths` — given explicit skill names, resolves each to a filesystem path. Silently omits skills that cannot be found (unsafe names, missing files). Uses the same search order as `preloadSkills`.
- `discoverAvailableSkillPaths` — discovers all available skills and returns their paths. Uses the same search roots as `discoverAvailableSkills`.

**Path semantics:**
- Flat file skill (`skills/tdd.md`) → path is the `.md` file
- Directory skill (`skills/tdd/SKILL.md`) → path is the directory (`skills/tdd`), because `pi --skill` accepts directories

### subagent.ts

**Remove:**
- `buildSkillSuffix` function
- Skill content append logic in `executeSubagent` (revert prompt file write to only contain `resolvedAgent.systemPrompt`)
- Import of `preloadSkills` (no longer needed here)

**Modify `buildChildArgs`:**
- Always pass `--no-skills` to suppress host autodiscovery
- Based on `agent.skills`:
  - `false` → no `--skill` flags
  - `string[]` → call `resolveSkillPaths(skills, cwd)`, pass `--skill <path>` for each result
  - `undefined` / `true` → call `discoverAvailableSkillPaths(cwd)`, pass `--skill <path>` for each result

**Signature change for `buildChildArgs`:**
```typescript
function buildChildArgs(
  agent: AgentDefinition,
  promptPath: string | undefined,
  childSessionPath: string,
  recursionEnabled: boolean,
  effectiveModel: string | undefined,
  cwd: string,  // NEW — needed for skill path resolution
): string[]
```

### Prompt file write (in executeSubagent)

Revert to original behavior — write only `resolvedAgent.systemPrompt.trim()`:

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

## Behavior Matrix

| `skills` value | `--no-skills` | `--skill` flags | Prompt file |
|---|---|---|---|
| `false` | Yes | None | Base systemPrompt only |
| `["tdd", "debugging"]` | Yes | `--skill /path/to/tdd --skill /path/to/debugging` | Base systemPrompt only |
| `undefined` / `true` | Yes | `--skill <path>` for each discovered skill | Base systemPrompt only |

## Testing

- Update existing skill injection test: assert spawn args contain `--no-skills` and `--skill <resolved-path>` for agent with `skills: ["test-skill"]`
- Update existing suppression test: assert spawn args contain `--no-skills` and NO `--skill` flags for agent with `skills: false`
- Add test: agent with `skills: undefined` discovers and passes `--skill` flags for available skills
- Add unit tests for `resolveSkillPaths` and `discoverAvailableSkillPaths` in skill-loader.test.ts
- Verify prompt file contains only base systemPrompt (no skill content appended)

## Migration

- `preloadSkills` and `discoverAvailableSkills` remain exported (they may be used elsewhere or by tests). No breaking API changes to skill-loader.
- The `PreloadedSkill` interface remains for backward compatibility.

## Files Changed

| File | Action |
|---|---|
| `src/core/skill-loader.ts` | Add `ResolvedSkill`, `resolveSkillPaths`, `discoverAvailableSkillPaths` |
| `src/core/subagent.ts` | Remove `buildSkillSuffix`, modify `buildChildArgs` + prompt write |
| `tests/subagent.test.ts` | Update skill injection/suppression tests |
| `tests/skill-loader.test.ts` | Add tests for new path-resolution functions |
