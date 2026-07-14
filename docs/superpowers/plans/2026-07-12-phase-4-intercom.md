# Phase 4: Intercom / Supervisor Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable child agents to request decisions, send progress updates, or conduct structured interviews with the parent session via in-process promise-based communication.

**Architecture:** A single module `src/core/intercom.ts` containing `IntercomManager` (request/reply state machine), a child tool factory (`createContactSupervisorTool`), and a parent tool factory (`createIntercomTool`). Manager is created during extension init, stored on `RuntimeDeps`. Child tool injected via `customTools` on `runAgent`. Parent tool registered lazily on first child intercom opt-in.

**Tech Stack:** TypeScript, Vitest, TypeBox, `@earendil-works/pi-coding-agent` (ExtensionAPI, ToolDefinition)

**Spec:** `docs/superpowers/specs/2026-07-12-security-memory-intercom-watchdog-design.md` (Phase 4 section)

---

## File Map

| File                         | Action | Responsibility                                                         |
| ---------------------------- | ------ | ---------------------------------------------------------------------- |
| `src/core/intercom.ts`       | Create | `IntercomManager`, `createContactSupervisorTool`, `createIntercomTool` |
| `tests/intercom.test.ts`     | Create | Unit tests for manager, child tool, parent tool                        |
| `src/shared/types.ts`        | Modify | Add `intercom` field to `AgentDefinition`                              |
| `src/shared/runtime-deps.ts` | Modify | Add `intercom?: IntercomManager`                                       |
| `src/core/agent-format.ts`   | Modify | Parse `intercom` from frontmatter                                      |
| `src/core/agent-manager.ts`  | Modify | Inject `contact_supervisor` tool via customTools                       |
| `src/index.ts`               | Modify | Create IntercomManager, register parent tool, renderer, cleanup        |

---

### Task 1: Implement `IntercomManager` core

**Files:**

- Create: `src/core/intercom.ts`
- Create: `tests/intercom.test.ts`

- [ ] **Step 1: Write failing tests for IntercomManager**

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createIntercomManager } from "../src/core/intercom.js";
import type { IntercomManager } from "../src/core/intercom.js";

describe("IntercomManager", () => {
  let manager: IntercomManager;

  beforeEach(() => {
    manager = createIntercomManager({ timeoutMs: 1000 });
  });

  it("sendRequest with expectsReply=false resolves immediately with null", async () => {
    const result = await manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "progress_update",
      message: "50% done",
      expectsReply: false,
    });
    expect(result).toBeNull();
  });

  it("sendRequest with expectsReply=true blocks until reply", async () => {
    const promise = manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Which approach?",
      expectsReply: true,
    });

    // Should have one pending
    const pending = manager.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].agentName).toBe("Scout");

    // Reply
    manager.reply(pending[0].id, "Use approach A");

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.message).toBe("Use approach A");
  });

  it("sendRequest times out and returns timeout reply", async () => {
    const mgr = createIntercomManager({ timeoutMs: 50 });
    const result = await mgr.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Help?",
      expectsReply: true,
    });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("timeout");
  });

  it("cancelForAgent rejects pending requests for that agent", async () => {
    const promise = manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Help?",
      expectsReply: true,
    });

    manager.cancelForAgent("a1");

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.message).toContain("cancelled");
  });

  it("dispose rejects all pending", async () => {
    const promise = manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Help?",
      expectsReply: true,
    });

    manager.dispose();

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.message).toContain("ended");
  });

  it("listPending only shows expectsReply=true requests", async () => {
    await manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "progress_update",
      message: "update",
      expectsReply: false,
    });

    manager.sendRequest({
      agentId: "a2",
      agentName: "Planner",
      reason: "need_decision",
      message: "decide",
      expectsReply: true,
    });

    // Small delay to let the progress_update resolve
    await new Promise((r) => setTimeout(r, 10));

    const pending = manager.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].agentName).toBe("Planner");
  });

  it("reply to nonexistent ID is a no-op", () => {
    expect(() => manager.reply("nonexistent", "hi")).not.toThrow();
  });

  it("onRequest callback fires for expectsReply=true", async () => {
    const onRequest = vi.fn();
    const mgr = createIntercomManager({ timeoutMs: 5000, onRequest });
    mgr.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Which?",
      expectsReply: true,
    });
    expect(onRequest).toHaveBeenCalledOnce();
    expect(onRequest.mock.calls[0][0]).toMatchObject({
      agentName: "Scout",
      reason: "need_decision",
    });
    mgr.dispose();
  });

  it("onRequest callback does not fire for expectsReply=false", async () => {
    const onRequest = vi.fn();
    const mgr = createIntercomManager({ timeoutMs: 5000, onRequest });
    await mgr.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "progress_update",
      message: "50%",
      expectsReply: false,
    });
    expect(onRequest).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/intercom.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement IntercomManager**

