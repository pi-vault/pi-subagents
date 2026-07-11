import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  isParallelStep,
  isDynamicParallelStep,
  getStepAgents,
  resolveChainTemplates,
  resolveStepBehavior,
  buildChainInstructions,
  createChainDir,
  removeChainDir,
} from "../src/core/chain-settings.js";
import type {
  ChainStep,
  SequentialStep,
  ParallelStep,
  DynamicParallelStep,
} from "../src/shared/types.js";

describe("isParallelStep", () => {
  test("true for parallel step", () => {
    const step: ParallelStep = { parallel: [{ agent: "a", task: "t" }] };
    expect(isParallelStep(step)).toBe(true);
  });

  test("false for sequential step", () => {
    const step: SequentialStep = { agent: "a", task: "t" };
    expect(isParallelStep(step)).toBe(false);
  });

  test("false for dynamic parallel step", () => {
    const step: DynamicParallelStep = {
      expand: { from: { output: "x", path: "/items" } },
      parallel: { agent: "a" },
      collect: { as: "results" },
    };
    expect(isParallelStep(step)).toBe(false);
  });
});

describe("isDynamicParallelStep", () => {
  test("true for dynamic parallel step", () => {
    const step: DynamicParallelStep = {
      expand: { from: { output: "x", path: "/items" } },
      parallel: { agent: "a" },
      collect: { as: "results" },
    };
    expect(isDynamicParallelStep(step)).toBe(true);
  });

  test("false for static parallel step", () => {
    const step: ParallelStep = { parallel: [{ agent: "a", task: "t" }] };
    expect(isDynamicParallelStep(step)).toBe(false);
  });

  test("false for sequential step", () => {
    const step: SequentialStep = { agent: "a", task: "t" };
    expect(isDynamicParallelStep(step)).toBe(false);
  });
});

describe("getStepAgents", () => {
  test("returns single agent for sequential step", () => {
    const step: SequentialStep = { agent: "agent-a" };
    expect(getStepAgents(step)).toEqual(["agent-a"]);
  });

  test("returns multiple agents for parallel step", () => {
    const step: ParallelStep = {
      parallel: [{ agent: "a", task: "t1" }, { agent: "b", task: "t2" }],
    };
    expect(getStepAgents(step)).toEqual(["a", "b"]);
  });

  test("returns agent for dynamic parallel step", () => {
    const step: DynamicParallelStep = {
      expand: { from: { output: "x", path: "/items" } },
      parallel: { agent: "dyn-agent" },
      collect: { as: "results" },
    };
    expect(getStepAgents(step)).toEqual(["dyn-agent"]);
  });
});

describe("resolveChainTemplates", () => {
  test("first step defaults to {task}", () => {
    const steps: ChainStep[] = [{ agent: "a" }];
    expect(resolveChainTemplates(steps)).toEqual(["{task}"]);
  });

  test("subsequent steps default to {previous}", () => {
    const steps: ChainStep[] = [{ agent: "a" }, { agent: "b" }];
    expect(resolveChainTemplates(steps)).toEqual(["{task}", "{previous}"]);
  });

  test("explicit task overrides default", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "custom task" },
      { agent: "b", task: "use {outputs.x}" },
    ];
    expect(resolveChainTemplates(steps)).toEqual([
      "custom task",
      "use {outputs.x}",
    ]);
  });

  test("parallel step returns array of templates", () => {
    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "task A" },
          { agent: "b", task: "task B" },
        ],
      },
    ];
    expect(resolveChainTemplates(steps)).toEqual([["task A", "task B"]]);
  });

  test("parallel item without task defaults to {previous}", () => {
    const steps: ChainStep[] = [{ parallel: [{ agent: "a" }, { agent: "b" }] }];
    expect(resolveChainTemplates(steps)).toEqual([
      ["{previous}", "{previous}"],
    ]);
  });

  test("dynamic parallel returns template string", () => {
    const steps: ChainStep[] = [
      {
        expand: { from: { output: "x", path: "/items" } },
        parallel: { agent: "a", task: "review {target}" },
        collect: { as: "reviews" },
      },
    ];
    expect(resolveChainTemplates(steps)).toEqual(["review {target}"]);
  });
});

describe("resolveStepBehavior", () => {
  test("step overrides take priority over agent defaults", () => {
    const result = resolveStepBehavior(
      {
        output: "agent-default.md",
        reads: false,
        progress: false,
        skills: false,
        model: "gpt-4",
      },
      { output: "step-override.md", model: "claude" },
    );
    expect(result.output).toBe("step-override.md");
    expect(result.model).toBe("claude");
  });

  test("falls back to agent defaults when no overrides", () => {
    const result = resolveStepBehavior(
      {
        output: "default.md",
        reads: ["ctx.md"],
        progress: true,
        skills: ["s1"],
        model: "gpt-4",
      },
      {},
    );
    expect(result.output).toBe("default.md");
    expect(result.reads).toEqual(["ctx.md"]);
    expect(result.progress).toBe(true);
    expect(result.model).toBe("gpt-4");
  });

  test("returns defaults when agent has no chain-relevant config", () => {
    const result = resolveStepBehavior(
      { output: false, reads: false, progress: false, skills: false },
      {},
    );
    expect(result.output).toBe(false);
    expect(result.reads).toBe(false);
    expect(result.progress).toBe(false);
  });
});

describe("buildChainInstructions", () => {
  test("includes read instructions when reads is set", () => {
    const { prefix } = buildChainInstructions(
      {
        output: false,
        outputMode: "inline",
        reads: ["ctx.md"],
        progress: false,
        skills: false,
      },
      "/tmp/chain",
      false,
    );
    expect(prefix).toContain("ctx.md");
  });

  test("includes write instructions when output is set", () => {
    const { prefix } = buildChainInstructions(
      {
        output: "result.md",
        outputMode: "inline",
        reads: false,
        progress: false,
        skills: false,
      },
      "/tmp/chain",
      false,
    );
    expect(prefix).toContain("result.md");
  });

  test("includes progress instructions for first progress agent", () => {
    const { suffix } = buildChainInstructions(
      {
        output: false,
        outputMode: "inline",
        reads: false,
        progress: true,
        skills: false,
      },
      "/tmp/chain",
      true,
    );
    expect(suffix).toContain("progress");
  });

  test("returns empty strings when no behavior configured", () => {
    const { prefix, suffix } = buildChainInstructions(
      {
        output: false,
        outputMode: "inline",
        reads: false,
        progress: false,
        skills: false,
      },
      "/tmp/chain",
      false,
    );
    expect(prefix).toBe("");
    expect(suffix).toBe("");
  });
});

describe("createChainDir / removeChainDir", () => {
  const testBaseDir = join(tmpdir(), "pi-subagents-chain-test");
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const d of createdDirs) removeChainDir(d);
    createdDirs.length = 0;
    removeChainDir(testBaseDir);
  });

  test("creates directory and returns path containing runId", () => {
    const dir = createChainDir("run-123", testBaseDir);
    createdDirs.push(dir);
    expect(existsSync(dir)).toBe(true);
    expect(dir).toContain("run-123");
  });

  test("uses default base dir when none provided", () => {
    const dir = createChainDir("run-default");
    createdDirs.push(dir);
    expect(existsSync(dir)).toBe(true);
    expect(dir).toContain("pi-subagents-chain-runs");
  });

  test("removeChainDir removes existing directory", () => {
    const dir = createChainDir("run-remove", testBaseDir);
    removeChainDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  test("removeChainDir handles non-existent directory gracefully", () => {
    expect(() => removeChainDir("/nonexistent-dir-abc123")).not.toThrow();
  });
});
