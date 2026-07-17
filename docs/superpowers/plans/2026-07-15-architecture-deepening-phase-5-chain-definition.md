# Chain Definition Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Chain definition valid, executable, and Agent-preflighted before it can create a Chain directory, start an Agent, or join a running background Chain.

**Architecture:** Keep saved `ChainStepConfig` definitions separate from executable `ChainStep` definitions. `chain-serializer.ts` owns structural normalization and saved-schema materialization; `chain-outputs.ts` owns ordered output-name validation; `chain-settings.ts` retains Chain shape guards. Background `AgentRecord` state is the sole source of truth for append validation, so an invalid append is rejected at the tool call instead of failing an already-running Chain.

**Tech Stack:** TypeScript, Vitest, TypeBox, Node.js filesystem APIs, Pi coding-agent.

---

## Decisions

- Preserve `ChainStepConfig` and its schema-file paths for saved Chain round trips. Executable `ChainStep` values contain object schemas only.
- Preserve unknown fields on ordinary sequential and static-parallel objects. Reject unknown keys in dynamic fanout objects (`expand`, its `from`, dynamic `parallel`, and `collect`) because they change control flow.
- A dynamic fanout may reference any earlier named output. The existing runtime check remains responsible for rejecting an output that did not produce structured JSON.
- Dynamic schema paths are resolved relative to `ChainConfig.filePath`; unreadable files, invalid JSON, arrays, `null`, and primitives are definition errors.
- An append batch is accepted only for a running asynchronous Chain. It may reference outputs from earlier accepted batches, even if those batches have not executed yet.
- Do not add a schema framework, a second run registry, a new source module, or a process-wide Git configuration change.

## File map

| File | Responsibility after this phase |
| --- | --- |
| `src/shared/types.ts` | Persisted-vs-executable Chain types and `AgentRecord.chainDefinition`. |
| `src/core/chain-serializer.ts` | Structural validation, parser validation, schema-file materialization, serialization. |
| `src/core/chain-outputs.ts` | Ordered output-reference validation with optional prior output names. |
| `src/core/chain-settings.ts` | Existing Chain shape guards, Agent lookup per step, templates, and directories. |
| `src/core/subagent.ts` | Complete TypeBox Chain tool schema and tool/append preflight. |
| `src/core/slash-chain.ts` | Common slash and saved-Chain execution seam. |
| `src/core/chain-execution.ts` | Final no-side-effect preflight and consumption of already-validated append batches. |
| `src/core/agent-manager.ts` / `src/core/chain-append.ts` | Registered running definition, append queue, and settlement cleanup. |

## Commit sequence

1. `refactor: centralize chain definition validation`
2. `refactor: normalize chain entry points`
3. `fix: activate validated chain appends`

### Task 1: Centralize persisted and executable Chain validation

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/chain-serializer.ts`
- Modify: `src/core/chain-outputs.ts`
- Test: `tests/chain-serializer.test.ts`
- Test: `tests/chain-outputs.test.ts`

- [ ] **Step 1: Write failing structural and contextual-validation tests**

Add accepted sequential, static, and dynamic definitions; rejected mixed discriminants and invalid recognized fields; preserved ordinary unknown fields; rejected dynamic unknown keys; and contextual output ordering.

```ts
expect(normalizeChainSteps(
  [{ agent: "scout", task: "scan", extensionHint: "keep" }],
  "tool chain",
)).toEqual([{ agent: "scout", task: "scan", extensionHint: "keep" }]);

expect(() => normalizeChainSteps([{
  expand: { from: { output: "targets", path: "/items" } },
  parallel: { agent: "worker", task: "review {item.name}", maxItem: 3 },
  collect: { as: "reviews" },
}], "tool chain")).toThrow(/does not support field 'maxItem'/);

expect(() => validateChainOutputBindingsWithContext(
  [{ agent: "worker", task: "use {outputs.prior}" }],
  { priorOutputNames: ["prior"], startStepIndex: 3 },
)).not.toThrow();
```

Create temporary saved Chain files and test relative schema paths on a sequential step, static task, dynamic template, and `collect`. Assert all materialize to object schemas. Add failures for a missing schema file and a schema JSON array.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm vitest run tests/chain-serializer.test.ts tests/chain-outputs.test.ts
```

Expected: FAIL because the normalizer, materializer, and contextual validator do not exist.

