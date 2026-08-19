# Implement Plan Review Chain

**Status:** Design approved in chat; implementation pending spec review.

## Goal

Add a reusable saved chain that accepts a plan-file path, makes the plan implementation-ready, implements it in the current working tree, and performs two write-capable review passes. The chain must honor the configured model and thinking level for every stage instead of silently using the parent model.

Example invocation:

```text
/run-chain implement-plan-review -- docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility-phase-2-dashboard.md
```

The chain is designed for the existing `@pi-vault/pi-subagents` package and its bundled agents.

## Decisions

- Use the existing `worker` agent for all four stages. It already has the tools needed to edit plans, implement code, fix review findings, and verify changes.
- Keep stages sequential, independent, and in the same working tree. Do not inherit the parent conversation and do not create a worktree.
- Stage 1 owns readiness: it may replan the supplied file and must return only after the plan is implementation-ready. There is no conditional retry or interactive approval pause.
- Review stages are write-capable workers rather than the bundled read-only `reviewer` agent.
- Use these skills per stage: `brainstorming`, `test-driven-development`, `requesting-code-review`, and `ponytail-review`.
- Resolve explicit model names before execution and fail before spawning any stage if a model cannot be resolved. Never silently fall back to the parent or agent-default model.
- Follow tests named by the plan and run relevant repository-native checks. Do not add a separate runtime execution mechanism for `acceptance.command` in this work.

## Current Constraints

The package already supports saved sequential chains, per-step `model` and `skills`, named outputs, parallel steps, and chain status. The existing saved chain in `chains/implement.chain.md` demonstrates scout → planner → worker handoff.

Two gaps prevent the requested workflow from being represented faithfully:

1. Chain step definitions do not support per-step `thinking`.
2. Chain dispatch places a step model on a temporary agent definition but does not forward it through `AgentManager`'s `SpawnOptions`, so the run can use the parent model instead.

The current `acceptance` field is definition metadata only; `chain-execution.ts` does not execute its command. This design intentionally leaves that behavior unchanged.

## Saved Chain

Create `chains/implement-plan-review.chain.md` with four sequential `worker` steps. Each step explicitly references `{task}` so that the plan path, rather than prior prose, is the durable handoff.

### Stage 1 — Plan readiness

- Model: `GPT-5.6 Luna`
- Thinking: `max`
- Skill: `brainstorming`
- Read the current repository and `{task}`.
- Edit only the plan when it is incomplete, contradictory, or not implementation-ready.
- Do not modify product code.
- Return only after the plan is ready for implementation.

### Stage 2 — Implementation

- Model: `MiniMax-M3`
- Thinking: `high`
- Skill: `test-driven-development`
- Read and follow `{task}`.
- Implement directly in the current working tree without worktree isolation.
- Run plan-specified tests and relevant repository checks.
- Do not replace the plan with a new design during implementation.

### Stage 3 — Correctness review

- Model: `GPT-5.6 Luna`
- Thinking: `max`
- Skill: `requesting-code-review`
- Read `{task}`, inspect the current diff and tests, and review for defects, regressions, and missing coverage.
- Fix valid findings directly and verify the fixes.

### Stage 4 — Over-engineering review

- Model: `GPT-5.6 Luna`
- Thinking: `max`
- Skill: `ponytail-review`
- Read `{task}` and inspect the final diff.
- Remove only unjustified complexity; preserve interfaces and seams needed by later phases.
- Fix valid findings directly and verify the final state.

No `reads`, `output`, or `as` handoffs are required because every stage can read the plan path and the shared working tree directly.

## Runtime Changes

### Chain schema and parsing

Add `thinking?: string` to all chain step representations that can carry behavior:

- `SequentialStep`
- `ParallelTaskItem`
- `DynamicParallelTemplate`
- `ChainStepConfig`
- inline `/chain` configuration

Recognize, validate, and serialize the field in both `.chain.md` and `.chain.json` definitions. Add inline parsing support for `thinking=<level>` so saved and inline chains use the same behavior model. Existing definitions without the field retain their current defaults.

Thinking levels are normalized case-insensitively to the Pi-supported names (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Invalid levels fail validation; the runtime must not silently clamp a requested level.

### Execution propagation

Extend chain behavior resolution and `StepSpawnOptions` with `thinking`. When resolving a step, use the step override first and the selected agent definition's `thinking` as the default. Do the same for `model`, so an agent's configured model remains effective when a step has no override.

Forward the resolved model and thinking through both chain dispatch paths (`/chain` and `subagent` tool) into `AgentManager.spawnAndWait`. The existing single-agent invocation path remains unchanged.

### Model preflight

Before executing stage 1, inspect every explicit chain-step model against the active model registry using the existing exact and fuzzy lookup behavior. Store/pass the canonical `provider/id` representation used by the single-agent path. If the registry is unavailable or a configured model cannot be resolved, return an error naming the step and requested model; do not spawn any stage.

Preserve existing model-scope enforcement, applying it to the canonical resolved model. Omitted step models continue to use the selected agent's configured model or the parent/default model according to the existing invocation rules.

## Testing

Add focused tests for:

1. `.chain.md` and `.chain.json` parsing/serialization of `thinking`.
2. Inline `/chain` parsing of `thinking=<level>`.
3. Case normalization and invalid-level rejection.
4. Chain execution forwarding each step's model and thinking to `spawnAndWait`.
5. Agent-definition model/thinking defaults when a step omits overrides.
6. Model preflight resolving fuzzy names, failing before any spawn for an unknown model, and preserving existing model-scope behavior.
7. Regression coverage for the existing saved `implement` chain and default single-agent execution.
8. Parsing and execution of the new four-stage saved chain definition.

Verification commands:

```bash
pnpm check
pnpm pack:dry-run
```

## Boundaries and Risks

- Replanning is intentionally an instruction contract inside stage 1, not a new conditional/retry primitive.
- Review stages may modify the working tree, but they do not modify the plan file.
- All stages share the current working tree. Existing chain terminal-status handling remains unchanged; this design adds no rollback, retry, or recovery behavior.
- Model display names remain dependent on the active Pi registry. Fail-fast behavior prevents an unintended model substitution.
- Runtime acceptance commands, automatic test gates, new agent roles, and parallelism are out of scope.

## Completion Criteria

The work is complete when:

- The new saved chain parses and invokes four sequential worker stages with the requested skills, models, and thinking levels.
- Explicit model overrides are resolved and forwarded, and unresolved overrides prevent execution before stage 1.
- The existing chain and single-agent behavior remain compatible.
- Focused tests and `pnpm check` pass.
- The package dry-run includes the new chain file and modified source/tests.
