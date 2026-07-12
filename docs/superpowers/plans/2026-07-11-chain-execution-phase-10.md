# Chain Execution — Phase 10: Wire Step Behavior Into Execution Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "last mile" gap where step configuration fields (reads, output, progress, toolBudget, skills, worktree) are parsed and tested in isolation but never applied at runtime. Wire `resolveStepBehavior()` and `buildChainInstructions()` into the execution engine, expand the `spawnAndWait` callback to accept per-step options, add chain directory cleanup, and ship a bundled example chain.

**Architecture:** Expand `ChainExecutionParams.spawnAndWait` to accept a `StepSpawnOptions` bag. Inside the step loop, call `resolveStepBehavior()` then `buildChainInstructions()` for each step, prepend/append instructions to the task prompt, and pass options (toolBudget, isolation, skills) through the callback. Callers in `subagent.ts` and `slash-chain.ts` pipe these options to `AgentManager.spawnAndWait`.

**Tech Stack:** pnpm, Vitest, TypeScript

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** All previous phases (1-9) complete.

**Out of scope (deferred):** Model override per step (requires model registry access that neither the chain engine nor the single-agent path currently provides at spawn time), async/background chain execution (`--bg` wiring), chain clarification TUI, prompt workflow chains (`/chain-prompts`).

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` — `src/runs/foreground/chain-execution.ts` lines 1085-1103 (sequential behavior wiring), lines 2336-2348 (parallel behavior wiring).

---

## File Map

### Modified Files

| File | Changes |
| --- | --- |
| `src/core/chain-execution.ts` | Import and call `resolveStepBehavior`, `buildChainInstructions`; expand `spawnAndWait` signature; add cleanup |
| `src/core/subagent.ts` | Update chain `spawnAndWait` callback to pipe `StepSpawnOptions` through to `deps.manager.spawnAndWait` |
| `src/core/slash-chain.ts` | Same: update `spawnAndWait` callback to pipe `StepSpawnOptions` |
| `src/core/chain-settings.ts` | Export `StepSpawnOptions` interface (or put in types.ts) |
| `tests/chain-execution.test.ts` | Add tests verifying instructions are prepended, toolBudget is passed, worktree is passed |

### New Files

| File | Responsibility |
| --- | --- |
| `chains/implement.chain.md` | Bundled example chain: scout → planner → worker |

---

### Task 11: Expand `spawnAndWait` to accept per-step options

**Files:**

- Modify: `src/core/chain-execution.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/core/slash-chain.ts`

- [ ] **Step 1: Define `StepSpawnOptions` interface in `chain-execution.ts`**

Add above the `ChainExecutionParams` interface:

```typescript
import type { ResolvedToolBudget } from "../shared/types.js";