- [ ] **Step 3: Preserve saved types and implement the definition seam**

In `src/shared/types.ts`, retain `ChainStepConfig`; do not widen executable `SequentialStep` or `ParallelTaskItem` with strings. Make saved dynamic nested fields express `string | JsonSchemaObject`.

```ts
export type SavedOutputSchema = string | JsonSchemaObject;

export interface ChainStepConfig {
  outputSchema?: SavedOutputSchema;
  parallel?: ChainStepConfig[] | ChainStepConfig;
  collect?: { as: string; outputSchema?: SavedOutputSchema };
}
```

First add the shared context interface in `src/core/chain-outputs.ts`, then import it in `src/core/chain-serializer.ts`:

```ts
export interface ChainOutputValidationContext {
  priorOutputNames?: Iterable<string>;
  startStepIndex?: number;
}
```

Then add:

```ts
export class ChainDefinitionError extends Error {
  readonly name = "ChainDefinitionError";
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
  }
}

export function normalizeChainSteps(
  value: unknown,
  source: string,
  context: ChainOutputValidationContext = {},
): ChainStep[];

export function materializeSavedChainSteps(config: ChainConfig): ChainStep[];
```

Use private record helpers and a private saved-definition mode. Never coerce values. Validate non-blank Agent names; non-empty static groups; the sequential/static/dynamic discriminants; strings, booleans, enums, arrays of non-blank strings, positive integers, acceptance objects, object schemas, and every `toolBudget` through `validateToolBudget`. Static tasks allow `count`; dynamic templates reject `as` and `count`.

The executable normalizer calls `validateChainOutputBindingsWithContext`. The Markdown and JSON parsers use saved-definition validation without reading schema files. `materializeSavedChainSteps` reads string schemas relative to `dirname(config.filePath)`, rejects invalid/non-object JSON, replaces them recursively, then calls executable normalization. Markdown serialization rejects non-sequential configs with `ChainDefinitionError`; JSON serialization continues to serialize saved configs.

- [ ] **Step 4: Add contextual output validation in its existing module**

In `src/core/chain-outputs.ts`, keep runtime `resolveOutputReferences()` and add:

```ts
export function getChainOutputNames(steps: ChainStep[]): string[];

export function validateChainOutputBindingsWithContext(
  steps: ChainStep[],
  context: ChainOutputValidationContext = {},
): void;
```

Seed both available and duplicate-name sets from `priorOutputNames`. Check task references before adding the current step's output names. Check `expand.from.output` against the same prior names. Keep `validateChainOutputBindings(steps)` as the empty-context wrapper.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm vitest run tests/chain-serializer.test.ts tests/chain-outputs.test.ts tests/chain-settings.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/types.ts src/core/chain-serializer.ts src/core/chain-outputs.ts tests/chain-serializer.test.ts tests/chain-outputs.test.ts
git diff --check
```

Expected: all focused tests and typecheck pass; no lint or whitespace errors.

- [ ] **Step 6: Commit the definition seam**

```bash
git add src/shared/types.ts src/core/chain-serializer.ts src/core/chain-outputs.ts tests/chain-serializer.test.ts tests/chain-outputs.test.ts
git commit -m "refactor: centralize chain definition validation"
```

### Task 2: Route Chain entry points through the definition seam

**Files:**

- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/chain-execution.ts`
- Test: `tests/subagent-chain.test.ts`
- Test: `tests/slash-chain.test.ts`
- Test: `tests/chain-execution.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Capture the registered TypeBox parameters and prove Pi accepts all supported forms: a sequential `outputSchema`/acceptance/budget step, a static task with `count`, and a dynamic object-valued `parallel` with `collect`.

Add tool and slash failures for a missing Agent, malformed static group, unknown Agent, and invalid saved schema path. Each fails before `spawnAndWait` and `createChainDir`.

```ts
const result = await executeTool({
  task: "review",
  chain: [{ parallel: { agent: "worker", task: "x" } }],
});

