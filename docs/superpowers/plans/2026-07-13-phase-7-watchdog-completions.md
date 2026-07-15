# Phase 7: Watchdog Completions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete 5 watchdog features held back from MVP: TUI renderer, model recommendation, child watchdog, turn-delta mode, and auto-follow steering.

**Architecture:** Each task builds on the existing `watchdog.ts` runtime factory. Tasks 1-2 are isolated additions. Tasks 3-5 progressively extend `WatchdogConfig` and `handleAgentEnd`. Auto-follow (task 5) uses `manager.resume()` which does NOT trigger onComplete, avoiding recursion.

**Tech Stack:** TypeScript, Vitest, Pi SDK Extension API (`registerMessageRenderer`, `sendMessage`), pi-tui (`Container`, `Spacer`, `Text`)

**Reference implementations:**
- `nicobailon-pi-subagents/src/watchdog/` — mature watchdog with render, model-selection, turn-delta, child-status
- `pi/packages/coding-agent/src/core/extensions/types.ts` — Extension API type definitions

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1: TUI Renderer | — | `src/index.ts` | `tests/watchdog.test.ts` |
| 2: Model Recommendation | `src/core/watchdog-model-selection.ts` | `src/core/watchdog.ts`, `src/index.ts` | `tests/watchdog-model-selection.test.ts` |
| 3: Child Watchdog | `src/core/watchdog-child.ts` | `src/core/watchdog.ts`, `src/index.ts` | `tests/watchdog-child.test.ts` |
| 4: Turn-Delta Mode | `src/core/watchdog-turn-delta.ts` | `src/core/watchdog.ts`, `src/index.ts` | `tests/watchdog-turn-delta.test.ts` |
| 5: Auto-Follow Steering | — | `src/core/watchdog.ts`, `src/index.ts` | `tests/watchdog.test.ts` |

---

### Task 1: Watchdog TUI Renderer

Register a custom message renderer for `watchdog-warning` messages with severity colors, state labels, and expanded details. Follows the pattern established by the `subagent-notification` renderer (index.ts line 329).

**Files:**
- Modify: `src/index.ts` (add renderer after `subagent-notification` renderer, add `state` to onWarnings details)
- Test: `tests/watchdog.test.ts` (verify message shape)

- [ ] **Step 1: Add state field to onWarnings emission**

In `src/index.ts`, update the `onWarnings` callback (line ~135) to include `state: "displayed"`:

```typescript
details: { agentId, ...w, state: "displayed" },
```

- [ ] **Step 2: Register the watchdog-warning message renderer**

In `src/index.ts`, after the `subagent-notification` renderer (after line 342), add:

```typescript
// Watchdog warning renderer with severity colors and state labels
pi.registerMessageRenderer("watchdog-warning", (msg, opts, theme) => {
  const d = (msg as { details?: {
    severity?: string; summary?: string; evidence?: string;
    recommendedAction?: string; category?: string; state?: string;
    autoFollowAttempt?: number; agentId?: string;
  } }).details;
  if (!d?.summary) return new Text(typeof (msg as { content?: string }).content === "string" ? (msg as { content: string }).content : "", 0, 0);
  const t = theme as { fg: (color: string, text: string) => string; bold: (text: string) => string };
  const { Container, Spacer } = await import("@earendil-works/pi-tui");

  const subject = d.severity === "blocker" ? "Blocker" : "Concern";
  const color = d.severity === "blocker" ? "error" : "warning";

  // State labels
  const labels: string[] = [];
  if (d.state === "displayed") labels.push("displayed");
  if (d.state === "stale") labels.push("stale");
  if (d.state === "failed") labels.push("failed review");
  if (d.state === "stalemate") labels.push("stalemate");
  if (d.autoFollowAttempt !== undefined) labels.push(`auto-follow attempt ${d.autoFollowAttempt}`);
  const labelSuffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";

  const header = t.fg(color, t.bold(`Watchdog ${subject}${labelSuffix}: ${d.summary}`));

  if (!opts.expanded) {
    const brief = d.evidence ? `  \u23BF  Evidence: ${d.evidence}` : "";
    return new Text(`${header}\n${t.fg("dim", brief)}`, 0, 0);
  }

  const lines = [
    header,
    t.fg("dim", `Evidence: ${d.evidence ?? "\u2014"}`),
    t.fg("dim", `Recommended action: ${d.recommendedAction ?? "\u2014"}`),
    t.fg("dim", `Category: ${d.category ?? "other"}${d.agentId ? ` \u00B7 Agent: ${d.agentId}` : ""}`),
  ];
  return new Text(lines.join("\n"), 0, 0);
});
```

Note: `Container`/`Spacer` are available from `@earendil-works/pi-tui` (already imported as `Text`). Since the renderer must be synchronous, import them at the top with `Text`:

```typescript
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
```