export interface StepSpawnOptions {
  toolBudget?: ResolvedToolBudget;
  isolation?: "worktree";
  skills?: string[];
}
```

- [ ] **Step 2: Expand `spawnAndWait` signature in `ChainExecutionParams`**

Change from:

```typescript
spawnAndWait: (
  agentDef: AgentDefinition,
  prompt: string,
  cwd: string,
) => Promise<{ id: string; record: AgentRecord }>;
```

To:

```typescript
spawnAndWait: (
  agentDef: AgentDefinition,
  prompt: string,
  cwd: string,
  options?: StepSpawnOptions,
) => Promise<{ id: string; record: AgentRecord }>;
```

- [ ] **Step 3: Update caller in `src/core/subagent.ts`**

In the chain dispatch block (~line 230), update the `spawnAndWait` callback to accept and forward options:

```typescript
spawnAndWait: async (agentDef, prompt, stepCwd, options) => {
  return deps.manager.spawnAndWait(ctx, agentDef, {
    prompt,
    cwd: stepCwd || effectiveCwd,
    maxTurns: loadedConfig.config.defaultMaxTurns,
    toolBudget: options?.toolBudget,
    isolation: options?.isolation,
  });
},
```

When `options.skills` is provided, create a shallow copy of agentDef with overridden skills before passing to `spawnAndWait`:

```typescript
spawnAndWait: async (agentDef, prompt, stepCwd, options) => {
  const effectiveAgentDef = options?.skills
    ? { ...agentDef, skills: options.skills }
    : agentDef;
  return deps.manager.spawnAndWait(ctx, effectiveAgentDef, {
    prompt,
    cwd: stepCwd || effectiveCwd,
    maxTurns: loadedConfig.config.defaultMaxTurns,
    toolBudget: options?.toolBudget,
    isolation: options?.isolation,
  });
},
```

- [ ] **Step 4: Update caller in `src/core/slash-chain.ts`**

Same pattern as step 3 — update the `executeChainInContext` function's `spawnAndWait` callback:

```typescript
spawnAndWait: async (agentDef, prompt, stepCwd, options) => {
  const effectiveAgentDef = options?.skills
    ? { ...agentDef, skills: options.skills }
    : agentDef;
  return deps.manager.spawnAndWait(ctx, effectiveAgentDef, {
    prompt,
    cwd: stepCwd || ctx.cwd,
    maxTurns: loadedConfig.config.defaultMaxTurns,
    toolBudget: options?.toolBudget,
    isolation: options?.isolation,
  });
},
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (all existing call sites still type-check since options is optional)

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-execution.ts src/core/subagent.ts src/core/slash-chain.ts
git commit -m "refactor(chain-execution): expand spawnAndWait to accept StepSpawnOptions"
```

---

### Task 12: Wire step behavior resolution into the execution engine

**Files:**

- Modify: `src/core/chain-execution.ts`
- Modify: `tests/chain-execution.test.ts`

This is the core change. For each step, call `resolveStepBehavior()` to merge agent defaults with step overrides, then call `buildChainInstructions()` to produce prefix/suffix text, then wrap the task prompt and pass options through `spawnAndWait`.

- [ ] **Step 1: Add imports to `chain-execution.ts`**

Add to the imports from `./chain-settings.js`:

```typescript
import {
  isParallelStep,
  isDynamicParallelStep,
  resolveChainTemplates,
  createChainDir,
  removeChainDir,
  resolveStepBehavior,
  buildChainInstructions,
  type AgentBehaviorDefaults,
} from "./chain-settings.js";
```

Also import `validateToolBudget` for step-level toolBudget validation:

```typescript
import { validateToolBudget } from "./tool-budget.js";
```

- [ ] **Step 2: Add helper to extract agent behavior defaults from AgentDefinition**

Add a small helper inside `chain-execution.ts` (not exported):

```typescript
function agentDefaults(agentDef: AgentDefinition): AgentBehaviorDefaults {
  return {
    // AgentDefinition has skills but not output/reads/progress —
    // those are step-level only in our system. Defaults are false/undefined.
    skills: Array.isArray(agentDef.skills) ? agentDef.skills : undefined,
  };
}
```

Note: `AgentDefinition` has `skills?: string[] | boolean` but does NOT have `output`, `reads`, or `progress`. In our implementation, those are step-level config only. The `resolveStepBehavior` function handles missing defaults by falling through to `false`, which means "no instruction" unless the step itself opts in.

- [ ] **Step 3: Wire behavior into sequential step execution**

In the sequential step branch (~line 264-304), before calling `spawnAndWait`, add behavior resolution:

```typescript
// --- Sequential step ---
const seqStep = step as SequentialStep;
const agentDef = findAgent(seqStep.agent);

stepStatuses[flatIndex] = { status: "running" };
emitSnapshot(stepIndex, flatIndex);

// Resolve step behavior
const behavior = resolveStepBehavior(agentDefaults(agentDef), {
  output: seqStep.output,
  outputMode: seqStep.outputMode,
  reads: seqStep.reads,
  progress: seqStep.progress,
  skills: seqStep.skills,
  model: seqStep.model,
});

// Track first progress agent
const isFirstProgress = behavior.progress && !progressCreated;
if (isFirstProgress) progressCreated = true;

// Build prefix/suffix instructions
const { prefix, suffix } = buildChainInstructions(behavior, chainDir, isFirstProgress);

let taskStr = (template as string) ?? "{task}";
taskStr = taskStr
  .replace(/\{task\}/g, task)
  .replace(/\{previous\}/g, prev)
  .replace(/\{chain_dir\}/g, chainDir);
taskStr = resolveOutputReferences(taskStr, outputs);

// Wrap with instructions
const fullPrompt = [prefix, taskStr, suffix].filter(Boolean).join("\n\n");

// Build spawn options
const stepOptions: StepSpawnOptions = {};
if (seqStep.toolBudget) {
  const validated = validateToolBudget(seqStep.toolBudget);
  if (!validated.error) stepOptions.toolBudget = validated.budget;
}
if (behavior.skills && behavior.skills.length > 0) {
  stepOptions.skills = behavior.skills;
}

