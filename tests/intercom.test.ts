import { describe, expect, it, vi, beforeEach } from "vitest";
import { createIntercomManager, createContactSupervisorTool, createIntercomTool } from "../src/core/intercom.js";
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
    expect(result).toBe("Use approach A");
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
    expect(result).toContain("timeout");
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
    expect(result).toContain("cancelled");
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
    expect(result).toContain("ended");
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
      { action: "list" } as any,
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
      } as any,
      undefined,
      undefined,
      {} as any,
    );

    const reply = await replyPromise;
    expect(reply).toBe("Use main.ts");
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
      } as any,
      undefined,
      undefined,
      {} as any,
    );

    const reply = await replyPromise;
    expect(reply).toBe("Use main.ts");
  });

  it("status action returns info", async () => {
    const manager = createIntercomManager({ timeoutMs: 5000 });
    const tool = createIntercomTool(manager);
    const result = await tool.execute(
      "tc-1",
      { action: "status" } as any,
      undefined,
      undefined,
      {} as any,
    );
    expect(result.content[0].text).toContain("Intercom active");
  });
});

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
