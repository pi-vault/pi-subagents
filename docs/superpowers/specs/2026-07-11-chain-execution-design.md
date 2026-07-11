# Chain Execution

Multi-step workflow orchestration for subagents: sequential pipelines, parallel groups, and dynamic fanout with named outputs and template variables.

Reference implementation: [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) — `src/runs/foreground/chain-execution.ts`, `src/agents/chain-serializer.ts`, `src/runs/shared/chain-outputs.ts`, `src/runs/background/chain-append.ts`, `src/shared/settings.ts`.

Approach: direct port with adaptation to the current `src/core/` flat structure.

---

## 1. New Modules & File Layout

All chain modules go into `src/core/` alongside existing files.

### New Files

| File                      | Responsibility                                                                                                                  | Est. Lines |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `chain-execution.ts`      | `executeChain()` orchestrator — step loop, sequential/parallel/dynamic dispatch, chain directory management, output aggregation | ~800       |
| `chain-serializer.ts`     | `parseChain()`, `parseJsonChain()`, `serializeChain()`, `serializeJsonChain()` — file I/O for `.chain.md` and `.chain.json`     | ~280       |
| `chain-outputs.ts`        | `validateChainOutputBindings()`, `resolveOutputReferences()`, `outputEntryFromResult()` — named output plumbing                 | ~120       |
| `chain-append.ts`         | `enqueueChainAppendRequest()`, `consumeChainAppendRequests()` — in-memory append queue                                          | ~80        |
| `chain-settings.ts`       | `resolveChainTemplates()`, `resolveStepBehavior()`, `buildChainInstructions()` — step type definitions and behavior resolution  | ~300       |
| `src/tui/chain-widget.ts` | Workflow graph rendering, phase/label display, step progress                                                                    | ~150       |

### Modified Files

| File                         | Changes                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`        | Add chain types: `ChainStep`, `SequentialStep`, `ParallelStep`, `DynamicParallelStep`, `ChainOutputMap`, `WorkflowGraphSnapshot`, `SubagentRunMode` |
| `src/core/agents.ts`         | Add `loadChainsFromDir()`, `discoverChains()` alongside agent discovery                                                                             |
| `src/core/subagent.ts`       | Add `chain` mode to tool schema + execution dispatch                                                                                                |
| `src/index.ts`               | Register `/chain` and `/run-chain` slash commands                                                                                                   |
| `src/shared/runtime-deps.ts` | Add optional `chainWidget` field to `RuntimeDeps`                                                                                                   |

### Unchanged Files

`agent-manager.ts`, `agent-runner.ts`, `spawn-guard.ts`, `tool-budget.ts`, `agent-widget.ts`, `fleet-list.ts` — chain steps spawn through existing `AgentManager`, so all safety features apply per-step automatically.

---

## 2. Type System

New types in `src/shared/types.ts`:

### Ported Helper Types

These types are ported from the source project alongside the chain feature:

```typescript
// Acceptance criteria for verifying step output quality
export interface AcceptanceInput {
  description: string;
  command?: string;
}

// Standard JSON Schema object (used for dynamic fanout output validation)
export type JsonSchemaObject = Record<string, unknown>;
```

### Chain Step Types

```typescript
export interface SequentialStep {
  agent: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: JsonSchemaObject;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
}

export interface ParallelTaskItem {
  agent: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: JsonSchemaObject;
  count?: number;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
}

export interface ParallelStep {
  parallel: ParallelTaskItem[];
  concurrency?: number;
  failFast?: boolean;
  worktree?: boolean;
  cwd?: string;
}

export interface DynamicParallelStep {
  expand: {
    from: { output: string; path: string };
    item?: string;
    key?: string;
    maxItems?: number;
    onEmpty?: "skip" | "fail";
  };
  parallel: DynamicParallelTemplate;
  collect: { as: string; outputSchema?: JsonSchemaObject };
  concurrency?: number;
  failFast?: boolean;
  acceptance?: AcceptanceInput;
}

export type DynamicParallelTemplate = Omit<ParallelTaskItem, "as" | "count">;