const { record } = await spawnAndWait(agentDef, fullPrompt, cwd, stepOptions);
```

Add `let progressCreated = false;` near the top of the function, alongside the other state variables.

- [ ] **Step 4: Wire behavior into parallel step execution**

In the parallel step branch, for each item resolve behavior and build instructions:

```typescript
const promises = step.parallel.map(async (item, i) => {
  const agentDef = findAgent(item.agent);
  const behavior = resolveStepBehavior(agentDefaults(agentDef), {
    output: item.output,
    outputMode: item.outputMode,
    reads: item.reads,
    progress: item.progress,
    skills: item.skills,
    model: item.model,
  });

  const isFirstProgress = behavior.progress && !progressCreated;
  if (isFirstProgress) progressCreated = true;
  const { prefix, suffix } = buildChainInstructions(behavior, chainDir, isFirstProgress);

  let taskStr = taskTemplates[i] ?? "{previous}";
  taskStr = taskStr
    .replace(/\{task\}/g, task)
    .replace(/\{previous\}/g, prev)
    .replace(/\{chain_dir\}/g, chainDir);
  taskStr = resolveOutputReferences(taskStr, outputs);

  const fullPrompt = [prefix, taskStr, suffix].filter(Boolean).join("\n\n");

  // Build spawn options
  const stepOptions: StepSpawnOptions = {};
  if (item.toolBudget) {
    const validated = validateToolBudget(item.toolBudget);
    if (!validated.error) stepOptions.toolBudget = validated.budget;
  }
  if (step.worktree) stepOptions.isolation = "worktree";
  if (behavior.skills && behavior.skills.length > 0) {
    stepOptions.skills = behavior.skills;
  }

  const { record } = await spawnAndWait(agentDef, fullPrompt, cwd, stepOptions);
  // ... rest unchanged
});
```

- [ ] **Step 5: Wire behavior into dynamic parallel step execution**

Similar pattern — resolve behavior for the dynamic parallel template agent:

```typescript
const dynamicResults = await Promise.all(
  (items as unknown[]).map(async (item) => {
    const agentDef = findAgent(step.parallel.agent);
    const behavior = resolveStepBehavior(agentDefaults(agentDef), {
      output: step.parallel.output,
      reads: step.parallel.reads,
      progress: step.parallel.progress,
      skills: step.parallel.skills,
    });

    const { prefix, suffix } = buildChainInstructions(behavior, chainDir, false);

    let taskStr = step.parallel.task ?? "{previous}";
    // ... existing item template variable resolution ...
    taskStr = taskStr
      .replace(/\{task\}/g, task)
      .replace(/\{previous\}/g, prev)
      .replace(/\{chain_dir\}/g, chainDir);
    taskStr = resolveOutputReferences(taskStr, outputs);

    const fullPrompt = [prefix, taskStr, suffix].filter(Boolean).join("\n\n");

    const stepOptions: StepSpawnOptions = {};
    if (step.parallel.toolBudget) {
      const validated = validateToolBudget(step.parallel.toolBudget);
      if (!validated.error) stepOptions.toolBudget = validated.budget;
    }
    if (behavior.skills && behavior.skills.length > 0) {
      stepOptions.skills = behavior.skills;
    }

    const { record } = await spawnAndWait(agentDef, fullPrompt, cwd, stepOptions);
    return { output: record.result ?? "", status: record.status };
  }),
);
```

- [ ] **Step 6: Add tests for behavior wiring**

Add to `tests/chain-execution.test.ts`:

```typescript
test("prepends read instructions to task prompt", async () => {
  const prompts: string[] = [];
  const result = await executeChain({
    steps: [
      { agent: "scout", task: "do stuff", reads: ["context.md"] },
    ],
    task: "original",
    spawnAndWait: async (agentDef, prompt, cwd, options) => {
      prompts.push(prompt);
      return { id: "1", record: makeRecord("completed", "done") };
    },
    findAgent: () => makeAgentDef("scout"),
    cwd: "/tmp",
    runId: "test-reads",
  });
  expect(prompts[0]).toContain("[Read from:");
  expect(prompts[0]).toContain("context.md");
});

test("passes toolBudget through StepSpawnOptions", async () => {
  const receivedOptions: any[] = [];
  await executeChain({
    steps: [
      { agent: "worker", task: "build", toolBudget: { soft: 10, hard: 20 } },
    ],
    task: "test",
    spawnAndWait: async (agentDef, prompt, cwd, options) => {
      receivedOptions.push(options);
      return { id: "1", record: makeRecord("completed", "done") };
    },
    findAgent: () => makeAgentDef("worker"),
    cwd: "/tmp",
    runId: "test-budget",
  });
  expect(receivedOptions[0]?.toolBudget).toBeDefined();
});

test("passes isolation: worktree for parallel steps with worktree: true", async () => {
  const receivedOptions: any[] = [];
  await executeChain({
    steps: [
      {
        parallel: [
          { agent: "a", task: "t1" },
          { agent: "b", task: "t2" },
        ],
        worktree: true,
      },
    ],
    task: "test",
    spawnAndWait: async (agentDef, prompt, cwd, options) => {
      receivedOptions.push(options);
      return { id: "1", record: makeRecord("completed", "done") };
    },
    findAgent: (name) => makeAgentDef(name),
    cwd: "/tmp",
    runId: "test-worktree",
  });
  expect(receivedOptions[0]?.isolation).toBe("worktree");
  expect(receivedOptions[1]?.isolation).toBe("worktree");
});