Create `src/core/intercom.ts`:

```typescript
import { randomUUID } from "node:crypto";

export type IntercomReason =
  | "need_decision"
  | "progress_update"
  | "interview_request";

export interface IntercomRequest {
  id: string;
  agentId: string;
  agentName: string;
  reason: IntercomReason;
  message: string;
  expectsReply: boolean;
  createdAt: number;
  interview?: unknown;
}

export interface IntercomReply {
  requestId: string;
  message: string;
  createdAt: number;
}

export interface IntercomManager {
  sendRequest(
    request: Omit<IntercomRequest, "id" | "createdAt">,
    signal?: AbortSignal,
  ): Promise<IntercomReply | null>;
  listPending(): IntercomRequest[];
  reply(requestId: string, message: string): void;
  cancelForAgent(agentId: string): void;
  dispose(): void;
}

interface PendingEntry {
  request: IntercomRequest;
  resolve: (reply: IntercomReply | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createIntercomManager(options?: {
  timeoutMs?: number;
  onRequest?: (request: IntercomRequest) => void;
}): IntercomManager {
  const timeoutMs = options?.timeoutMs ?? 300_000; // 5 min default
  const pending = new Map<string, PendingEntry>();

  function sendRequest(
    input: Omit<IntercomRequest, "id" | "createdAt">,
    signal?: AbortSignal,
  ): Promise<IntercomReply | null> {
    // Non-blocking progress updates
    if (!input.expectsReply) {
      return Promise.resolve(null);
    }

    const request: IntercomRequest = {
      ...input,
      id: randomUUID().slice(0, 8),
      createdAt: Date.now(),
    };

    return new Promise<IntercomReply | null>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(request.id);
        resolve({
          requestId: request.id,
          message:
            "Supervisor reply timeout — no reply received. Proceed with your best judgment.",
          createdAt: Date.now(),
        });
      }, timeoutMs);

      const entry: PendingEntry = { request, resolve, timer };
      pending.set(request.id, entry);

      // Notify listener (e.g., parent session) about the new request
      options?.onRequest?.(request);

      // Wire abort signal
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          pending.delete(request.id);
          resolve({
            requestId: request.id,
            message: "Request cancelled.",
            createdAt: Date.now(),
          });
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  function listPending(): IntercomRequest[] {
    return [...pending.values()].map((e) => e.request);
  }

  function reply(requestId: string, message: string): void {
    // Support prefix matching
    let entry: PendingEntry | undefined;
    if (pending.has(requestId)) {
      entry = pending.get(requestId);
    } else {
      // Prefix match
      for (const [id, e] of pending) {
        if (id.startsWith(requestId)) {
          entry = e;
          requestId = id;
          break;
        }
      }
    }
    if (!entry) return;

    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve({
      requestId,
      message,
      createdAt: Date.now(),
    });
  }

  function cancelForAgent(agentId: string): void {
    for (const [id, entry] of pending) {
      if (entry.request.agentId === agentId) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve({
          requestId: id,
          message: "Agent cancelled — supervisor request abandoned.",
          createdAt: Date.now(),
        });
      }
    }
  }

  function dispose(): void {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({
        requestId: id,
        message: "Session ended — supervisor request abandoned.",
        createdAt: Date.now(),
      });
    }
    pending.clear();
  }

  return { sendRequest, listPending, reply, cancelForAgent, dispose };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/intercom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/intercom.ts tests/intercom.test.ts
git commit -m "feat(intercom): add IntercomManager with send/reply/cancel/dispose"
```

---

### Task 2: Implement child tool `contact_supervisor`

**Files:**

- Modify: `src/core/intercom.ts`
- Modify: `tests/intercom.test.ts`

- [ ] **Step 1: Write failing tests for child tool**

Add to `tests/intercom.test.ts`:

