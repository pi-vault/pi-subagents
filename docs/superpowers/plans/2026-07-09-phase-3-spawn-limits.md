# Phase 3: Spawn Limits Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `AgentManager.spawn()` enforces per-session spawn limits. Config value applied at startup. Settings menu `apply` wired. Counter resets on session switch.

**Prerequisite:** Phase 2 complete (config + invocation-config wired).

**Tech Stack:** TypeScript, Vitest, Biome

**Spec:** `docs/superpowers/specs/2026-07-08-spawn-limits-tool-budgets-design.md`

**Deliverable:** Spawn limit is enforced. Spawning beyond the limit throws an error caught by the existing tool handler. Settings menu `apply` for `maxSpawnsPerSession` applies live. Counter resets on session switch.

---

### Task 3.1: Update `src/core/agent-manager.ts`

**Files:**

- Modify: `src/core/agent-manager.ts`

- [ ] **Step 1: Add imports**

Add after the existing imports:

```typescript
import {
  DEFAULT_MAX_SPAWNS_PER_SESSION,
  checkSpawnLimit,
  resolveMaxSpawns,
} from "./spawn-guard.js";
```

- [ ] **Step 2: Add private fields to the class**

Add after `private onStart?: OnAgentStart;`:

```typescript
  private spawnCount = 0;
  private maxSpawnsPerSession = DEFAULT_MAX_SPAWNS_PER_SESSION;
```

- [ ] **Step 3: Add spawn limit check in `spawn()` method**

At the top of the `spawn()` method, after the `allowedAgents` check (after the closing `}` of the `if (options.allowedAgents ...)` block), add:

```typescript
const effectiveMax = resolveMaxSpawns(this.maxSpawnsPerSession);
const spawnError = checkSpawnLimit(this.spawnCount, 1, effectiveMax);
if (spawnError) {
  throw new Error(spawnError);
}
this.spawnCount++;
```

- [ ] **Step 4: Add setter, getter, and reset methods**

Add after the `getMaxConcurrent()` method:

```typescript
  setMaxSpawnsPerSession(n: number): void {
    this.maxSpawnsPerSession = n;
  }

  getSpawnCount(): number {
    return this.spawnCount;
  }

  resetSpawnCounter(): void {
    this.spawnCount = 0;
  }
```

- [ ] **Step 5: Reset counter in `dispose()`**

Add `this.spawnCount = 0;` in the `dispose()` method, before or after `this.agents.clear();`:

```typescript
this.spawnCount = 0;
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```
feat(agent-manager): add spawn counter and limit enforcement

- Private spawnCount + maxSpawnsPerSession fields
- checkSpawnLimit guard at top of spawn()
- setMaxSpawnsPerSession, getSpawnCount, resetSpawnCounter methods
- dispose() resets counter
```

---

### Task 3.2: Wire `apply` callback in settings menu

**Context:** Phase 2 deferred this step because `setMaxSpawnsPerSession` didn't exist yet. Now that Task 3.1 added it, wire the live-apply callback.

**Files:**

- Modify: `src/tui/agents-menu.ts`

- [ ] **Step 1: Add `apply` callback to `maxSpawnsPerSession` menu item**

In `SETTINGS_MENU_ITEMS`, find the `maxSpawnsPerSession` entry (around line 108) and add an `apply` callback after the `parse` function:

```typescript
  {
    key: "maxSpawnsPerSession",
    label: "Max Spawns Per Session",
    promptTitle: "Max Spawns Per Session (0 = block all)",
    formatValue: (config) => String(config.maxSpawnsPerSession),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    },
    apply: (value, deps) => {
      deps.manager.setMaxSpawnsPerSession(value as number);
    },
  },
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat(settings): wire live apply for maxSpawnsPerSession

- Changing Max Spawns Per Session in /agents menu now takes effect
  immediately without requiring restart