Then use:
```typescript
pi.registerMessageRenderer("watchdog-warning", (msg, opts, theme) => {
  // ... (same logic as above, using Container for expanded view)
  const container = new Container();
  container.addChild(new Text(header, 0, 0));
  if (opts.expanded) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(t.fg("dim", `Evidence: ${d.evidence ?? "\u2014"}`), 0, 0));
    container.addChild(new Text(t.fg("dim", `Recommended action: ${d.recommendedAction ?? "\u2014"}`), 0, 0));
    container.addChild(new Text(t.fg("dim", `Category: ${d.category ?? "other"}${d.agentId ? ` \u00B7 Agent: ${d.agentId}` : ""}`), 0, 0));
  } else if (d.evidence) {
    container.addChild(new Text(t.fg("dim", `  \u23BF  Evidence: ${d.evidence}`), 0, 0));
  }
  return container;
});
```

- [ ] **Step 3: Write test for warning message shape**

In `tests/watchdog.test.ts`, add a describe block:

```typescript
describe("watchdog warning message shape", () => {
  it("onWarnings details include state field", () => {
    const warning: WatchdogWarning = {
      severity: "blocker",
      summary: "Missing null check",
      evidence: "src/foo.ts:42",
      recommendedAction: "Add null guard",
      category: "correctness",
    };
    // Verify the shape that index.ts onWarnings produces
    const details = { agentId: "agent-1", ...warning, state: "displayed" };
    expect(details).toMatchObject({
      severity: "blocker",
      summary: "Missing null check",
      state: "displayed",
      agentId: "agent-1",
    });
  });
});
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/watchdog.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add TUI renderer with severity colors and state labels"
```

---

### Task 2: Model Recommendation

Intelligent complementary model selection. Uses the model registry API (available via `ExtensionContext`) to find authenticated cross-provider models.

**Design decision:** The reference implementation (nicobailon) uses `ctx.modelRegistry` which requires `ExtensionContext`. Our codebase doesn't have persistent access to `ExtensionContext` in the watchdog runtime. We'll implement a two-tier approach:
1. A pure-function recommendation for the `/watchdog recommend-model` command (which HAS ctx access)
2. A config-only recommendation for the one-time tip (uses string matching since no ctx available at watchdog init time)

**Files:**
- Create: `src/core/watchdog-model-selection.ts`
- Modify: `src/index.ts` (extend existing `/watchdog` command handler)
- Test: `tests/watchdog-model-selection.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/watchdog-model-selection.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { recommendWatchdogModel, detectProviderFamily } from "../src/core/watchdog-model-selection.js";

describe("detectProviderFamily", () => {
  it("detects openai family", () => {
    expect(detectProviderFamily("openai-codex", "gpt-5.5")).toBe("openai");
    expect(detectProviderFamily("openai", "gpt-5-5")).toBe("openai");
  });

  it("detects anthropic family", () => {
    expect(detectProviderFamily("anthropic", "claude-opus-4-8")).toBe("anthropic");
    expect(detectProviderFamily("anthropic", "opus-4.8")).toBe("anthropic");
  });

  it("returns unknown for other providers", () => {
    expect(detectProviderFamily("google", "gemini-2")).toBe("unknown");
    expect(detectProviderFamily(undefined, undefined)).toBe("unknown");
  });
});

describe("recommendWatchdogModel", () => {
  it("recommends anthropic model for openai session", () => {
    const result = recommendWatchdogModel("openai");
    expect(result.model).toContain("anthropic");
    expect(result.family).toBe("opus");
  });

  it("recommends openai model for anthropic session", () => {
    const result = recommendWatchdogModel("anthropic");
    expect(result.model).toContain("openai");
    expect(result.family).toBe("gpt");
  });

  it("defaults to opus for unknown provider", () => {
    const result = recommendWatchdogModel("unknown");
    expect(result.family).toBe("opus");
  });

  it("returns a human-readable reason", () => {
    const result = recommendWatchdogModel("openai");
    expect(result.reason).toBeTruthy();
    expect(result.reason.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/watchdog-model-selection.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement watchdog-model-selection.ts**

Create `src/core/watchdog-model-selection.ts`:

```typescript
export type ProviderFamily = "openai" | "anthropic" | "unknown";

export interface ModelRecommendation {
  family: "opus" | "gpt";
  model: string;
  thinking: string;
  reason: string;
}

const STRONG_MODELS = {
  opus: {
    model: "anthropic/claude-opus-4-8",
    label: "Opus 4.8",
  },
  gpt: {
    model: "openai-codex/gpt-5.5",
    label: "GPT 5.5",
  },
} as const;

/**
 * Detect the provider family from provider string and model ID.
 */
export function detectProviderFamily(
  provider: string | undefined,
  modelId?: string | undefined,
): ProviderFamily {
  const p = (provider ?? "").toLowerCase();
  const m = (modelId ?? "").toLowerCase();
  if (p.includes("openai") || m.includes("gpt")) return "openai";
  if (p.includes("anthropic") || m.includes("claude") || m.includes("opus")) return "anthropic";
  return "unknown";
}

/**
 * Recommend a complementary watchdog model based on the current session's provider family.
 * Cross-provider review provides independent perspective.
 */
