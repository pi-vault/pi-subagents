import { describe, expect, test } from "vitest";
import {
  validateChainOutputBindings,
  validateChainOutputBindingsWithContext,
  getChainOutputNames,
  resolveOutputReferences,
  outputEntryFromResult,
  ChainOutputValidationError,
} from "../src/core/chain-outputs.js";
import type { ChainStep, ChainOutputMap } from "../src/shared/types.js";

describe("validateChainOutputBindings", () => {
  test("accepts valid sequential chain with named outputs", () => {
    const steps: ChainStep[] = [
      { agent: "scout", task: "scan", as: "context" },
      { agent: "planner", task: "plan from {outputs.context}" },
    ];
    expect(() => validateChainOutputBindings(steps)).not.toThrow();
  });

  test("rejects duplicate output names", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t", as: "dup" },
      { agent: "b", task: "t", as: "dup" },
    ];
    expect(() => validateChainOutputBindings(steps)).toThrow(ChainOutputValidationError);
  });

  test("rejects reference to nonexistent output", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "use {outputs.missing}" }];
    expect(() => validateChainOutputBindings(steps)).toThrow(ChainOutputValidationError);
  });

  test("rejects invalid output name characters", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "t", as: "bad-name" }];
    expect(() => validateChainOutputBindings(steps)).toThrow(ChainOutputValidationError);
  });

  test("accepts parallel step with named outputs", () => {
    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "t", as: "out_a" },
          { agent: "b", task: "t", as: "out_b" },
        ],
      },
      { agent: "c", task: "use {outputs.out_a} and {outputs.out_b}" },
    ];
    expect(() => validateChainOutputBindings(steps)).not.toThrow();
  });

  test("rejects forward reference (output used before defined)", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "use {outputs.later}" },
      { agent: "b", task: "t", as: "later" },
    ];
    expect(() => validateChainOutputBindings(steps)).toThrow(ChainOutputValidationError);
  });

  test("accepts dynamic parallel step with collect output", () => {
    const steps: ChainStep[] = [
      { agent: "scout", task: "find targets", as: "targets" },
      {
        expand: { from: { output: "targets", path: "/items" }, item: "target" },
        parallel: { agent: "reviewer", task: "review {target}" },
        collect: { as: "reviews" },
      },
      { agent: "worker", task: "synthesize {outputs.reviews}" },
    ];
    expect(() => validateChainOutputBindings(steps)).not.toThrow();
  });

  test("accepts references to outputs reserved by earlier batches", () => {
    const steps: ChainStep[] = [{ agent: "worker", task: "use {outputs.prior}", as: "next" }];

    expect(() =>
      validateChainOutputBindingsWithContext(steps, {
        priorOutputNames: ["prior"],
        startStepIndex: 3,
      }),
    ).not.toThrow();
    expect(getChainOutputNames(steps)).toEqual(["next"]);
  });

  test("requires dynamic fanout sources to be earlier named outputs", () => {
    const steps: ChainStep[] = [
      {
        expand: { from: { output: "later", path: "/items" } },
        parallel: { agent: "worker", task: "review {item}" },
        collect: { as: "reviews" },
      },
      { agent: "scout", task: "find", as: "later" },
    ];

    expect(() => validateChainOutputBindings(steps)).toThrow(/later/);
  });

  test("rejects an output name already reserved by an earlier batch", () => {
    expect(() =>
      validateChainOutputBindingsWithContext([{ agent: "worker", task: "work", as: "prior" }], {
        priorOutputNames: ["prior"],
      }),
    ).toThrow(/Duplicate.*prior/);
  });
});

describe("resolveOutputReferences", () => {
  test("replaces {outputs.name} with entry text", () => {
    const outputs: ChainOutputMap = {
      context: {
        text: "found 3 files",
        structured: undefined,
        agent: "scout",
        stepIndex: 0,
      },
    };
    expect(resolveOutputReferences("Plan from {outputs.context}", outputs)).toBe(
      "Plan from found 3 files",
    );
  });

  test("replaces multiple references", () => {
    const outputs: ChainOutputMap = {
      a: { text: "A", structured: undefined, agent: "x", stepIndex: 0 },
      b: { text: "B", structured: undefined, agent: "y", stepIndex: 1 },
    };
    expect(resolveOutputReferences("{outputs.a} + {outputs.b}", outputs)).toBe("A + B");
  });

  test("throws on unknown reference", () => {
    expect(() => resolveOutputReferences("{outputs.nope}", {})).toThrow(ChainOutputValidationError);
  });

  test("returns string unchanged when no references", () => {
    expect(resolveOutputReferences("no refs here", {})).toBe("no refs here");
  });
});

describe("outputEntryFromResult", () => {
  test("creates entry from text result without structured key", () => {
    const entry = outputEntryFromResult("scout", "found files", 0);
    expect(entry).toEqual({
      text: "found files",
      agent: "scout",
      stepIndex: 0,
    });
    expect("structured" in entry).toBe(false);
  });

  test("creates entry with structured output", () => {
    const structured = { items: [1, 2, 3] };
    const entry = outputEntryFromResult("scout", "text", 0, structured);
    expect(entry.structured).toEqual(structured);
  });
});