```typescript
import { createContactSupervisorTool } from "../src/core/intercom.js";

describe("createContactSupervisorTool", () => {
  it("returns a tool definition with correct name", () => {
    const manager = createIntercomManager({ timeoutMs: 100 });
    const tool = createContactSupervisorTool(manager, "agent-1", "Scout");
    expect(tool.name).toBe("contact_supervisor");
  });

  it("progress_update returns immediately", async () => {
    const manager = createIntercomManager({ timeoutMs: 100 });
    const tool = createContactSupervisorTool(manager, "agent-1", "Scout");
    const result = await tool.execute(
      "tc-1",
      {
        reason: "progress_update",
        message: "50% complete",
      },
      undefined,
      undefined,
      {} as any,
    );
    expect(result.content[0].text).toContain("delivered");
  });

  it("need_decision blocks until reply", async () => {
    const manager = createIntercomManager({ timeoutMs: 5000 });
    const tool = createContactSupervisorTool(manager, "agent-1", "Scout");
    const promise = tool.execute(
      "tc-1",
      {
        reason: "need_decision",
        message: "Which path?",
      },
      undefined,
      undefined,
      {} as any,
    );

    // Reply from parent side
    await new Promise((r) => setTimeout(r, 10));
    const pending = manager.listPending();
    manager.reply(pending[0].id, "Take path B");

    const result = await promise;
    expect(result.content[0].text).toContain("Take path B");
  });

  it("returns timeout message on timeout", async () => {
    const manager = createIntercomManager({ timeoutMs: 50 });
    const tool = createContactSupervisorTool(manager, "agent-1", "Scout");
    const result = await tool.execute(
      "tc-1",
      {
        reason: "need_decision",
        message: "Help?",
      },
      undefined,
      undefined,
      {} as any,
    );
    expect(result.content[0].text).toContain("timeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/intercom.test.ts`
Expected: FAIL — `createContactSupervisorTool` not exported

- [ ] **Step 3: Implement `createContactSupervisorTool`**

Add to `src/core/intercom.ts`:

```typescript
import { Type } from "typebox";

export interface IntercomToolDef {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: { reason: IntercomReason; message: string; interview?: unknown },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

/**
 * Create the child-side `contact_supervisor` tool bound to a specific agent.
 */
export function createContactSupervisorTool(
  manager: IntercomManager,
  agentId: string,
  agentName: string,
): IntercomToolDef {
  return {
    name: "contact_supervisor",
    label: "Contact Supervisor",
    description:
      "Contact the parent session for a blocking decision, progress update, or structured interview.",
    parameters: Type.Object({
      reason: Type.Union([
        Type.Literal("need_decision"),
        Type.Literal("progress_update"),
        Type.Literal("interview_request"),
      ]),
      message: Type.String({ description: "What you need from the parent" }),
      interview: Type.Optional(
        Type.Unknown({
          description: "Structured data for interview_request",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const expectsReply = params.reason !== "progress_update";

      const reply = await manager.sendRequest(
        {
          agentId,
          agentName,
          reason: params.reason,
          message: params.message,
          expectsReply,
          interview: params.interview,
        },
        signal ?? undefined,
      );

      if (!expectsReply) {
        return {
          content: [{ type: "text", text: "Progress update delivered." }],
        };
      }

      if (reply) {
        if (reply.message.includes("timeout")) {
          return {
            content: [
              {
                type: "text",
                text: `Supervisor reply timeout — no reply received. Proceed with your best judgment.`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: `Parent replied: ${reply.message}` }],
        };
      }

      return { content: [{ type: "text", text: "No reply received." }] };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/intercom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/intercom.ts tests/intercom.test.ts
git commit -m "feat(intercom): add createContactSupervisorTool for child agents"
```

---

### Task 3: Implement parent tool `intercom`

**Files:**

- Modify: `src/core/intercom.ts`
- Modify: `tests/intercom.test.ts`

- [ ] **Step 1: Write failing tests for parent tool**

Add to `tests/intercom.test.ts`:

```typescript
import { createIntercomTool } from "../src/core/intercom.js";

describe("createIntercomTool", () => {
  it("list action shows pending requests", async () => {
    const manager = createIntercomManager({ timeoutMs: 5000 });
    const tool = createIntercomTool(manager);

    // Create a pending request
    manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Which file?",
      expectsReply: true,
    });

    await new Promise((r) => setTimeout(r, 10));

    const result = await tool.execute(
      "tc-1",
      { action: "list" },
      undefined,
      undefined,
      {} as any,
    );
    expect(result.content[0].text).toContain("Scout");
    expect(result.content[0].text).toContain("Which file?");
  });

  it("reply action resolves a pending request", async () => {
    const manager = createIntercomManager({ timeoutMs: 5000 });
    const tool = createIntercomTool(manager);

    const replyPromise = manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Which file?",
      expectsReply: true,
    });

    await new Promise((r) => setTimeout(r, 10));
    const pending = manager.listPending();

    await tool.execute(
      "tc-1",
      {
        action: "reply",
        replyTo: pending[0].id,
        message: "Use main.ts",
      },
      undefined,
      undefined,
      {} as any,
    );

    const reply = await replyPromise;
    expect(reply!.message).toBe("Use main.ts");
  });

  it("reply auto-resolves when only one pending", async () => {
    const manager = createIntercomManager({ timeoutMs: 5000 });
    const tool = createIntercomTool(manager);

    const replyPromise = manager.sendRequest({
      agentId: "a1",
      agentName: "Scout",
      reason: "need_decision",
      message: "Which file?",
      expectsReply: true,
    });

    await new Promise((r) => setTimeout(r, 10));

    // No replyTo specified — should auto-resolve single pending
    await tool.execute(
      "tc-1",
      {
        action: "reply",
        message: "Use main.ts",
      },
      undefined,
      undefined,
      {} as any,
    );

    const reply = await replyPromise;
    expect(reply!.message).toBe("Use main.ts");
  });

  it("status action returns info", async () => {
    const manager = createIntercomManager({ timeoutMs: 5000 });
    const tool = createIntercomTool(manager);
    const result = await tool.execute(
      "tc-1",
      { action: "status" },
      undefined,
      undefined,
      {} as any,
    );
    expect(result.content[0].text).toContain("Intercom active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/intercom.test.ts`
Expected: FAIL — `createIntercomTool` not exported

- [ ] **Step 3: Implement `createIntercomTool`**

Add to `src/core/intercom.ts`:

```typescript
/**
 * Create the parent-side `intercom` tool for replying to child requests.
 */
export function createIntercomTool(manager: IntercomManager): IntercomToolDef {
  return {
    name: "intercom",
    label: "Intercom",
    description:
      "Reply to child agent requests. Use 'list' to see pending, 'reply' to respond, 'status' for info.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("reply"),
        Type.Literal("list"),
        Type.Literal("status"),
      ]),
      replyTo: Type.Optional(
        Type.String({
          description:
            "Request ID to reply to (prefix match). Omit if only one pending.",
        }),
      ),
      message: Type.Optional(
        Type.String({
          description: "Reply message content",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      switch (params.action) {
        case "list": {
          const pending = manager.listPending();
          if (pending.length === 0) {
            return {
              content: [
                { type: "text", text: "No pending intercom requests." },
              ],
            };
          }
          const lines = pending.map((r) => {
            const age = Math.round((Date.now() - r.createdAt) / 1000);
            return `- [${r.id}] ${r.agentName} (${r.reason}): "${r.message}" (${age}s ago)`;
          });
          return {
            content: [
              { type: "text", text: `Pending requests:\n${lines.join("\n")}` },
            ],
          };
        }

        case "reply": {
          const pending = manager.listPending();
          const replyTo = (params as { replyTo?: string }).replyTo;
          const message = (params as { message?: string }).message ?? "";

          if (!replyTo && pending.length === 1) {
            // Auto-resolve single pending
            manager.reply(pending[0].id, message);
            return {
              content: [
                {
                  type: "text",
                  text: `Replied to ${pending[0].agentName}: "${message}"`,
                },
              ],
            };
          }

          if (!replyTo) {
            return {
              content: [
                {
                  type: "text",
                  text: `Multiple pending requests. Specify replyTo ID. Use action "list" to see them.`,
                },
              ],
            };
          }

          manager.reply(replyTo, message);
          return {
            content: [
              { type: "text", text: `Replied to ${replyTo}: "${message}"` },
            ],
          };
        }

        case "status": {
          const count = manager.listPending().length;
          return {
            content: [
              {
                type: "text",
                text: `Intercom active. Pending: ${count} request(s).`,
              },
            ],
          };
        }

        default:
          return { content: [{ type: "text", text: "Unknown action." }] };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/intercom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/intercom.ts tests/intercom.test.ts
git commit -m "feat(intercom): add createIntercomTool for parent session"
```

---

### Task 4: Add `intercom` to types and runtime-deps

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/shared/runtime-deps.ts`
- Modify: `src/core/agent-format.ts`

- [ ] **Step 1: Add `intercom` field to AgentDefinition**

In `src/shared/types.ts`, add to `AgentDefinition`:

```typescript
intercom?: boolean;
```

- [ ] **Step 2: Add `intercom` to RuntimeDeps**

In `src/shared/runtime-deps.ts`, add import and field:

```typescript
import type { IntercomManager } from "../core/intercom.js";

