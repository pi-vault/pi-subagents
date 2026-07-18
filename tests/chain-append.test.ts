import { afterEach, describe, expect, test } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import {
  clearChainAppendRequests,
  enqueueChainAppendRequest,
  consumeChainAppendRequests,
  countPendingChainAppendRequests,
  resetAppendQueues,
} from "../src/core/chain-append.js";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  SequentialStep,
} from "../src/shared/types.js";

afterEach(() => {
  resetAppendQueues();
});

describe("chain append queue", () => {
  const findAgent = (name: string): AgentDefinition => {
    if (name === "missing") throw new Error('Unknown agent: "missing"');
    return {
      name,
      description: name,
      tools: [],
      subagentAgents: [],
      systemPrompt: "test",
      sourcePath: "/test",
    };
  };

  function registerChain(
    manager: AgentManager,
    id = "chain-1",
    overrides: Partial<AgentRecord> = {},
  ): AgentRecord {
    const record = manager.fireAndForgetChain(
      id,
      "test",
      [{ agent: "a", task: "first", as: "first" }],
      "/tmp",
      () => new Promise(() => {}),
    );
    Object.assign(record, overrides);
    return record;
  }

  test("enqueue and consume returns steps", () => {
    const manager = new AgentManager();
    registerChain(manager);
    const step: SequentialStep = { agent: "a", task: "t" };
    enqueueChainAppendRequest(manager, "chain-1", [step], findAgent);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toEqual(step);
    manager.dispose();
  });

  test("consume clears the queue", () => {
    const manager = new AgentManager();
    registerChain(manager);
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "a", task: "t" }], findAgent);
    consumeChainAppendRequests("chain-1");

    const second = consumeChainAppendRequests("chain-1");
    expect(second).toHaveLength(0);
    manager.dispose();
  });

  test("multiple enqueues accumulate", () => {
    const manager = new AgentManager();
    registerChain(manager);
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "a", task: "1" }], findAgent);
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "b", task: "2" }], findAgent);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(2);
    manager.dispose();
  });

  test("countPendingChainAppendRequests returns correct count", () => {
    expect(countPendingChainAppendRequests("chain-1")).toBe(0);
    const manager = new AgentManager();
    registerChain(manager);
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "a", task: "t" }], findAgent);
    expect(countPendingChainAppendRequests("chain-1")).toBe(1);
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "b", task: "t" }], findAgent);
    expect(countPendingChainAppendRequests("chain-1")).toBe(2);
    manager.dispose();
  });

  test("different chain IDs are independent", () => {
    const manager = new AgentManager();
    registerChain(manager);
    registerChain(manager, "chain-2");
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "a", task: "t" }], findAgent);
    enqueueChainAppendRequest(manager, "chain-2", [{ agent: "b", task: "t" }], findAgent);

    expect(consumeChainAppendRequests("chain-1")).toHaveLength(1);
    expect(consumeChainAppendRequests("chain-2")).toHaveLength(1);
    manager.dispose();
  });

  test("consume for unknown chain returns empty array", () => {
    expect(consumeChainAppendRequests("nonexistent")).toHaveLength(0);
  });

  test("enqueue with empty steps array is a no-op on consume", () => {
    const manager = new AgentManager();
    registerChain(manager);
    enqueueChainAppendRequest(manager, "chain-1", [], findAgent);
    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(0);
    manager.dispose();
  });

  test.each([
    ["unknown", undefined],
    ["completed", { status: "completed" as const }],
    ["foreground", { isBackground: false }],
    ["non-chain", { type: "Scout" }],
    ["missing definition", { chainDefinition: undefined }],
  ])("rejects %s targets without queue mutation", (_label, overrides) => {
    const manager = new AgentManager();
    if (overrides) registerChain(manager, "chain-1", overrides);

    expect(() =>
      enqueueChainAppendRequest(manager, "chain-1", [{ agent: "a" }], findAgent),
    ).toThrow();
    expect(countPendingChainAppendRequests("chain-1")).toBe(0);
    manager.dispose();
  });

  test.each([
    ["malformed", [{}]],
    ["unknown Agent", [{ agent: "missing" }]],
    ["duplicate output", [{ agent: "a", as: "first" }]],
    [
      "forward reference",
      [
        { agent: "a", task: "{outputs.later}" },
        { agent: "a", as: "later" },
      ],
    ],
  ])("rejects %s appends without reserving or queueing", (_label, steps) => {
    const manager = new AgentManager();
    const record = registerChain(manager);
    const before = [...(record.chainDefinition ?? [])];

    expect(() =>
      enqueueChainAppendRequest(manager, "chain-1", steps as ChainStep[], findAgent),
    ).toThrow();
    expect(record.chainDefinition).toEqual(before);
    expect(countPendingChainAppendRequests("chain-1")).toBe(0);
    manager.dispose();
  });

  test("reserves accepted batches so later appends can reference their outputs", () => {
    const manager = new AgentManager();
    const record = registerChain(manager);
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "a", as: "second" }], findAgent);
    enqueueChainAppendRequest(
      manager,
      "chain-1",
      [{ agent: "a", task: "use {outputs.second}" }],
      findAgent,
    );

    expect(record.chainDefinition).toHaveLength(3);
    expect(countPendingChainAppendRequests("chain-1")).toBe(2);
    manager.dispose();
  });

  test("clearChainAppendRequests removes only the target queue", () => {
    const manager = new AgentManager();
    registerChain(manager);
    registerChain(manager, "chain-2");
    enqueueChainAppendRequest(manager, "chain-1", [{ agent: "a" }], findAgent);
    enqueueChainAppendRequest(manager, "chain-2", [{ agent: "a" }], findAgent);

    clearChainAppendRequests("chain-1");

    expect(countPendingChainAppendRequests("chain-1")).toBe(0);
    expect(countPendingChainAppendRequests("chain-2")).toBe(1);
    manager.dispose();
  });
});
