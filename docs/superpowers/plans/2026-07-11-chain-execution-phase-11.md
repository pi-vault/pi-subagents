# Chain Execution — Phase 11: Model Override, Background Chains, Prompt Workflows & Clarification TUI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four features deferred from phase 10: per-step model override, async/background chain execution (`--bg`), prompt workflow chains (`/prompt-workflow`, `/chain-prompts`), and the chain clarification TUI.

**Tech Stack:** pnpm, Vitest, TypeScript, `@earendil-works/pi-tui`

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 10 complete (phases 1-10 are merged to master).

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents`

- Model override: `src/runs/shared/model-fallback.ts` (`resolveSubagentModelOverride`), `src/runs/foreground/chain-execution.ts` lines 1113-1119
- Background chains: `src/runs/background/async-execution.ts` (`executeAsyncChain`), `src/runs/background/subagent-runner.ts`
- Prompt workflows: `src/slash/prompt-workflows.ts`
- Clarification TUI: `src/runs/foreground/chain-clarify.ts`

---

## File Map

### New Files

| File | Responsibility |
| --- | --- |
| `src/core/prompt-workflows.ts` | Prompt workflow discovery, `/prompt-workflow` and `/chain-prompts` commands |
| `src/tui/chain-clarify.ts` | Chain clarification TUI component for previewing/editing chains before execution |
| `tests/prompt-workflows.test.ts` | Unit tests for prompt workflow parsing, discovery, chain conversion |
| `tests/chain-clarify.test.ts` | Unit tests for clarification component |
| `prompts/` | Bundled prompt workflow templates (optional starter set) |

### Modified Files

| File | Changes |
| --- | --- |
| `src/shared/types.ts` | Add `model?: unknown` to `SpawnOptions` (line ~278); add `userPromptsDir`, `bundledPromptsDir` to `ResolvedPaths` (line ~42) |
| `src/core/agent-manager.ts` | Pass `model: options.model` in `startAgent` RunOptions (line ~190); add `registerExternalRecord()`, `notifyComplete()` |
| `src/core/chain-execution.ts` | Add `model?: string` to `StepSpawnOptions` (line 29); pipe `behavior.model` into spawn options at all 3 branches |
| `src/core/subagent.ts` | Pipe `options?.model` through `spawnAndWait` callback; add background chain dispatch path before foreground chain |
| `src/core/slash-chain.ts` | Refactor `stripExecutionFlags` to return `{ args, bg }`; wire `bg` flag through `executeSlashChain` |
| `src/core/paths.ts` | Add `getBundledPromptsDir()`, add prompt paths to `resolvePaths()` |
| `src/index.ts` | Import and register prompt workflow commands |
| `tests/chain-execution.test.ts` | Add model override piping tests |

---

### Task 16: Per-step model override

**Files:**

- Modify: `src/core/chain-execution.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `tests/chain-execution.test.ts`

**Architecture:**

The model resolution pipeline already handles most of this:

1. `SequentialStep.model` and `ParallelTaskItem.model` fields exist in `types.ts` (lines 330, 349)
2. `resolveStepBehavior()` already receives and returns `model` (chain-settings.ts line 108)
3. `chain-execution.ts` already passes `model: seqStep.model` / `model: item.model` to `resolveStepBehavior` (lines 133-139, 345-351)
4. `runAgent()` uses `(options.model ?? ctx.model)` at agent-runner.ts line 245

The gap: `StepSpawnOptions` has no `model` field, the `spawnAndWait` callbacks don't pipe model through, `SpawnOptions` has no `model` field, and `startAgent` doesn't pass `model` in `RunOptions`.

**SDK limitation:** The current SDK provides no `getModelById(string)` API. `ctx.model` is an opaque object, `modelRegistry.listModels()` returns metadata only. For now, we thread the model string through `agentDef.model` so `runAgent` can use it for informational display. Actual model switching will require SDK support for model-by-id lookup. This is acceptable — the plumbing is the valuable work, and it will "just work" once the SDK adds the API.

- [ ] **Step 1: Add `model` to `StepSpawnOptions`**

In `src/core/chain-execution.ts` (line 29-33), add model:

```typescript
export interface StepSpawnOptions {
  toolBudget?: ResolvedToolBudget;
  isolation?: "worktree";
  skills?: string[];
  model?: string; // Model string (e.g. "anthropic/claude-sonnet-4-5")
}
```

- [ ] **Step 2: Pipe `behavior.model` into spawn options in all 3 branches**

In `src/core/chain-execution.ts`, after `resolveStepBehavior` in each branch, set the model on spawn options if present:

**Sequential branch** (after line 374, where `seqOptions` is built):

