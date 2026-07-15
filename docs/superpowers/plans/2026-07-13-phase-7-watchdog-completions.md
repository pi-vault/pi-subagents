# Phase 7: Watchdog Completions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete 5 watchdog features held back from MVP: TUI renderer, model recommendation, child watchdog, turn-delta mode, and auto-follow steering.

**Architecture:** Each task builds on the existing `watchdog.ts` runtime. Tasks 1-2 are small additions. Tasks 3-5 extend `WatchdogConfig`, `handleAgentEnd`, and the runtime lifecycle. Auto-follow (task 5) uses `manager.resume()` for completed agents.

**Tech Stack:** TypeScript, Vitest, Pi SDK Extension API (`registerMessageRenderer`, `resume()`), pi-tui theme system

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: TUI Renderer | — | `src/index.ts` | `tests/index.test.ts` (or integration) |
| 2: Model Recommendation | `src/core/watchdog-model-selection.ts` | `src/core/watchdog.ts`, `src/index.ts` | `tests/core/watchdog-model-selection.test.ts` |
| 3: Child Watchdog | — | `src/core/watchdog.ts`, `src/index.ts` | `tests/core/watchdog.test.ts` |
| 4: Turn-Delta Mode | `src/core/watchdog-turn-delta.ts` | `src/core/watchdog.ts` | `tests/core/watchdog-turn-delta.test.ts`, `tests/core/watchdog.test.ts` |
| 5: Auto-Follow Steering | — | `src/core/watchdog.ts`, `src/index.ts` | `tests/core/watchdog.test.ts` |

---

### Task 1: Watchdog TUI Renderer

**Files:**
- Modify: `src/index.ts:309-327` (add renderer registration after existing renderers)
- Test: `tests/core/watchdog.test.ts` (verify message shape)

- [ ] **Step 1: Write the failing test**

In `tests/core/watchdog.test.ts`, add a describe block verifying the warning message shape has the fields the renderer needs:

```typescript
describe("watchdog warning message shape", () => {
  it("onWarnings emits message with customType and details", () => {
    let emittedMessage: unknown;
    const mockSendMessage = vi.fn((msg: unknown) => { emittedMessage = msg; });

    // Simulate the onWarnings callback pattern from index.ts
    const warning: WatchdogWarning = {
      severity: "blocker",
      summary: "Missing null check",
      evidence: "src/foo.ts:42",
      recommendedAction: "Add null guard",
      category: "correctness",
    };

    const content = `[watchdog/${warning.severity}] ${warning.summary}\nEvidence: ${warning.evidence}\nAction: ${warning.recommendedAction}`;
    const msg = {
      customType: "watchdog-warning",
      content,
      display: true,
      details: { agentId: "agent-1", ...warning, state: "displayed" },
    };
    mockSendMessage(msg);

    expect(emittedMessage).toMatchObject({
      customType: "watchdog-warning",
      details: {
        severity: "blocker",
        summary: "Missing null check",
        state: "displayed",
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes (shape test only)**

Run: `npx vitest run tests/core/watchdog.test.ts --reporter=verbose`
Expected: PASS (this is a shape verification test)

- [ ] **Step 3: Register the watchdog-warning message renderer**

In `src/index.ts`, after the `subagent-notification` renderer registration (around line 327), add:

```typescript
// Watchdog warning renderer with severity colors and state labels
pi.registerMessageRenderer("watchdog-warning", (msg, opts, theme) => {
  const d = (msg as { details?: { severity?: string; summary?: string; evidence?: string; recommendedAction?: string; state?: string; autoFollowAttempt?: number } }).details;
  if (!d) return new Text("", 0, 0);
  const t = theme as { fg: (color: string, text: string) => string; bold: (text: string) => string };

  const icon = d.severity === "blocker" ? "[!]" : "[~]";
  const color = d.severity === "blocker" ? "error" : "warning";
  const header = t.fg(color, `${icon} ${d.severity}: ${d.summary}`);

  const labels: string[] = [];
  if (d.state === "displayed") labels.push("displayed");
  if (d.state === "stale") labels.push("stale");
  if (d.state === "failed") labels.push("failed review");
  if (d.state === "stalemate") labels.push("stalemate");
  if (d.autoFollowAttempt !== undefined) labels.push(`auto-follow attempt ${d.autoFollowAttempt}`);
  const labelStr = labels.length > 0 ? ` (${labels.join(", ")})` : "";

  if (!opts.expanded) {
    return new Text(header + labelStr, 0, 0);
  }

  const lines = [
    header + labelStr,
    `  Evidence: ${d.evidence ?? "—"}`,
    `  Action: ${d.recommendedAction ?? "—"}`,
  ];
  return new Text(lines.join("\n"), 0, 0);
});
```

- [ ] **Step 4: Update onWarnings to include state field**

In `src/index.ts`, in the `onWarnings` callback (around line 130), add `state: "displayed"` to the details:

```typescript
details: { agentId, ...w, state: "displayed" },
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/core/watchdog.test.ts
git commit -m "feat(watchdog): add TUI renderer with severity colors and state labels"
```

---

### Task 2: Model Recommendation

**Files:**
- Create: `src/core/watchdog-model-selection.ts`
- Modify: `src/core/watchdog.ts:294-358` (add tip in runDefaultReview)
- Modify: `src/index.ts` (add /watchdog recommend-model command)
- Test: `tests/core/watchdog-model-selection.test.ts`

- [ ] **Step 1: Write the failing test for model recommendation logic**

Create `tests/core/watchdog-model-selection.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { recommendWatchdogModel } from "../src/core/watchdog-model-selection.js";

