# Phase 2: Model Scope Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that resolved agent models are within allowed scope before spawning, preventing unauthorized model use and enforcing organizational policies.

**Architecture:** A pure module `src/core/model-scope.ts` with no side effects. Called in `subagent.ts` after `resolveModel()` succeeds, before `manager.spawn()`. Reads allowlists from `subagents.json` settings only (our own `modelScope.allow` patterns). Does NOT depend on pi's `SettingsManager` (which is not available to extensions).

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md` (Phase 2 section)

**Reference:** Aligned with nicobailon-pi-subagents `src/runs/shared/model-scope.ts` approach (pure allowlist, no external settings dependency).

---

## Design Decisions

1. **Self-contained allowlist only** — `modelScope.allow` patterns in our own `subagents.json`. We do NOT read pi's `enabledModels` because `ctx.settingsManager` is not available to extensions, and reading pi's settings files directly adds fragile coupling. Users who want pi's enabled models as the allowlist can duplicate them in `modelScope.allow`.

2. **Source determination** — Explicit vs inherited is based on which layer of `resolveInvocationConfig` the model came from:
   - If `agentDef.model` is set → it won (priority 1) → `"inherited"` (human-authored frontmatter)
   - Else if `params.model` is set → it won (priority 2) → `"explicit"` (LLM runtime choice)
   - Else → defaults or undefined → `"inherited"`

3. **Resolved model ID** — Scope check uses the canonicalized `provider/id` from the model registry when available, falling back to `resolved.model` as-is when no registry exists.

4. **Chain mode coverage** — Scope check applies both to single-agent and chain execution paths. Chain step model overrides from tool params are treated as `"explicit"` (LLM-generated chain definitions).

---

## File Map

| File                        | Action | Responsibility                                              |
| --------------------------- | ------ | ----------------------------------------------------------- |
| `src/core/model-scope.ts`   | Create | `matchesPattern`, `checkModelScope`, `parseModelScopeConfig` |
| `tests/model-scope.test.ts` | Create | Unit tests for all functions                                |
| `src/core/settings.ts`      | Modify | Add `modelScope` to `SubagentsSettings` schema              |
| `src/core/subagent.ts`      | Modify | Call `checkModelScope` in single-agent and chain paths      |

---

### Task 1: Write failing tests for `matchesPattern`

**Files:**

- Create: `tests/model-scope.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { matchesPattern } from "../src/core/model-scope.js";

