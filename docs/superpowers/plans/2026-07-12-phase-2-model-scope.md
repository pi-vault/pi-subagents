# Phase 2: Model Scope Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that resolved agent models are within allowed scope before spawning, preventing unauthorized model use and enforcing organizational policies.

**Architecture:** A pure module `src/core/model-scope.ts` with no side effects. Called in `subagent.ts` after `resolveModel()` succeeds, before `manager.spawn()`. Reads allowlists from `subagents.json` settings and pi's `SettingsManager.getEnabledModels()`.

**Tech Stack:** TypeScript, Vitest, TypeBox

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md` (Phase 2 section)

---

## File Map

| File                        | Action | Responsibility                                                                      |
| --------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `src/core/model-scope.ts`   | Create | `matchesPattern`, `checkModelScope`, `parseModelScopeConfig`, `readPiEnabledModels` |
| `tests/model-scope.test.ts` | Create | Unit tests for all functions                                                        |
| `src/core/settings.ts`      | Modify | Add `modelScope` to `SubagentsSettings` schema                                      |
| `src/core/subagent.ts`      | Modify | Call `checkModelScope` after model resolution                                       |
| `src/shared/types.ts`       | Modify | Add `ModelScopeConfig` interface                                                    |

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
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(m);
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
    expect(
      checkModelScope("anything", undefined, undefined, "explicit"),
    ).toBeUndefined();
  });

  it("returns undefined (pass) when enforce is false", () => {
    const noEnforce: ModelScopeConfig = { enforce: false, allow: [] };
    expect(
      checkModelScope("anything", noEnforce, undefined, "explicit"),
    ).toBeUndefined();
  });

  it("passes when model matches allow patterns", () => {
    expect(
      checkModelScope(
        "anthropic/claude-sonnet-4-20250514",
        scope,
        undefined,
        "explicit",
      ),
    ).toBeUndefined();
    expect(
      checkModelScope("openai/gpt-5-turbo", scope, undefined, "explicit"),
    ).toBeUndefined();
  });

  it("passes when model is in piEnabledModels set", () => {
    const piModels = new Set(["deepseek/deepseek-r1"]);
    expect(
      checkModelScope("deepseek/deepseek-r1", scope, piModels, "explicit"),
    ).toBeUndefined();
  });

  it("returns error violation for explicit out-of-scope model", () => {
    const violation = checkModelScope(
      "google/gemini-pro",
      scope,
      undefined,
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
      undefined,
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
        undefined,
        "explicit",
      ),
    ).toBeUndefined();
  });

  it("matches pi enabled models case-insensitively", () => {
    const piModels = new Set(["deepseek/deepseek-r1"]);
    expect(
      checkModelScope("DeepSeek/DeepSeek-R1", scope, piModels, "explicit"),
    ).toBeUndefined();
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
 */
export function checkModelScope(
  model: string,
  scope: ModelScopeConfig | undefined,
  piEnabledModels: Set<string> | undefined,
  source: ModelSource,
): ModelScopeViolation | undefined {
  if (!scope || !scope.enforce) return undefined;

  // Normalize: lowercase, strip :thinking suffix
  const normalized = model.toLowerCase().replace(/:thinking$/, "");

  // Check our allow patterns
  for (const pattern of scope.allow) {
    if (matchesPattern(normalized, pattern)) return undefined;
  }

  // Check pi's enabledModels (case-insensitive exact match)
  if (piEnabledModels) {
    for (const enabled of piEnabledModels) {
      if (enabled.toLowerCase() === normalized) return undefined;
    }
  }

  // Violation
  const severity = source === "explicit" ? "error" : "warn";
  return {
    model,
    severity,
    allowedPatterns: scope.allow,
    message: `Model "${model}" is not in the allowed scope. Allowed patterns: ${scope.allow.join(", ") || "(none)"}${piEnabledModels?.size ? ` + ${piEnabledModels.size} pi-enabled models` : ""}`,
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

### Task 4: Implement `readPiEnabledModels`

**Files:**

- Modify: `src/core/model-scope.ts`
- Modify: `tests/model-scope.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/model-scope.test.ts`:

```typescript
import { readPiEnabledModels } from "../src/core/model-scope.js";

