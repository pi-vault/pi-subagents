# Chain Definition Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize every Chain definition form before Chain execution performs filesystem or Agent side effects.

**Architecture:** Add and test the unknown-to-`ChainStep[]` normalizer first, then route all adapters through it and remove duplicated shape guards.

**Tech Stack:** TypeScript, Vitest, TypeBox, Node.js filesystem APIs.

---

## Commit sequence

1. `refactor: add chain definition normalizer`
2. `refactor: route chain adapters through normalizer`

### Task 1: Add the Chain definition normalizer

**Files:**
- Modify: `src/core/chain-serializer.ts`
- Modify: `src/core/chain-settings.ts`
- Modify: `src/core/chain-outputs.ts`
- Modify: `tests/chain-serializer.test.ts`
- Modify: `tests/chain-outputs.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Exercise sequential, parallel, dynamic, JSON, and Markdown definitions. Reject non-object steps, malformed nested shapes, invalid budgets, duplicate output names, unknown output references, and invalid output names.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/chain-serializer.test.ts tests/chain-outputs.test.ts
```

- [ ] **Step 3: Implement the core normalizer**

```ts
export class ChainDefinitionError extends Error {
  readonly name = "ChainDefinitionError";
}

export function normalizeChainSteps(
  value: unknown,
  source: string,
): ChainStep[];
```

Validate nested structures, tool budgets, and output bindings. Put shared step guards here and include `source` in errors. Keep runtime output text substitution in `chain-outputs.ts`.

- [ ] **Step 4: Verify and commit the green core task**

```bash
pnpm vitest run tests/chain-serializer.test.ts tests/chain-outputs.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/chain-serializer.ts src/core/chain-settings.ts src/core/chain-outputs.ts tests/chain-serializer.test.ts tests/chain-outputs.test.ts
git add src/core/chain-serializer.ts src/core/chain-settings.ts src/core/chain-outputs.ts tests/chain-serializer.test.ts tests/chain-outputs.test.ts
git commit -m "refactor: add chain definition normalizer"
```

### Task 2: Route every Chain adapter through the normalizer

**Files:**
- Modify: `src/core/slash-chain.ts`
- Modify: `src/core/subagent.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/chain-execution.test.ts`
- Modify: `tests/slash-chain.test.ts`

- [ ] **Step 1: Write failing adapter/no-side-effect tests**

Cover slash, tool, and append inputs. Spy on Chain directory creation and `spawnAndWait`; assert an invalid definition reaches neither.

- [ ] **Step 2: Verify the red test**

```bash
pnpm vitest run tests/chain-execution.test.ts tests/slash-chain.test.ts
```

- [ ] **Step 3: Route all adapters**

Replace raw Chain casts in tool/append dispatch and slash mapping with `normalizeChainSteps`. Keep Agent-name lookup at callers with Agent discovery; pass normalized steps to `executeChain` before directory creation.

- [ ] **Step 4: Verify and commit the green migration task**

```bash
pnpm vitest run tests/chain-execution.test.ts tests/slash-chain.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/slash-chain.ts src/core/subagent.ts src/shared/types.ts
git add src/core/slash-chain.ts src/core/subagent.ts src/shared/types.ts tests/chain-execution.test.ts tests/slash-chain.test.ts
git commit -m "refactor: route chain adapters through normalizer"
