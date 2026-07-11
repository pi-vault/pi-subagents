import { afterEach, describe, expect, test } from "vitest";
import {
  enqueueChainAppendRequest,
  consumeChainAppendRequests,
  countPendingChainAppendRequests,
  resetAppendQueues,
} from "../src/core/chain-append.js";
import type { SequentialStep } from "../src/shared/types.js";

afterEach(() => {
  resetAppendQueues();
});

describe("chain append queue", () => {
  test("enqueue and consume returns steps", () => {
    const step: SequentialStep = { agent: "a", task: "t" };
    enqueueChainAppendRequest("chain-1", [step]);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toEqual(step);
  });

  test("consume clears the queue", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    consumeChainAppendRequests("chain-1");

    const second = consumeChainAppendRequests("chain-1");
    expect(second).toHaveLength(0);
  });

  test("multiple enqueues accumulate", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "1" }]);
    enqueueChainAppendRequest("chain-1", [{ agent: "b", task: "2" }]);

    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(2);
  });

  test("countPendingChainAppendRequests returns correct count", () => {
    expect(countPendingChainAppendRequests("chain-1")).toBe(0);
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    expect(countPendingChainAppendRequests("chain-1")).toBe(1);
    enqueueChainAppendRequest("chain-1", [{ agent: "b", task: "t" }]);
    expect(countPendingChainAppendRequests("chain-1")).toBe(2);
  });

  test("different chain IDs are independent", () => {
    enqueueChainAppendRequest("chain-1", [{ agent: "a", task: "t" }]);
    enqueueChainAppendRequest("chain-2", [{ agent: "b", task: "t" }]);

    expect(consumeChainAppendRequests("chain-1")).toHaveLength(1);
    expect(consumeChainAppendRequests("chain-2")).toHaveLength(1);
  });

  test("consume for unknown chain returns empty array", () => {
    expect(consumeChainAppendRequests("nonexistent")).toHaveLength(0);
  });

  test("enqueue with empty steps array is a no-op on consume", () => {
    enqueueChainAppendRequest("chain-1", []);
    const consumed = consumeChainAppendRequests("chain-1");
    expect(consumed).toHaveLength(0);
  });
});