export interface RuntimeDeps {
  // ... existing fields ...
  intercom?: IntercomManager;
}
```

- [ ] **Step 3: Parse `intercom` from frontmatter**

In `src/core/agent-format.ts`, in `parseAgentContent()` after the memory parsing line (`const memory = parseMemoryConfig(frontmatter.memory);`), add:

```typescript
// intercom
const intercom = frontmatter.intercom === true ? true : undefined;
```

Then add `intercom` to the returned agent object (after the `memory` field).

- [ ] **Step 4: Add frontmatter parsing tests**

Add to `tests/agent-format.test.ts`, near the existing memory tests:

```typescript
test("parses intercom: true from frontmatter", () => {
  const content =
    "---\nname: scout\ndescription: Scouts\ntools: read\nintercom: true\n---\nDo things\n";
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.agent.intercom).toBe(true);
});

test("intercom is undefined when omitted", () => {
  const content =
    "---\nname: test\ndescription: A test\ntools: read\n---\nPrompt\n";
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.agent.intercom).toBeUndefined();
});

test("intercom is undefined for non-true value", () => {
  const content =
    '---\nname: test\ndescription: A test\ntools: read\nintercom: "yes"\n---\nPrompt\n';
  const result = parseAgentContent("/test.md", content);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.agent.intercom).toBeUndefined();
});
```

- [ ] **Step 5: Run typecheck and tests**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/runtime-deps.ts src/core/agent-format.ts tests/agent-format.test.ts
git commit -m "feat(intercom): add intercom to types, RuntimeDeps, and frontmatter"
```

---

### Task 5: Inject `contact_supervisor` tool in `agent-manager.ts`

**Files:**

- Modify: `src/core/agent-manager.ts`

**Context:** Custom tools are built in `agent-manager.ts` lines 258-278, where `createChildSubagentTool` and `createChildGetResultTool` are conditionally added. The intercom tool follows the same pattern: add it to the `customTools` array when the agent opts in.

- [ ] **Step 1: Add import**

At the top of `src/core/agent-manager.ts`, add:

```typescript
import { createContactSupervisorTool } from "./intercom.js";
```

- [ ] **Step 2: Inject intercom tool into customTools**

In the `spawn()` method, after the existing `customTools` block (line 278, after the closing `}`), add:

```typescript
// Inject contact_supervisor tool for intercom-enabled agents
if (agentDef.intercom) {
  const deps = (options as { _deps?: RuntimeDeps })._deps;
  if (deps?.intercom) {
    customTools.push(
      createContactSupervisorTool(deps.intercom, id, agentDef.name),
    );
  }
}
```

This reuses the same `deps` extraction pattern already used for child subagent tools. The `id` (agent ID) and `agentDef.name` are both available at this point.

Note: `agent-runner.ts` requires NO changes — it already passes `customTools` through to `createAgentSession` via the generic `customTools` field in `RunOptions`.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: All pass (no tests break; intercom-specific tests already pass from Tasks 1-3)

- [ ] **Step 4: Commit**

```bash
git add src/core/agent-manager.ts
git commit -m "feat(intercom): inject contact_supervisor tool via customTools"
```

---

### Task 6: Wire IntercomManager into `index.ts`

**Files:**

- Modify: `src/index.ts`

**Context:** `index.ts` has two key functions: `createRuntimeDeps(pi)` which builds the dependency graph, and `registerSubagentsExtension(pi, deps)` which registers tools, renderers, and event handlers. Intercom needs integration in both.

- [ ] **Step 1: Add imports**

At the top of `src/index.ts`, add:

```typescript
import {
  createIntercomManager,
  createIntercomTool,
  type IntercomRequest,
} from "./core/intercom.js";
```

- [ ] **Step 2: Create IntercomManager in `createRuntimeDeps()`**

In `createRuntimeDeps()`, **before** the `new AgentManager(...)` call (line 114), create the intercom manager:

```typescript
// Intercom: child↔parent communication channel
const intercom = createIntercomManager({
  onRequest: (request) => {
    const label = `[${request.agentName}] ${request.reason}: ${request.message}`;
    (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
      {
        customType: "intercom-request",
        content: label,
        display: true,
        details: request,
      } as unknown as Parameters<typeof pi.sendMessage>[0],
      { deliverAs: "followUp", triggerTurn: true },
    );
  },
});
```

