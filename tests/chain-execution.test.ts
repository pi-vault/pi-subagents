import { describe, expect, test, vi } from "vitest";
import { executeChain } from "../src/core/chain-execution.js";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  DynamicParallelStep,
  ParallelStep,
} from "../src/shared/types.js";

// Minimal mock deps
function makeMockDeps(stepResults: Array<{ result: string; status?: string }>) {
  let callIndex = 0;
  const spawnAndWait = vi.fn(
    async (
      _agentDef: AgentDefinition,
      _prompt: string,
      _cwd: string,
    ): Promise<{ id: string; record: AgentRecord }> => {
      const r = stepResults[callIndex++] ?? { result: "(no output)" };
      const id = `agent-${callIndex}`;
      const record: Partial<AgentRecord> = {
        id,
        type: "mock",
        description: "mock agent",
        status: (r.status as AgentRecord["status"]) ?? "completed",
        result: r.result,
        error: r.status === "error" ? r.result : undefined,
        toolUses: 0,
        turnCount: 1,
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 100,
        lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      };
      return { id, record: record as AgentRecord };
    },
  );

  const findAgent = vi.fn(
    (name: string): AgentDefinition => ({
      name,
      description: `mock ${name}`,
      tools: [],
      subagentAgents: [],
      systemPrompt: "You are a test agent.",
      sourcePath: "/mock",
    }),
  );

  return { spawnAndWait, findAgent };
}

describe("executeChain — sequential", () => {
  test("runs 2 sequential steps and passes {previous}", async () => {
    const mockDeps = makeMockDeps([
      { result: "step 1 output" },
      { result: "step 2 output" },
    ]);

    const steps: ChainStep[] = [
      { agent: "scout", task: "Analyze {task}" },
      { agent: "planner", task: "Plan from {previous}" },
    ];

    const result = await executeChain({
      steps,
      task: "build auth",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);

    // First step should have {task} replaced
    expect(mockDeps.spawnAndWait).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.stringContaining("build auth"),
      expect.anything(),
    );

    // Second step should have {previous} replaced with step 1 output
    expect(mockDeps.spawnAndWait).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.stringContaining("step 1 output"),
      expect.anything(),
    );
  });

  test("stores named output via 'as' and resolves {outputs.name}", async () => {
    const mockDeps = makeMockDeps([
      { result: "context data" },
      { result: "plan output" },
    ]);

    const steps: ChainStep[] = [
      { agent: "scout", task: "scan", as: "context" },
      { agent: "planner", task: "use {outputs.context}" },
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(false);
    expect(mockDeps.spawnAndWait).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.stringContaining("context data"),
      expect.anything(),
    );
  });

  test("aborts chain on step failure", async () => {
    const mockDeps = makeMockDeps([
      { result: "error msg", status: "error" },
      { result: "should not run" },
    ]);

    const steps: ChainStep[] = [
      { agent: "a", task: "fail" },
      { agent: "b", task: "continue" },
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(true);
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(1);
  });
});

describe("executeChain — parallel", () => {
  test("executes parallel items concurrently and aggregates output", async () => {
    const mockDeps = makeMockDeps([
      { result: "alpha result" },
      { result: "beta result" },
    ]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "alpha", task: "do alpha" },
          { agent: "beta", task: "do beta" },
        ],
      } satisfies ParallelStep,
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(false);
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    // Aggregated output joins with separator
    expect(result.content).toContain("alpha result");
    expect(result.content).toContain("beta result");
  });

  test("failFast aborts chain when a parallel item errors", async () => {
    const mockDeps = makeMockDeps([
      { result: "ok" },
      { result: "boom", status: "error" },
    ]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "ok" },
          { agent: "b", task: "fail" },
        ],
        failFast: true,
      } satisfies ParallelStep,
    ];

    const result = await executeChain({
      steps,
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("parallel step");
  });
});

describe("executeChain — dynamic parallel", () => {
  test("errors when prior step lacks structured output", async () => {
    const mockDeps = makeMockDeps([{ result: "plain text" }]);

    const dynamicStep: DynamicParallelStep = {
      expand: { from: { output: "data", path: "/items" }, item: "item" },
      parallel: { agent: "worker", task: "{item.name}" },
      collect: { as: "results" },
    };

    const result = await executeChain({
      steps: [
        { agent: "scout", task: "scan", as: "data" },
        dynamicStep,
      ],
      task: "test",
      spawnAndWait: mockDeps.spawnAndWait,
      findAgent: mockDeps.findAgent,
      cwd: "/tmp",
      runId: "test-run",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("no structured output");
    expect(result.content).toContain("dynamic step 2");
  });
});
