# Implement Plan Review Runtime — Phase 6: Saved Chain Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the expected four-stage `implement-plan-review` saved chain after runtime support is complete.

**Architecture:** Keep the existing saved-chain format and worker agent. The chain uses canonical model IDs, explicit thinking levels, and the four approved skills; all stages share the current tree and receive the plan path through `{task}`.

**Tech Stack:** Chain Markdown format, TypeScript/Vitest discovery tests, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

## Global Constraints

- Use `worker` for all four stages.
- Use `openai-codex/gpt-5.6-luna` with `max` for stages 1, 3, and 4.
- Use `minimax/MiniMax-M3` with `high` for stage 2.
- Keep stages sequential, independent, same-tree, and without worktree isolation or automatic commits.
- Stage 1 edits only the plan; review stages edit product code but not the plan.
- Stage 3 reviews `git diff HEAD`, including all current dirty changes.

---

### Task 1: Add the Saved Chain and Reviewer Delegation

**Files:**

- Create: `chains/implement-plan-review.chain.md`
- Modify: `agents/worker.md`
- Test: `tests/chain-serializer.test.ts`
- Test: `tests/subagent-chain.test.ts`

**Interfaces:**

- The chain is loaded by the existing `/run-chain implement-plan-review -- path/to/plan.md` flow.
- Add `reviewer` to `worker`’s existing `subagent_agents` list so the correctness-review skill can delegate to the bundled read-only reviewer.

- [ ] **Step 1: Add failing discovery and assignment tests.**

  Assert the packaged chain is discoverable, contains four sequential `worker` steps, and has these exact assignments:

  ```ts
  expect(steps.map((step) => [step.model, step.thinking, step.skills])).toEqual([
    ["openai-codex/gpt-5.6-luna", "max", ["brainstorming"]],
    ["minimax/MiniMax-M3", "high", ["test-driven-development"]],
    ["openai-codex/gpt-5.6-luna", "max", ["requesting-code-review"]],
    ["openai-codex/gpt-5.6-luna", "max", ["ponytail-review"]],
  ]);
  ```

- [ ] **Step 2: Run the tests and confirm failure.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/subagent-chain.test.ts
  ```

  Expected: FAIL because the saved chain does not exist.

- [ ] **Step 3: Create the four-stage chain.**

  Create `chains/implement-plan-review.chain.md` with this exact structure:

  ```markdown
  # Implement Plan Review

  ## worker

  model: openai-codex/gpt-5.6-luna
  thinking: max
  skills: brainstorming

  Read `{task}`. Improve only that plan until it is implementation-ready.
  Work autonomously without asking for approval. Do not modify product code,
  tests, agent definitions, or chain files.

  ## worker

  model: minimax/MiniMax-M3
  thinking: high
  skills: test-driven-development

  Read and follow `{task}`. Implement the requested runtime changes directly
  in the current working tree. Use the existing tree; do not create a
  worktree. Run the checks specified by the plan and the repository's native
  checks. Do not commit automatically.

  ## worker

  model: openai-codex/gpt-5.6-luna
  thinking: max
  skills: requesting-code-review

  Inspect `git diff HEAD`, including all current dirty changes. Use the
  permitted read-only reviewer delegation. Fix valid correctness findings in
  product code, run relevant verification, and do not modify the plan or
  commit changes.

  ## worker

  model: openai-codex/gpt-5.6-luna
  thinking: max
  skills: ponytail-review

  Inspect the final `git diff HEAD`. Remove only unjustified complexity while
  preserving required interfaces and behavior. Do not modify the plan or
  commit changes. Run relevant verification after any cleanup.
  ```

  The prompts must preserve these execution rules:

  - Stage 1: read `{task}`, autonomously make only the plan implementation-ready, and do not modify product code.
  - Stage 2: read and follow `{task}`, implement directly in the current working tree, and run plan-specified/native checks.
  - Stage 3: inspect `git diff HEAD`, use the permitted read-only reviewer delegation, fix valid correctness findings in product code, and verify without committing.
  - Stage 4: inspect the final diff, remove only unjustified complexity, preserve required interfaces, and verify without modifying the plan.

  Use `model`, `thinking`, and `skills` values exactly as specified in the assignment test.

- [ ] **Step 4: Allow worker-to-reviewer delegation.**

  Change only `agents/worker.md`’s `subagent_agents` list to add `reviewer`.

- [ ] **Step 5: Run saved-chain tests.**

  ```bash
  pnpm vitest run tests/chain-serializer.test.ts tests/subagent-chain.test.ts
  ```

  Expected: discovery, parsing, assignment, and execution wiring tests pass.

- [ ] **Step 6: Commit the integration artifact.**

  ```bash
  git add chains/implement-plan-review.chain.md agents/worker.md tests/chain-serializer.test.ts tests/subagent-chain.test.ts
  git commit -m "feat: add implement plan review chain"
  ```

## Phase Result

The expected saved chain is packaged and executable through the completed runtime, with the approved four-stage model, thinking, and skill assignments.