test("passes skills override through StepSpawnOptions", async () => {
  const receivedOptions: any[] = [];
  await executeChain({
    steps: [
      { agent: "worker", task: "build", skills: ["tdd", "lint"] },
    ],
    task: "test",
    spawnAndWait: async (agentDef, prompt, cwd, options) => {
      receivedOptions.push(options);
      return { id: "1", record: makeRecord("completed", "done") };
    },
    findAgent: () => makeAgentDef("worker"),
    cwd: "/tmp",
    runId: "test-skills",
  });
  expect(receivedOptions[0]?.skills).toEqual(["tdd", "lint"]);
});
```

Ensure `makeRecord` and `makeAgentDef` test helpers exist (add `output`, `reads`, `progress`, `skills` fields to `makeAgentDef` if needed — they should default to `undefined`/`false`).

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: All new and existing tests pass.

- [ ] **Step 8: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/core/chain-execution.ts tests/chain-execution.test.ts
git commit -m "feat(chain-execution): wire resolveStepBehavior and buildChainInstructions into step loop"
```

---

### Task 13: Chain directory cleanup

**Files:**

- Modify: `src/core/chain-execution.ts`
- Modify: `tests/chain-execution.test.ts`

- [ ] **Step 1: Call `removeChainDir()` at end of `executeChain()`**

Add cleanup after the summary is built, both on success and on early return (error/abort). Use a try/finally pattern:

Wrap the step loop in a try block and add finally:

```typescript
try {
  // ... existing step loop and summary ...
} finally {
  // Cleanup chain directory (best-effort, never throws)
  removeChainDir(chainDir);
}
```

Alternatively, since `removeChainDir` already catches errors internally, just add the call before each `return` statement (there are 4: abort, seq error, parallel failFast error, dynamic error, plus the success return). The try/finally approach is cleaner.

- [ ] **Step 2: Add test for cleanup**

```typescript
test("removes chain directory after successful execution", async () => {
  const { existsSync } = await import("node:fs");
  let capturedChainDir = "";
  await executeChain({
    steps: [{ agent: "a", task: "{chain_dir}" }],
    task: "test",
    spawnAndWait: async (agentDef, prompt) => {
      capturedChainDir = prompt.trim(); // task template is {chain_dir}
      return { id: "1", record: makeRecord("completed", "done") };
    },
    findAgent: () => makeAgentDef("a"),
    cwd: "/tmp",
    runId: `cleanup-test-${Date.now()}`,
  });
  expect(capturedChainDir).not.toBe("");
  expect(existsSync(capturedChainDir)).toBe(false);
});
```

- [ ] **Step 3: Run tests and commit**

Run: `pnpm vitest run tests/chain-execution.test.ts`
Expected: PASS

```bash
git add src/core/chain-execution.ts tests/chain-execution.test.ts
git commit -m "fix(chain-execution): cleanup chain directory after execution"
```

---

### Task 14: Add bundled example chain

**Files:**

- Create: `chains/implement.chain.md`
- Modify: `tests/chain-discovery.test.ts` (optional: verify bundled chain is discoverable)

- [ ] **Step 1: Create `chains/` directory at package root**

This is the directory that `getBundledChainsDir()` resolves to (`../../chains` from `src/core/`).

- [ ] **Step 2: Create `chains/implement.chain.md`**

```markdown
---
name: implement
description: Scout the codebase, plan the implementation, then execute
---

## scout

phase: Context
label: Explore the codebase
as: context
output: context.md

Analyze the codebase relevant to {task}. Map key files, patterns, and dependencies.

## planner

phase: Planning
label: Create implementation plan
as: plan
reads: context.md
progress: true

Based on {outputs.context}, create a detailed step-by-step implementation plan for {task}.

## worker

phase: Implementation
label: Execute the plan
reads: context.md
progress: true

Implement the following plan:

{outputs.plan}
```

- [ ] **Step 3: Verify chain discovery finds it**

Run: `node -e "import('./src/core/paths.js').then(p => console.log(p.getBundledChainsDir()))"`

Then confirm the file exists at that path.

- [ ] **Step 4: Commit**

```bash
git add chains/implement.chain.md
git commit -m "feat(chains): add bundled implement chain (scout -> planner -> worker)"
```

---

### Task 15: Final verification

- [ ] **Step 1: Run full check**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Run tests in isolation**

Run: `pnpm vitest run`
Expected: All tests pass (existing + new).

- [ ] **Step 3: Review the diff**

Run: `git diff master --stat`
Verify: Only expected files changed. No unintended modifications to existing modules.

- [ ] **Step 4: Final commit if any integration fixes were needed**

```bash
git add -A
git commit -m "chore: phase 10 integration fixes"
```
