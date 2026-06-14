# Phase 1: Rename `disabled` → `enabled` Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `disabled?: boolean` field with `enabled?: boolean` across types, parser, serializer, TUI, and tests — with backward compatibility for existing user files that still use `disabled: true`.

**Architecture:** A direct rename of the field on `AgentDefinition`, with the parser accepting both `enabled` and legacy `disabled` from frontmatter. The serializer and `disableAgentInUserScope` emit `enabled: false`. No new runtime behavior.

**Tech Stack:** TypeScript, vitest.

---

## File Map

| File                     | Action | Responsibility                                                                          |
| ------------------------ | ------ | --------------------------------------------------------------------------------------- |
| `src/shared/types.ts`    | Modify | Rename `disabled` → `enabled` on `AgentDefinition`                                      |
| `src/core/agents.ts`     | Modify | Parse `enabled` + legacy `disabled`, emit `enabled: false` in `disableAgentInUserScope` |
| `src/tui/agents-menu.ts` | Modify | Replace `overrideAgent?.disabled` with `overrideAgent?.enabled === false`               |
| `tests/agents.test.ts`   | Modify | Fix assertion from `.disabled` to `.enabled`                                            |
| `tests/index.test.ts`    | Modify | Fix mock return from `disabled: true` to `enabled: false`                               |

---

### Task 1: Rename field in `AgentDefinition`

**Files:**

- Modify: `src/shared/types.ts:32-43`

- [ ] **Step 1: Replace `disabled?: boolean` with `enabled?: boolean`**

In `src/shared/types.ts`, change line 40:

```typescript
  enabled?: boolean;
```

The full interface becomes:

```typescript
export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: string;
  subagentAgents: string[];
  timeoutMs?: number;
  enabled?: boolean;
  systemPrompt: string;
  sourcePath: string;
}
```

- [ ] **Step 2: Run typecheck to see what breaks**

Run: `pnpm typecheck`
Expected: FAIL — errors in `src/core/agents.ts` (lines 321-336, 384, 501), `src/tui/agents-menu.ts` (line 235), `tests/agents.test.ts` (line 599), and `tests/index.test.ts` (line 92).

---

### Task 2: Update parser for `enabled` with backward compat

**Files:**

- Modify: `src/core/agents.ts:321-339`

- [ ] **Step 1: Replace the `disabled` parsing block**

In `src/core/agents.ts`, replace lines 321-324:

```typescript
const disabled =
  typeof frontmatter.disabled === "string"
    ? frontmatter.disabled.trim().toLowerCase() === "true"
    : false;
```

With:

```typescript
let enabled: boolean | undefined;
if (frontmatter.enabled !== undefined) {
  const raw =
    typeof frontmatter.enabled === "string"
      ? frontmatter.enabled.trim().toLowerCase()
      : "";
  enabled = raw !== "false";
} else if (frontmatter.disabled !== undefined) {
  // Backward compat: support legacy `disabled: true` in user files
  const raw =
    typeof frontmatter.disabled === "string"
      ? frontmatter.disabled.trim().toLowerCase()
      : "";
  enabled = raw !== "true";
}
```

- [ ] **Step 2: Replace `disabled,` with `enabled,` in the return object**

In `src/core/agents.ts`, replace line 336:

```typescript
      disabled,
```

With:

```typescript
      enabled,
```

- [ ] **Step 3: Update `discoverAgents` to use `enabled === false`**

In `src/core/agents.ts`, replace line 384:

```typescript
    if (agent.disabled) {
```

With:

```typescript
    if (agent.enabled === false) {
```

- [ ] **Step 4: Update `disableAgentInUserScope` to emit `enabled: false`**

In `src/core/agents.ts`, replace line 501:

```typescript
    "disabled: true",
```

With:

```typescript
    "enabled: false",
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors remain only in `src/tui/agents-menu.ts` and tests.

---

### Task 3: Update agents-menu

**Files:**

- Modify: `src/tui/agents-menu.ts:235`

- [ ] **Step 1: Replace `overrideAgent?.disabled`**

In `src/tui/agents-menu.ts`, replace line 235:

```typescript
      if (overrideAgent?.disabled) {
```

With:

```typescript
      if (overrideAgent?.enabled === false) {
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors remain only in test files.

---

### Task 4: Fix tests

**Files:**

- Modify: `tests/agents.test.ts:598-599`
- Modify: `tests/index.test.ts:92`

- [ ] **Step 1: Fix `agents.test.ts` assertion**

In `tests/agents.test.ts`, replace line 599:

```typescript
expect(disabled.disabled).toBe(true);
```

With:

```typescript
expect(disabled.enabled).toBe(false);
```

- [ ] **Step 2: Fix `index.test.ts` mock**

In `tests/index.test.ts`, replace line 92:

```typescript
    disableAgentInUserScope: () => ({ ...discovery.agents[0]!, disabled: true }),
```

With:

```typescript
    disableAgentInUserScope: () => ({ ...discovery.agents[0]!, enabled: false }),
```

- [ ] **Step 3: Add tests for backward compat and new field**

In `tests/agents.test.ts`, add after the "deleting a user override restores the bundled agent" test block (after line 632):

```typescript
test("parses enabled: true", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "enabled: true",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { enabled: true },
  });
});

test("parses enabled: false", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "enabled: false",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { enabled: false },
  });
});

test("supports legacy disabled: true (backward compat)", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "disabled: true",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { enabled: false },
  });
});

test("omitting both enabled and disabled leaves enabled undefined", () => {
  const parsed = parseAgentFile(
    "/tmp/worker.md",
    [
      "---",
      "name: worker",
      "description: Does work",
      "tools: read",
      "---",
      "Do the work.",
    ].join("\n"),
  );

  expect(parsed).toMatchObject({
    ok: true,
    agent: { enabled: undefined },
  });
});
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/core/agents.ts src/tui/agents-menu.ts tests/agents.test.ts tests/index.test.ts
git commit -m "refactor: rename disabled → enabled on AgentDefinition

Parser accepts both 'enabled' and legacy 'disabled' in frontmatter for
backward compatibility with existing user agent files.

The serializer (disableAgentInUserScope) now emits 'enabled: false'.
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full check suite**

Run: `pnpm check`
Expected: lint, typecheck, and all tests PASS.

- [ ] **Step 2: Verify bundled agents still parse**

Run: `pnpm test -- tests/agents.test.ts -t "bundled default agent files exist"`
Expected: PASS.
