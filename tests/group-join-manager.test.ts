import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GroupJoinManager } from "../src/core/group-join-manager.js";
import type { AgentRecord } from "../src/shared/types.js";

function makeRecord(id: string, status: AgentRecord["status"] = "completed"): AgentRecord {
  return {
    id,
    type: "test",
    status,
    toolUses: 0,
    turnCount: 0,
    startedAt: Date.now(),
    lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
  };
}

describe("GroupJoinManager", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns 'pass' for ungrouped agents", () => {
    const deliverCb = vi.fn();
    const manager = new GroupJoinManager(deliverCb);
    const result = manager.onAgentComplete(makeRecord("agent-1"));
    expect(result).toBe("pass");
    expect(deliverCb).not.toHaveBeenCalled();
  });

  it("holds until all agents complete, then delivers", () => {
    const deliverCb = vi.fn();
    const manager = new GroupJoinManager(deliverCb);
    manager.registerGroup("g1", ["a1", "a2"]);

    expect(manager.onAgentComplete(makeRecord("a1"))).toBe("held");
    expect(deliverCb).not.toHaveBeenCalled();

    expect(manager.onAgentComplete(makeRecord("a2"))).toBe("delivered");
    expect(deliverCb).toHaveBeenCalledOnce();
    expect(deliverCb.mock.calls[0][0]).toHaveLength(2);
    expect(deliverCb.mock.calls[0][1]).toBe(false); // not partial
  });

  it("delivers partial on timeout", () => {
    const deliverCb = vi.fn();
    const manager = new GroupJoinManager(deliverCb, 5000);
    manager.registerGroup("g1", ["a1", "a2"]);

    manager.onAgentComplete(makeRecord("a1"));
    expect(deliverCb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(deliverCb).toHaveBeenCalledOnce();
    expect(deliverCb.mock.calls[0][0]).toHaveLength(1);
    expect(deliverCb.mock.calls[0][1]).toBe(true); // partial
  });

  it("isGrouped returns true for registered agents", () => {
    const manager = new GroupJoinManager(vi.fn());
    manager.registerGroup("g1", ["a1", "a2"]);
    expect(manager.isGrouped("a1")).toBe(true);
    expect(manager.isGrouped("a3")).toBe(false);
  });

  it("dispose clears timeouts and state", () => {
    const manager = new GroupJoinManager(vi.fn(), 5000);
    manager.registerGroup("g1", ["a1"]);
    manager.dispose();
    expect(manager.isGrouped("a1")).toBe(false);
  });
});
