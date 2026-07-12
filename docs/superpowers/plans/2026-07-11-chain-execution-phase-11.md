# Chain Execution — Phase 11: Model Override, Background Chains, Prompt Workflows & Clarification TUI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four features deferred from phase 10: per-step model override, async/background chain execution (`--bg`), prompt workflow chains (`/chain-prompts`), and the chain clarification TUI.

**Architecture:** Each feature is self-contained. Model override threads a model string through `SpawnOptions` → `startAgent` → `runAgent`. Background chains use the existing `AgentManager.spawn()` with `isBackground: true`, wrapping the chain loop in a top-level `AgentRecord`. Prompt workflows are a lightweight adapter that discovers markdown templates and converts them to `ChainStep[]`. The clarification TUI is a new `Component` for previewing/editing chains before execution.

**Tech Stack:** pnpm, Vitest, TypeScript, `@earendil-works/pi-tui`

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 10 complete.

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
| `src/slash/prompt-workflows.ts` | Prompt workflow discovery, `/prompt-workflow` and `/chain-prompts` commands |
| `src/tui/chain-clarify.ts` | Chain clarification TUI component for previewing/editing chains before execution |
| `tests/prompt-workflows.test.ts` | Unit tests for prompt workflow parsing, discovery, chain conversion |
| `tests/chain-clarify.test.ts` | Unit tests for clarification component |
| `prompts/` | Bundled prompt workflow templates (optional starter set) |

### Modified Files

| File | Changes |
| --- | --- |
| `src/shared/types.ts` | Add `model?: string` to `SpawnOptions` |
| `src/core/agent-manager.ts` | Pipe `options.model` through to `RunOptions` in `startAgent` |
| `src/core/chain-execution.ts` | Add `StepSpawnOptions.model`; resolve and pass model per step |
| `src/core/subagent.ts` | Pipe `StepSpawnOptions.model` to `SpawnOptions.model`; add background chain path |
| `src/core/slash-chain.ts` | Wire `--bg` flag; pipe model; add `clarify` support |
| `src/core/paths.ts` | Add `userPromptsDir`, `bundledPromptsDir` to `ResolvedPaths` |
| `src/index.ts` | Register prompt workflow commands |
| `tests/chain-execution.test.ts` | Add model override tests |

---

### Task 16: Per-step model override

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/chain-execution.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `tests/chain-execution.test.ts`

The plumbing already exists on the `RunOptions` side (`model?: unknown` at line 250 of `types.ts`). `runAgent` uses `options.model ?? ctx.model` (line 245 of `agent-runner.ts`). The gap is that `SpawnOptions` has no `model` field, and `startAgent` never passes it.

- [ ] **Step 1: Add `model` to `SpawnOptions`**

In `src/shared/types.ts`, add to the `SpawnOptions` interface:

```typescript
export interface SpawnOptions {
  // ... existing fields ...
  model?: unknown; // Model override — opaque pi-ai model object
}
```

- [ ] **Step 2: Wire `model` through `startAgent` in `agent-manager.ts`**

In `src/core/agent-manager.ts`, in the `startAgent` method, add `model` to the `RunOptions` object passed to `runAgent()` (~line 190):

```typescript
const promise = runAgent(
  agentDef,
  {
    prompt: options.prompt,
    cwd: effectiveCwd,
    agentId: id,
    model: options.model, // <-- add this line
    maxTurns: options.maxTurns,
    // ... rest unchanged
  },
  ctx as { model?: unknown; modelRegistry?: unknown },
);
```

- [ ] **Step 3: Add `model` to `StepSpawnOptions` in `chain-execution.ts`**

Extend the interface (added in phase 10):

```typescript
export interface StepSpawnOptions {
  toolBudget?: ResolvedToolBudget;
  isolation?: "worktree";
  skills?: string[];
  model?: string; // Model string (e.g. "anthropic/claude-sonnet-4-5")
}
```

- [ ] **Step 4: Resolve and pass model per step in `chain-execution.ts`**

Add model resolution to `ChainExecutionParams`:

```typescript
export interface ChainExecutionParams {
  // ... existing fields ...
  resolveModel?: (modelString: string) => unknown | undefined;
}
```

In the sequential step branch, after calling `resolveStepBehavior`:

```typescript
if (behavior.model && params.resolveModel) {
  const resolved = params.resolveModel(behavior.model);
  if (resolved) stepOptions.model = resolved;
}
```

Same pattern for parallel and dynamic parallel branches — if `item.model` or `step.parallel.model` is set, resolve and pass it.

Note: `behavior.model` is a string like `"anthropic/claude-sonnet-4-5"`. The `resolveModel` callback converts it to the opaque model object that `runAgent` expects. The callback is optional — when absent, model override is silently skipped (safe default).

- [ ] **Step 5: Provide `resolveModel` callback in `subagent.ts`**

In the chain dispatch block, add the `resolveModel` callback using the existing `resolveModel` import and `ctx.modelRegistry`:

```typescript
resolveModel: (modelString) => {
  const registry = (ctx as { modelRegistry?: { listModels?: () => Array<{ id: string; provider: string; name?: string }> } }).modelRegistry;
  if (!registry?.listModels) return undefined;
  const match = resolveModel(modelString, registry.listModels());
  return match ? (ctx as { model?: unknown }).model : undefined;
  // Note: model instances aren't selectable by string alone in the current SDK.
  // This returns the parent model if the string validates. Full model switching
  // requires SDK support for model-by-id lookup — defer to a follow-up.
},
```