```

---

### Task 3.3: Apply config at startup + reset on session switch in `src/index.ts`

**Context:** The spawn limit must be loaded from config at startup, and the counter must reset when switching sessions (matching the reference implementation's behavior — a "per-session" limit means the counter is scoped to the current session).

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Apply maxSpawnsPerSession from config after manager creation**

In `createRuntimeDeps()`, after the `manager` is created (after the `new AgentManager(3, ...)` block closes, around line 164), add:

```typescript
// Apply spawn limit from config
{
  const initPaths = resolvePaths();
  const { config: initConfig } = loadConfig(initPaths);
  manager.setMaxSpawnsPerSession(initConfig.maxSpawnsPerSession);
}
```

- [ ] **Step 2: Reset spawn counter on session switch**

In the existing `session_before_switch` handler (around line 401), add `deps.manager.resetSpawnCounter()` so the counter resets for the new session:

```typescript
pi.on("session_before_switch", () => {
  deps.manager.resetSpawnCounter();
  deps.manager.clearCompleted();
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat: apply spawn limit from config at startup, reset on session switch

- index.ts: load config and call setMaxSpawnsPerSession in createRuntimeDeps
- index.ts: resetSpawnCounter in session_before_switch handler
```

---

### Task 3.4: Update `tests/agent-manager.test.ts`

**Files:**

- Modify: `tests/agent-manager.test.ts`

- [ ] **Step 1: Add spawn limit tests**

Add a new `describe` block at the end of the file:

```typescript
describe("spawn limits", () => {
  it("blocks spawn when limit reached", () => {
    const manager = new AgentManager(3);
    manager.setMaxSpawnsPerSession(2);
    // First two succeed
    manager.spawn({}, makeAgentDef(), {
      prompt: "task 1",
      cwd: "/tmp",
      isBackground: true,
    });
    manager.spawn({}, makeAgentDef(), {
      prompt: "task 2",
      cwd: "/tmp",
      isBackground: true,
    });
    // Third should fail
    expect(() =>
      manager.spawn({}, makeAgentDef(), {
        prompt: "task 3",
        cwd: "/tmp",
        isBackground: true,
      }),
    ).toThrow(/spawn limit/i);
    manager.dispose();
  });

  it("increments spawn counter on each spawn", () => {
    const manager = new AgentManager(3);
    expect(manager.getSpawnCount()).toBe(0);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(2);
    manager.dispose();
  });

  it("resetSpawnCounter resets to zero", () => {
    const manager = new AgentManager(3);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.resetSpawnCounter();
    expect(manager.getSpawnCount()).toBe(0);
    manager.dispose();
  });

  it("setMaxSpawnsPerSession updates the limit", () => {
    const manager = new AgentManager(3);
    manager.setMaxSpawnsPerSession(1);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(() =>
      manager.spawn({}, makeAgentDef(), {
        prompt: "task 2",
        cwd: "/tmp",
        isBackground: true,
      }),
    ).toThrow(/spawn limit/i);
    manager.dispose();
  });

  it("dispose resets spawn counter", () => {
    const manager = new AgentManager(3);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.dispose();
    expect(manager.getSpawnCount()).toBe(0);
  });

  it("spawnAndWait also increments counter", async () => {
    const manager = new AgentManager(3);
    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.dispose();
  });
});
```

- [ ] **Step 2: Run agent-manager tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npx vitest run tests/agent-manager.test.ts`
Expected: All tests PASS (existing + 6 new)

- [ ] **Step 3: Commit**

```
test: add spawn limit integration tests

- 6 new tests: block at limit, counter increment, reset,
  setMaxSpawnsPerSession, dispose reset, spawnAndWait counter
```

---

### Task 3.5: Phase 3 verification

- [ ] **Step 1: Run full check suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-subagents && npm run check`
Expected: All pass

---

---

**Next:** Phase 4 (`docs/superpowers/plans/2026-07-09-phase-4-tool-budgets.md`)