expect(result.isError).toBe(true);
expect(spawnAndWait).not.toHaveBeenCalled();
expect(createChainDir).not.toHaveBeenCalled();
```

Add clarification tests where a valid initial Chain is edited into an unknown Agent or invalid output reference, and assert the edit is rejected before dispatch.

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run:

```bash
pnpm vitest run tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
```

Expected: FAIL because the TypeBox schema is incomplete and raw, clarified, and saved definitions bypass the seam.

- [ ] **Step 3: Complete the flattened TypeBox Chain schema**

In `src/core/subagent.ts`, define reusable TypeBox fragments named `JsonSchemaObject`, `AcceptanceSchema`, `ToolBudgetSchema`, `OutputOverride`, `OutputModeOverride`, `ReadsOverride`, `SkillsOverride`, `ParallelTaskSchema`, `DynamicExpandSchema`, `DynamicCollectSchema`, and `DynamicTemplateSchema`. Use them in the current flattened Chain item.

```ts
const ChainItem = Type.Object({
  agent: Type.Optional(Type.String()),
  task: Type.Optional(Type.String()),
  phase: Type.Optional(Type.String()),
  label: Type.Optional(Type.String()),
  as: Type.Optional(Type.String()),
  outputSchema: Type.Optional(JsonSchemaObject),
  output: Type.Optional(OutputOverride),
  outputMode: Type.Optional(OutputModeOverride),
  reads: Type.Optional(ReadsOverride),
  model: Type.Optional(Type.String()),
  skills: Type.Optional(SkillsOverride),
  progress: Type.Optional(Type.Boolean()),
  cwd: Type.Optional(Type.String()),
  acceptance: Type.Optional(AcceptanceSchema),
  toolBudget: Type.Optional(ToolBudgetSchema),
  parallel: Type.Optional(Type.Unsafe({
    anyOf: [Type.Array(ParallelTaskSchema, { minItems: 1 }), DynamicTemplateSchema],
  })),
  expand: Type.Optional(DynamicExpandSchema),
  collect: Type.Optional(DynamicCollectSchema),
  concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
  failFast: Type.Optional(Type.Boolean()),
  worktree: Type.Optional(Type.Boolean()),
});
```

Include every existing recognized sequential and parallel field, including `count`, `outputMode`, `reads`, `skills`, `progress`, `cwd`, `concurrency`, `failFast`, and `worktree`. Do not duplicate contextual or strict dynamic-key validation in TypeBox.

- [ ] **Step 4: Normalize and preflight the initial adapters**

In `src/core/subagent.ts`, replace raw `as ChainStep[]` casts with executable normalization and Agent preflight before clarification, background registration, or execution. Repeat after clarification.

In `src/core/slash-chain.ts`, leave `buildChainSteps()` as expression parsing. At the start of `executeSlashChain()`, normalize and preflight the supplied input; repeat after clarification. For `/run-chain`, call `materializeSavedChainSteps(chain)` before `executeSlashChain()`.

```ts
const steps = normalizeChainSteps(inputChain, "/chain");
for (const step of steps) {
  for (const name of getStepAgents(step)) {
    if (!findAgentByName(discovery, name)) throw new Error(`Unknown agent: "${name}"`);
  }
}
```

Keep prompt workflows unchanged because they already use `executeSlashChain()`. Preserve existing slash error delivery.

- [ ] **Step 5: Defend direct execution before side effects**

At the start of `executeChain()`, normalize and Agent-preflight its input before template resolution or `createChainDir()`. Keep adapter preflight for background Chains so an invalid call returns an error instead of a false "started" response.

- [ ] **Step 6: Run focused verification**

Run:

```bash
pnpm vitest run tests/chain-serializer.test.ts tests/chain-outputs.test.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/subagent.ts src/core/slash-chain.ts src/core/chain-execution.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
git diff --check
```

Expected: all focused tests and typecheck pass; no lint or whitespace errors.

- [ ] **Step 7: Commit the adapter migration**

```bash
git add src/core/subagent.ts src/core/slash-chain.ts src/core/chain-execution.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
git commit -m "refactor: normalize chain entry points"
```

### Task 3: Activate and validate background Chain appends

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/agent-manager.ts`
- Modify: `src/core/chain-append.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/chain-execution.ts`
- Test: `tests/agent-manager.test.ts`
- Test: `tests/chain-append.test.ts`
- Test: `tests/subagent-chain.test.ts`
- Test: `tests/slash-chain.test.ts`
- Test: `tests/chain-execution.test.ts`

- [ ] **Step 1: Write failing lifecycle and append tests**

Prove the external Chain record and copied definition exist before its run factory executes.