```typescript
if (behavior.model) seqOptions.model = behavior.model;
```

**Parallel branch** (after line 163, where `parallelOptions` is built):

```typescript
if (behavior.model) parallelOptions.model = behavior.model;
```

**Dynamic parallel branch** (after line 279, where `dynOptions` is built — also add `model` to `resolveStepBehavior` call at line 261 which is currently missing it):

```typescript
const dynBehavior = resolveStepBehavior(agentDefaults(dynAgentDef), {
  output: step.parallel.output,
  outputMode: step.parallel.outputMode,
  reads: step.parallel.reads,
  progress: step.parallel.progress,
  skills: step.parallel.skills,
  model: step.parallel.model, // <-- ADD THIS (currently missing)
});
```

Then after `dynOptions` construction:

```typescript
if (dynBehavior.model) dynOptions.model = dynBehavior.model;
```

- [ ] **Step 3: Add `model` to `SpawnOptions`**

In `src/shared/types.ts` (line 278-301), add to `SpawnOptions`:

```typescript
export interface SpawnOptions {
  // ... existing fields ...
  model?: unknown; // Opaque model object from pi-ai
  toolBudget?: ResolvedToolBudget;
}
```

- [ ] **Step 4: Pass `model` through `startAgent` in `agent-manager.ts`**

In `src/core/agent-manager.ts`, in `startAgent` (line ~190), add `model` to the RunOptions passed to `runAgent()`:

```typescript
const promise = runAgent(
  agentDef,
  {
    prompt: options.prompt,
    cwd: effectiveCwd,
    agentId: id,
    model: options.model, // <-- ADD THIS
    maxTurns: options.maxTurns,
    // ... rest unchanged
  },
  ctx as { model?: unknown; modelRegistry?: unknown },
)
```

- [ ] **Step 5: Pipe model through `spawnAndWait` callbacks**

In `src/core/subagent.ts` (line 230-241), update the `spawnAndWait` callback to forward model. The model string needs to override `agentDef.model` so it reaches `runAgent`:

```typescript
spawnAndWait: async (agentDef, prompt, stepCwd, options) => {
  const effectiveAgentDef = options?.skills
    ? { ...agentDef, skills: options.skills }
    : agentDef;
  // Override agentDef.model if step specifies a model string
  const withModel = options?.model
    ? { ...effectiveAgentDef, model: options.model }
    : effectiveAgentDef;
  return deps.manager.spawnAndWait(ctx, withModel, {
    prompt,
    cwd: stepCwd || effectiveCwd,
    maxTurns: loadedConfig.config.defaultMaxTurns,
    toolBudget: options?.toolBudget,
    isolation: options?.isolation,
  });
},
```

Apply the same change in `src/core/slash-chain.ts` `executeSlashChain` function (line 514-525).

Note: `agentDef.model` is a string used for informational display. `options.model` in `SpawnOptions` is the opaque model object. Since we can't convert string → object without SDK support, we override `agentDef.model` (string) for now. When the SDK adds `getModelById()`, we can also pass the resolved object through `SpawnOptions.model`.

- [ ] **Step 6: Add tests**

In `tests/chain-execution.test.ts`, add:

```typescript
describe("executeChain — model override", () => {
  test("passes model string through StepSpawnOptions for sequential step", async () => {
    const receivedOptions: unknown[] = [];

    await executeChain({
      steps: [{ agent: "worker", task: "build", model: "anthropic/claude-sonnet-4-5" }],
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options?: unknown) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-model",
    });

    expect((receivedOptions[0] as { model?: string }).model).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });

  test("passes model string through StepSpawnOptions for parallel items", async () => {
    const receivedOptions: unknown[] = [];

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "t1", model: "anthropic/claude-sonnet-4-5" },
          { agent: "b", task: "t2" },
        ],
      } satisfies ParallelStep,
    ];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options?: unknown) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: (name) => makeAgentDef(name),
      cwd: "/tmp",
      runId: "test-model-parallel",
    });

    expect((receivedOptions[0] as { model?: string }).model).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    expect((receivedOptions[1] as { model?: string }).model).toBeUndefined();
  });

  test("does not set model when step has no model field", async () => {
    const receivedOptions: unknown[] = [];

    await executeChain({
      steps: [{ agent: "worker", task: "build" }],
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options?: unknown) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-no-model",
    });

    expect((receivedOptions[0] as { model?: string }).model).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run check and commit**

Run: `pnpm check`
Expected: PASS

```bash
git add -A
git commit -m "feat(chain-execution): add per-step model override plumbing"
```

---

### Task 17: Background chain execution

**Files:**

- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `tests/chain-execution.test.ts`

**Design:**

When `run_in_background: true` is set with a chain, the chain loop runs as a background Promise tracked by a top-level `AgentRecord`. The caller gets a chain ID immediately.

The chain is a single `executeChain()` call that returns a Promise. For background execution:
1. Create a proper `AgentRecord` for the chain (with required fields `type` and `description`)
2. Register it with `AgentManager` via new `registerExternalRecord()` method
3. Start `executeChain()` as a fire-and-forget Promise
4. On completion, update the record's status and call `notifyComplete()` so the LLM gets notified
5. Return the chain ID immediately

We do NOT use `AgentManager.spawn()` because that expects an `AgentDefinition` and calls `runAgent()`. Instead, the chain dispatch block creates a record directly and manages the lifecycle.

- [ ] **Step 1: Add `registerExternalRecord` and `notifyComplete` to `AgentManager`**

In `src/core/agent-manager.ts`, add after `spawnAndWait` (after line 148):

```typescript
/**
 * Register an externally-managed record (e.g. chain execution).
 * The caller is responsible for updating the record's lifecycle fields.
 */