export type ChainStep = SequentialStep | ParallelStep | DynamicParallelStep;
```

`ChainStep` is a discriminated union with type guards:

- `isParallelStep(step)`: `"parallel" in step && Array.isArray(step.parallel)`
- `isDynamicParallelStep(step)`: `"expand" in step && "collect" in step && "parallel" in step && !Array.isArray(step.parallel)`
- Otherwise: `SequentialStep`

### Chain Output Map

```typescript
export interface ChainOutputMapEntry {
  text: string;
  structured?: unknown;
  agent: string;
  stepIndex: number;
}

export type ChainOutputMap = Record<string, ChainOutputMapEntry>;
```

Plain object keyed by output name. Entries store both text output and optional structured (JSON) output for dynamic fanout consumption.

### Chain Config (Saved Files)

```typescript
export interface ChainConfig {
  name: string;
  localName?: string;
  packageName?: string;
  description: string;
  filePath: string;
  steps: ChainStepConfig[];
  extraFields?: Record<string, string>;
}

export interface ChainStepConfig {
  agent?: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: string | JsonSchemaObject; // string = file path to load
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
  // Parallel step fields
  parallel?: ChainStepConfig[];
  concurrency?: number;
  failFast?: boolean;
  worktree?: boolean;
  // Dynamic fanout fields
  expand?: DynamicParallelStep["expand"];
  collect?: DynamicParallelStep["collect"];
}
```

### Workflow Graph (TUI)

```typescript
export type WorkflowNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "paused"
  | "stopped";

export interface WorkflowGraphNode {
  id: string;
  kind: "step" | "parallel-group" | "dynamic-parallel-group" | "agent";
  agent?: string;
  phase?: string;
  label: string;
  status: WorkflowNodeStatus;
  flatIndex?: number;
  stepIndex?: number;
  children?: WorkflowGraphNode[];
  dynamic?: {
    sourceOutput: string;
    sourcePath: string;
    itemName: string;
    maxItems?: number;
    collectAs?: string;
  };
  itemKey?: string;
  outputName?: string;
  structured?: boolean;
  error?: string;
}

export interface WorkflowGraphSnapshot {
  runId: string;
  mode: SubagentRunMode;
  phases: Array<{ title: string; nodeIds: string[] }>;
  nodes: WorkflowGraphNode[];
  currentNodeId?: string;
}
```

Nodes form a tree: parallel-group and dynamic-parallel-group nodes contain `children` of kind `"agent"`. Phases group nodes by the `phase` field from step definitions.

### Run Mode

```typescript
export type SubagentRunMode = "single" | "parallel" | "chain";
```

### Tool Input Extension

`SubagentToolInput` gains an optional `chain` field. When `chain` is provided, `agent` is not required (the chain steps each specify their own agents):

```typescript
export interface SubagentToolInput {
  // Single-agent mode (required when chain is absent)
  agent: string;
  task: string;
  // ...existing fields...

  // Chain mode (when present, agent is ignored; task becomes the {task} template var)
  chain?: ChainStep[];

  // Append steps to a running async chain
  chain_append?: {
    chain_id: string;
    steps: ChainStep[];
  };
}
```

In the TypeBox tool schema, `agent` is made optional (with runtime validation ensuring either `agent` or `chain` is provided).

---

## 3. Chain Execution Flow

### Module: `src/core/chain-execution.ts`

Primary export: `executeChain()`.

### Entry Points

All three converge on `executeChain()`:

1. **`subagent` tool** — when `params.chain` is provided
2. **`/chain` slash command** — parses inline syntax into `ChainStep[]`
3. **`/run-chain` slash command** — loads saved chain file, resolves to `ChainStep[]`

### Orchestration

```
executeChain(steps, task, deps, ctx, signal)
  |
  +- 1. Create chain directory (temp artifacts: outputs, progress files)
  +- 2. validateChainOutputBindings(steps) -- fail early on invalid refs
  +- 3. Resolve templates for each step
  |
  +- 4. Step loop:
  |     |
  |     +-- SequentialStep:
  |     |     +- resolveStepBehavior(step, agentDef)
  |     |     +- Resolve template vars: {task}, {previous}, {chain_dir}, {outputs.x}
  |     |     +- buildChainInstructions(step)
  |     |     +- deps.manager.spawnAndWait(ctx, agentDef, runOptions)
  |     |     +- Store result in outputs map (if step.as set)
  |     |     +- Update `previous` for next step
  |     |
  |     +-- ParallelStep:
  |     |     +- For each item in step.parallel:
  |     |     |   +- resolveStepBehavior(item, agentDef)
  |     |     |   +- Resolve template vars per item
  |     |     +- Create worktrees if step.worktree
  |     |     +- Execute concurrently (respecting step.concurrency)
  |     |     +- Aggregate outputs with separators
  |     |     +- Fail-fast if configured and any item errors
  |     |     +- Store named outputs from each item
  |     |     +- Update `previous` with aggregated output
  |     |
  |     +-- DynamicParallelStep:
  |           +- Read structured output from outputs[expand.from.output]
  |           +- JSON-pointer into expand.from.path to get items array
  |           +- Validate against expand.maxItems
  |           +- Materialize N parallel tasks from template
  |           +- Execute as parallel group
  |           +- Collect results into structured collection
  |           +- Store under collect.as
  |
  +- 5. Build chain summary (all step results)
  +- 6. Return results with WorkflowGraphSnapshot