```ts
let recordVisibleAtStart = false;
manager.fireAndForgetChain("chain-1", "task", [{ agent: "scout" }], "/tmp", async () => {
  recordVisibleAtStart = manager.getRecord("chain-1")?.chainDefinition?.[0]?.agent === "scout";
  return { content: "done", isError: false };
});
expect(recordVisibleAtStart).toBe(true);
```

Add rejected append cases for an unknown ID, completed Chain, foreground/non-Chain record, malformed steps, unknown Agent, duplicate output, and forward reference; assert the queue is unchanged. Add two accepted batches where batch two references the first batch's `as: "review"` output before execution. Add integration coverage that both background adapters consume an appended step and pass it the first step's output.

- [ ] **Step 2: Run the append tests to verify they fail**

Run:

```bash
pnpm vitest run tests/agent-manager.test.ts tests/chain-append.test.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
```

Expected: FAIL because a Chain is registered after its promise starts, background callers omit `isAsync`, and appends have no target/context validation.

- [ ] **Step 3: Register the running definition before execution starts**

Add `chainDefinition?: ChainStep[]` to `AgentRecord`. Change `AgentManager.fireAndForgetChain()` to receive a validated definition and a factory, register a copied definition, and only then invoke the factory.

```ts
fireAndForgetChain(
  id: string,
  task: string,
  chainDefinition: ChainStep[],
  cwd: string,
  start: () => Promise<{ content: string; isError: boolean }>,
  onClear?: () => void,
): AgentRecord
```

Update both background callers in `subagent.ts` and `slash-chain.ts` to invoke their existing `executeChain()` options with `isAsync: true` inside this factory:

```ts
executeChain({
  steps: chainSteps,
  task: params.task ?? "",
  spawnAndWait,
  findAgent,
  cwd: effectiveCwd,
  runId: chainRunId,
  isAsync: true,
  onGraphUpdate,
  getSpawnBudget: () => deps.manager.getSpawnBudget(),
});
```

Preserve each caller's existing `onGraphUpdate` behavior and include append-queue cleanup in the settlement callback.

- [ ] **Step 4: Validate and reserve appends at enqueue time**

In the `chain_append` dispatch in `src/core/subagent.ts`:

1. Retrieve the record and reject unless it is a running background Chain with `chainDefinition`.
2. Normalize with output names from the complete reserved definition and the definition length as the step offset.
3. Preflight all Agents.
4. Extend the record and enqueue in the same synchronous operation.

```ts
const prior = getChainOutputNames(record.chainDefinition);
const appended = normalizeChainSteps(params.chain_append.steps, "chain append", {
  priorOutputNames: prior,
  startStepIndex: record.chainDefinition.length,
});
for (const step of appended) {
  for (const name of getStepAgents(step)) {
    if (!findAgentByName(discovery, name)) throw new Error(`Unknown agent: "${name}"`);
  }
}
record.chainDefinition.push(...appended);
enqueueChainAppendRequest(chainId, appended);
```

Do not re-normalize the whole Chain after `consumeChainAppendRequests()`; it receives only validated, reserved batches. Add `clearChainAppendRequests(chainId)` and call it on completion, error, and abort.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm vitest run tests/agent-manager.test.ts tests/chain-append.test.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
pnpm tsc --noEmit
pnpm biome lint src/shared/types.ts src/core/agent-manager.ts src/core/chain-append.ts src/core/subagent.ts src/core/slash-chain.ts src/core/chain-execution.ts tests/agent-manager.test.ts tests/chain-append.test.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
git diff --check
```

Expected: all focused tests and typecheck pass; no lint or whitespace errors.

- [ ] **Step 6: Commit validated append activation**

```bash
git add src/shared/types.ts src/core/agent-manager.ts src/core/chain-append.ts src/core/subagent.ts src/core/slash-chain.ts src/core/chain-execution.ts tests/agent-manager.test.ts tests/chain-append.test.ts tests/subagent-chain.test.ts tests/slash-chain.test.ts tests/chain-execution.test.ts
git commit -m "fix: activate validated chain appends"
```

## Final verification

- [ ] Run the complete suite. The process-local signing override is permitted only because tests create temporary repositories; do not use it for any branch commit.

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false pnpm check
```

Expected: the complete suite passes, including all new Chain tests.

- [ ] Check the committed branch and worktree.

```bash
git diff master...HEAD --check
git status --short --branch
```

Expected: no whitespace errors and a clean Phase 5 branch after the three normally signed commits.
