# Phase 3: Extract Frontmatter Parsing into `agent-format.ts`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all format concerns (frontmatter extraction, YAML-like field parsing, string-array normalization, field validation, markdown serialization) out of `agents.ts` into a dedicated pure module `agent-format.ts`. This makes `agents.ts` a thin orchestrator for domain operations and lets format logic be tested without filesystem fixtures.

**Architecture:** `agent-format.ts` is a pure module — string in, structured data out (or error). No `fs` imports, no side effects. `agents.ts` imports and delegates to it for parsing and serialization, retaining all file I/O and domain logic (discovery, merge, create, export, disable).

**Tech Stack:** TypeScript, vitest. No new dependencies.

---

## File Map

| File                         | Action             | Responsibility                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/agent-format.ts`   | **Create**         | Owns `parseAgentContent`, `serializeAgent`, and all internal helpers: `parseFrontmatter`, `parseStringArray`, `uniqueStrings`, `normalizeOptionalString`, `normalizeAgentModel`, `serializeStringList`                                                                                                                                                                      |
| `src/core/agents.ts`         | **Slim**           | Retains `discoverAgents`, `discoverToolNames`, `createAgentFile`, `exportAgentToUserScope`, `disableAgentInUserScope`, `deleteUserAgentOverride`, and private helpers: `normalizeNameForComparison`, `ensureUserAgentsDir`, `fileSlugForAgent`, `findAgentDefinition`, `discoverAgentsFromDirectory`. Imports `parseAgentContent` + `serializeAgent` from `agent-format.ts` |
| `src/tui/agents-menu.ts`     | **Update import**  | Changes `parseAgentFile` import from `../core/agents.js` to `../core/agent-format.js`                                                                                                                                                                                                                                                                                       |
| `tests/agent-format.test.ts` | **Create**         | Exhaustive unit tests for the format module in isolation                                                                                                                                                                                                                                                                                                                    |
| `tests/agents.test.ts`       | **Update imports** | Adds import of `parseAgentContent` from `agent-format.js`; updates tests that call `parseAgentFile` to use the new name. Tests that exercise discovery/create/export/disable remain here                                                                                                                                                                                    |

---

### Task 1: Create `src/core/agent-format.ts`

Extract format concerns into a new pure module with a clean public interface.

**Public exports:**

```typescript
// src/core/agent-format.ts

import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryDiagnostic,
} from "../shared/types.js";

type ParseResult =
  | { ok: true; agent: AgentDefinition }
  | { ok: false; diagnostic: AgentDiscoveryDiagnostic };

