# Subagent Skills — Implementation Overview

**Goal:** Add a `skills` field to agent definitions that preloads named skills into agent system prompts at spawn time, with inheritance from parent when unspecified.

**Split into 3 independently-mergeable phases:**

| Phase | Plan                                                                       | Deliverable                                                                                                   |
| ----- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1     | [phase-1-enabled-refactor](./2026-06-13-subagent-skills-phase-1.md)        | Rename `disabled` → `enabled` with backward compat. Pure refactor, no new behavior.                           |
| 2     | [phase-2-skills-field-and-loader](./2026-06-13-subagent-skills-phase-2.md) | Add `skills` field to types/parser + create `skill-loader.ts` module. Feature is dark (not wired to runtime). |
| 3     | [phase-3-skill-injection](./2026-06-13-subagent-skills-phase-3.md)         | Wire skill injection into `executeSubagent`. Feature goes live.                                               |

Each phase passes `pnpm check` on its own and can be merged independently.

## Dependency Order

```
Phase 1 → Phase 2 → Phase 3
```

Phase 2 depends on the `enabled` field existing. Phase 3 depends on the skill-loader module and `skills` field existing.
