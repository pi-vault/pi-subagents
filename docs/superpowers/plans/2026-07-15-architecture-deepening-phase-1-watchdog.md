# Watchdog Policy Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Watchdog runtime own child-policy selection while retaining the current review and warning behavior.

**Architecture:** Add a subject object to the Watchdog interface and resolve child model/thinking internally. `index.ts` remains a warning-delivery adapter; delete the one-caller child-policy module.

**Tech Stack:** TypeScript, Vitest, TypeBox, Pi coding-agent.

---

## Commit sequence

1. `docs: record architecture deepening design`
2. `refactor: deepen watchdog runtime policy`

### Task 1: Record the domain vocabulary used by the refactor

**Files:**
- Create: `CONTEXT.md`
- Create: `docs/superpowers/specs/2026-07-15-architecture-deepening-design.md`

- [ ] **Step 1: Create the root glossary**

```md
# Pi Subagents Context

This context names the concepts used by the Pi subagents extension.

## Language

**Agent**:
A configured delegated worker with a prompt, tool policy, and execution record.
_Avoid_: worker when referring to the domain concept

**Chain**:
A declared sequence or parallel group of Agent invocations whose outputs can feed later steps.
_Avoid_: pipeline when referring to the domain concept

**Watchdog**:
An optional review Agent that inspects an ended Agent's changes or conversation and may request fixes.
_Avoid_: reviewer when referring to the domain concept
```

Write the approved six-phase architecture decisions and settings precedence to the design document.

- [ ] **Step 2: Verify the documentation**

```bash
test -s CONTEXT.md
test -s docs/superpowers/specs/2026-07-15-architecture-deepening-design.md
git diff --check
```

Expected: both files exist and the diff has no whitespace errors.

- [ ] **Step 3: Commit the standalone documentation task**

```bash
git add CONTEXT.md docs/superpowers/specs/2026-07-15-architecture-deepening-design.md
git commit -m "docs: record architecture deepening design"
```

### Task 2: Move child policy behind the Watchdog interface

**Files:**
- Modify: `src/core/watchdog.ts`
- Modify: `src/index.ts`
- Delete: `src/core/watchdog-child.ts`
- Modify: `tests/watchdog.test.ts`
- Delete: `tests/watchdog-child.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Move child-policy coverage into `tests/watchdog.test.ts`. Test parent defaults, child defaults, per-Agent overrides, disabled child overrides, and one warning delivery callback. Call the runtime with:

```ts
const subject = { id: "agent-1", type: "scout", cwd: tmp };
await runtime.handleAgentEnd(subject);
```

- [ ] **Step 2: Run the focused test**

```bash
pnpm vitest run tests/watchdog.test.ts
```

Expected: failure because the runtime still accepts positional `agentId, cwd` arguments and child policy is external.

- [ ] **Step 3: Add the subject interface and internal policy resolver**

```ts
export interface WatchdogSubject {
  id: string;
  type: string;
  cwd: string;
}

export interface WatchdogRuntime {
  handleAgentEnd(subject: WatchdogSubject): Promise<WatchdogWarning[]>;
  status(): "idle" | "reviewing" | "disabled";
  dispose(): void;
}
```

Move child override selection into `watchdog.ts`. Use selected child model/thinking when applicable; otherwise retain the current parent review behavior. Keep reviewer exceptions non-fatal and keep warning payloads unchanged.

- [ ] **Step 4: Simplify the extension adapter**

Update `src/index.ts` to call:

```ts
watchdog.handleAgentEnd({
  id: record.id,
  type: record.type,
  cwd: record.cwd ?? process.cwd(),
});
```

Remove child runtime construction/imports, delete `watchdog-child.ts`, and delete its direct tests only after their cases live in `tests/watchdog.test.ts`.

- [ ] **Step 5: Verify and commit the usable phase**

```bash
pnpm vitest run tests/watchdog.test.ts
pnpm tsc --noEmit
pnpm biome lint src/core/watchdog.ts src/index.ts tests/watchdog.test.ts
git add CONTEXT.md docs/superpowers/specs/2026-07-15-architecture-deepening-design.md src/core/watchdog.ts src/index.ts tests/watchdog.test.ts
git rm src/core/watchdog-child.ts tests/watchdog-child.test.ts
git commit -m "refactor: deepen watchdog runtime policy"
```

Expected: all Watchdog policy behavior is reachable through one runtime interface and the extension remains usable.