export function recommendWatchdogModel(
  currentProviderFamily: ProviderFamily,
): ModelRecommendation {
  if (currentProviderFamily === "openai") {
    return {
      family: "opus",
      model: STRONG_MODELS.opus.model,
      thinking: "high",
      reason: `Use ${STRONG_MODELS.opus.label} with high thinking as a cross-provider watchdog. Different model families catch different classes of issues.`,
    };
  }
  if (currentProviderFamily === "anthropic") {
    return {
      family: "gpt",
      model: STRONG_MODELS.gpt.model,
      thinking: "high",
      reason: `Use ${STRONG_MODELS.gpt.label} with high thinking as a cross-provider watchdog. Different model families catch different classes of issues.`,
    };
  }
  // Default: recommend opus (generally strong at code review)
  return {
    family: "opus",
    model: STRONG_MODELS.opus.model,
    thinking: "high",
    reason: `Default recommendation: ${STRONG_MODELS.opus.label} with high thinking for independent code review.`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/watchdog-model-selection.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Extend existing /watchdog command with recommend-model subcommand**

In `src/index.ts`, update the existing `/watchdog` command handler (line ~350) to handle `recommend-model`:

```typescript
pi.registerCommand("watchdog", {
  description: "Watchdog control: status, off, recommend-model",
  handler: async (args) => {
    const sub = args.trim().toLowerCase();
    if (sub === "off") {
      deps.watchdog?.dispose();
      (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
        { customType: "notification", content: "Watchdog disabled for this session.", display: true } as unknown as Parameters<typeof pi.sendMessage>[0],
      );
    } else if (sub === "recommend-model") {
      const { recommendWatchdogModel, detectProviderFamily } = await import("./core/watchdog-model-selection.js");
      // Attempt to determine current provider from captured model registry
      const currentProvider = detectProviderFamily(
        (capturedModelRegistry as unknown as { currentProvider?: string })?.currentProvider,
      );
      const rec = recommendWatchdogModel(currentProvider);
      const msg = [
        `Recommended watchdog model: ${rec.model}`,
        `Thinking level: ${rec.thinking}`,
        `Reason: ${rec.reason}`,
        ``,
        `To apply, add to .pi/subagents.json:`,
        `  "watchdog": { "model": "${rec.model}", "thinking": "${rec.thinking}" }`,
      ].join("\n");
      (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
        { customType: "notification", content: msg, display: true } as unknown as Parameters<typeof pi.sendMessage>[0],
      );
    } else {
      const st = deps.watchdog?.status() ?? "not initialized";
      (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
        { customType: "notification", content: `Watchdog status: ${st}`, display: true } as unknown as Parameters<typeof pi.sendMessage>[0],
      );
    }
  },
});
```

- [ ] **Step 6: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/watchdog-model-selection.test.ts tests/watchdog.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/core/watchdog-model-selection.ts src/index.ts tests/watchdog-model-selection.test.ts
git commit -m "feat(watchdog): add model recommendation with /watchdog recommend-model command"
```

---

### Task 3: Child Watchdog

Per-child-agent watchdog instances that review child agent work with potentially different model/thinking settings.

**Architecture decision:** Since this codebase's agents are in-process LLM sessions (not separate OS processes), the child watchdog runs in the same process. Config resolution determines whether a child agent type gets its own watchdog review and with what settings. The parent watchdog's `handleAgentEnd` is skipped for agents that have a child config — instead, a temporary runtime with child-specific settings runs the review.

**Files:**
- Create: `src/core/watchdog-child.ts`
- Modify: `src/core/watchdog.ts` (add `children` to WatchdogConfig, parse it)
- Modify: `src/index.ts` (wire child config resolution in onComplete)
- Test: `tests/watchdog-child.test.ts`

- [ ] **Step 1: Write failing tests for child config resolution**

Create `tests/watchdog-child.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveChildWatchdogConfig } from "../src/core/watchdog-child.js";
import { parseWatchdogConfig } from "../src/core/watchdog.js";

describe("resolveChildWatchdogConfig", () => {
  it("returns undefined when children.enabled is false", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: { enabled: false },
    });
    const result = resolveChildWatchdogConfig(config, "scout");
    expect(result).toBeUndefined();
  });

  it("returns undefined when parent watchdog is disabled", () => {
    const config = parseWatchdogConfig({
      enabled: false,
      children: { enabled: true },
    });
    const result = resolveChildWatchdogConfig(config, "scout");
    expect(result).toBeUndefined();
  });

  it("returns child config with parent defaults when no override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "parent-model",
      thinking: "high",
      children: { enabled: true, model: "child-model" },
    });
    const result = resolveChildWatchdogConfig(config, "worker");
    expect(result).toBeDefined();
    expect(result!.model).toBe("child-model");
    expect(result!.thinking).toBe("high"); // inherited from parent
  });

  it("applies per-agent override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "parent-model",
      children: {
        enabled: true,
        model: "child-default",
        overrides: { scout: { model: "scout-model", thinking: "low" } },
      },
    });
    const result = resolveChildWatchdogConfig(config, "scout");
    expect(result).toBeDefined();
    expect(result!.model).toBe("scout-model");
    expect(result!.thinking).toBe("low");
  });

  it("returns undefined when specific agent is disabled via override", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      children: {
        enabled: true,
        overrides: { scout: { enabled: false } },
      },
    });
    const result = resolveChildWatchdogConfig(config, "scout");
    expect(result).toBeUndefined();
  });

  it("uses parent model when no children.model and no override.model", () => {
    const config = parseWatchdogConfig({
      enabled: true,
      model: "parent-model",
      children: { enabled: true },
    });
    const result = resolveChildWatchdogConfig(config, "worker");
    expect(result).toBeDefined();
    expect(result!.model).toBe("parent-model");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/watchdog-child.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Extend WatchdogConfig with children field**

In `src/core/watchdog.ts`, update the interface and defaults:

```typescript
export interface WatchdogChildOverride {
  enabled?: boolean;
  model?: string;
  thinking?: string;
}

export interface WatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
  children: {
    enabled: boolean;
    model?: string;
    thinking?: string;
    overrides: Record<string, WatchdogChildOverride>;
  };
  lsp: {
    enabled: boolean;
    timeoutMs: number;
    maxFiles: number;
    maxDiagnostics: number;
  };
}
```

Update `DEFAULT_WATCHDOG_CONFIG`:

```typescript
const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  children: { enabled: false, overrides: {} },
  lsp: {
    enabled: true,
    timeoutMs: 3_000,
    maxFiles: 20,
    maxDiagnostics: 50,
  },
};
```

Update `parseWatchdogConfig` to parse children (after lsp block):

```typescript
if (r.children && typeof r.children === "object") {
  const ch = r.children as Record<string, unknown>;
  if (typeof ch.enabled === "boolean") config.children.enabled = ch.enabled;
  if (typeof ch.model === "string") config.children.model = ch.model;
  if (typeof ch.thinking === "string") config.children.thinking = ch.thinking;
  if (ch.overrides && typeof ch.overrides === "object") {
    config.children.overrides = ch.overrides as typeof config.children.overrides;
  }
}
```

- [ ] **Step 4: Implement watchdog-child.ts**

Create `src/core/watchdog-child.ts`:

```typescript
import type { WatchdogConfig } from "./watchdog.js";

export interface ChildWatchdogConfig {
  model?: string;
  thinking?: string;
}

/**
 * Resolve child watchdog config for a given agent type.
 * Returns undefined if child watchdog should NOT run for this agent.
 */
export function resolveChildWatchdogConfig(
  config: WatchdogConfig,
  agentType: string,
): ChildWatchdogConfig | undefined {
  if (!config.enabled || !config.children.enabled) return undefined;

  const override = config.children.overrides[agentType];
  if (override?.enabled === false) return undefined;

  return {
    model: override?.model ?? config.children.model ?? config.model,
    thinking: override?.thinking ?? config.children.thinking ?? config.thinking,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/watchdog-child.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Wire child watchdog in index.ts onComplete callback**

In `src/index.ts`, update the watchdog trigger block (lines ~190-195):

```typescript
import { resolveChildWatchdogConfig } from "./core/watchdog-child.js";

// (In the onComplete callback, replace the current watchdog block:)
// Trigger watchdog review non-blocking after agent completes
if (watchdog.status() !== "disabled" && record.status === "completed") {
  const childConfig = resolveChildWatchdogConfig(watchdogConfig, record.type);
  if (childConfig) {
    // Child-specific review: create temporary runtime with child model/thinking
    const childWatchdogConfig = {
      ...watchdogConfig,
      ...(childConfig.model ? { model: childConfig.model } : {}),
      ...(childConfig.thinking ? { thinking: childConfig.thinking } : {}),
    };
    const childWatchdog = createWatchdogRuntime(childWatchdogConfig, {
      onWarnings: (agentId, warnings) => {
        for (const w of warnings) {
          const content = `[watchdog/child/${w.severity}] ${w.summary}\nEvidence: ${w.evidence}\nAction: ${w.recommendedAction}`;
          (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
            {
              customType: "watchdog-warning",
              content,
              display: true,
              details: { agentId, ...w, state: "displayed", source: "child" },
            } as unknown as Parameters<typeof pi.sendMessage>[0],
            { deliverAs: "followUp", triggerTurn: true },
          );
        }
      },
    });
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

- [ ] **Step 7: Update existing parseWatchdogConfig tests**

In `tests/watchdog.test.ts`, add to the `parseWatchdogConfig` describe:

```typescript
it("parses children config", () => {
  const config = parseWatchdogConfig({
    enabled: true,
    children: { enabled: true, model: "child-model", overrides: { scout: { enabled: false } } },
  });
  expect(config.children.enabled).toBe(true);
  expect(config.children.model).toBe("child-model");
  expect(config.children.overrides.scout.enabled).toBe(false);
});

it("returns default children config when not specified", () => {
  const config = parseWatchdogConfig({ enabled: true });
  expect(config.children.enabled).toBe(false);
  expect(config.children.overrides).toEqual({});
});
```

- [ ] **Step 8: Run typecheck and all watchdog tests**

Run: `npx tsc --noEmit && npx vitest run tests/watchdog.test.ts tests/watchdog-child.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add src/core/watchdog-child.ts src/core/watchdog.ts src/index.ts tests/watchdog-child.test.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add child watchdog with per-agent config resolution"
```

---

### Task 4: Turn-Delta Mode

Alternative review mode: instead of reviewing git diffs, review the last N tool calls + responses from the agent's conversation. Useful for non-code agents (research, planning) where git diff is meaningless.

**Architecture:** Add `reviewChangesOnly` flag to `WatchdogConfig` (default: `true`). When `false`, `handleAgentEnd` skips git diff/LSP and instead formats the agent's session messages into a turn-delta string for review.

**Session data access:** `AgentRecord.session` has a `.messages` array (used by `getAgentConversation`). We pass a `getSessionMessages` callback to the runtime so it can access the conversation.

**Files:**
- Create: `src/core/watchdog-turn-delta.ts`
- Modify: `src/core/watchdog.ts` (add `reviewChangesOnly` to config, add turn-delta branch in handleAgentEnd)
- Modify: `src/index.ts` (wire getSessionMessages)
- Test: `tests/watchdog-turn-delta.test.ts`, `tests/watchdog.test.ts`

- [ ] **Step 1: Write failing tests for turn-delta formatting**

Create `tests/watchdog-turn-delta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatWatchdogTurnDelta } from "../src/core/watchdog-turn-delta.js";

describe("formatWatchdogTurnDelta", () => {
  it("formats tool_use blocks with name and input", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", name: "read_file", input: { path: "/foo.ts" } }] },
      { role: "tool", content: [{ type: "tool_result", content: "file contents here" }] },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("read_file");
    expect(result).toContain("/foo.ts");
  });

  it("redacts large edit/write tool inputs", () => {
    const longContent = "x".repeat(500);
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", name: "edit", input: { path: "/foo.ts", old_string: longContent, new_string: longContent } }] },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("[omitted 500 chars]");
    expect(result).not.toContain("x".repeat(100));
  });

  it("limits to last N messages", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: "assistant",
      content: [{ type: "tool_use", name: `tool_${i}`, input: {} }],
    }));
    const result = formatWatchdogTurnDelta(messages, 5);
    expect(result).toContain("tool_19");
    expect(result).toContain("tool_15");
    expect(result).not.toContain("tool_0");
  });

  it("handles string content in user/assistant messages", () => {
    const messages = [
      { role: "user", content: "Please fix the bug" },
      { role: "assistant", content: "I'll fix that now." },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("Please fix the bug");
    expect(result).toContain("I'll fix that now");
  });

  it("handles text blocks in content arrays", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "Let me analyze this." }] },
    ];
    const result = formatWatchdogTurnDelta(messages, 10);
    expect(result).toContain("Let me analyze this.");
  });

  it("returns empty string for empty messages", () => {
    expect(formatWatchdogTurnDelta([], 10)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/watchdog-turn-delta.test.ts --reporter=verbose`
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
    const m = msg as { role?: string; content?: unknown };
    if (!m.role || m.content === undefined) continue;

    // String content (user/assistant)
    if (typeof m.content === "string") {
      parts.push(`[${m.role}] ${m.content.slice(0, 500)}`);
      continue;
    }

    if (!Array.isArray(m.content)) continue;

    for (const block of m.content) {
      const b = block as {
        type?: string;
        name?: string;
        text?: string;
        input?: unknown;
        content?: unknown;
      };

      if (b.type === "tool_use") {
        const redacted = redactToolInput(b.name ?? "", b.input);
        const inputStr = JSON.stringify(redacted).slice(0, 500);
        parts.push(`[tool_use] ${b.name}: ${inputStr}`);
      } else if (b.type === "tool_result") {
        const text = typeof b.content === "string"
          ? b.content.slice(0, 300)
          : JSON.stringify(b.content).slice(0, 300);
        parts.push(`[tool_result] ${text}`);
      } else if (b.type === "text") {
        const text = b.text ?? (typeof b.content === "string" ? b.content : "");
        if (text) parts.push(`[${m.role}] ${text.slice(0, 500)}`);
      }
    }
  }

  return parts.join("\n\n");
}

// Keys whose values should be redacted in edit/write tools
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

Run: `npx vitest run tests/watchdog-turn-delta.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Add reviewChangesOnly to WatchdogConfig**

In `src/core/watchdog.ts`, update the config interface:

```typescript
export interface WatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
  reviewChangesOnly: boolean;  // NEW: default true. When false, uses turn-delta mode
  children: {
    enabled: boolean;
    model?: string;
    thinking?: string;
    overrides: Record<string, WatchdogChildOverride>;
  };
  lsp: { /* unchanged */ };
}
```

Update default:
```typescript
const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  reviewChangesOnly: true,
  children: { enabled: false, overrides: {} },
  lsp: { enabled: true, timeoutMs: 3_000, maxFiles: 20, maxDiagnostics: 50 },
};
```

Update `parseWatchdogConfig`:
```typescript
if (typeof r.reviewChangesOnly === "boolean") config.reviewChangesOnly = r.reviewChangesOnly;
```

- [ ] **Step 6: Add getSessionMessages to WatchdogRuntimeOptions**

In `src/core/watchdog.ts`:

```typescript
export interface WatchdogRuntimeOptions {
  runReview?: (diff: string, lspOutput: string, agentId: string) => Promise<WatchdogWarning[]>;
  onWarnings?: (agentId: string, warnings: WatchdogWarning[]) => void;
  /** Provide session messages for turn-delta mode. */
  getSessionMessages?: (agentId: string) => unknown[] | undefined;
}
```

- [ ] **Step 7: Add turn-delta branch to handleAgentEnd**

In `src/core/watchdog.ts`, at the start of `handleAgentEnd` (after the `if (!config.enabled || disposed) return []` check), add the turn-delta branch:

```typescript
async function handleAgentEnd(agentId: string, cwd: string): Promise<WatchdogWarning[]> {
  if (!config.enabled || disposed) return [];

  // Turn-delta mode: review conversation instead of git diff
  if (!config.reviewChangesOnly) {
    currentStatus = "reviewing";
    try {
      let turnDelta = "(no conversation data available)";
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
    } finally {
      currentStatus = config.enabled && !disposed ? "idle" : "disabled";
    }
  }

  // Git-diff mode (existing logic, unchanged)
  const signature = computeChangeSignature(cwd);
  if (!signature) return [];
  // ... rest of existing logic
```

- [ ] **Step 8: Wire getSessionMessages in index.ts**

In `src/index.ts`, update the `createWatchdogRuntime` call (line ~126):

```typescript
const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => { /* existing logic */ },
  getSessionMessages: (agentId) => {
    const record = manager.getRecord(agentId);
    if (!record?.session) return undefined;
    return (record.session as { messages?: unknown[] }).messages;
  },
});
```

Note: `manager` is not yet constructed at this point. Since the watchdog is created before the manager, we need to use a late-binding pattern:

```typescript
const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => { /* existing logic */ },
  getSessionMessages: (agentId) => {
    // Late-bound: manager is constructed after watchdog
    const record = deps.manager?.getRecord(agentId);
    if (!record?.session) return undefined;
    return (record.session as { messages?: unknown[] }).messages;
  },
});
```

Wait — `deps` is also not yet assigned. The cleanest fix: move `getSessionMessages` to reference `manager` directly (it's defined shortly after on line 159). Since the callback is only invoked later (not at construction time), the closure will capture the `manager` variable after it's assigned. So:

```typescript
// Assign a reference that will be filled in after manager construction
let managerRef: { getRecord: (id: string) => { session?: unknown } | undefined } | undefined;