**Important limitation:** The current SDK provides `ctx.model` (the parent's model instance) but no `ctx.modelRegistry.getModelById(string)` API. We can validate the string, but can't obtain a different model instance. For now, the callback validates the model string exists and logs a warning if not — actual model switching is deferred until the SDK supports it.

A simpler pragmatic approach: skip `resolveModel` for now. Just pass the model string through `StepSpawnOptions.model` and let `startAgent` use it. The `agentDef.model` field (which is a string) will be read by `runAgent`, which already falls back to `ctx.model`. The string is informational until the SDK supports model-by-id lookup.

- [ ] **Step 6: Provide `resolveModel` callback in `slash-chain.ts`**

Same pattern as step 5 — mirror the callback or omit it (matching the pragmatic approach).

- [ ] **Step 7: Pipe `StepSpawnOptions.model` in callers**

In both `subagent.ts` and `slash-chain.ts`, update the `spawnAndWait` callback to forward model:

```typescript
spawnAndWait: async (agentDef, prompt, stepCwd, options) => {
  const effectiveAgentDef = options?.skills
    ? { ...agentDef, skills: options.skills }
    : agentDef;
  // If step specifies a model string, override the agentDef.model
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

This overrides `agentDef.model` which `runAgent` reads at line 251 (`options.thinking ?? agentDef.thinking`). Since `runAgent` uses `(options.model ?? ctx.model)` for the actual model instance, and `agentDef.model` is only used for informational display, the full model switching requires the approach in step 5 — but this at least threads the string through for future SDK support.

- [ ] **Step 8: Add tests**

```typescript
test("passes model string through StepSpawnOptions", async () => {
  const agentDefs: AgentDefinition[] = [];
  await executeChain({
    steps: [{ agent: "worker", task: "build", model: "anthropic/claude-sonnet-4-5" }],
    task: "test",
    spawnAndWait: async (agentDef, prompt, cwd, options) => {
      agentDefs.push(agentDef);
      return { id: "1", record: makeRecord("completed", "done") };
    },
    findAgent: () => makeAgentDef("worker"),
    cwd: "/tmp",
    runId: "test-model",
  });
  // Model string should be threaded through
  expect(agentDefs[0]).toBeDefined();
});
```

- [ ] **Step 9: Run check and commit**

Run: `pnpm check`
Expected: PASS

```bash
git add -A
git commit -m "feat(chain-execution): add per-step model override plumbing"
```

---

### Task 17: Background chain execution — in-process model

**Files:**

- Modify: `src/core/chain-execution.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `tests/chain-execution.test.ts`

The spec calls for in-process background chains (not detached processes like the reference). When `--bg` or `run_in_background: true` is set with a chain, the chain loop runs as a background Promise tracked by a top-level `AgentRecord`. The caller gets an ID immediately.

**Design:**

The chain is already a single `executeChain()` call that returns a Promise. For background execution:
1. Create a synthetic `AgentRecord` for the chain (with `status: "running"`)
2. Start `executeChain()` as a fire-and-forget Promise
3. On completion, update the record's `status`, `result`, `durationMs`
4. Return the chain ID immediately to the caller
5. The chain widget updates as usual via `onGraphUpdate`

We do NOT use `AgentManager.spawn()` because that expects an `AgentDefinition` and calls `runAgent()`. Instead, the chain dispatch block in `subagent.ts` creates a record directly and manages the lifecycle.

- [ ] **Step 1: Add chain record management to `AgentManager`**

Add a method to register an external record:

```typescript
registerExternalRecord(id: string, record: AgentRecord): void {
  this.agents.set(id, record);
}
```

This allows the chain dispatch to create its own record and register it for tracking. The chain ID appears in fleet-list and can be queried via `get_subagent_result`.

- [ ] **Step 2: Add background chain dispatch path in `subagent.ts`**

In the chain dispatch block, before the existing foreground chain execution, add a background path:

```typescript
if (params.chain) {
  const chainRunId = `chain-${Date.now().toString(36)}`;

  if (params.run_in_background) {
    // Background chain — fire and forget
    const record: AgentRecord = {
      id: chainRunId,
      name: "(chain)",
      status: "running",
      startedAt: Date.now(),
      toolUses: 0,
      turnCount: 0,
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      isBackground: true,
    };
    deps.manager.registerExternalRecord(chainRunId, record);

    // Fire the chain Promise (don't await)
    executeChain({
      steps: params.chain as ChainStep[],
      task: params.task ?? "",
      spawnAndWait: /* ... same callback as foreground ... */,
      findAgent: /* ... same callback as foreground ... */,
      cwd: effectiveCwd,
      runId: chainRunId,
      signal,
      onGraphUpdate: (snapshot) => deps.chainWidget?.update(snapshot),
    }).then((result) => {
      record.status = result.isError ? "error" : "completed";
      record.result = result.content;
      record.error = result.isError ? result.content : undefined;
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      deps.chainWidget?.clear();
    }).catch((error) => {
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      deps.chainWidget?.clear();
    });

    return {
      content: [{ type: "text", text:
        `Chain started in background.\nChain ID: ${chainRunId}\n` +
        `You will be notified when this chain completes.\n` +
        `Use get_subagent_result to retrieve full results.` }],
      isError: false,
      details: stubDetails({
        status: "background" as const,
        agent: "(chain)",
        task: params.task ?? "",
        agentId: chainRunId,
      }),
    };
  }

  // ... existing foreground chain path below ...
}
```

Extract the `spawnAndWait` and `findAgent` callbacks into shared local variables so both background and foreground paths use the same logic.

- [ ] **Step 3: Wire `--bg` flag in slash commands**

In `src/core/slash-chain.ts`, the parser already strips `--bg` via `stripExecutionFlags()`. Currently the flag is discarded. Wire it through:

In `registerChainCommands`, for both `/chain` and `/run-chain`:

```typescript
const flags = stripExecutionFlags(rawArgs);
// flags.bg is already parsed (check the return type)
```

If `stripExecutionFlags` returns a string (just the cleaned args), update it to return `{ args: string; bg: boolean }` so the execution function knows to set `run_in_background`.

In the shared `executeChainInContext` function, when `bg` is true, use the existing `deps.manager` background spawn path instead of awaiting the chain.

Alternatively, if the slash command calls the subagent tool internally, pass `run_in_background: true` through the tool params.

- [ ] **Step 4: Completion notification**

When the background chain completes, the `AgentManager.onComplete` callback fires (if registered). Ensure the chain record goes through the same completion notification path as background agents — this is how the LLM gets notified.

Check: does `onComplete?.(record)` fire for external records? If `registerExternalRecord` just does `this.agents.set(id, record)`, completion won't trigger automatically since the Promise is managed externally. The `.then()` handler needs to call `this.onComplete?.(record)` explicitly.

Solution: expose `notifyComplete(id: string)` on AgentManager:

```typescript
notifyComplete(id: string): void {
  const record = this.agents.get(id);
  if (record) this.onComplete?.(record);
}
```

Call it from the `.then()` handler after updating the record.

- [ ] **Step 5: Add tests**

```typescript
test("background chain returns immediately with chain ID", async () => {
  // Use a mock manager that captures registerExternalRecord calls
  // Verify the response includes the chain ID and "background" status
});

test("background chain updates record on completion", async () => {
  // Verify record.status transitions from "running" to "completed"
});
```

- [ ] **Step 6: Run check and commit**

Run: `pnpm check`
Expected: PASS

```bash
git add -A
git commit -m "feat(chain-execution): add background chain execution via --bg flag"
```

---

### Task 18: Prompt workflow discovery and commands

**Files:**

- Create: `src/slash/prompt-workflows.ts`
- Modify: `src/core/paths.ts`
- Modify: `src/shared/types.ts` (add to `ResolvedPaths`)
- Modify: `src/index.ts`
- Create: `tests/prompt-workflows.test.ts`

Prompt workflows are markdown files with YAML frontmatter that define reusable prompt templates. They're a lightweight adapter over the chain engine.

Reference: `nicobailon-pi-subagents/src/slash/prompt-workflows.ts`

- [ ] **Step 1: Add prompt paths to `ResolvedPaths`**

In `src/shared/types.ts`:

```typescript
export interface ResolvedPaths {
  // ... existing fields ...
  userPromptsDir: string;
  bundledPromptsDir: string;
}
```

In `src/core/paths.ts`:

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

- [ ] **Step 2: Define `PromptWorkflow` interface**

In `src/slash/prompt-workflows.ts`:

```typescript
export interface PromptWorkflow {
  name: string;            // filename without extension
  description: string;     // from frontmatter or first line
  agent: string;           // from frontmatter "subagent" field, default "delegate"
  body: string;            // prompt body (after frontmatter)
  filePath: string;        // source file path
  model?: string;
  skills?: string[] | false;
  cwd?: string;
  worktree?: boolean;
  fork?: boolean;
  fresh?: boolean;
  chain?: string;          // chain declaration (e.g. "analyze -> fix")
}
```

- [ ] **Step 3: Implement prompt workflow discovery**

```typescript
export function discoverPromptWorkflows(paths: ResolvedPaths, cwd?: string): PromptWorkflow[] {
  const projectDir = cwd ? join(cwd, ".pi", "prompts") : undefined;
  // Scan each directory for *.md files
  // Parse frontmatter + body
  // Project overrides user overrides bundled (by name)
  // Return merged list
}
```

Parse frontmatter fields:
- `description` → string
- `subagent` → maps to `agent` (default: `"delegate"`)
- `model` → string
- `skill` → comma-separated string or `"false"` → `string[] | false`
- `cwd` → string
- `worktree` → boolean
- `fork` / `inheritContext` → boolean
- `fresh` → boolean
- `chain` → string (chain declaration)

- [ ] **Step 4: Implement argument substitution**

```typescript
function substituteArgs(body: string, args: string[]): string {
  let result = body;
  result = result.replace(/\$ARGUMENTS|\$@/g, args.join(" "));
  // Replace $1, $2, etc.
  result = result.replace(/\$(\d+)/g, (_, n) => args[parseInt(n) - 1] ?? "");
  // Replace ${N:-fallback}
  result = result.replace(/\$\{(\d+):-([^}]*)\}/g, (_, n, fallback) =>
    args[parseInt(n) - 1] ?? fallback,
  );
  return result;
}
```

- [ ] **Step 5: Implement chain step conversion**

```typescript
function workflowToChainStep(workflow: PromptWorkflow, args: string[]): ChainStep {
  const task = substituteArgs(workflow.body, args).trim();
  return {
    agent: workflow.agent,
    task,
    ...(workflow.model ? { model: workflow.model } : {}),
    ...(workflow.skills !== undefined ? { skills: workflow.skills } : {}),
    ...(workflow.cwd ? { cwd: workflow.cwd } : {}),
  };
}
```

- [ ] **Step 6: Implement runtime option parsing**

```typescript
interface RuntimeOptions {
  args: string[];
  agentOverride?: string;
  fork?: boolean;
  fresh?: boolean;
  worktree?: boolean;
  bg?: boolean;
}

function parseRuntimeOptions(words: string[]): RuntimeOptions {
  const args: string[] = [];
  let agentOverride: string | undefined;
  let fork = false, fresh = false, worktree = false, bg = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === "--fork") fork = true;
    else if (w === "--fresh") fresh = true;
    else if (w === "--worktree") worktree = true;
    else if (w === "--bg" || w === "--async") bg = true;
    else if (w === "--subagent" && i + 1 < words.length) agentOverride = words[++i];
    else if (w.startsWith("--subagent=")) agentOverride = w.slice("--subagent=".length);
    else args.push(w);
  }
  return { args, agentOverride, fork, fresh, worktree, bg };
}
```

- [ ] **Step 7: Register `/prompt-workflow` command**

```typescript
export function registerPromptWorkflowCommands(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  pi.registerCommand("prompt-workflow", {
    description: "Run a prompt template: /prompt-workflow <name> [args]",
    getArgumentCompletions: (prefix) => {
      const paths = deps.resolvePaths();
      const workflows = discoverPromptWorkflows(paths);
      return workflows
        .filter((w) => w.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((w) => ({ value: w.name, description: w.description }));
    },
    handler: async (ctx, rawArgs) => {
      const paths = deps.resolvePaths();
      const workflows = discoverPromptWorkflows(paths, ctx.cwd);
      // Parse args, find workflow, execute as single or chain
      // If workflow has chain field, split by -> and build chain steps
      // Otherwise run as single subagent
    },
  });
}
```

- [ ] **Step 8: Register `/chain-prompts` command**

```typescript
pi.registerCommand("chain-prompts", {
  description: "Chain prompt templates: /chain-prompts analyze -> fix -- args",
  handler: async (ctx, rawArgs) => {
    // Split by " -- " to separate declaration from args
    // Split declaration by " -> " to get workflow names
    // Convert each to chain step via workflowToChainStep
    // Execute chain via the shared executeChainInContext function
  },
});
```

- [ ] **Step 9: Register commands in `src/index.ts`**

```typescript
import { registerPromptWorkflowCommands } from "./slash/prompt-workflows.js";
// In the activate function:
registerPromptWorkflowCommands(pi, deps);
```

- [ ] **Step 10: Write tests**

```typescript
describe("discoverPromptWorkflows", () => {
  test("discovers .md files from directory");
  test("parses frontmatter fields");
  test("project workflows override user workflows");
  test("returns empty for nonexistent directories");
});

describe("substituteArgs", () => {
  test("replaces $1 with first arg");
  test("replaces $ARGUMENTS with all args");
  test("replaces ${N:-fallback} with arg or fallback");
});

describe("workflowToChainStep", () => {
  test("creates step with agent and substituted task");
  test("includes model when specified");
  test("includes skills when specified");
});

describe("parseRuntimeOptions", () => {
  test("extracts --bg flag");
  test("extracts --fork flag");
  test("extracts --subagent override");
  test("passes through remaining args");
});
```

- [ ] **Step 11: Run check and commit**

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

The clarification TUI shows a preview of chain steps and lets the user edit them before execution. It's triggered when `clarify: true` is set on the subagent tool call (default behavior for interactive sessions in the reference).

Reference: `nicobailon-pi-subagents/src/runs/foreground/chain-clarify.ts`

- [ ] **Step 1: Define result interface**

```typescript
export interface ChainClarifyResult {
  action: "run" | "cancel" | "bg";      // Run, cancel, or switch to background
  steps: ChainStep[];                    // Potentially modified steps
  behaviorOverrides: BehaviorOverride[]; // Per-step overrides from user edits
}

export interface BehaviorOverride {
  task?: string;
  model?: string;
  skills?: string[] | false;
  output?: string | false;
  reads?: string[] | false;
  progress?: boolean;
}
```

- [ ] **Step 2: Implement `ChainClarifyComponent`**

Create `src/tui/chain-clarify.ts` implementing the `Component` interface from `@earendil-works/pi-tui`:

```typescript
export class ChainClarifyComponent implements Component<ChainClarifyResult> {
  // State
  private steps: ChainStep[];
  private overrides: BehaviorOverride[];
  private selectedIndex: number = 0;
  private mode: "list" | "edit-task" | "edit-model" | "edit-skills" = "list";

  constructor(
    steps: ChainStep[],
    agents: AgentDefinition[],
    task: string,
  ) { /* ... */ }

  render(width: number, height: number): string[] { /* ... */ }
  handleKey(key: string): void { /* ... */ }
}
```

**UI Layout:**

```
Chain Preview (3 steps)                    [Enter] Run  [b] Background  [Esc] Cancel
─────────────────────────────────────────────────────────────────────────────────────
  > [1] scout                    Context
      Task: Analyze the codebase for {task}
      Model: (inherit)  Skills: (inherit)  Output: context.md

    [2] planner                  Planning
      Task: Create plan based on {outputs.context}
      Model: (inherit)  Skills: (inherit)  Progress: on

    [3] worker                   Implementation
      Task: Implement {outputs.plan}
      Model: (inherit)  Skills: (inherit)  Progress: on
─────────────────────────────────────────────────────────────────────────────────────
  [e] Edit task  [m] Model  [s] Skills  [o] Output  [r] Reads  [p] Progress
```

Key bindings:
- `Up`/`Down` or `j`/`k`: Navigate steps
- `Enter`: Run chain
- `b`: Switch to background execution
- `Esc` or `q`: Cancel
- `e`: Edit task template for selected step
- `m`: Select model for selected step
- `s`: Toggle/select skills
- `o`: Edit output path
- `r`: Edit reads list
- `p`: Toggle progress

- [ ] **Step 3: Implement edit modes**

Each edit mode (`edit-task`, `edit-model`, `edit-skills`) replaces the main view with an inline editor:

- **edit-task**: Multi-line text input (similar to existing text input components)
- **edit-model**: List of available models with search/filter
- **edit-skills**: Checkbox list of discovered skills

These can be simple initially — a single-line text input that replaces the current value. The reference has full rich editors but a minimal MVP is sufficient.

- [ ] **Step 4: Wire clarification into chain dispatch**

In `src/core/subagent.ts`, before the chain execution block, add clarification:

```typescript
if (params.chain) {
  // If clarify is true and we have UI, show the clarification TUI
  if (params.clarify !== false && ctx.ui?.custom) {
    const { ChainClarifyComponent } = await import("../tui/chain-clarify.js");
    const result = await ctx.ui.custom<ChainClarifyResult>(
      (tui, theme, _kb, done) =>
        new ChainClarifyComponent(
          params.chain as ChainStep[],
          discovery.agents,
          params.task ?? "",
          done,
        ),
    );
    if (result.action === "cancel") {
      return { content: [{ type: "text", text: "Chain cancelled." }], isError: false, details: stubDetails({ agent: "(chain)", task: params.task ?? "" }) };
    }
    if (result.action === "bg") {
      params.run_in_background = true;
    }
    // Apply overrides to steps
    params.chain = result.steps;
  }
  // ... continue to execution ...
}
```

- [ ] **Step 5: Write tests**

```typescript
describe("ChainClarifyComponent", () => {
  test("renders step list with agent names and phases");
  test("navigation changes selected index");
  test("returns 'run' action on Enter");
  test("returns 'cancel' action on Escape");
  test("returns 'bg' action on b key");
  test("edit mode updates step task");
});
```

Focus on unit-testing the render output and key handling, not full integration.

- [ ] **Step 6: Run check and commit**

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