The `onRequest` callback fires when a child sends a blocking request. It injects a message into the parent conversation via `pi.sendMessage()` with `triggerTurn: true`, which prompts the parent LLM to respond (using the `intercom` tool).

- [ ] **Step 3: Add `cancelForAgent` to the `onComplete` callback**

In the `AgentManager` constructor's `onComplete` callback (currently starting at line 114), add this line near the top of the callback (after the lifecycle event emission):

```typescript
intercom.cancelForAgent(record.id);
```

This cleans up any pending intercom requests when an agent completes or errors.

- [ ] **Step 4: Add `intercom` to the deps object**

In the `deps: RuntimeDeps = { ... }` object literal, add:

```typescript
intercom,
```

- [ ] **Step 5: Register parent tool and message renderer in `registerSubagentsExtension()`**

After the existing tool registrations (after `registerWaitTool(pi, deps.manager);`), add:

```typescript
// Intercom: parent-side reply tool
if (deps.intercom) {
  pi.registerTool(createIntercomTool(deps.intercom) as never);

  // Render intercom requests from children
  pi.registerMessageRenderer("intercom-request", (msg, _opts, theme) => {
    const d = (msg as { details?: IntercomRequest }).details;
    if (!d) return new Text("", 0, 0);
    const t = theme as {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    };
    return new Text(
      `${t.bold(t.fg("cyan", `[${d.agentName}]`))} ${d.reason}: ${d.message}`,
      0,
      0,
    );
  });
}
```

- [ ] **Step 6: Add `intercom.dispose()` to shutdown handler**

In the `session_shutdown` handler, add before `deps.manager.abortAll()`:

```typescript
deps.intercom?.dispose();
```

- [ ] **Step 7: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/index.ts
git commit -m "feat(intercom): wire intercom into extension init, tool registration, and cleanup"
```

---

### Task 7: Integration test

**Files:**

- Modify: `tests/intercom.test.ts`

- [ ] **Step 1: Add integration test for full send→reply flow**

Add to `tests/intercom.test.ts`:

```typescript
describe("integration: child send → parent reply", () => {
  it("full round-trip: child blocks, parent lists + replies, child unblocks", async () => {
    const onRequest = vi.fn();
    const manager = createIntercomManager({ timeoutMs: 5000, onRequest });
    const childTool = createContactSupervisorTool(manager, "agent-1", "Scout");
    const parentTool = createIntercomTool(manager);

    // Child sends a blocking request
    const childPromise = childTool.execute(
      "tc-1",
      { reason: "need_decision", message: "Which approach?" },
      undefined,
      undefined,
      {} as any,
    );

    // onRequest should have fired
    expect(onRequest).toHaveBeenCalledOnce();

    // Small delay to let the request register
    await new Promise((r) => setTimeout(r, 10));

    // Parent lists pending requests
    const listResult = await parentTool.execute(
      "tc-2",
      { action: "list" },
      undefined,
      undefined,
      {} as any,
    );
    expect(listResult.content[0].text).toContain("Scout");
    expect(listResult.content[0].text).toContain("Which approach?");

    // Parent replies (auto-resolve since only one pending)
    await parentTool.execute(
      "tc-3",
      { action: "reply", message: "Use approach A" },
      undefined,
      undefined,
      {} as any,
    );

    // Child should now have the reply
    const childResult = await childPromise;
    expect(childResult.content[0].text).toContain("Use approach A");

    // No more pending
    expect(manager.listPending()).toHaveLength(0);
  });

  it("cancelForAgent resolves child tool with cancellation message", async () => {
    const manager = createIntercomManager({ timeoutMs: 5000 });
    const childTool = createContactSupervisorTool(manager, "agent-1", "Scout");

    const childPromise = childTool.execute(
      "tc-1",
      { reason: "need_decision", message: "Help?" },
      undefined,
      undefined,
      {} as any,
    );

    await new Promise((r) => setTimeout(r, 10));
    manager.cancelForAgent("agent-1");

    const result = await childPromise;
    expect(result.content[0].text).toContain("cancelled");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test -- tests/intercom.test.ts`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add tests/intercom.test.ts
git commit -m "test(intercom): add integration test for full send/reply round-trip"
```

---

### Task 8: Typecheck and lint

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run full check**

Run: `pnpm check`
Expected: All pass

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: fix lint/type issues from intercom integration"
```