registerExternalRecord(id: string, record: AgentRecord): void {
  this.agents.set(id, record);
}

/**
 * Trigger completion notification for an externally-managed record.
 * Call this after updating the record's status/result fields.
 */
notifyComplete(id: string): void {
  const record = this.agents.get(id);
  if (record) this.onComplete?.(record);
}
```

- [ ] **Step 2: Add background chain dispatch path in `subagent.ts`**

In `src/core/subagent.ts`, within the chain dispatch block (line 224), add a background path BEFORE the existing foreground path. First, extract the `spawnAndWait` and `findAgent` callbacks into shared local variables:

```typescript
// --- Chain mode dispatch ---
if (params.chain) {
  const chainRunId = `chain-${Date.now().toString(36)}`;

  // Shared callbacks for both foreground and background paths
  const chainSpawnAndWait = async (
    agentDef: AgentDefinition,
    prompt: string,
    stepCwd: string,
    options?: StepSpawnOptions,
  ) => {
    const effectiveAgentDef = options?.skills
      ? { ...agentDef, skills: options.skills }
      : agentDef;
    const withModel = options?.model
      ? { ...effectiveAgentDef, model: options.model }
      : effectiveAgentDef;
    return deps.manager.spawnAndWait(ctx, withModel, {
      prompt,
      cwd: stepCwd || effectiveCwd,
      maxTurns: loadedConfig.config.defaultMaxTurns,
      toolBudget: options?.toolBudget,
      isolation: options?.isolation,
    });
  };

  const chainFindAgent = (name: string) => {
    const agent = findAgentByName(discovery, name);
    if (!agent) throw new Error(`Unknown agent: "${name}"`);
    return agent;
  };

  // Background chain path
  if (params.run_in_background) {
    const record: AgentRecord = {
      id: chainRunId,
      type: "(chain)",
      description: `Chain: ${params.task?.slice(0, 60) ?? ""}`,
      status: "running",
      startedAt: Date.now(),
      toolUses: 0,
      turnCount: 0,
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      isBackground: true,
    };
    deps.manager.registerExternalRecord(chainRunId, record);

    // Fire the chain Promise (don't await)
    const { executeChain } = await import("./chain-execution.js");
    executeChain({
      steps: params.chain as ChainStep[],
      task: params.task ?? "",
      spawnAndWait: chainSpawnAndWait,
      findAgent: chainFindAgent,
      cwd: effectiveCwd,
      runId: chainRunId,
      signal,
      onGraphUpdate: (snapshot) => deps.chainWidget?.update(snapshot),
    }).then((chainResult) => {
      record.status = chainResult.isError ? "error" : "completed";
      record.result = chainResult.content;
      record.error = chainResult.isError ? chainResult.content : undefined;
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      deps.chainWidget?.clear();
      deps.manager.notifyComplete(chainRunId);
    }).catch((error) => {
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      deps.chainWidget?.clear();
      deps.manager.notifyComplete(chainRunId);
    });

    return {
      content: [{ type: "text", text:
        `Chain started in background.\n` +
        `Chain ID: ${chainRunId}\n` +
        `You will be notified when this chain completes.\n` +
        `Use get_subagent_result to retrieve full results.`,
      }],
      isError: false,
      details: stubDetails({
        status: "background" as const,
        agent: "(chain)",
        task: params.task ?? "",
        agentId: chainRunId,
      }),
    };
  }

  // Foreground chain path (existing code, updated to use shared callbacks)
  try {
    const { executeChain } = await import("./chain-execution.js");
    const chainResult = await executeChain({
      steps: params.chain as ChainStep[],
      task: params.task ?? "",
      spawnAndWait: chainSpawnAndWait,
      findAgent: chainFindAgent,
      cwd: effectiveCwd,
      runId: chainRunId,
      signal,
      onGraphUpdate: (snapshot) => deps.chainWidget?.update(snapshot),
    });
    // ... rest unchanged ...
  }
}
```

Import `StepSpawnOptions` type at the top of `subagent.ts`:

```typescript
import type { StepSpawnOptions } from "./chain-execution.js";
```

- [ ] **Step 3: Refactor `stripExecutionFlags` and wire `--bg` in slash commands**

In `src/core/slash-chain.ts`, refactor `stripExecutionFlags` (line 56-66) to return parsed flags:

```typescript
export interface ExecutionFlags {
  args: string;
  bg: boolean;
}