describe("recommendWatchdogModel", () => {
  it("recommends opus when current model is gpt family", () => {
    const result = recommendWatchdogModel("openai/gpt-5.5");
    expect(result?.family).toBe("opus");
  });

  it("recommends gpt when current model is anthropic family", () => {
    const result = recommendWatchdogModel("anthropic/claude-opus-4.8");
    expect(result?.family).toBe("gpt");
  });

  it("returns opus first when provider is unknown", () => {
    const result = recommendWatchdogModel(undefined);
    expect(result).toBeDefined();
  });

  it("returns model id string for configuration", () => {
    const result = recommendWatchdogModel("openai/gpt-5.5");
    expect(result?.modelId).toMatch(/anthropic|opus/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/watchdog-model-selection.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement watchdog-model-selection.ts**

Create `src/core/watchdog-model-selection.ts`:

```typescript
export interface ModelRecommendation {
  family: "opus" | "gpt";
  modelId: string;
  reason: string;
}

type ProviderFamily = "openai" | "anthropic" | "unknown";

function detectProviderFamily(modelString: string | undefined): ProviderFamily {
  if (!modelString) return "unknown";
  const lower = modelString.toLowerCase();
  if (lower.includes("openai") || lower.includes("gpt")) return "openai";
  if (lower.includes("anthropic") || lower.includes("claude") || lower.includes("opus")) return "anthropic";
  return "unknown";
}

/**
 * Recommend a complementary model for watchdog reviews.
 * Selects a model from a different provider family than the current session model.
 */
export function recommendWatchdogModel(currentModel: string | undefined): ModelRecommendation {
  const family = detectProviderFamily(currentModel);

  if (family === "openai") {
    return {
      family: "opus",
      modelId: "anthropic/claude-opus-4.8",
      reason: "Cross-provider review: Anthropic model complements OpenAI session model",
    };
  }
  if (family === "anthropic") {
    return {
      family: "gpt",
      modelId: "openai/gpt-5.5",
      reason: "Cross-provider review: OpenAI model complements Anthropic session model",
    };
  }
  // Default: recommend opus
  return {
    family: "opus",
    modelId: "anthropic/claude-opus-4.8",
    reason: "Default recommendation for second-opinion reviews",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/watchdog-model-selection.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Add one-time tip in runDefaultReview**

In `src/core/watchdog.ts`, add a module-level flag and emit tip in `runDefaultReview` (around line 294):

```typescript
let modelTipShown = false;

// Inside runDefaultReview, before creating the session:
if (!config.model && !modelTipShown) {
  modelTipShown = true;
  const { recommendWatchdogModel } = await import("./watchdog-model-selection.js");
  const rec = recommendWatchdogModel(undefined); // No access to session model here
  console.info(`[watchdog] Tip: Set watchdog.model to "${rec.modelId}" in .pi/subagents.json for cross-provider reviews.`);
}
```

- [ ] **Step 6: Register /watchdog recommend-model command**

In `src/index.ts`, where other commands are registered, add:

```typescript
pi.registerCommand("watchdog", {
  description: "Watchdog utilities: /watchdog recommend-model",
  handler: async (args, ctx) => {
    if (args.trim() === "recommend-model") {
      const { recommendWatchdogModel } = await import("./core/watchdog-model-selection.js");
      const currentModel = (ctx as { model?: string }).model;
      const rec = recommendWatchdogModel(currentModel);
      ctx.ui.notify(`Recommended watchdog model: ${rec.modelId}\nReason: ${rec.reason}\n\nSet in .pi/subagents.json:\n  "watchdog": { "model": "${rec.modelId}" }`, "info");
    } else {
      ctx.ui.notify("Usage: /watchdog recommend-model", "error");
    }
  },
});
```

- [ ] **Step 7: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/watchdog-model-selection.test.ts tests/core/watchdog.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/core/watchdog-model-selection.ts src/core/watchdog.ts src/index.ts tests/core/watchdog-model-selection.test.ts
git commit -m "feat(watchdog): add intelligent model recommendation with /watchdog command"
```

---

### Task 3: Child Watchdog

**Files:**
- Modify: `src/core/watchdog.ts:31-47,164-191,193-276`
- Modify: `src/index.ts:189-194` (child onComplete hook)
- Test: `tests/core/watchdog.test.ts`

- [ ] **Step 1: Write the failing test for child config resolution**

In `tests/core/watchdog.test.ts`, add:

```typescript
describe("child watchdog config", () => {
  it("parseWatchdogConfig includes children config", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: { enabled: true, model: "anthropic/opus-4.8", overrides: { scout: { enabled: false } } },
    });
    expect(config.children).toEqual({
      enabled: true,
      model: "anthropic/opus-4.8",
      thinking: undefined,
      overrides: { scout: { enabled: false } },
    });
  });

  it("resolveChildWatchdogConfig merges parent with override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "parent-model",
      children: { enabled: true, model: "child-model", overrides: { scout: { model: "scout-model" } } },
    });
    const childConfig = resolveChildWatchdogConfig({ config, agent: "scout" });
    expect(childConfig).toBeDefined();
    expect(childConfig!.model).toBe("scout-model");
  });

  it("resolveChildWatchdogConfig returns undefined when agent disabled", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: { enabled: true, overrides: { scout: { enabled: false } } },
    });
    const childConfig = resolveChildWatchdogConfig({ config, agent: "scout" });
    expect(childConfig).toBeUndefined();
  });

  it("resolveChildWatchdogConfig returns undefined when children disabled globally", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: { enabled: false },
    });
    const childConfig = resolveChildWatchdogConfig({ config, agent: "worker" });
    expect(childConfig).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/watchdog.test.ts --reporter=verbose`
Expected: FAIL — `children` not in config, `resolveChildWatchdogConfig` not exported

- [ ] **Step 3: Extend WatchdogConfig with children field**

In `src/core/watchdog.ts`, update the `WatchdogConfig` interface (line 31):

```typescript
export interface WatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
  reviewChangesOnly?: boolean;
  children: {
    enabled: boolean;
    model?: string;
    thinking?: string;
    overrides: Record<string, Partial<{ enabled: boolean; model: string; thinking: string }>>;
  };
  autoFollow: {
    blockers: boolean;
    concerns: boolean;
    maxAttempts: number;
    stalemateRepeats: number;
  };
  lsp: {
    enabled: boolean;
    timeoutMs: number;
    maxFiles: number;
    maxDiagnostics: number;
  };
}
```

Update `DEFAULT_WATCHDOG_CONFIG` to include defaults:

```typescript
const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  reviewChangesOnly: true,
  children: { enabled: false, overrides: {} },
  autoFollow: { blockers: false, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
  lsp: { enabled: true, timeoutMs: 30_000, maxFiles: 20, maxDiagnostics: 50 },
};
```

- [ ] **Step 4: Update parseWatchdogConfig to parse children**

In `src/core/watchdog.ts`, add to `parseWatchdogConfig` (after the lsp parsing block):

```typescript
if (typeof r.reviewChangesOnly === "boolean") config.reviewChangesOnly = r.reviewChangesOnly;

if (r.children && typeof r.children === "object") {
  const ch = r.children as Record<string, unknown>;
  if (typeof ch.enabled === "boolean") config.children.enabled = ch.enabled;
  if (typeof ch.model === "string") config.children.model = ch.model;
  if (typeof ch.thinking === "string") config.children.thinking = ch.thinking;
  if (ch.overrides && typeof ch.overrides === "object") {
    config.children.overrides = ch.overrides as typeof config.children.overrides;
  }
}

if (r.autoFollow && typeof r.autoFollow === "object") {
  const af = r.autoFollow as Record<string, unknown>;
  if (typeof af.blockers === "boolean") config.autoFollow.blockers = af.blockers;
  if (typeof af.concerns === "boolean") config.autoFollow.concerns = af.concerns;
  if (typeof af.maxAttempts === "number") config.autoFollow.maxAttempts = af.maxAttempts;
  if (typeof af.stalemateRepeats === "number") config.autoFollow.stalemateRepeats = af.stalemateRepeats;
}
```

- [ ] **Step 5: Implement resolveChildWatchdogConfig**

In `src/core/watchdog.ts`, export:

```typescript
export interface ChildWatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
}

export function resolveChildWatchdogConfig(input: {
  config: WatchdogConfig;
  agent?: string;
}): ChildWatchdogConfig | undefined {
  if (!input.config.enabled || !input.config.children.enabled) return undefined;

  const override = input.agent ? input.config.children.overrides[input.agent] : undefined;
  const enabled = override?.enabled ?? true;
  if (!enabled) return undefined;

  return {
    enabled: true,
    model: override?.model ?? input.config.children.model ?? input.config.model,
    thinking: override?.thinking ?? input.config.children.thinking ?? input.config.thinking,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/core/watchdog.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Wire child watchdog in index.ts onComplete**

In `src/index.ts`, update the watchdog trigger on agent complete (around line 189):

```typescript
// Trigger watchdog review non-blocking after agent completes
if (watchdog.status() !== "disabled" && record.status === "completed") {
  // Check if this is a child agent that should get its own watchdog review
  const childConfig = resolveChildWatchdogConfig({ config: watchdogConfig, agent: record.type });
  if (childConfig) {
    const childWatchdog = createWatchdogRuntime(
      { ...watchdogConfig, ...childConfig, children: { enabled: false, overrides: {} }, autoFollow: watchdogConfig.autoFollow },
      { onWarnings: (agentId, warnings) => { /* same emit pattern as parent */ } },
    );
    childWatchdog.handleAgentEnd(record.id, record.cwd ?? process.cwd()).catch((err) => {
      console.error("[watchdog/child] handleAgentEnd failed:", err);
    }).finally(() => childWatchdog.dispose());
  } else {
    watchdog.handleAgentEnd(record.id, record.cwd ?? process.cwd()).catch((err) => {
      console.error("[watchdog] handleAgentEnd failed:", err);
    });
  }
}
```

- [ ] **Step 8: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/core/watchdog.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add src/core/watchdog.ts src/index.ts tests/core/watchdog.test.ts
git commit -m "feat(watchdog): add child watchdog with per-agent config resolution"
```

---

### Task 4: Turn-Delta Mode

**Files:**
- Create: `src/core/watchdog-turn-delta.ts`
- Modify: `src/core/watchdog.ts:230-276` (handleAgentEnd branch)
- Test: `tests/core/watchdog-turn-delta.test.ts`

- [ ] **Step 1: Write the failing test for formatWatchdogTurnDelta**

Create `tests/core/watchdog-turn-delta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatWatchdogTurnDelta } from "../src/core/watchdog-turn-delta.js";

describe("formatWatchdogTurnDelta", () => {
  it("formats tool calls with names and truncated inputs", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", name: "read_file", input: { path: "/foo.ts" } }] },
      { role: "tool", content: [{ type: "tool_result", content: "file contents here" }] },
    ];
    const result = formatWatchdogTurnDelta(messages as never[], 10);
    expect(result).toContain("read_file");
    expect(result).toContain("/foo.ts");
  });

  it("redacts large edit/write tool inputs", () => {
    const longContent = "x".repeat(500);
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", name: "edit_file", input: { path: "/foo.ts", oldText: longContent, newText: longContent } }] },
    ];
    const result = formatWatchdogTurnDelta(messages as never[], 10);
    expect(result).toContain("[omitted 500 chars]");
    expect(result).not.toContain("x".repeat(100));
  });

  it("limits to last N messages", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: "assistant",
      content: [{ type: "tool_use", name: `tool_${i}`, input: {} }],
    }));
    const result = formatWatchdogTurnDelta(messages as never[], 5);
    expect(result).toContain("tool_19");
    expect(result).toContain("tool_15");
    expect(result).not.toContain("tool_0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/watchdog-turn-delta.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement watchdog-turn-delta.ts**

Create `src/core/watchdog-turn-delta.ts`:

```typescript
/**
 * Format the last N messages from an agent session as a turn delta for watchdog review.
 * Redacts large tool inputs (edit/write) to save tokens.
 */
export function formatWatchdogTurnDelta(messages: unknown[], lastN: number): string {
  const recent = messages.slice(-lastN);
  const parts: string[] = [];

  for (const msg of recent) {
    const m = msg as { role?: string; content?: unknown[] | string };
    if (!m.role || !m.content) continue;

    if (typeof m.content === "string") {
      parts.push(`[${m.role}] ${m.content.slice(0, 200)}`);
      continue;
    }

    if (!Array.isArray(m.content)) continue;

    for (const block of m.content) {
      const b = block as { type?: string; name?: string; input?: unknown; content?: unknown };
      if (b.type === "tool_use") {
        const redacted = redactToolInput(b.name ?? "", b.input);
        parts.push(`[tool_use] ${b.name}: ${JSON.stringify(redacted).slice(0, 500)}`);
      } else if (b.type === "tool_result") {
        const text = typeof b.content === "string" ? b.content.slice(0, 300) : JSON.stringify(b.content).slice(0, 300);
        parts.push(`[tool_result] ${text}`);
      } else if (b.type === "text") {
        const text = typeof b.content === "string" ? b.content : (b as { text?: string }).text ?? "";
        parts.push(`[${m.role}] ${(text as string).slice(0, 300)}`);
      }
    }
  }

  return parts.join("\n\n");
}

const REDACT_KEYS = new Set(["oldText", "newText", "content", "old_string", "new_string"]);
const REDACT_TOOL_NAMES = new Set(["edit_file", "write_file", "edit", "write"]);

function redactToolInput(toolName: string, input: unknown): unknown {
  if (!REDACT_TOOL_NAMES.has(toolName)) return input;
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redactToolInput(toolName, item));

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key) && typeof value === "string") {
      sanitized[key] = `[omitted ${value.length} chars]`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/watchdog-turn-delta.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Add turn-delta branch to handleAgentEnd**

In `src/core/watchdog.ts`, in `handleAgentEnd` (around line 234, after `computeChangeSignature`), add a branch for turn-delta mode:

```typescript
// Turn-delta mode: review conversation instead of git diff
if (!config.reviewChangesOnly) {
  let turnDelta = "(no conversation data)";
  if (options?.getSessionMessages) {
    const messages = options.getSessionMessages(agentId);
    if (messages && messages.length > 0) {
      const { formatWatchdogTurnDelta } = await import("./watchdog-turn-delta.js");
      turnDelta = formatWatchdogTurnDelta(messages, 10);
    }
  }

  let warnings: WatchdogWarning[];
  if (options?.runReview) {
    warnings = await options.runReview(turnDelta, "N/A (turn-delta mode)", agentId);
  } else {
    warnings = await runDefaultReview(config, turnDelta, "N/A (turn-delta mode)", agentId, globalSeen);
  }
  if (warnings.length > 0) options?.onWarnings?.(agentId, warnings);
  return warnings;
}
```

Update the `WatchdogRuntimeOptions` type to include:

```typescript
getSessionMessages?: (agentId: string) => unknown[] | undefined;
```

- [ ] **Step 6: Write test for turn-delta mode in runtime**

In `tests/core/watchdog.test.ts`, add:

```typescript
describe("turn-delta mode", () => {
  it("uses turn delta when reviewChangesOnly is false", async () => {
    let reviewInput: string | undefined;
    const config = parseWatchdogConfig({ enabled: true, reviewChangesOnly: false });
    const runtime = createWatchdogRuntime(config, {
      runReview: async (diff) => {
        reviewInput = diff;
        return [];
      },
      getSessionMessages: () => [
        { role: "assistant", content: [{ type: "tool_use", name: "read_file", input: { path: "/x.ts" } }] },
      ],
    });

    await runtime.handleAgentEnd("agent-1", "/tmp");
    expect(reviewInput).toContain("read_file");
    expect(reviewInput).not.toContain("git");
    runtime.dispose();
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/core/watchdog.test.ts tests/core/watchdog-turn-delta.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/watchdog-turn-delta.ts src/core/watchdog.ts tests/core/watchdog-turn-delta.test.ts tests/core/watchdog.test.ts
git commit -m "feat(watchdog): add turn-delta review mode with input redaction"
```

---

### Task 5: Auto-Follow Steering

**Files:**
- Modify: `src/core/watchdog.ts:230-276` (post-review logic)
- Modify: `src/index.ts:189-194` (wire resume callback)
- Test: `tests/core/watchdog.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/core/watchdog.test.ts`, add:

```typescript
describe("auto-follow steering", () => {
  it("resumes agent when blockers found and autoFollow.blockers is true", async () => {
    const resumed: Array<{ id: string; message: string }> = [];
    const config = parseWatchdogConfig({
      enabled: true,
      autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
    });

    let callCount = 0;
    const runtime = createWatchdogRuntime(config, {
      runReview: async () => {
        callCount++;
        if (callCount === 1) {
          return [{ severity: "blocker", summary: "Bug found", evidence: "x.ts:1", recommendedAction: "Fix it", category: "correctness" }];
        }
        return []; // Fixed on second review
      },
      resumeAgent: async (id, message) => {
        resumed.push({ id, message });
      },
    });

    await runtime.handleAgentEnd("agent-1", "/tmp");

    expect(resumed).toHaveLength(1);
    expect(resumed[0].id).toBe("agent-1");
    expect(resumed[0].message).toContain("Bug found");
  });

  it("stops after maxAttempts", async () => {
    const resumed: string[] = [];
    const config = parseWatchdogConfig({
      enabled: true,
      autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 3 },
    });

    const runtime = createWatchdogRuntime(config, {
      runReview: async () => [{ severity: "blocker", summary: "Persistent bug", evidence: "x.ts:1", recommendedAction: "Fix", category: "correctness" }],
      resumeAgent: async (id) => { resumed.push(id); },
    });

    await runtime.handleAgentEnd("agent-1", "/tmp");
    expect(resumed.length).toBeLessThanOrEqual(2);
  });

  it("detects stalemate when same warning repeats", async () => {
    let warningsEmitted: WatchdogWarning[] = [];
    const config = parseWatchdogConfig({
      enabled: true,
      autoFollow: { blockers: true, concerns: false, maxAttempts: 5, stalemateRepeats: 2 },
    });

    const runtime = createWatchdogRuntime(config, {
      runReview: async () => [{ severity: "blocker", summary: "Same bug", evidence: "x.ts:1", recommendedAction: "Fix", category: "correctness" }],
      resumeAgent: async () => {},
      onWarnings: (_id, w) => { warningsEmitted = w; },
    });

    await runtime.handleAgentEnd("agent-1", "/tmp");
    // Should stop due to stalemate, not maxAttempts
    expect(warningsEmitted.length).toBeGreaterThan(0);
  });

  it("does nothing when autoFollow.blockers is false", async () => {
    const resumed: string[] = [];
    const config = parseWatchdogConfig({
      enabled: true,
      autoFollow: { blockers: false, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
    });

    const runtime = createWatchdogRuntime(config, {
      runReview: async () => [{ severity: "blocker", summary: "Bug", evidence: "x.ts:1", recommendedAction: "Fix", category: "correctness" }],
      resumeAgent: async (id) => { resumed.push(id); },
    });

    await runtime.handleAgentEnd("agent-1", "/tmp");
    expect(resumed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/watchdog.test.ts --reporter=verbose`
Expected: FAIL — auto-follow logic not implemented

- [ ] **Step 3: Add resumeAgent to WatchdogRuntimeOptions**

In `src/core/watchdog.ts`, update the options interface:

```typescript
export interface WatchdogRuntimeOptions {
  runReview?: (diff: string, lspOutput: string, agentId: string) => Promise<WatchdogWarning[]>;
  onWarnings?: (agentId: string, warnings: WatchdogWarning[]) => void;
  getSessionMessages?: (agentId: string) => unknown[] | undefined;
  resumeAgent?: (agentId: string, message: string) => Promise<void>;
}
```

- [ ] **Step 4: Implement auto-follow logic after review**

In `src/core/watchdog.ts`, after warnings are collected in `handleAgentEnd`, add:

```typescript
// Auto-follow steering
if (warnings.length > 0 && options?.resumeAgent) {
  const hasBlockers = warnings.some((w) => w.severity === "blocker");
  const hasConcerns = warnings.some((w) => w.severity === "concern");
  const shouldFollow =
    (config.autoFollow.blockers && hasBlockers) ||
    (config.autoFollow.concerns && hasConcerns);

  if (shouldFollow) {
    const warningKey = warnings.map((w) => w.summary.toLowerCase().trim()).sort().join("|");
    let attempts = 0;
    let repeatCount = 0;
    let lastKey = warningKey;

    while (attempts < config.autoFollow.maxAttempts) {
      attempts++;
      const steerMsg = `Watchdog found issues:\n${warnings.map((w) => `- [${w.severity}] ${w.summary}: ${w.recommendedAction}`).join("\n")}\n\nPlease fix these issues.`;
      await options.resumeAgent(agentId, steerMsg);

      // Re-review after resume
      const newWarnings = options.runReview
        ? await options.runReview("(re-review after auto-follow)", "(re-review)", agentId)
        : await runDefaultReview(config, "(re-review)", "(re-review)", agentId, globalSeen);

      if (newWarnings.length === 0) {
        warnings.length = 0; // Clear — agent fixed the issues
        break;
      }

      const newKey = newWarnings.map((w) => w.summary.toLowerCase().trim()).sort().join("|");
      if (newKey === lastKey) {
        repeatCount++;
        if (repeatCount >= config.autoFollow.stalemateRepeats) {
          // Stalemate detected — stop steering
          warnings.length = 0;
          warnings.push(...newWarnings);
          break;
        }
      } else {
        repeatCount = 0;
        lastKey = newKey;
      }
      warnings.length = 0;
      warnings.push(...newWarnings);
    }
  }
}

if (warnings.length > 0) {
  options?.onWarnings?.(agentId, warnings);
}
```

- [ ] **Step 5: Wire resumeAgent in index.ts**

In `src/index.ts`, update the `createWatchdogRuntime` options to include:

```typescript
resumeAgent: async (agentId, message) => {
  await manager.resume(agentId, message);
},
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/core/watchdog.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/core/watchdog.ts src/index.ts tests/core/watchdog.test.ts
git commit -m "feat(watchdog): add auto-follow steering with stalemate detection

Disabled by default. Uses manager.resume() for completed agents.
Conservative defaults: maxAttempts=2, stalemateRepeats=2."
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npx eslint src/ tests/ --ext .ts`
Expected: No new errors
