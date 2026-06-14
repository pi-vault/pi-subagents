import { describe, expect, test } from "vitest";
import { ExecutionStateStore } from "../src/core/execution-state.js";
import type {
  PersistedDeferredSlashRequest,
  SlashLiveDetails,
  SubagentExecutionResult,
} from "../src/shared/types.js";
import {
  DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY,
  DEFERRED_SLASH_REQUEST_ENTRY,
} from "../src/shared/types.js";

function createResult(
  overrides: Partial<SubagentExecutionResult> = {},
): SubagentExecutionResult {
  return {
    content: "done",
    isError: false,
    details: {
      status: "success",
      agent: "Scout",
      task: "explore",
      sourcePath: "/agents/scout.md",
      cwd: "/repo",
      timeoutMs: 60000,
      durationMs: 100,
      childSessionDir: "/sessions/run-0",
      childSessionPath: "/sessions/run-0/session.jsonl",
      model: "gpt-5",
      stopReason: "end",
      exitCode: 0,
      stderr: "",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 15,
        cost: 0.01,
        turns: 1,
      },
      recentToolActivity: [],
    },
    ...overrides,
  };
}

describe("ExecutionStateStore", () => {
  describe("live execution", () => {
    test("startLive creates a running snapshot", () => {
      const store = new ExecutionStateStore();
      const details = store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      expect(details.kind).toBe("slash-live");
      expect(details.requestId).toBe("req-1");
      expect(details.status).toBe("running");
      expect(details.agent).toBe("Scout");
      expect(details.task).toBe("explore");
      expect(details.cwd).toBe("/repo");
      expect(details.durationMs).toBe(0);
      expect(details.recentToolActivity).toEqual([]);
    });

    test("startLive uses startedAtMs when provided", () => {
      const store = new ExecutionStateStore();
      const details = store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
        startedAtMs: 5000,
      });

      expect(details.startedAt).toBe(5000);
    });

    test("updateLive patches duration and activity", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      const updated = store.updateLive("req-1", {
        durationMs: 500,
        activity: { label: "read done", preview: "ok" },
      });

      expect(updated?.durationMs).toBe(500);
      expect(updated?.recentToolActivity).toEqual([
        { label: "read done", preview: "ok" },
      ]);
    });

    test("updateLive returns undefined for unknown requestId", () => {
      const store = new ExecutionStateStore();
      const result = store.updateLive("unknown", { durationMs: 100 });
      expect(result).toBeUndefined();
    });

    test("updateLive keeps only last 5 activities", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      for (let i = 0; i < 7; i++) {
        store.updateLive("req-1", {
          activity: { label: `tool-${i}`, preview: "" },
        });
      }

      const snapshot = store.getSnapshot("req-1");
      expect(snapshot?.live.recentToolActivity).toHaveLength(5);
      expect(snapshot?.live.recentToolActivity[0]?.label).toBe("tool-2");
    });

    test("tickLive advances duration from startedAt", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
        startedAtMs: 1000,
      });

      const result = store.tickLive("req-1", 1450);
      expect(result?.durationMs).toBe(450);
    });

    test("tickLive returns undefined for finalized requests", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });
      store.finalizeLive("req-1", createResult());

      const result = store.tickLive("req-1", 9999);
      expect(result).toBeUndefined();
    });

    test("tickLive returns undefined for unknown requestId", () => {
      const store = new ExecutionStateStore();
      expect(store.tickLive("unknown")).toBeUndefined();
    });

    test("finalizeLive attaches result to snapshot", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      const result = createResult();
      store.finalizeLive("req-1", result);

      const snapshot = store.getSnapshot("req-1");
      expect(snapshot?.final).toBe(result);
    });

    test("finalizeLive is a no-op for unknown requestId", () => {
      const store = new ExecutionStateStore();
      store.finalizeLive("unknown", createResult());
      expect(store.getSnapshot("unknown")).toBeUndefined();
    });

    test("isLiveRunning returns true before finalize", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      expect(store.isLiveRunning("req-1")).toBe(true);
    });

    test("isLiveRunning returns false after finalize", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });
      store.finalizeLive("req-1", createResult());

      expect(store.isLiveRunning("req-1")).toBe(false);
    });

    test("isLiveRunning returns false for unknown requestId", () => {
      const store = new ExecutionStateStore();
      expect(store.isLiveRunning("unknown")).toBe(false);
    });

    test("clearLive removes snapshot entirely", () => {
      const store = new ExecutionStateStore();
      store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      store.clearLive("req-1");
      expect(store.getSnapshot("req-1")).toBeUndefined();
    });

    test("getSnapshot returns undefined for unknown requestId", () => {
      const store = new ExecutionStateStore();
      expect(store.getSnapshot("unknown")).toBeUndefined();
    });

    test("pruning removes oldest snapshots beyond MAX_SNAPSHOTS", () => {
      const store = new ExecutionStateStore();
      for (let i = 0; i < 105; i++) {
        store.startLive({
          requestId: `req-${i}`,
          agent: "Scout",
          task: "explore",
          cwd: "/repo",
        });
      }

      // First 5 should have been pruned
      expect(store.getSnapshot("req-0")).toBeUndefined();
      expect(store.getSnapshot("req-4")).toBeUndefined();
      // Last ones should still exist
      expect(store.getSnapshot("req-104")).toBeDefined();
    });

    test("getRenderableMessage returns live details when running", () => {
      const store = new ExecutionStateStore();
      const details = store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      const renderable = store.getRenderableMessage(details);
      expect(renderable?.content).toBe("");
      expect(renderable?.details).toMatchObject({
        kind: "slash-live",
        requestId: "req-1",
      });
    });

    test("getRenderableMessage returns final result after finalize", () => {
      const store = new ExecutionStateStore();
      const details = store.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      const result = createResult({ content: "final answer" });
      store.finalizeLive("req-1", result);

      const renderable = store.getRenderableMessage(details);
      expect(renderable?.content).toBe("final answer");
      expect(renderable?.details).toBe(result.details);
    });

    test("getRenderableMessage returns passthrough for unknown requestId", () => {
      const store = new ExecutionStateStore();
      const details: SlashLiveDetails = {
        kind: "slash-live",
        requestId: "unknown",
        status: "running",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
        durationMs: 0,
        startedAt: 0,
        recentToolActivity: [],
      };

      const renderable = store.getRenderableMessage(details);
      expect(renderable?.content).toBe("");
      expect(renderable?.details).toBe(details);
    });

    test("getRenderableMessage returns undefined for undefined input", () => {
      const store = new ExecutionStateStore();
      expect(store.getRenderableMessage(undefined)).toBeUndefined();
    });
  });

  describe("deferred requests", () => {
    test("rememberDeferred stores request and appends entry", () => {
      const store = new ExecutionStateStore();
      const entries: Array<{ type: string; data: unknown }> = [];
      const pi = {
        appendEntry(customType: string, data: unknown) {
          entries.push({ type: customType, data });
        },
      };
      const request: PersistedDeferredSlashRequest = {
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
        createdAt: Date.now(),
      };

      store.rememberDeferred(pi, request);

      expect(store.getDeferredRequest("req-1")).toBe(request);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe(DEFERRED_SLASH_REQUEST_ENTRY);
      expect(entries[0]?.data).toBe(request);
    });

    test("markDeferredConsumed removes request and runtime state", () => {
      const store = new ExecutionStateStore();
      const entries: Array<{ type: string; data: unknown }> = [];
      const pi = {
        appendEntry(customType: string, data: unknown) {
          entries.push({ type: customType, data });
        },
      };

      store.rememberDeferred(pi, {
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
        createdAt: Date.now(),
      });
      store.setDeferredRuntimeState("req-1", {
        signal: undefined,
      });

      store.markDeferredConsumed(pi, "req-1");

      expect(store.getDeferredRequest("req-1")).toBeUndefined();
      expect(store.takeDeferredRuntimeState("req-1")).toBeUndefined();
      expect(entries[1]?.type).toBe(DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY);
    });

    test("setDeferredRuntimeState stores state by requestId", () => {
      const store = new ExecutionStateStore();
      const state = { signal: undefined, requestRender: () => {} };
      store.setDeferredRuntimeState("req-1", state);

      expect(store.takeDeferredRuntimeState("req-1")).toBe(state);
    });

    test("takeDeferredRuntimeState returns and clears state", () => {
      const store = new ExecutionStateStore();
      store.setDeferredRuntimeState("req-1", { signal: undefined });

      const first = store.takeDeferredRuntimeState("req-1");
      expect(first).toBeDefined();
    });

    test("takeDeferredRuntimeState returns undefined on second call", () => {
      const store = new ExecutionStateStore();
      store.setDeferredRuntimeState("req-1", { signal: undefined });

      store.takeDeferredRuntimeState("req-1");
      const second = store.takeDeferredRuntimeState("req-1");
      expect(second).toBeUndefined();
    });

    test("getDeferredRequest returns stored request", () => {
      const store = new ExecutionStateStore();
      const pi = { appendEntry() {} };
      const request: PersistedDeferredSlashRequest = {
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
        createdAt: 1000,
      };

      store.rememberDeferred(pi, request);
      expect(store.getDeferredRequest("req-1")).toBe(request);
    });

    test("getDeferredRequest returns undefined for unknown id", () => {
      const store = new ExecutionStateStore();
      expect(store.getDeferredRequest("unknown")).toBeUndefined();
    });

    test("hydrateFromSession replays persisted entries", () => {
      const store = new ExecutionStateStore();
      const entries = [
        {
          type: "custom",
          customType: DEFERRED_SLASH_REQUEST_ENTRY,
          data: {
            requestId: "req-1",
            agent: "Scout",
            task: "explore",
            cwd: "/repo",
            createdAt: 1000,
          },
        },
      ];

      store.hydrateFromSession({ getEntries: () => entries as never[] });
      expect(store.getDeferredRequest("req-1")).toMatchObject({
        requestId: "req-1",
        agent: "Scout",
      });
    });

    test("hydrateFromSession respects consumed entries", () => {
      const store = new ExecutionStateStore();
      const entries = [
        {
          type: "custom",
          customType: DEFERRED_SLASH_REQUEST_ENTRY,
          data: {
            requestId: "req-1",
            agent: "Scout",
            task: "explore",
            cwd: "/repo",
            createdAt: 1000,
          },
        },
        {
          type: "custom",
          customType: DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY,
          data: {
            requestId: "req-1",
            consumedAt: 2000,
          },
        },
      ];

      store.hydrateFromSession({ getEntries: () => entries as never[] });
      expect(store.getDeferredRequest("req-1")).toBeUndefined();
    });

    test("hydrateFromSession clears previous state", () => {
      const store = new ExecutionStateStore();
      const pi = { appendEntry() {} };
      store.rememberDeferred(pi, {
        requestId: "req-old",
        agent: "Scout",
        task: "old",
        cwd: "/repo",
        createdAt: 500,
      });

      store.hydrateFromSession({ getEntries: () => [] });

      expect(store.getDeferredRequest("req-old")).toBeUndefined();
    });
  });

  describe("isolation", () => {
    test("separate instances do not share state", () => {
      const store1 = new ExecutionStateStore();
      const store2 = new ExecutionStateStore();

      store1.startLive({
        requestId: "req-1",
        agent: "Scout",
        task: "explore",
        cwd: "/repo",
      });

      expect(store1.getSnapshot("req-1")).toBeDefined();
      expect(store2.getSnapshot("req-1")).toBeUndefined();
    });
  });
});