/** Extract and strip trailing --bg / --fork flags. */
export function stripExecutionFlags(rawArgs: string): ExecutionFlags {
  let args = rawArgs.trim();
  let bg = false;
  for (;;) {
    if (args.endsWith(" --bg") || args === "--bg") {
      args = args === "--bg" ? "" : args.slice(0, -5).trim();
      bg = true;
    } else if (args.endsWith(" --fork") || args === "--fork") {
      args = args === "--fork" ? "" : args.slice(0, -7).trim();
      // fork not wired yet
    } else break;
  }
  return { args, bg };
}
```

Update all callers (lines 576, 609) to destructure:

```typescript
const { args: cleanedArgs, bg } = stripExecutionFlags(args);
```

Update `executeSlashChain` signature (line 498) to accept `bg`:

```typescript
async function executeSlashChain(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  chain: ChainStep[],
  task: string,
  bg = false,
): Promise<void> {
```

Inside `executeSlashChain`, add background path before the existing foreground path, following the same pattern as the subagent tool (create a record, fire-and-forget, return immediately via `pi.sendMessage`).

Pass `bg` through from both `/chain` and `/run-chain` handlers:

```typescript
await executeSlashChain(pi, ctx, deps, built.chain, built.task, bg);
```

Update `tests/slash-chain.test.ts` (if it tests `stripExecutionFlags`) for the new return type.

- [ ] **Step 4: Add tests**

In `tests/chain-execution.test.ts`:

```typescript
describe("background chain execution", () => {
  test("registerExternalRecord makes record visible via getRecord", () => {
    // Test AgentManager.registerExternalRecord directly
  });

  test("notifyComplete triggers onComplete callback", () => {
    // Test AgentManager.notifyComplete directly
  });
});
```

Integration testing of background chain dispatch is best done via the `subagent.ts` execute path in `tests/subagent-chain.test.ts`.

- [ ] **Step 5: Run check and commit**

Run: `pnpm check`
Expected: PASS

```bash
git add -A
git commit -m "feat(chain-execution): add background chain execution via --bg flag"
```

---

### Task 18: Prompt workflow discovery and commands

**Files:**

- Create: `src/core/prompt-workflows.ts`
- Modify: `src/core/paths.ts`
- Modify: `src/shared/types.ts` (add to `ResolvedPaths`)
- Modify: `src/index.ts`
- Create: `tests/prompt-workflows.test.ts`

Prompt workflows are markdown files with YAML frontmatter that define reusable prompt templates. They're a lightweight adapter over the chain engine.

Reference: `nicobailon-pi-subagents/src/slash/prompt-workflows.ts`

Note: This project uses `src/core/` for all slash command code (see `slash-chain.ts`), not `src/slash/`. Follow the existing convention.

- [ ] **Step 1: Add prompt paths to `ResolvedPaths`**

In `src/shared/types.ts` (line 42-51):

```typescript
export interface ResolvedPaths {
  agentDir: string;
  configPath: string;
  userAgentsDir: string;
  bundledAgentsDir: string;
  sessionsDir: string;
  userChainsDir: string;
  bundledChainsDir: string;
  // Prompt workflow directories
  userPromptsDir: string;
  bundledPromptsDir: string;
}
```

In `src/core/paths.ts`, add the helper and update `resolvePaths`:

```typescript
export function getBundledPromptsDir(): string {
  return resolve(currentDir, "../../prompts");
}

export function resolvePaths(agentDir = getAgentDir()): ResolvedPaths {
  return {
    // ... existing fields ...
    userPromptsDir: join(agentDir, "prompts"),
    bundledPromptsDir: getBundledPromptsDir(),
  };
}
```

The `currentDir` variable already exists at line 6 (`const currentDir = dirname(fileURLToPath(import.meta.url))`), following the same pattern as `getBundledAgentsDir` and `getBundledChainsDir`.

- [ ] **Step 2: Create `src/core/prompt-workflows.ts` with types and frontmatter parser**

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ChainStep, ResolvedPaths } from "../shared/types.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";

export interface PromptWorkflow {
  name: string;            // filename without .md extension
  description: string;     // from frontmatter or first non-empty body line
  agent: string;           // from frontmatter "subagent" field, default "delegate"
  body: string;            // prompt body (after frontmatter)
  filePath: string;        // source file path
  model?: string;
  skills?: string[] | false;
  cwd?: string;
  chain?: string;          // chain declaration (e.g. "analyze -> fix")
}

// Reserved names that can't be used as workflow names
const RESERVED_NAMES = new Set([
  "chain-prompts", "prompt-workflow", "chain", "run-chain",
]);

type Frontmatter = Record<string, string>;
```

Reuse the same simple frontmatter parser pattern from `chain-serializer.ts` (line 18-29) — `---\n...\n---` delimited YAML-like key-value pairs.

- [ ] **Step 3: Implement prompt workflow discovery**

```typescript
function readPromptDir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

export function discoverPromptWorkflows(
  paths: ResolvedPaths,
  cwd?: string,
): PromptWorkflow[] {
  const workflows = new Map<string, PromptWorkflow>();

  // Scan directories in priority order: bundled < user < project
  // Later entries override earlier ones by name
  const dirs = [
    paths.bundledPromptsDir,
    paths.userPromptsDir,
    ...(cwd ? [join(cwd, ".pi", "prompts")] : []),
  ];

  for (const dir of dirs) {
    for (const filePath of readPromptDir(dir)) {
      const workflow = loadPromptWorkflow(filePath);
      if (workflow) workflows.set(workflow.name, workflow);
    }
  }

  return [...workflows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

`loadPromptWorkflow` parses frontmatter fields:
- `description` -> string
- `subagent` -> maps to `agent` (default: `"delegate"`)
- `model` -> string
- `skill` -> `"false"` | comma-separated names -> `string[] | false`
- `cwd` -> string
- `chain` -> string (chain declaration)

Filter out reserved names via `RESERVED_NAMES.has(name)`.

- [ ] **Step 4: Implement argument substitution**

```typescript
export function substituteArgs(body: string, args: string[]): string {
  return body
    .replace(/\$ARGUMENTS|\$@/g, args.join(" "))
    .replace(
      /\$\{(\d+):-([^}]*)\}/g,
      (_, n: string, fallback: string) => args[parseInt(n) - 1] ?? fallback,
    )
    .replace(/\$(\d+)/g, (_, n: string) => args[parseInt(n) - 1] ?? "");
}
```

- [ ] **Step 5: Implement chain step conversion and runtime option parsing**

```typescript
function workflowToChainStep(
  workflow: PromptWorkflow,
  args: string[],
): ChainStep {
  const task = substituteArgs(workflow.body, args).trim();
  return {
    agent: workflow.agent,
    task,
    ...(workflow.model ? { model: workflow.model } : {}),
    ...(workflow.skills !== undefined ? { skills: workflow.skills } : {}),
    ...(workflow.cwd ? { cwd: workflow.cwd } : {}),
  };
}

