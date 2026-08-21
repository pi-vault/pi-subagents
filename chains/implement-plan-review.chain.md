---
name: implement-plan-review
description: Improve a plan, implement it, and review the resulting changes
---

# Implement Plan Review

## worker

model: openai-codex/gpt-5.6-luna
thinking: max
skills: brainstorming

Read `{task}`. Improve only that plan until it is implementation-ready.
This is an autonomous chain stage: treat the chain task as approval, do not
ask for approval or pause. Modify only `{task}`; do not modify product code,
tests, agent definitions, or chain files. Do not commit.

## worker

model: minimax/MiniMax-M3
thinking: high
skills: test-driven-development

Read and follow `{task}`. Implement the requested runtime changes directly
in the current working tree. Modify only the product source/tests required
by the plan; do not modify `{task}`, agent definitions, or chain files. Use
the existing tree; do not create a worktree. Run the checks specified by the
plan and the repository's native checks. Do not commit automatically.

## worker

model: openai-codex/gpt-5.6-luna
thinking: max
skills: requesting-code-review

Inspect `git diff HEAD`, including all current dirty changes. Use the
bundled read-only `reviewer` agent—the only permitted correctness-review
delegate—with `{task}` and the dirty diff in its prompt; do not request a
`general-purpose` or additional reviewer. Fix valid correctness findings in
product code, run relevant verification, and do not modify the plan or
commit changes.

## worker

model: openai-codex/gpt-5.6-luna
thinking: max
skills: ponytail-review

Inspect the final `git diff HEAD` for `{task}`. Use `ponytail-review` as the complexity
audit, then apply only justified cleanup in product code while preserving
required interfaces and behavior. This stage is write-capable even though
the audit skill is report-only by default. Do not modify the plan, chain, or
agent definitions or commit changes. Run relevant verification after any
cleanup.
