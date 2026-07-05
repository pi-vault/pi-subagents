import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SmartBatchTracker } from "../src/core/smart-batch-tracker.js";
import type { GroupJoinManager } from "../src/core/group-join-manager.js";
import type { AgentRecord, JoinMode } from "../src/shared/types.js";

function makeRecord(
  id: string,
  opts: Partial<AgentRecord> = {},
): AgentRecord {
  return {
    id,
    type: "test",
    status: "completed",
    toolUses: 0,
    turnCount: 0,
    startedAt: Date.now(),
    lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    ...opts,
  };
}

function makeGroupJoin() {
  const registerGroup = vi.fn();
  const onAgentComplete = vi.fn().mockReturnValue("held");
  const isGrouped = vi.fn().mockReturnValue(false);
  const dispose = vi.fn();
  const groupJoin = {
    registerGroup,
    onAgentComplete,
    isGrouped,
    dispose,
  } as unknown as GroupJoinManager;
  return { groupJoin, registerGroup, onAgentComplete, isGrouped, dispose };
}

describe("SmartBatchTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups 2+ background agents registered within 100ms", () => {
    const { groupJoin, registerGroup } = makeGroupJoin();
    const records = new Map<string, AgentRecord>();
    const sendNudge = vi.fn();

    const tracker = new SmartBatchTracker(
      groupJoin,
      (id) => records.get(id),
      sendNudge,
      () => "smart" as JoinMode,
    );

    tracker.register("a1");
    tracker.register("a2");

    // Before debounce fires — no group yet
    expect(registerGroup).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(registerGroup).toHaveBeenCalledOnce();
    const [groupId, ids] = registerGroup.mock.calls[0] as [string, string[]];
    expect(groupId).toMatch(/^batch-/);
    expect(ids).toContain("a1");
    expect(ids).toContain("a2");
    expect(sendNudge).not.toHaveBeenCalled();
  });

  it("does NOT group a single background agent; sends nudge if already completed", () => {
    const { groupJoin, registerGroup } = makeGroupJoin();
    const record = makeRecord("a1", { completedAt: Date.now() });
    const records = new Map([["a1", record]]);
    const sendNudge = vi.fn();

    const tracker = new SmartBatchTracker(
      groupJoin,
      (id) => records.get(id),
      sendNudge,
      () => "smart" as JoinMode,
    );

    tracker.register("a1");
    vi.advanceTimersByTime(100);

    expect(registerGroup).not.toHaveBeenCalled();
    // nudge fired because agent was already completed during debounce
    expect(sendNudge).toHaveBeenCalledOnce();
    expect((sendNudge.mock.calls[0][0] as AgentRecord).id).toBe("a1");
  });

  it("retroactively processes agents that completed before finalizeBatch fires", () => {
    const { groupJoin, registerGroup, onAgentComplete } = makeGroupJoin();
    const now = Date.now();
    const r1 = makeRecord("a1", { completedAt: now });
    const r2 = makeRecord("a2");
    const records = new Map([
      ["a1", r1],
      ["a2", r2],
    ]);
    const sendNudge = vi.fn();

    const tracker = new SmartBatchTracker(
      groupJoin,
      (id) => records.get(id),
      sendNudge,
      () => "smart" as JoinMode,
    );

    tracker.register("a1");
    tracker.register("a2");

    // a1 already completed during the debounce window (completedAt is set, resultConsumed is not)
    vi.advanceTimersByTime(100);

    expect(registerGroup).toHaveBeenCalledOnce();
    // groupId should be set on the record
    expect(r1.groupId).toMatch(/^batch-/);
    // onAgentComplete called for a1 (completed) but not a2 (still running)
    expect(onAgentComplete).toHaveBeenCalledOnce();
    expect((onAgentComplete.mock.calls[0][0] as AgentRecord).id).toBe("a1");
    // No individual nudge since a group was formed
    expect(sendNudge).not.toHaveBeenCalled();
  });

  it("bypasses batching when joinMode is async", () => {
    const { groupJoin, registerGroup } = makeGroupJoin();
    const records = new Map<string, AgentRecord>();
    const sendNudge = vi.fn();

    const tracker = new SmartBatchTracker(
      groupJoin,
      (id) => records.get(id),
      sendNudge,
      () => "async" as JoinMode,
    );

    tracker.register("a1");
    tracker.register("a2");
    vi.advanceTimersByTime(100);

    expect(registerGroup).not.toHaveBeenCalled();
    expect(sendNudge).not.toHaveBeenCalled();
  });

  it("dispose() clears the timer and pending batch so registerGroup is never called", () => {
    const { groupJoin, registerGroup } = makeGroupJoin();
    const records = new Map<string, AgentRecord>();
    const sendNudge = vi.fn();

    const tracker = new SmartBatchTracker(
      groupJoin,
      (id) => records.get(id),
      sendNudge,
      () => "smart" as JoinMode,
    );

    tracker.register("a1");
    tracker.register("a2");

    // Timer is running — dispose before it fires
    tracker.dispose();

    vi.advanceTimersByTime(100);

    expect(registerGroup).not.toHaveBeenCalled();
    expect(sendNudge).not.toHaveBeenCalled();
  });

  it("debounce timer resets on each new registration", () => {
    const { groupJoin, registerGroup } = makeGroupJoin();
    const records = new Map<string, AgentRecord>();
    const sendNudge = vi.fn();

    const tracker = new SmartBatchTracker(
      groupJoin,
      (id) => records.get(id),
      sendNudge,
      () => "smart" as JoinMode,
    );

    tracker.register("a1"); // t=0
    vi.advanceTimersByTime(80); // t=80 — not yet finalized
    expect(registerGroup).not.toHaveBeenCalled();

    tracker.register("a2"); // t=80 — resets debounce to t+100=180
    vi.advanceTimersByTime(80); // t=160 — 80ms since a2, not yet finalized
    expect(registerGroup).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20); // t=180 — 100ms since a2, should finalize
    expect(registerGroup).toHaveBeenCalledOnce();
    const ids = registerGroup.mock.calls[0][1] as string[];
    expect(ids).toContain("a1");
    expect(ids).toContain("a2");
  });
});