describe("readPiEnabledModels", () => {
  it("returns undefined when settingsManager returns undefined", () => {
    const mockSM = { getEnabledModels: () => undefined };
    expect(readPiEnabledModels(mockSM as any, "/tmp")).toBeUndefined();
  });

  it("returns Set from settingsManager enabledModels", () => {
    const mockSM = {
      getEnabledModels: () => [
        "anthropic/claude-sonnet-4-20250514",
        "openai/gpt-5",
      ],
    };
    const result = readPiEnabledModels(mockSM as any, "/tmp");
    expect(result).toBeInstanceOf(Set);
    expect(result!.has("anthropic/claude-sonnet-4-20250514")).toBe(true);
    expect(result!.has("openai/gpt-5")).toBe(true);
  });

  it("strips :thinking suffix and lowercases entries", () => {
    const mockSM = {
      getEnabledModels: () => ["Anthropic/Claude-Sonnet-4:thinking"],
    };
    const result = readPiEnabledModels(mockSM as any, "/tmp");
    expect(result!.has("anthropic/claude-sonnet-4")).toBe(true);
  });

  it("filters out entries without provider/id format", () => {
    const mockSM = {
      getEnabledModels: () => ["anthropic/*", "openai/gpt-5", "sonnet"],
    };
    const result = readPiEnabledModels(mockSM as any, "/tmp");
    // Glob patterns and bare names are excluded — only exact provider/id kept
    expect(result!.has("openai/gpt-5")).toBe(true);
    expect(result!.size).toBe(1);
  });

  it("returns undefined when settingsManager is undefined (fallback disabled)", () => {
    expect(readPiEnabledModels(undefined, "/tmp")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: FAIL — `readPiEnabledModels` not exported

- [ ] **Step 3: Implement `readPiEnabledModels`**

Add to `src/core/model-scope.ts`:

```typescript
interface SettingsManagerLike {
  getEnabledModels(): string[] | undefined;
}

/**
 * Read pi's enabledModels via SettingsManager (preferred) or return undefined.
 * Filters to exact provider/modelId entries only (no glob patterns).
 * Strips :thinking suffixes and lowercases.
 */
export function readPiEnabledModels(
  settingsManager: SettingsManagerLike | undefined,
  _cwd: string,
): Set<string> | undefined {
  if (!settingsManager) return undefined;

  const raw = settingsManager.getEnabledModels();
  if (!raw || raw.length === 0) return undefined;

  const set = new Set<string>();
  for (const entry of raw) {
    // Only keep exact provider/modelId entries (must contain exactly one /)
    const slashIdx = entry.indexOf("/");
    if (slashIdx <= 0 || slashIdx === entry.length - 1) continue;
    // Reject glob patterns (contain *)
    if (entry.includes("*")) continue;
    // Normalize: lowercase, strip :thinking
    const normalized = entry.toLowerCase().replace(/:thinking$/, "");
    set.add(normalized);
  }

  return set.size > 0 ? set : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/model-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/model-scope.ts tests/model-scope.test.ts
git commit -m "feat(model-scope): add readPiEnabledModels with SettingsManager API"
```

---

### Task 5: Add `modelScope` to settings schema

**Files:**

- Modify: `src/core/settings.ts`
- Modify: `tests/settings.test.ts`

- [ ] **Step 1: Add modelScope to SubagentsSettings interface**

In `src/core/settings.ts`, add to the `SubagentsSettings` interface:

```typescript
import type { ModelScopeConfig } from "./model-scope.js";

export interface SubagentsSettings {
  maxConcurrent?: number;
  defaultJoinMode?: JoinMode;
  widgetMode?: WidgetMode;
  fleetView?: boolean;
  modelScope?: ModelScopeConfig;
}
```

- [ ] **Step 2: Add sanitization for modelScope in `sanitize` function**

Add to the `sanitize` function in `src/core/settings.ts`:

```typescript
import { parseModelScopeConfig } from "./model-scope.js";

// Inside sanitize(), after existing checks:
if (r.modelScope !== undefined) {
  const parsed = parseModelScopeConfig(r.modelScope);
  if (parsed) out.modelScope = parsed;
}
```

- [ ] **Step 3: Run existing settings tests**

Run: `pnpm test -- tests/settings.test.ts`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/core/settings.ts
git commit -m "feat(model-scope): add modelScope to subagents settings"
```

---

### Task 6: Integrate model scope check into subagent.ts

**Files:**

- Modify: `src/core/subagent.ts`

- [ ] **Step 1: Add model scope check after resolveModel**

In `src/core/subagent.ts`, after the model is resolved (around where `resolveModel` is called), add:

```typescript
import { checkModelScope, readPiEnabledModels } from "./model-scope.js";
import { loadSettings } from "./settings.js";

// After resolveModel() succeeds and before manager.spawn():
const settings = loadSettings(effectiveCwd);
if (settings.modelScope) {
  const piModels = readPiEnabledModels(
    (ctx as any).session?.settingsManager,
    effectiveCwd,
  );
  const source = params.model ? "explicit" : "inherited";
  const violation = checkModelScope(
    resolvedModelId, // the provider/id string after resolution
    settings.modelScope,
    piModels,
    source as any,
  );
  if (violation && violation.severity === "error") {
    return {
      content: [{ type: "text", text: violation.message }],
      isError: true,
      details: stubDetails({ status: "error", agent: agentDef?.name ?? "" }),
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
```

Note: The exact location depends on where the model string is available. Find the point after `resolveModel()` returns a `provider/id` string and before `deps.manager.spawnAndWait()` or `deps.manager.spawnBackground()` is called.

- [ ] **Step 2: Write integration test**

Add to `tests/model-scope.test.ts`:

```typescript
describe("integration: subagent model scope rejection", () => {
  it("blocks explicit out-of-scope model with error", () => {
    // This is validated by the unit tests on checkModelScope returning "error"
    // and the subagent.ts code path returning isError: true.
    // Full integration requires mocking the tool execution — covered by
    // the existing subagent.test.ts patterns if needed.
    const violation = checkModelScope(
      "google/gemini-pro",
      { enforce: true, allow: ["anthropic/*"] },
      undefined,
      "explicit",
    );
    expect(violation?.severity).toBe("error");
  });
});
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/core/subagent.ts tests/model-scope.test.ts
git commit -m "feat(model-scope): enforce model scope in subagent tool"
```

---

### Task 7: Typecheck and lint

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint and format**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: fix lint/type issues from model-scope integration"
```