```

### Template Variable Resolution Order

1. `{task}` — original task passed to the chain
2. `{previous}` — output from the immediately preceding step (aggregated for parallel)
3. `{chain_dir}` — path to chain's artifact directory
4. `{outputs.name}` — named output from any prior step with `as: "name"`

### Error Handling

| Scenario                                        | Behavior                                                |
| ----------------------------------------------- | ------------------------------------------------------- |
| Sequential step failure                         | Chain aborts, returns partial results with error status |
| Parallel step failure, `failFast: true`         | Abort remaining items, chain aborts                     |
| Parallel step failure, `failFast: false`        | Collect all results, mark failed items, continue chain  |
| Dynamic fanout, empty items + `onEmpty: "skip"` | Skip step, continue                                     |
| Dynamic fanout, empty items + `onEmpty: "fail"` | Chain aborts                                            |

### Integration with Safety Systems

Each step spawns through `AgentManager`, so existing features apply per-step:

- **Spawn limits**: Each step consumes a spawn slot. A 5-step chain uses 5 spawns. A parallel step with 4 items uses 4 spawns. The chain itself does not consume a slot.
- **Tool budgets**: Step-level `toolBudget` overrides agent frontmatter via 3-layer resolution.
- **Concurrency**: Parallel step items queue through `AgentManager` if `maxConcurrency` is reached. Step-level `concurrency` acts as an additional cap within the parallel group.
- **Turn limits**: Per-step, inherited from agent frontmatter or step config.

---

## 4. Chain Discovery & File Formats

### Module: `src/core/agents.ts` (extended) + `src/core/chain-serializer.ts` (new)

### Discovery

Extends the existing `discoverAgents()` pattern. Scans for `.chain.md` and `.chain.json` files from dedicated `chains/` directories in each scope:

| Scope   | Path                  | Priority |
| ------- | --------------------- | -------- |
| Project | `.pi/chains/` (cwd)   | Highest  |
| User    | `~/.pi/agent/chains/` |          |
| Package | bundled `chains/` dir |          |
| Builtin | `chains/` (shipped)   | Lowest   |

Higher-priority scopes shadow lower ones by chain name. When both `.chain.json` and `.chain.md` exist for the same name, JSON takes priority.

Chain directories are separate from agent directories — this keeps the filesystem organized and avoids filename collisions between agents and chains.

New export from `agents.ts`:

```typescript
export interface ChainDiscoveryDiagnostic {
  filePath: string;
  error: string;
}

export interface ChainDiscoveryResult {
  chains: ChainConfig[];
  diagnostics: ChainDiscoveryDiagnostic[];
}

export function discoverChains(paths: ResolvedPaths): ChainDiscoveryResult;
```

### `.chain.md` Format (Sequential Chains)

```markdown
---
name: scout-then-plan
description: Gather context then plan implementation
---

## scout

phase: Context
label: Map the codebase
as: context
output: context.md

Analyze the codebase for {task}

## planner

phase: Planning
label: Create implementation plan
reads: context.md
model: anthropic/claude-sonnet-4-5:high
progress: true