describe("matchesPattern", () => {
  it("matches exact string (case-insensitive)", () => {
    expect(
      matchesPattern(
        "anthropic/claude-sonnet-4-20250514",
        "anthropic/claude-sonnet-4-20250514",
      ),
    ).toBe(true);
    expect(
      matchesPattern(
        "Anthropic/Claude-Sonnet-4-20250514",
        "anthropic/claude-sonnet-4-20250514",
      ),
    ).toBe(true);
  });

  it("matches wildcard at end", () => {
    expect(
      matchesPattern("anthropic/claude-sonnet-4-20250514", "anthropic/*"),
    ).toBe(true);
    expect(
      matchesPattern("anthropic/claude-opus-4-20250514", "anthropic/*"),
    ).toBe(true);
    expect(matchesPattern("openai/gpt-5-turbo", "anthropic/*")).toBe(false);
  });

  it("matches wildcard at start", () => {
    expect(
      matchesPattern("anthropic/claude-sonnet-4-20250514", "*sonnet*"),
    ).toBe(true);
  });

  it("matches wildcard in middle", () => {
    expect(matchesPattern("openai/gpt-5-turbo", "openai/gpt-5-*")).toBe(true);
    expect(matchesPattern("openai/gpt-4o", "openai/gpt-5-*")).toBe(false);
  });

  it("handles multiple wildcards", () => {
    expect(
      matchesPattern("anthropic/claude-sonnet-4-20250514", "*claude*sonnet*"),
    ).toBe(true);
  });

  it("empty pattern matches nothing", () => {
    expect(matchesPattern("anthropic/anything", "")).toBe(false);
  });

  it("* alone matches everything", () => {
    expect(matchesPattern("anything/at-all", "*")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: FAIL — module `../src/core/model-scope.js` does not exist

- [ ] **Step 3: Implement `matchesPattern`**

Create `src/core/model-scope.ts`:

```typescript
/**
 * Glob pattern matching where only * is special (matches any sequence of chars).
 * Case-insensitive comparison.
 */
export function matchesPattern(model: string, pattern: string): boolean {
  if (!pattern) return false;
  const m = model.toLowerCase();
  const p = pattern.toLowerCase();

  // Convert glob pattern to regex: escape regex chars, replace * with .*
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(m);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/model-scope.ts tests/model-scope.test.ts
git commit -m "feat(model-scope): add matchesPattern glob matcher"
```

---

### Task 2: Add types and `parseModelScopeConfig`

**Files:**

- Modify: `src/core/model-scope.ts`
- Modify: `tests/model-scope.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/model-scope.test.ts`:

```typescript
import { parseModelScopeConfig } from "../src/core/model-scope.js";

describe("parseModelScopeConfig", () => {
  it("parses valid config", () => {
    const result = parseModelScopeConfig({
      enforce: true,
      allow: ["anthropic/*", "openai/gpt-5-*"],
    });
    expect(result).toEqual({
      enforce: true,
      allow: ["anthropic/*", "openai/gpt-5-*"],
    });
  });

  it("returns undefined for null/undefined", () => {
    expect(parseModelScopeConfig(null)).toBeUndefined();
    expect(parseModelScopeConfig(undefined)).toBeUndefined();
  });

  it("returns undefined for non-object", () => {
    expect(parseModelScopeConfig("string")).toBeUndefined();
    expect(parseModelScopeConfig(42)).toBeUndefined();
  });

  it("returns undefined when enforce is not boolean", () => {
    expect(
      parseModelScopeConfig({ enforce: "yes", allow: [] }),
    ).toBeUndefined();
  });

  it("returns undefined when allow is not array", () => {
    expect(
      parseModelScopeConfig({ enforce: true, allow: "anthropic/*" }),
    ).toBeUndefined();
  });

  it("filters non-string entries from allow", () => {
    const result = parseModelScopeConfig({
      enforce: true,
      allow: ["anthropic/*", 42, null, "openai/*"],
    });
    expect(result).toEqual({
      enforce: true,
      allow: ["anthropic/*", "openai/*"],
    });
  });

  it("defaults enforce to false when missing", () => {
    const result = parseModelScopeConfig({ allow: ["anthropic/*"] });
    expect(result).toEqual({ enforce: false, allow: ["anthropic/*"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: FAIL — `parseModelScopeConfig` not exported

- [ ] **Step 3: Implement types and parser**

Add to `src/core/model-scope.ts`:

```typescript
export interface ModelScopeConfig {
  enforce: boolean;
  allow: string[];
}

export type ModelSource = "explicit" | "inherited";

export interface ModelScopeViolation {
  model: string;
  severity: "error" | "warn";
  allowedPatterns: string[];
  message: string;
}

/**
 * Parse modelScope from settings JSON. Returns undefined if invalid.
 */
export function parseModelScopeConfig(
  raw: unknown,
): ModelScopeConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  // enforce: must be boolean if present, defaults to false
  if (r.enforce !== undefined && typeof r.enforce !== "boolean")
    return undefined;
  const enforce = typeof r.enforce === "boolean" ? r.enforce : false;

  // allow: must be array if present
  if (r.allow !== undefined && !Array.isArray(r.allow)) return undefined;
  const allowRaw = Array.isArray(r.allow) ? r.allow : [];
  const allow = allowRaw.filter(
    (item): item is string => typeof item === "string",
  );

  return { enforce, allow };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/model-scope.ts tests/model-scope.test.ts
git commit -m "feat(model-scope): add types and parseModelScopeConfig"
```

---

### Task 3: Implement `checkModelScope`

**Files:**

- Modify: `src/core/model-scope.ts`
- Modify: `tests/model-scope.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/model-scope.test.ts`:

```typescript
import { checkModelScope } from "../src/core/model-scope.js";
import type { ModelScopeConfig } from "../src/core/model-scope.js";

describe("checkModelScope", () => {
  const scope: ModelScopeConfig = {
    enforce: true,
    allow: ["anthropic/*", "openai/gpt-5-*"],
  };

  it("returns undefined (pass) when scope is undefined", () => {
    expect(checkModelScope("anything", undefined, "explicit")).toBeUndefined();
  });

  it("returns undefined (pass) when enforce is false", () => {
    const noEnforce: ModelScopeConfig = { enforce: false, allow: [] };
    expect(
      checkModelScope("anything", noEnforce, "explicit"),
    ).toBeUndefined();
  });

  it("passes when model matches allow patterns", () => {
    expect(
      checkModelScope(
        "anthropic/claude-sonnet-4-20250514",
        scope,
        "explicit",
      ),
    ).toBeUndefined();
    expect(
      checkModelScope("openai/gpt-5-turbo", scope, "explicit"),
    ).toBeUndefined();
  });

  it("returns error violation for explicit out-of-scope model", () => {
    const violation = checkModelScope(
      "google/gemini-pro",
      scope,
      "explicit",
    );
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe("error");
    expect(violation!.model).toBe("google/gemini-pro");
    expect(violation!.allowedPatterns).toEqual([
      "anthropic/*",
      "openai/gpt-5-*",
    ]);
  });

  it("returns warn violation for inherited out-of-scope model", () => {
    const violation = checkModelScope(
      "google/gemini-pro",
      scope,
      "inherited",
    );
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe("warn");
  });

  it("normalizes model: strips :thinking suffix, lowercases", () => {
    expect(
      checkModelScope(
        "Anthropic/Claude-Sonnet-4-20250514:thinking",
        scope,
        "explicit",
      ),
    ).toBeUndefined();
  });

  it("returns error when allow list is empty and enforce is true", () => {
    const emptyScope: ModelScopeConfig = { enforce: true, allow: [] };
    const violation = checkModelScope(
      "anthropic/claude-sonnet-4-20250514",
      emptyScope,
      "explicit",
    );
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: FAIL — `checkModelScope` not exported

- [ ] **Step 3: Implement `checkModelScope`**

Add to `src/core/model-scope.ts`:

```typescript
/**
 * Pure check: does model pass scope? Returns undefined if allowed,
 * or a ModelScopeViolation if blocked.
 *
 * Unlike the original design, this does NOT consult pi's enabledModels
 * (SettingsManager is not available to extensions). Scope is entirely
 * defined by our own modelScope.allow patterns.
 */
export function checkModelScope(
  model: string,
  scope: ModelScopeConfig | undefined,
  source: ModelSource,
): ModelScopeViolation | undefined {
  if (!scope || !scope.enforce) return undefined;

  // Normalize: lowercase, strip :thinking suffix
  const normalized = model.toLowerCase().replace(/:thinking$/, "");

  // Check allow patterns
  for (const pattern of scope.allow) {
    if (matchesPattern(normalized, pattern)) return undefined;
  }

  // Violation
  const severity = source === "explicit" ? "error" : "warn";
  return {
    model,
    severity,
    allowedPatterns: scope.allow,
    message: `Model "${model}" is not in the allowed scope. Allowed: ${scope.allow.join(", ") || "(none)"}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/model-scope.ts tests/model-scope.test.ts
git commit -m "feat(model-scope): add checkModelScope enforcement logic"
```

---

### Task 4: Add `modelScope` to settings schema

**Files:**

- Modify: `src/core/settings.ts`
- Modify: `tests/settings.test.ts`

- [ ] **Step 1: Add modelScope to SubagentsSettings interface and sanitize**

In `src/core/settings.ts`:

```typescript
import type { ModelScopeConfig } from "./model-scope.js";
import { parseModelScopeConfig } from "./model-scope.js";

export interface SubagentsSettings {
  maxConcurrent?: number;
  defaultJoinMode?: JoinMode;
  widgetMode?: WidgetMode;
  fleetView?: boolean;
  modelScope?: ModelScopeConfig;
}
```

Add to the `sanitize` function, after the `fleetView` check:

```typescript
if (r.modelScope !== undefined) {
  const parsed = parseModelScopeConfig(r.modelScope);
  if (parsed) out.modelScope = parsed;
}
```

- [ ] **Step 2: Add tests for modelScope in settings**

Add to `tests/settings.test.ts`:

```typescript
it("sanitize preserves valid modelScope", () => {
  writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
    modelScope: { enforce: true, allow: ["anthropic/*"] },
  }));
  const settings = loadSettings(projectDir);
  expect(settings.modelScope).toEqual({ enforce: true, allow: ["anthropic/*"] });
});

it("sanitize strips invalid modelScope", () => {
  writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
    modelScope: { enforce: "yes", allow: [] },
  }));
  const settings = loadSettings(projectDir);
  expect(settings.modelScope).toBeUndefined();
});

it("sanitize strips non-object modelScope", () => {
  writeFileSync(join(piDir, "subagents.json"), JSON.stringify({
    modelScope: "invalid",
  }));
  const settings = loadSettings(projectDir);
  expect(settings.modelScope).toBeUndefined();
});
```

- [ ] **Step 3: Run settings tests**

Run: `pnpm test -- tests/settings.test.ts`
Expected: All tests pass (existing + new)

- [ ] **Step 4: Commit**

```bash
git add src/core/settings.ts tests/settings.test.ts
git commit -m "feat(model-scope): add modelScope to subagents settings"
```

---

### Task 5: Integrate model scope check into single-agent path

**Files:**

- Modify: `src/core/subagent.ts`
- Modify: `tests/model-scope.test.ts`

- [ ] **Step 1: Add imports to subagent.ts**

Add at the top of `src/core/subagent.ts`:

```typescript
import { checkModelScope } from "./model-scope.js";
import { loadSettings } from "./settings.js";
```

- [ ] **Step 2: Add model scope check after registry validation**

In the single-agent path of `execute()`, after the existing model registry validation block (after line 458), add the scope check. The key insight: capture the resolved model ID from the registry match, and determine source based on which config layer provided the model.

Replace the existing model validation block (lines 411-458) with an expanded version that:
1. Captures the resolved `provider/id` when available
2. Adds scope enforcement after validation passes

```typescript
// Validate model string against registry (if available)
let resolvedModelId = resolved.model; // fallback: use as-is
if (resolved.model) {
  const registry = (
    ctx as {
      modelRegistry?: {
        listModels?: () => Array<{
          id: string;
          provider: string;
          name?: string;
        }>;
      };
    }
  ).modelRegistry;
  if (registry?.listModels) {
    const match = resolveModel(resolved.model, registry.listModels());
    if (!match) {
      const available = registry
        .listModels()
        .map((m) => `${m.provider}/${m.id}`)
        .join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Unknown model: "${resolved.model}". Available models: ${available}`,
          },
        ],
        isError: true,
        details: {
          status: "error" as const,
          agent: params.agent,
          task: params.task,
          sourcePath: "",
          cwd: effectiveCwd,
          maxTurns: 0,
          durationMs: 0,
          childSessionDir: "",
          childSessionPath: "",
          model: resolved.model,
          stopReason: "error",
          exitCode: null,
          stderr: `Unknown model: "${resolved.model}". Available models: ${available}`,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
          recentToolActivity: [],
        },
      };
    }
    // Capture canonical provider/id for scope checking
    resolvedModelId = `${match.provider}/${match.id}`;
  }
}

// Model scope enforcement
if (resolvedModelId) {
  const settings = loadSettings(effectiveCwd);
  if (settings.modelScope) {
    // Determine source: did the model come from tool params (LLM choice) or config?
    // resolveInvocationConfig priority: agentDef.model > params.model > defaults.model
    const source = agentDef.model
      ? "inherited" as const
      : params.model
        ? "explicit" as const
        : "inherited" as const;
    const violation = checkModelScope(resolvedModelId, settings.modelScope, source);
    if (violation && violation.severity === "error") {
      return {
        content: [{ type: "text", text: violation.message }],
        isError: true,
        details: stubDetails({
          status: "error",
          agent: agentDef.name,
          task: params.task,
          model: resolved.model,
          stopReason: "error",
          stderr: violation.message,
        }),
      };
    }
    if (violation && violation.severity === "warn") {
      pi.sendMessage({
        customType: "model_scope_warning",
        content: violation.message,
        display: true,
      });
    }
  }
}
```

Note: `pi` is available via closure from `registerSubagentTool(pi, deps)`.

- [ ] **Step 3: Write integration tests**

Add to `tests/model-scope.test.ts`:

```typescript
describe("integration: model scope source determination", () => {
  it("explicit source: model from tool params when no agent model", () => {
    // When agentDef.model is undefined and params.model is set,
    // source should be "explicit" → violation is "error"
    const violation = checkModelScope(
      "google/gemini-pro",
      { enforce: true, allow: ["anthropic/*"] },
      "explicit",
    );
    expect(violation?.severity).toBe("error");
  });

  it("inherited source: model from agent frontmatter", () => {
    // When agentDef.model is set (takes priority),
    // source should be "inherited" → violation is "warn"
    const violation = checkModelScope(
      "google/gemini-pro",
      { enforce: true, allow: ["anthropic/*"] },
      "inherited",
    );
    expect(violation?.severity).toBe("warn");
  });

  it("no violation when model matches scope", () => {
    expect(
      checkModelScope(
        "anthropic/claude-sonnet-4-20250514",
        { enforce: true, allow: ["anthropic/*"] },
        "explicit",
      ),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/subagent.ts tests/model-scope.test.ts
git commit -m "feat(model-scope): enforce model scope in single-agent path"
```

---

### Task 6: Integrate model scope check into chain execution path

**Files:**

- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Add scope check in chain's spawnAndWait closure**

In `subagent.ts`, the chain mode `spawnAndWait` closure (around lines 277-293) needs a scope check before calling `deps.manager.spawnAndWait`. The model in chain steps comes from `options?.model` (step-level override) or `agentDef.model` (agent frontmatter).

Modify the `spawnAndWait` closure inside the chain mode block:

```typescript
const spawnAndWait = async (
  agentDef: AgentDefinition,
  prompt: string,
  stepCwd: string,
  options?: import("./chain-execution.js").StepSpawnOptions,
) => {
  let effectiveAgentDef = options?.skills
    ? { ...agentDef, skills: options.skills }
    : agentDef;
  if (options?.model) effectiveAgentDef = { ...effectiveAgentDef, model: options.model };

  // Model scope enforcement for chain steps
  const stepModel = options?.model ?? agentDef.model;
  if (stepModel) {
    const settings = loadSettings(effectiveCwd);
    if (settings.modelScope) {
      // Chain step model overrides from tool params are LLM-generated → "explicit"
      // Agent frontmatter models are human-configured → "inherited"
      const source = options?.model ? "explicit" as const : "inherited" as const;
      const violation = checkModelScope(stepModel, settings.modelScope, source);
      if (violation && violation.severity === "error") {
        throw new Error(violation.message);
      }
      if (violation && violation.severity === "warn") {
        pi.sendMessage({
          customType: "model_scope_warning",
          content: `[chain step] ${violation.message}`,
          display: true,
        });
      }
    }
  }

  return deps.manager.spawnAndWait(ctx, effectiveAgentDef, {
    prompt,
    cwd: stepCwd || effectiveCwd,
    maxTurns: loadedConfig.config.defaultMaxTurns,
    toolBudget: options?.toolBudget,
    isolation: options?.isolation,
  });
};
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/core/subagent.ts
git commit -m "feat(model-scope): enforce model scope in chain execution path"
```

---

### Task 7: Typecheck, lint, and final verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint and format**

Run: `pnpm lint`
Expected: No errors (fix any issues)

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: fix lint/type issues from model-scope integration"
```

---

## Differences from Original Plan

| Aspect | Original | Revised | Reason |
|--------|----------|---------|--------|
| Pi enabledModels | `readPiEnabledModels` via `settingsManager` | Removed entirely | `ctx.settingsManager` not available to extensions |
| `checkModelScope` signature | 4 params (model, scope, piModels, source) | 3 params (model, scope, source) | No piModels needed |
| Source determination | `params.model ? "explicit" : "inherited"` | Checks `agentDef.model` first | `resolveInvocationConfig` priority: frontmatter > params |
| Resolved model ID | Assumed `resolvedModelId` exists | Captured from registry match | Variable didn't exist; now explicitly created |
| Chain enforcement | Not addressed | Task 6 adds scope check in chain path | Gap in original plan |
| `src/shared/types.ts` | Listed in file map but never modified | Removed from file map | Types live in `model-scope.ts` |
| Task count | 7 tasks | 7 tasks | Reorganized: Task 4 removed (readPiEnabledModels), replaced with chain integration |
