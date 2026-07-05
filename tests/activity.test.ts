import { describe, expect, it, vi } from "vitest";
import { createActivityTracker, getLifetimeTotal } from "../src/tui/activity.js";

describe("getLifetimeTotal", () => {
  it("returns 0 for undefined", () => {
    expect(getLifetimeTotal(undefined)).toBe(0);
  });
  it("sums input + output + cacheWrite", () => {
    expect(getLifetimeTotal({ input: 100, output: 50, cacheWrite: 25 })).toBe(175);
  });
});

describe("createActivityTracker", () => {
  it("returns state with correct initial values", () => {
    const { state } = createActivityTracker();
    expect(state.activeTools.size).toBe(0);
    expect(state.toolUses).toBe(0);
    expect(state.turnCount).toBe(1);
    expect(state.responseText).toBe("");
    expect(state.session).toBeUndefined();
    expect(state.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
  });

  it("sets maxTurns when provided", () => {
    const { state } = createActivityTracker(10);
    expect(state.maxTurns).toBe(10);
  });

  it("onToolActivity start adds to activeTools", () => {
    const { state, callbacks } = createActivityTracker();
    callbacks.onToolActivity({ type: "start", toolName: "read" });
    expect(state.activeTools.size).toBe(1);
    expect([...state.activeTools.values()]).toContain("read");
  });

  it("onToolActivity end removes from activeTools and increments toolUses", () => {
    const { state, callbacks } = createActivityTracker();
    callbacks.onToolActivity({ type: "start", toolName: "read" });
    callbacks.onToolActivity({ type: "end", toolName: "read" });
    expect(state.activeTools.size).toBe(0);
    expect(state.toolUses).toBe(1);
  });

  it("multiple concurrent tools of same name: only removes one on end", () => {
    const { state, callbacks } = createActivityTracker();
    callbacks.onToolActivity({ type: "start", toolName: "read" });
    callbacks.onToolActivity({ type: "start", toolName: "read" });
    expect(state.activeTools.size).toBe(2);
    callbacks.onToolActivity({ type: "end", toolName: "read" });
    expect(state.activeTools.size).toBe(1);
    expect(state.toolUses).toBe(1);
  });

  it("onTextDelta updates responseText", () => {
    const { state, callbacks } = createActivityTracker();
    callbacks.onTextDelta("hello", "hello world");
    expect(state.responseText).toBe("hello world");
  });

  it("onTurnEnd updates turnCount", () => {
    const { state, callbacks } = createActivityTracker();
    callbacks.onTurnEnd(3);
    expect(state.turnCount).toBe(3);
  });

  it("onSessionCreated stores session", () => {
    const { state, callbacks } = createActivityTracker();
    const fakeSession = { messages: [] };
    callbacks.onSessionCreated(fakeSession);
    expect(state.session).toBe(fakeSession);
  });

  it("onUsage accumulates into lifetimeUsage", () => {
    const { state, callbacks } = createActivityTracker();
    callbacks.onUsage({ input: 100, output: 50, cacheWrite: 25 });
    callbacks.onUsage({ input: 10, output: 5, cacheWrite: 2 });
    expect(state.lifetimeUsage).toEqual({ input: 110, output: 55, cacheWrite: 27 });
  });

  it("onStreamUpdate is called on each state change", () => {
    const onStreamUpdate = vi.fn();
    const { callbacks } = createActivityTracker(undefined, onStreamUpdate);
    callbacks.onToolActivity({ type: "start", toolName: "read" });
    callbacks.onToolActivity({ type: "end", toolName: "read" });
    callbacks.onTextDelta("x", "x");
    callbacks.onTurnEnd(2);
    callbacks.onUsage({ input: 1, output: 1, cacheWrite: 0 });
    expect(onStreamUpdate).toHaveBeenCalledTimes(5);
  });

  it("onSessionCreated does not trigger onStreamUpdate", () => {
    const onStreamUpdate = vi.fn();
    const { callbacks } = createActivityTracker(undefined, onStreamUpdate);
    callbacks.onSessionCreated({ messages: [] });
    expect(onStreamUpdate).not.toHaveBeenCalled();
  });
});