Create an implementation plan based on {outputs.context}
```

Parsing rules:

- Frontmatter (`---` block) provides chain-level metadata
- Each `## agent-name` heading starts a step
- Lines immediately after the heading in `key: value` format are step config
- Remaining text is the task template
- Steps are always sequential (for parallel, use `.chain.json`)

### `.chain.json` Format (All Step Types)

```json
{
  "name": "dynamic-review",
  "description": "Find targets, fan out reviewers, synthesize.",
  "chain": [
    {
      "agent": "scout",
      "task": "Return structured output with items array",
      "as": "targets"
    },
    {
      "expand": {
        "from": { "output": "targets", "path": "/items" },
        "item": "target",
        "maxItems": 12
      },
      "parallel": {
        "agent": "reviewer",
        "task": "Review {target.path}"
      },
      "collect": { "as": "reviews" },
      "concurrency": 4
    },
    {
      "agent": "worker",
      "task": "Synthesize from {outputs.reviews}"
    }
  ]
}
```

### Serializer Exports

```typescript
export function parseChain(filePath: string, content: string): ChainConfig;
export function parseJsonChain(filePath: string, content: string): ChainConfig;
export function serializeChain(config: ChainConfig): string;
export function serializeJsonChain(config: ChainConfig): string;
```

---

## 5. Tool Schema & Slash Commands

### Tool Schema Extension

The `subagent` tool gains a `chain` parameter. When present, execution dispatches to `executeChain()` instead of the single-agent path:

```typescript
// At the top of execute():
if (params.chain) {
  return executeChain(params.chain, params.task ?? "", deps, ctx, signal);
}
// ...existing single-agent path below
```

The `chain` parameter is a `Type.Array` of objects supporting all three step types (sequential fields, parallel fields, dynamic fanout fields) as optional properties. The discriminated union is resolved at runtime.

### Tool Description Update

The tool description string shown to the LLM documents chain mode:

```
## CHAIN mode

Pass a `chain` array to run multiple agents in sequence/parallel:

chain: [
  { agent: "scout", task: "Analyze {task}", as: "context" },
  { agent: "planner", task: "Plan based on {outputs.context}" }
]

Template variables: {task}, {previous}, {chain_dir}, {outputs.<name>}
```

### `/chain` — Inline Chain Execution

Syntax: `/chain agent1 "task1" -> agent2 "task2" -> (agentA "taskA" | agentB "taskB") -> agent3 "task3" [--bg] [--fork]`

- `->` separates sequential steps
- `(a | b | c)` denotes a parallel group
- Quotes around task are optional for single words
- Inline config via brackets: `agent[as=context,output=ctx.md] "task"`
- `--bg` flag: run chain in background (async)
- `--fork` flag: fork parent context into chain

Parsing produces `ChainStep[]` and calls `executeChain()`.

### `/run-chain` — Execute Saved Chain File

Syntax: `/run-chain <chainName> -- <task> [--bg] [--fork]`

- Looks up chain by name from `discoverChains()`
- Resolves `{task}` with the provided task string
- `--bg` / `--fork` flags same as `/chain`
- Calls `executeChain()`

---

## 6. Async Chain Execution & Step Appending

### Module: `src/core/chain-append.ts`

### Async Chains

When `run_in_background: true` is set alongside `chain`, the chain runs in the background as a single logical unit. The caller gets an agent ID immediately.

**Adaptation note:** The source project uses file-based detached processes (via `jiti`) for async chains. Our project runs everything in-process through `AgentManager`. Async chains in our adaptation use an in-process `Promise`-based model: the chain loop runs as a background task tracked by a top-level `AgentRecord`, with individual steps spawning through `AgentManager.spawnAndWait()` internally.

The chain's `AgentRecord` is the top-level record. Individual step executions are nested — they spawn through `AgentManager` but are tracked as children of the chain record:

- `"running"` while any step is executing
- `"completed"` when all steps finish successfully
- `"error"` when a step fails and the chain aborts

### Chain Append

In-memory queue for adding steps to a running async chain. The source project uses a file-based queue (JSON files in a directory) because it spawns detached processes. Our in-process model uses a simple `Map<string, ChainStep[][]>` keyed by chain ID:

```typescript
export function enqueueChainAppendRequest(
  chainId: string,
  steps: ChainStep[],
): void;

export function consumeChainAppendRequests(chainId: string): ChainStep[];

export function countPendingChainAppendRequests(chainId: string): number;
```

### Append Flow

1. An async chain is running steps 1-3
2. The parent LLM calls `subagent` with `chain_append` targeting the chain ID
3. Steps 4-5 are enqueued via `enqueueChainAppendRequest()`
4. After step 3 completes, the chain loop calls `consumeChainAppendRequests()`
5. Steps 4-5 are appended and execution continues

### Tool Schema Addition

```typescript
chain_append: Type.Optional(
  Type.Object({
    chain_id: Type.String({ description: "ID of running async chain" }),
    steps: Type.Array(/* ChainStep schema */),
  }),
);
```

### Constraints

- Can only append to chains with `"running"` status
- Appended steps inherit the chain's `{task}` and `{chain_dir}`
- `{previous}` for the first appended step is the output of the last completed step
- Appending to a completed/failed chain returns an error

---

## 7. TUI Integration (Additive)

### Module: `src/tui/chain-widget.ts`

No modifications to `agent-widget.ts` or `fleet-list.ts`.

### Display

When a chain is running, the widget shows a compact workflow graph:

```
Chain: scout-then-plan
  [1/3] done  scout (Context) -- 4.2s
  [2/3] run   planner (Planning) -- running...
  [3/3] wait  worker (Implementation)
```

For parallel steps:

```
  [2/3] run   parallel (3 tasks, 2/3 done)
    +- done  reviewer "auth module" -- 6.1s
    +- done  reviewer "db layer" -- 5.3s
    +- run   reviewer "api routes" -- running...
```

### Data Flow

```
executeChain() step loop
  +- Updates WorkflowGraphSnapshot after each step
      +- Calls deps.chainWidget?.update(snapshot)
          +- chain-widget.ts re-renders the graph
```

`WorkflowGraphSnapshot` is the sole data contract between execution and TUI. The widget is a pure renderer.

### Registration

In `src/index.ts`:

```typescript
const chainWidget = createChainWidget(pi);
deps.chainWidget = chainWidget;
```

`RuntimeDeps` gains an optional `chainWidget` field. When no chain is running, the widget is inert.

---

## 8. Testing

### New Test Files

| File                            | Scope                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ---- |
| `test/chain-execution.test.ts`  | Integration: sequential chains, parallel groups, dynamic fanout, template vars, error handling |
| `test/chain-serializer.test.ts` | Unit: parse/serialize `.chain.md` and `.chain.json`, roundtrip                                 |
| `test/chain-outputs.test.ts`    | Unit: output binding validation, reference resolution, duplicate detection                     |
| `test/chain-settings.test.ts`   | Unit: `resolveChainTemplates()`, `resolveStepBehavior()`, `buildChainInstructions()`           |
| `test/chain-append.test.ts`     | Unit: enqueue, consume, status update, append-to-completed error                               |
| `test/slash-chain.test.ts`      | Unit: inline chain syntax parsing (`->`, `(a                                                   | b)`) |

### Key Test Cases

**Sequential chains:**

- 2-step chain passes `{previous}` between steps
- `{task}` resolves to original task in all steps
- Named output via `as` is stored and accessible via `{outputs.name}`
- Step failure aborts chain with partial results

**Parallel groups:**

- Concurrent execution respects `concurrency` cap
- `failFast: true` aborts remaining on first failure
- `failFast: false` collects all results
- Worktree isolation creates/cleans worktrees
- Aggregated output becomes `{previous}` for next step

**Dynamic fanout:**

- Structured output expansion produces correct parallel tasks
- `maxItems` enforced
- `onEmpty: "skip"` skips, `onEmpty: "fail"` aborts
- Collected results stored under `collect.as`

**Chain serializer:**

- `.chain.md` roundtrip: parse then serialize produces equivalent output
- `.chain.json` roundtrip: parse then serialize produces equivalent output
- Malformed files produce diagnostics, not crashes

**Chain append:**

- Enqueue + consume returns correct steps
- Append to completed chain returns error
- `{previous}` for first appended step is last completed step's output

### Verification

```
pnpm check  # biome lint + tsc --noEmit + vitest run
```

All new tests run within the existing vitest suite.