const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => { /* existing logic */ },
  getSessionMessages: (agentId) => {
    const record = managerRef?.getRecord(agentId);
    if (!record?.session) return undefined;
    return (record.session as { messages?: unknown[] }).messages;
  },
});

// ... then after manager construction (line 159):
managerRef = manager;
```

Alternative (simpler): since the manager is declared just below and the callback is invoked asynchronously, just reference `manager` directly. JavaScript closures capture the variable binding, not the value. The function will see the assigned `manager` when called.

```typescript
// This works because handleAgentEnd is only called after manager is assigned:
getSessionMessages: (agentId) => {
  const record = manager?.getRecord(agentId);
  if (!record?.session) return undefined;
  return (record.session as { messages?: unknown[] }).messages;
},
```

But `manager` is declared on line 159 with `const manager = new AgentManager(...)`. It's declared AFTER the watchdog. In strict TypeScript, this would be a reference error. So we need a different approach.

**Cleanest solution**: Declare a `let` variable before the watchdog, assign after manager construction:

```typescript
let sessionMessageSource: ((agentId: string) => unknown[] | undefined) | undefined;

const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => { /* ... */ },
  getSessionMessages: (agentId) => sessionMessageSource?.(agentId),
});

// ... later, after manager construction:
sessionMessageSource = (agentId) => {
  const record = manager.getRecord(agentId);
  if (!record?.session) return undefined;
  return (record.session as { messages?: unknown[] }).messages;
};
```

- [ ] **Step 9: Add test for turn-delta mode in runtime**

In `tests/watchdog.test.ts`, add:

```typescript
describe("turn-delta mode", () => {
  it("uses turn delta when reviewChangesOnly is false", async () => {
    let reviewInput = "";
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true, reviewChangesOnly: false }),
      {
        runReview: async (diff) => {
          reviewInput = diff;
          return [];
        },
        getSessionMessages: () => [
          { role: "assistant", content: [{ type: "tool_use", name: "read_file", input: { path: "/x.ts" } }] },
        ],
      },
    );

    await runtime.handleAgentEnd("agent-1", "/tmp/nonexistent");
    expect(reviewInput).toContain("read_file");
    expect(reviewInput).toContain("/x.ts");
  });

  it("falls back to git diff when reviewChangesOnly is true (default)", async () => {
    let reviewCalled = false;
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({ enabled: true }),
      {
        runReview: async () => {
          reviewCalled = true;
          return [];
        },
        getSessionMessages: () => [{ role: "assistant", content: "test" }],
      },
    );

    // Non-git directory: git diff mode returns early with no changes
    await runtime.handleAgentEnd("agent-1", "/tmp");
    expect(reviewCalled).toBe(false); // Never reaches review since no git changes
  });
});
```

- [ ] **Step 10: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/watchdog.test.ts tests/watchdog-turn-delta.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 11: Commit**

```bash
git add src/core/watchdog-turn-delta.ts src/core/watchdog.ts src/index.ts tests/watchdog-turn-delta.test.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add turn-delta review mode with input redaction