interface RuntimeOptions {
  args: string[];
  agentOverride?: string;
  bg?: boolean;
}

function parseRuntimeOptions(words: string[]): RuntimeOptions {
  const args: string[] = [];
  let agentOverride: string | undefined;
  let bg = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === "--bg" || w === "--async") { bg = true; continue; }
    if (w === "--subagent" && i + 1 < words.length) { agentOverride = words[++i]; continue; }
    const eq = w.match(/^--subagent[=:](.+)$/);
    if (eq) { agentOverride = eq[1]; continue; }
    args.push(w);
  }
  return { args, agentOverride, bg };
}
```

Also implement `shellWords(input: string): string[]` for tokenizing raw args (same pattern as reference — quote-aware word splitting).

- [ ] **Step 6: Register `/prompt-workflow` command**

```typescript
export function registerPromptWorkflowCommands(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  pi.registerCommand("prompt-workflow", {
    description: "Run a prompt template: /prompt-workflow <name> [args]",
    getArgumentCompletions: (prefix) => {
      try {
        const paths = deps.resolvePaths();
        const workflows = discoverPromptWorkflows(paths);
        const lower = prefix.toLowerCase();
        const matches = workflows.filter((w) =>
          w.name.toLowerCase().startsWith(lower),
        );
        return matches.length > 0
          ? matches.map((w) => ({ value: w.name, label: w.name }))
          : null;
      } catch {
        return null;
      }
    },
    handler: async (rawArgs, ctx: ExtensionCommandContext) => {
      const words = shellWords(rawArgs);
      const name = words.shift();
      const paths = deps.resolvePaths();
      const workflows = discoverPromptWorkflows(paths, ctx.cwd);

      if (!name || name === "list") {
        const list = workflows.length === 0
          ? "No prompt workflows found."
          : workflows.map((w) => `- ${w.name}: ${w.description}`).join("\n");
        pi.sendMessage({ content: list, display: true });
        return;
      }

      const workflow = workflows.find((w) => w.name === name);
      if (!workflow) {
        ctx.ui.notify(`Unknown prompt workflow: ${name}`, "error");
        return;
      }

      const runtime = parseRuntimeOptions(words);

      try {
        if (workflow.chain) {
          // Chain mode — split chain declaration and build steps
          const chainNames = workflow.chain.split(" -> ").map((s) => s.trim()).filter(Boolean);
          const chain = chainNames.map((stepName) => {
            const step = workflows.find((w) => w.name === stepName);
            if (!step) throw new Error(`Unknown workflow in chain '${workflow.name}': ${stepName}`);
            return workflowToChainStep(step, runtime.args);
          });
          // Execute as chain using the shared executeSlashChain pattern
          await executePromptChain(pi, ctx, deps, chain, runtime.args.join(" "));
          return;
        }
        // Single workflow — execute as single-step chain
        const step = workflowToChainStep(workflow, runtime.args);
        await executePromptChain(pi, ctx, deps, [step], step.task);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
```

- [ ] **Step 7: Register `/chain-prompts` command**

```typescript
  pi.registerCommand("chain-prompts", {
    description: "Chain prompt templates: /chain-prompts analyze -> fix -- args",
    handler: async (rawArgs, ctx: ExtensionCommandContext) => {
      const delimiterIdx = rawArgs.indexOf(" -- ");
      const declaration = delimiterIdx === -1 ? rawArgs.trim() : rawArgs.slice(0, delimiterIdx).trim();
      const argsText = delimiterIdx === -1 ? "" : rawArgs.slice(delimiterIdx + 4).trim();

      const paths = deps.resolvePaths();
      const workflows = discoverPromptWorkflows(paths, ctx.cwd);

      if (!declaration || declaration === "list") {
        const list = workflows.length === 0
          ? "No prompt workflows found."
          : workflows.map((w) => `- ${w.name}: ${w.description}`).join("\n");
        pi.sendMessage({ content: list, display: true });
        return;
      }

      const runtime = parseRuntimeOptions(shellWords(argsText));
      const names = declaration.split(" -> ").map((s) => s.trim()).filter(Boolean);
      if (names.length === 0) {
        ctx.ui.notify("Usage: /chain-prompts prompt-a -> prompt-b -- args", "error");
        return;
      }

      try {
        const chain = names.map((name) => {
          const workflow = workflows.find((w) => w.name === name);
          if (!workflow) throw new Error(`Unknown prompt workflow: ${name}`);
          return workflowToChainStep(workflow, runtime.args);
        });
        await executePromptChain(pi, ctx, deps, chain, runtime.args.join(" "));
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
```

The `executePromptChain` helper follows the same pattern as `executeSlashChain` in `slash-chain.ts` (line 498-550) — load config, discover agents, call `executeChain`, send result via `pi.sendMessage`.

- [ ] **Step 8: Register commands in `src/index.ts`**

Add import and registration following the existing pattern (line 20, 273):

```typescript
import { registerPromptWorkflowCommands } from "./core/prompt-workflows.js";

// In registerSubagentsExtension(), after registerChainCommands:
registerPromptWorkflowCommands(pi, deps);
```

- [ ] **Step 9: Write tests**

Create `tests/prompt-workflows.test.ts`:

```typescript
describe("discoverPromptWorkflows", () => {
  test("discovers .md files from directory");
  test("parses frontmatter fields correctly");
  test("project workflows override user workflows by name");
  test("returns empty array for nonexistent directories");
  test("filters out reserved command names");
});

describe("substituteArgs", () => {
  test("replaces $1 with first arg");
  test("replaces $ARGUMENTS with all args joined");
  test("replaces ${N:-fallback} with arg or fallback");
  test("leaves unmatched $N as empty string");
});

describe("parseRuntimeOptions", () => {
  test("extracts --bg flag");
  test("extracts --subagent override");
  test("passes through remaining args");
});
```

- [ ] **Step 10: Run check and commit**

Run: `pnpm check`
Expected: PASS

```bash
git add -A
git commit -m "feat(prompt-workflows): add /prompt-workflow and /chain-prompts commands"
```

---

### Task 19: Chain clarification TUI

**Files:**

- Create: `src/tui/chain-clarify.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Create: `tests/chain-clarify.test.ts`

The clarification TUI shows a preview of chain steps and lets the user edit them before execution. The reference implementation (`nicobailon-pi-subagents/src/runs/foreground/chain-clarify.ts`) is a full Component with model selection, skill toggling, and behavior overrides.

Reference: `nicobailon-pi-subagents/src/runs/foreground/chain-clarify.ts`

- [ ] **Step 1: Define result interface and types**

In `src/tui/chain-clarify.ts`:

```typescript
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ChainStep, AgentDefinition, SequentialStep } from "../shared/types.js";
import type { ResolvedStepBehavior } from "../core/chain-settings.js";
import type { Theme } from "./agent-widget.js";

export interface ChainClarifyResult {
  action: "run" | "cancel" | "bg";
  steps: ChainStep[];
}

export interface BehaviorOverride {
  task?: string;
  model?: string;
}

type EditMode = "list" | "edit-task" | "edit-model";
```

- [ ] **Step 2: Implement `ChainClarifyComponent`**

The component implements the `Component` interface from `@earendil-works/pi-tui`, which requires:
- `handleInput(data: string): void`
- `render(width: number): string[]`

Results are communicated via a `done` callback (same pattern as `ConversationViewer`).

```typescript
export class ChainClarifyComponent implements Component {
  private selectedIndex = 0;
  private mode: EditMode = "list";
  private overrides: Map<number, BehaviorOverride> = new Map();

  constructor(
    private tui: TUI,
    private theme: Theme,
    private steps: ChainStep[],
    private agents: AgentDefinition[],
    private task: string,
    private done: (result: ChainClarifyResult) => void,
  ) {}

  handleInput(data: string): void {
    // Key handling based on mode
    // list mode: Up/Down navigate, Enter runs, b backgrounds, Esc cancels, e edits task, m edits model
    // edit-task mode: text input, Enter confirms, Esc cancels
    // edit-model mode: text input for model string, Enter confirms, Esc cancels
  }

  render(width: number): string[] {
    // Render step list with current selection, overrides, and keybind hints
  }
}
```

**UI Layout:**

```
Chain Preview (3 steps)                    [Enter] Run  [b] Background  [Esc] Cancel
-----
  > [1] scout                    Context
      Task: Analyze the codebase for {task}
      Model: (inherit)

    [2] planner                  Planning
      Task: Create plan based on {outputs.context}
      Model: (inherit)

    [3] worker                   Implementation
      Task: Implement {outputs.plan}
      Model: (inherit)
-----
  [e] Edit task  [m] Model
```

Key bindings:
- `Up`/`Down` or `j`/`k`: Navigate steps
- `Enter`: Run chain (`action: "run"`)
- `b`: Switch to background (`action: "bg"`)
- `Esc` or `q`: Cancel (`action: "cancel"`)
- `e`: Edit task template for selected step
- `m`: Edit model override for selected step

Start with this minimal MVP. The reference has full rich editors for skills, output paths, reads, and progress toggles — these can be added incrementally after the basic component works.

- [ ] **Step 3: Implement edit modes**

Each edit mode replaces the step list with a single-line text input:

- **edit-task**: Shows current task text, user types replacement, Enter confirms, Esc cancels
- **edit-model**: Shows current model (or "(inherit)"), user types model string, Enter confirms, Esc cancels

On confirm, store the override in `this.overrides` map keyed by step index. On render, show overridden values with a marker (e.g. `*` prefix).

When `done` is called with `action: "run"` or `"bg"`, apply overrides to produce the final `steps` array:

```typescript
private applyOverrides(): ChainStep[] {
  return this.steps.map((step, i) => {
    const override = this.overrides.get(i);
    if (!override) return step;
    const seq = step as SequentialStep;
    return {
      ...seq,
      ...(override.task !== undefined ? { task: override.task } : {}),
      ...(override.model !== undefined ? { model: override.model } : {}),
    };
  });
}
```

- [ ] **Step 4: Add `clarify` parameter to subagent tool schema**

In `src/core/subagent.ts`, add to `SUBAGENT_TOOL_PARAMETERS` (after `chain_append`, around line 118):

```typescript
clarify: Type.Optional(
  Type.Boolean({
    description: "If true, show chain preview TUI before execution (interactive only)",
  }),
),
```

Add `clarify?: boolean` to the `SubagentToolInput` interface in `src/shared/types.ts`.

- [ ] **Step 5: Wire clarification into chain dispatch**

In `src/core/subagent.ts`, inside the chain dispatch block, before the background check, add clarification:

```typescript
if (params.chain) {
  // ... shared callbacks ...

  // Clarification TUI (interactive foreground only)
  if (params.clarify && !params.run_in_background) {
    const customUI = (ctx as { ui?: { custom?: unknown } }).ui as
      | { custom?: <T>(factory: (tui: TUI, theme: Theme, kb: unknown, done: (r: T) => void) => Component) => Promise<T> }
      | undefined;

    if (customUI?.custom) {
      const { ChainClarifyComponent } = await import("../tui/chain-clarify.js");
      const result = await customUI.custom<ChainClarifyResult>(
        (tui, theme, _kb, done) =>
          new ChainClarifyComponent(tui, theme, params.chain as ChainStep[], discovery.agents, params.task ?? "", done),
      );
      if (result.action === "cancel") {
        return {
          content: [{ type: "text", text: "Chain cancelled." }],
          isError: false,
          details: stubDetails({ agent: "(chain)", task: params.task ?? "", status: "aborted" as const }),
        };
      }
      if (result.action === "bg") {
        params.run_in_background = true;
      }
      // Apply user edits
      (params as { chain: unknown[] }).chain = result.steps;
    }
  }

  // ... background path ...
  // ... foreground path ...
}
```

Note: The `ctx.ui.custom` API availability needs to be verified at runtime. If `custom` is not available (e.g. non-interactive mode), clarification is silently skipped and the chain runs directly. The type cast is defensive — the actual API shape depends on the `@earendil-works/pi-tui` version.

- [ ] **Step 6: Write tests**

Create `tests/chain-clarify.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { ChainClarifyComponent } from "../src/tui/chain-clarify.js";

// Mock TUI and theme
const mockTui = { requestRender: vi.fn() } as any;
const mockTheme = { /* minimal theme fields */ } as any;

describe("ChainClarifyComponent", () => {
  test("renders step list with agent names", () => {
    const steps = [
      { agent: "scout", task: "analyze" },
      { agent: "planner", task: "plan" },
    ];
    let result: any;
    const component = new ChainClarifyComponent(
      mockTui, mockTheme, steps, [], "test task",
      (r) => { result = r; },
    );
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("scout"))).toBe(true);
    expect(lines.some((l) => l.includes("planner"))).toBe(true);
  });

  test("Enter key returns run action", () => {
    const steps = [{ agent: "scout", task: "analyze" }];
    let result: any;
    const component = new ChainClarifyComponent(
      mockTui, mockTheme, steps, [], "test",
      (r) => { result = r; },
    );
    component.handleInput("\r"); // Enter
    expect(result.action).toBe("run");
    expect(result.steps).toEqual(steps);
  });

  test("Escape key returns cancel action", () => {
    const steps = [{ agent: "scout", task: "analyze" }];
    let result: any;
    const component = new ChainClarifyComponent(
      mockTui, mockTheme, steps, [], "test",
      (r) => { result = r; },
    );
    component.handleInput("\x1b"); // Escape
    expect(result.action).toBe("cancel");
  });

  test("b key returns bg action", () => {
    const steps = [{ agent: "scout", task: "analyze" }];
    let result: any;
    const component = new ChainClarifyComponent(
      mockTui, mockTheme, steps, [], "test",
      (r) => { result = r; },
    );
    component.handleInput("b");
    expect(result.action).toBe("bg");
  });

  test("navigation changes selected index", () => {
    const steps = [
      { agent: "scout", task: "analyze" },
      { agent: "planner", task: "plan" },
    ];
    let result: any;
    const component = new ChainClarifyComponent(
      mockTui, mockTheme, steps, [], "test",
      (r) => { result = r; },
    );
    // Move down then run — verify selected step context
    component.handleInput("j"); // down
    const lines = component.render(80);
    // Second step should be selected (indicated by cursor marker)
    expect(lines.some((l) => l.includes(">") && l.includes("planner"))).toBe(true);
  });
});
```

- [ ] **Step 7: Run check and commit**

Run: `pnpm check`
Expected: PASS

```bash
git add -A
git commit -m "feat(tui): add chain clarification component for previewing/editing chains"
```

---

### Task 20: Final verification

- [ ] **Step 1: Run full check**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Run tests in isolation**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 3: Review the diff**

Run: `git diff master --stat`
Verify: Only expected files changed.

- [ ] **Step 4: Final commit if any integration fixes were needed**

```bash
git add -A
git commit -m "chore: phase 11 integration fixes"
```