export function parseAgentContent(
  filePath: string,
  content: string,
): ParseResult;
export function serializeAgent(input: AgentCreationInput): string;
```

**Steps:**

- [ ] Create `src/core/agent-format.ts` with the module header and type import from `../shared/types.js`
- [ ] Move `parseFrontmatter(content)` (lines 106-174 of `agents.ts`) into the new file as a private function
- [ ] Move `parseStringArray(value, fieldName)` (lines 28-104) into the new file as a private function
- [ ] Move `uniqueStrings(values)` (line 176-178), `normalizeOptionalString(value)` (lines 180-184), `normalizeAgentModel(value)` (lines 187-198), and `serializeStringList(fieldName, values)` (lines 456-459) as private helpers
- [ ] Move the body of `parseAgentFile` (lines 230-386) into the new file, renamed to `parseAgentContent`, with the same signature and return type: `{ ok: true; agent: AgentDefinition } | { ok: false; diagnostic: AgentDiscoveryDiagnostic }`
- [ ] Move `createAgentMarkdown(input)` (lines 462-503) into the new file, renamed to `serializeAgent`, with the same signature `(input: AgentCreationInput): string`
- [ ] Export both `parseAgentContent` and `serializeAgent` as named exports
- [ ] Verify the new file has zero `node:fs` imports and zero side effects
- [ ] Run `pnpm typecheck` — expect errors in `agents.ts` (missing references to moved functions) but `agent-format.ts` itself must compile cleanly

---

### Task 2: Slim `agents.ts` to use `agent-format`

Wire `agents.ts` to delegate format work to the new module while keeping its public export surface stable.

**Steps:**

- [ ] Add `import { parseAgentContent, serializeAgent } from "./agent-format.js";` at the top of `agents.ts`
- [ ] Remove the moved functions from `agents.ts`: `parseFrontmatter`, `parseStringArray`, `uniqueStrings`, `normalizeOptionalString`, `normalizeAgentModel`, `serializeStringList`, the body of `parseAgentFile`, and `createAgentMarkdown`
- [ ] Keep a thin re-export wrapper so existing callers don't break during the transition:
  ```typescript
  /** @deprecated Use parseAgentContent from agent-format.ts directly */
  export const parseAgentFile = parseAgentContent;
  /** @deprecated Use serializeAgent from agent-format.ts directly */
  export const createAgentMarkdown = serializeAgent;
  ```
- [ ] Update internal call sites within `agents.ts`:
  - `discoverAgentsFromDirectory` (line 401): already calls `parseAgentFile` — works via the re-export alias
  - `exportAgentToUserScope` (line 517): replace `createAgentMarkdown(...)` with `serializeAgent(...)`
  - `createAgentFile` (line 648): replace `createAgentMarkdown(...)` with `serializeAgent(...)`
  - `disableAgentInUserScope` remains unchanged (it builds markdown inline, not via `createAgentMarkdown`)
- [ ] Remove `normalizeOptionalString` usage in `createAgentFile` — import it from `agent-format.ts` instead (add to the export list of `agent-format.ts` as it's also used in domain validation). Alternatively, keep a local copy in `agents.ts` if it's only used for creation-time validation that's separate from format normalization.
  - Decision: export `normalizeOptionalString` from `agent-format.ts` since it's a string normalization concern
- [ ] Update `src/tui/agents-menu.ts`: change the import of `parseAgentFile` from `../core/agents.js` to:
  ```typescript
  import { parseAgentContent as parseAgentFile } from "../core/agent-format.js";
  ```
  (Keep the local alias to minimize churn in the file's usage sites)
- [ ] Verify `agents.ts` no longer contains any YAML parsing, frontmatter extraction, or markdown serialization logic — only domain orchestration and file I/O
- [ ] Run `pnpm typecheck` — must pass with zero errors
- [ ] Run `pnpm test` — all existing tests in `tests/agents.test.ts` must pass unchanged (the re-export aliases guarantee backward compat)

---

### Task 3: Add exhaustive format tests

Create a focused test file for `agent-format.ts` that exercises parsing and serialization in isolation — no temp directories, no filesystem.

**Steps:**

- [ ] Create `tests/agent-format.test.ts`
- [ ] Import `parseAgentContent` and `serializeAgent` from `../src/core/agent-format.js`
- [ ] Add `describe("parseAgentContent")` with the following test cases:
  - [ ] Parses minimal valid agent (name, description, tools, body)
  - [ ] Infers agent name from filePath stem when frontmatter `name` is absent
  - [ ] Parses tools as comma-separated string: `tools: bash, read`
  - [ ] Parses tools as JSON array: `tools: ["bash", "read"]`
  - [ ] Parses tools as YAML-style list (indented `- item` lines)
  - [ ] Parses `subagent_agents` field
  - [ ] Parses `timeout_ms` as positive number
  - [ ] Parses `model` field, normalizes "default" to undefined
  - [ ] Parses `thinking` field
  - [ ] Parses `enabled: true`, `enabled: false`, `disabled: true` (legacy)
  - [ ] Parses `skills: none` → `false`, `skills: all` → `true`, `skills: a, b` → `["a", "b"]`
  - [ ] Returns error for missing frontmatter delimiter
  - [ ] Returns error for missing closing frontmatter delimiter
  - [ ] Returns error for malformed frontmatter line (no colon)
  - [ ] Returns error for missing description
  - [ ] Returns error for empty name with no filename fallback (edge: filePath is `/tmp/.md`)
  - [ ] Returns error for non-string array in tools (`tools: [1, 2]`)
  - [ ] Returns error for `timeout_ms: 0` and `timeout_ms: -1` and `timeout_ms: NaN`
  - [ ] Handles unicode in description and body
  - [ ] Handles CRLF line endings (normalized to LF)
  - [ ] Handles empty body (trailing newline only after closing `---`)
- [ ] Add `describe("serializeAgent")` with the following test cases:
  - [ ] Serializes full input with all fields populated
  - [ ] Omits `name` field when input.name is undefined
  - [ ] Omits `model` when undefined or "default"
  - [ ] Omits `thinking` when undefined
  - [ ] Omits `subagent_agents` when array is empty
  - [ ] Omits `timeout_ms` when undefined
  - [ ] Serializes `skills: none` for `false`, `skills: all` for `true`, comma-separated for array
  - [ ] Omits `skills` when undefined
  - [ ] Deduplicates and trims tool names
  - [ ] Deduplicates subagent_agents
  - [ ] Trims and normalizes systemPrompt (strips CRLF, trailing whitespace)
- [ ] Add `describe("round-trip")` with the following test cases:
  - [ ] `parseAgentContent(path, serializeAgent(input))` yields the same semantic definition for a fully-populated input
  - [ ] Round-trip preserves `skills: false` / `skills: true` / `skills: [...]`
  - [ ] Round-trip preserves optional fields when present vs absent
- [ ] Run `pnpm test -- tests/agent-format.test.ts` — all tests must pass
- [ ] Run `pnpm test` — full suite must pass (existing tests unaffected)
- [ ] Run `pnpm typecheck` — must pass

---

## Verification Checklist

After all three tasks are complete:

- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run test` passes (both `tests/agents.test.ts` and `tests/agent-format.test.ts`)
- [ ] `pnpm run lint` passes (biome)
- [ ] `src/core/agent-format.ts` has zero `node:fs` imports
- [ ] `src/core/agents.ts` contains no frontmatter parsing, YAML field extraction, or markdown serialization logic
- [ ] Public exports from `agents.ts` (`parseAgentFile`, `createAgentMarkdown`) still exist as re-export aliases for backward compatibility
- [ ] `src/index.ts` requires no changes (consumes `agents.ts` public surface which is stable)
- [ ] No new runtime dependencies introduced