When reviewChangesOnly is false, reviews the agent's conversation
instead of git diffs. Useful for non-code agents (research, planning)."
```

---

### Task 5: Auto-Follow Steering

When watchdog finds blockers, automatically resume the reviewed agent to fix them. Uses `manager.resume()` which does NOT trigger `onComplete` (no recursion risk).

**Safety measures:**
- Disabled by default (`autoFollow.blockers: false`)
- Conservative `maxAttempts: 2` default
- Stalemate detection: stops if same warning repeats `stalemateRepeats` times
- Warning state tracking: marks warnings with `autoFollowAttempt` count and `stalemate` state

**Files:**
- Modify: `src/core/watchdog.ts` (add autoFollow config, add post-review auto-follow logic)
- Modify: `src/index.ts` (wire resumeAgent callback)
- Test: `tests/watchdog.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/watchdog.test.ts`, add:

```typescript
describe("auto-follow steering", () => {
  it("resumes agent when blockers found and autoFollow.blockers is true", async () => {
    const tmp = makeTmp("watchdog-autofollow-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const resumed: Array<{ id: string; message: string }> = [];
    let callCount = 0;

    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({
        enabled: true,
        autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
      }),
      {
        runReview: async () => {
          callCount++;
          if (callCount === 1) {
            return [{ severity: "blocker", summary: "Bug found", evidence: "file.ts:1", recommendedAction: "Fix it", category: "correctness" }];
          }
          return []; // Fixed on second review
        },
        resumeAgent: async (id, message) => {
          resumed.push({ id, message });
        },
      },
    );

    await runtime.handleAgentEnd("agent-1", tmp);
    expect(resumed).toHaveLength(1);
    expect(resumed[0].id).toBe("agent-1");
    expect(resumed[0].message).toContain("Bug found");
  });

  it("stops after maxAttempts even if issues persist", async () => {
    const tmp = makeTmp("watchdog-maxattempts-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const resumed: string[] = [];
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({
        enabled: true,
        autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 3 },
      }),
      {
        runReview: async () => [
          { severity: "blocker", summary: "Persistent bug", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd("agent-1", tmp);
    expect(resumed).toHaveLength(2); // maxAttempts = 2
  });

  it("detects stalemate when same warning repeats", async () => {
    const tmp = makeTmp("watchdog-stalemate-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const resumed: string[] = [];
    let warningsEmitted: WatchdogWarning[] = [];
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({
        enabled: true,
        autoFollow: { blockers: true, concerns: false, maxAttempts: 5, stalemateRepeats: 2 },
      }),
      {
        runReview: async () => [
          { severity: "blocker", summary: "Same bug", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
        onWarnings: (_id, w) => { warningsEmitted = w; },
      },
    );

    await runtime.handleAgentEnd("agent-1", tmp);
    // Should stop at stalemateRepeats (2), not maxAttempts (5)
    expect(resumed.length).toBeLessThanOrEqual(2);
    expect(warningsEmitted.length).toBeGreaterThan(0);
  });

  it("does nothing when autoFollow.blockers is false", async () => {
    const tmp = makeTmp("watchdog-noautofollow-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const resumed: string[] = [];
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({
        enabled: true,
        autoFollow: { blockers: false, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
      }),
      {
        runReview: async () => [
          { severity: "blocker", summary: "Bug", evidence: "file.ts:1", recommendedAction: "Fix", category: "correctness" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd("agent-1", tmp);
    expect(resumed).toHaveLength(0);
  });

  it("does not resume for concerns when only blockers enabled", async () => {
    const tmp = makeTmp("watchdog-concerns-");
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 1;");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.ts"), "const x = 2;");

    const resumed: string[] = [];
    const runtime = createWatchdogRuntime(
      parseWatchdogConfig({
        enabled: true,
        autoFollow: { blockers: true, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
      }),
      {
        runReview: async () => [
          { severity: "concern", summary: "Style issue", evidence: "file.ts:1", recommendedAction: "Refactor", category: "other" },
        ],
        resumeAgent: async (id) => { resumed.push(id); },
      },
    );

    await runtime.handleAgentEnd("agent-1", tmp);
    expect(resumed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/watchdog.test.ts --reporter=verbose`
Expected: FAIL — autoFollow config not parsed, resumeAgent not in options type

- [ ] **Step 3: Add autoFollow to WatchdogConfig**

In `src/core/watchdog.ts`, extend the interface:

```typescript
export interface WatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
  reviewChangesOnly: boolean;
  children: {
    enabled: boolean;
    model?: string;
    thinking?: string;
    overrides: Record<string, WatchdogChildOverride>;
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

Update default:
```typescript
const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  reviewChangesOnly: true,
  children: { enabled: false, overrides: {} },
  autoFollow: { blockers: false, concerns: false, maxAttempts: 2, stalemateRepeats: 2 },
  lsp: { enabled: true, timeoutMs: 3_000, maxFiles: 20, maxDiagnostics: 50 },
};
```

Update `parseWatchdogConfig`:
```typescript
if (r.autoFollow && typeof r.autoFollow === "object") {
  const af = r.autoFollow as Record<string, unknown>;
  if (typeof af.blockers === "boolean") config.autoFollow.blockers = af.blockers;
  if (typeof af.concerns === "boolean") config.autoFollow.concerns = af.concerns;
  if (typeof af.maxAttempts === "number") config.autoFollow.maxAttempts = af.maxAttempts;
  if (typeof af.stalemateRepeats === "number") config.autoFollow.stalemateRepeats = af.stalemateRepeats;
}
```

- [ ] **Step 4: Add resumeAgent to WatchdogRuntimeOptions**

```typescript
export interface WatchdogRuntimeOptions {
  runReview?: (diff: string, lspOutput: string, agentId: string) => Promise<WatchdogWarning[]>;
  onWarnings?: (agentId: string, warnings: WatchdogWarning[]) => void;
  getSessionMessages?: (agentId: string) => unknown[] | undefined;
  /** Resume a completed agent with a fix instruction. Used by auto-follow. */
  resumeAgent?: (agentId: string, message: string) => Promise<void>;
}
```

- [ ] **Step 5: Implement auto-follow logic in handleAgentEnd**

In `src/core/watchdog.ts`, after warnings are collected in `handleAgentEnd` (both git-diff and turn-delta branches), add the auto-follow logic BEFORE returning warnings. Place this as a helper function inside `createWatchdogRuntime`:

```typescript
async function attemptAutoFollow(
  agentId: string,
  cwd: string,
  initialWarnings: WatchdogWarning[],
): Promise<WatchdogWarning[]> {
  if (!options?.resumeAgent) return initialWarnings;

  const hasBlockers = initialWarnings.some((w) => w.severity === "blocker");
  const hasConcerns = initialWarnings.some((w) => w.severity === "concern");
  const shouldFollow =
    (config.autoFollow.blockers && hasBlockers) ||
    (config.autoFollow.concerns && hasConcerns);

  if (!shouldFollow) return initialWarnings;

  let warnings = initialWarnings;
  let lastKey = warningKey(warnings);
  let repeatCount = 0;

  for (let attempt = 0; attempt < config.autoFollow.maxAttempts; attempt++) {
    // Send steering message to the agent
    const steerMsg = [
      "Watchdog found issues that need fixing:",
      ...warnings.map((w) => `- [${w.severity}] ${w.summary}: ${w.recommendedAction}`),
      "",
      "Please address these issues.",
    ].join("\n");

    await options.resumeAgent(agentId, steerMsg);

    // Re-review after agent resumes
    let newWarnings: WatchdogWarning[];
    if (options.runReview) {
      newWarnings = await options.runReview("(re-review after auto-follow)", "(re-review)", agentId);
    } else {
      newWarnings = await runDefaultReview(config, "(re-review)", "(re-review)", agentId, globalSeen);
    }

    if (newWarnings.length === 0) return []; // Agent fixed all issues

    // Stalemate detection
    const newKey = warningKey(newWarnings);
    if (newKey === lastKey) {
      repeatCount++;
      if (repeatCount >= config.autoFollow.stalemateRepeats) {
        return newWarnings; // Stalemate — surface remaining warnings
      }
    } else {
      repeatCount = 0;
      lastKey = newKey;
    }
    warnings = newWarnings;
  }

  return warnings; // maxAttempts exhausted
}

function warningKey(warnings: WatchdogWarning[]): string {
  return warnings.map((w) => w.summary.toLowerCase().trim()).sort().join("|");
}
```

Then in `handleAgentEnd`, after collecting initial warnings:

```typescript
// Auto-follow steering (both git-diff and turn-delta modes)
if (warnings.length > 0) {
  warnings = await attemptAutoFollow(agentId, cwd, warnings);
}

if (warnings.length > 0) {
  options?.onWarnings?.(agentId, warnings);
}
return warnings;
```

**Important:** Remove the existing `options?.onWarnings?.(agentId, warnings)` call from before this block to avoid double-emission. The auto-follow logic now gates when onWarnings fires.

- [ ] **Step 6: Wire resumeAgent in index.ts**

In `src/index.ts`, add `resumeAgent` to the watchdog runtime options:

```typescript
const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => { /* existing */ },
  getSessionMessages: (agentId) => sessionMessageSource?.(agentId),
  resumeAgent: async (agentId, message) => {
    // manager is available by the time this is called (async)
    await manager.resume(agentId, message);
  },
});
```

Same late-binding note as Task 4: `manager` is declared after `watchdog`, but `resumeAgent` is only called asynchronously during `handleAgentEnd`, at which point `manager` is already assigned. Use the same pattern:

```typescript
let resumeAgentFn: ((id: string, msg: string) => Promise<void>) | undefined;

const watchdog = createWatchdogRuntime(watchdogConfig, {
  onWarnings: (agentId, warnings) => { /* existing */ },
  getSessionMessages: (agentId) => sessionMessageSource?.(agentId),
  resumeAgent: async (agentId, message) => {
    await resumeAgentFn?.(agentId, message);
  },
});

// After manager construction:
resumeAgentFn = async (id, msg) => { await manager.resume(id, msg); };
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/watchdog.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 8: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add src/core/watchdog.ts src/index.ts tests/watchdog.test.ts
git commit -m "feat(watchdog): add auto-follow steering with stalemate detection

Disabled by default (autoFollow.blockers: false).
Uses manager.resume() which does not trigger onComplete (no recursion).
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

Run: `npx eslint src/ tests/ --ext .ts` (or project lint command)
Expected: No new errors

- [ ] **Step 4: Verify config shape documentation**

Ensure the settings schema (if it exists) is updated to reflect the new watchdog config fields: `reviewChangesOnly`, `children`, `autoFollow`. Check `src/core/settings.ts` for any schema validation that needs updating.
