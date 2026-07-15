import { describe, expect, test, vi } from "vitest";
import { executeChain } from "../src/core/chain-execution.js";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  DynamicParallelStep,
  ParallelStep,
} from "../src/shared/types.js";

// ---------------------------------------------------------------------------
// Reusable test helpers
// ---------------------------------------------------------------------------

function makeRecord(status: "completed" | "error", result: string): AgentRecord {
  return {
    id: `agent-${Math.random()}`,
    type: "mock",
    description: "mock agent",
    status,
    result,
    error: status === "error" ? result : undefined,
    toolUses: 0,
    turnCount: 1,
    startedAt: Date.now(),
    completedAt: Date.now(),
    durationMs: 100,
    lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
  };
}

function makeAgentDef(name: string): AgentDefinition {
  return {
    name,
    description: `mock ${name}`,
    tools: [],
    subagentAgents: [],
    systemPrompt: "You are a test agent.",
    sourcePath: "/mock",
  };
}

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
      expect.anything(),
    );

    // Second step should have {previous} replaced with step 1 output
    expect(mockDeps.spawnAndWait).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.stringContaining("step 1 output"),
      expect.anything(),
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

// ---------------------------------------------------------------------------
// Step behavior wiring (Task 11 + 12)
// ---------------------------------------------------------------------------

describe("executeChain — step behavior wiring", () => {
  test("prepends read instructions to sequential task prompt", async () => {
    const prompts: string[] = [];

    await executeChain({
      steps: [{ agent: "scout", task: "do stuff", reads: ["context.md"] }],
      task: "original",
      spawnAndWait: async (_agentDef, prompt, _cwd) => {
        prompts.push(prompt);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("scout"),
      cwd: "/tmp",
      runId: "test-reads",
    });

    expect(prompts[0]).toContain("[Read from:");
    expect(prompts[0]).toContain("context.md");
  });

  test("appends progress instruction to sequential task prompt", async () => {
    const prompts: string[] = [];

    await executeChain({
      steps: [{ agent: "worker", task: "implement it", progress: true }],
      task: "build feature",
      spawnAndWait: async (_agentDef, prompt, _cwd) => {
        prompts.push(prompt);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-progress",
    });

    expect(prompts[0]).toContain("progress");
  });

  test("passes toolBudget through StepSpawnOptions for sequential step", async () => {
    const receivedOptions: unknown[] = [];

    await executeChain({
      steps: [{ agent: "worker", task: "build", toolBudget: { hard: 20, soft: 10 } }],
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options?: unknown) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-budget",
    });

    expect(receivedOptions[0]).toBeDefined();
    expect((receivedOptions[0] as { toolBudget?: unknown }).toolBudget).toBeDefined();
  });

  test("passes isolation: worktree for parallel steps with worktree: true", async () => {
    const receivedOptions: unknown[] = [];

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "t1" },
          { agent: "b", task: "t2" },
        ],
        worktree: true,
      } satisfies ParallelStep,
    ];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options?: unknown) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: (name) => makeAgentDef(name),
      cwd: "/tmp",
      runId: "test-worktree",
    });

    expect((receivedOptions[0] as { isolation?: string }).isolation).toBe("worktree");
    expect((receivedOptions[1] as { isolation?: string }).isolation).toBe("worktree");
  });

  test("passes skills override through StepSpawnOptions for sequential step", async () => {
    const receivedOptions: unknown[] = [];

    await executeChain({
      steps: [{ agent: "worker", task: "build", skills: ["tdd", "lint"] }],
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options?: unknown) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-skills",
    });

    expect((receivedOptions[0] as { skills?: unknown }).skills).toEqual(["tdd", "lint"]);
  });

  test("prepends read instructions for parallel task items", async () => {
    const prompts: string[] = [];

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "task a", reads: ["file.md"] },
          { agent: "b", task: "task b" },
        ],
      } satisfies ParallelStep,
    ];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait: async (_agentDef, prompt, _cwd) => {
        prompts.push(prompt);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: (name) => makeAgentDef(name),
      cwd: "/tmp",
      runId: "test-parallel-reads",
    });

    // First parallel item has reads, second does not
    expect(prompts.some((p) => p.includes("[Read from:") && p.includes("file.md"))).toBe(true);
    expect(prompts.filter((p) => p.includes("[Read from:"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Model override (Task 16)
// ---------------------------------------------------------------------------

describe("executeChain — model override", () => {
  test("passes model string through StepSpawnOptions for sequential step", async () => {
    const receivedOptions: unknown[] = [];

    await executeChain({
      steps: [{ agent: "worker", task: "build", model: "anthropic/claude-sonnet-4-5" }],
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-model",
    });

    expect((receivedOptions[0] as { model?: string }).model).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });

  test("passes model string through StepSpawnOptions for parallel items", async () => {
    const receivedOptions: unknown[] = [];

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "a", task: "t1", model: "anthropic/claude-sonnet-4-5" },
          { agent: "b", task: "t2" },
        ],
      } satisfies ParallelStep,
    ];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: (name) => makeAgentDef(name),
      cwd: "/tmp",
      runId: "test-model-parallel",
    });

    expect((receivedOptions[0] as { model?: string }).model).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    expect((receivedOptions[1] as { model?: string }).model).toBeUndefined();
  });

  test("does not set model when step has no model field", async () => {
    const receivedOptions: unknown[] = [];

    await executeChain({
      steps: [{ agent: "worker", task: "build" }],
      task: "test",
      spawnAndWait: async (_agentDef, _prompt, _cwd, options) => {
        receivedOptions.push(options);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-no-model",
    });

    expect((receivedOptions[0] as { model?: string }).model).toBeUndefined();
  });

  test("resolveStepBehavior pipes model for dynamic parallel path", async () => {
    const { resolveStepBehavior } = await import("../src/core/chain-settings.js");
    const behavior = resolveStepBehavior(
      { output: false, reads: false, progress: false, skills: false },
      { model: "anthropic/claude-sonnet-4-5" },
    );
    expect(behavior.model).toBe("anthropic/claude-sonnet-4-5");
  });
});

// ---------------------------------------------------------------------------
// Chain directory cleanup (Task 13)
// ---------------------------------------------------------------------------

describe("executeChain — chain directory cleanup", () => {
  test("removes chain directory after successful execution", async () => {
    const { existsSync } = await import("node:fs");
    const capturedPrompts: string[] = [];

    await executeChain({
      steps: [{ agent: "a", task: "{chain_dir}" }],
      task: "test",
      spawnAndWait: async (_agentDef, prompt, _cwd) => {
        capturedPrompts.push(prompt);
        return { id: "1", record: makeRecord("completed", "done") };
      },
      findAgent: () => makeAgentDef("a"),
      cwd: "/tmp",
      runId: `cleanup-test-${Date.now()}`,
    });

    const chainDir = capturedPrompts[0]?.trim();
    expect(chainDir).toBeTruthy();
    expect(existsSync(chainDir!)).toBe(false);
  });

  test("removes chain directory even when a step fails", async () => {
    const { existsSync } = await import("node:fs");
    const capturedPrompts: string[] = [];

    await executeChain({
      steps: [
        { agent: "a", task: "{chain_dir}" },
        { agent: "b", task: "second step" },
      ],
      task: "test",
      spawnAndWait: async (_agentDef, prompt, _cwd) => {
        capturedPrompts.push(prompt);
        // First call succeeds (captures chain_dir), second would not be reached anyway
        return { id: "1", record: makeRecord("error", "boom") };
      },
      findAgent: () => makeAgentDef("a"),
      cwd: "/tmp",
      runId: `cleanup-fail-${Date.now()}`,
    });

    const chainDir = capturedPrompts[0]?.trim();
    expect(chainDir).toBeTruthy();
    expect(existsSync(chainDir!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spawn budget for parallel steps (Task 4)
// ---------------------------------------------------------------------------

describe("executeChain — spawn budget for parallel steps", () => {
  test("reduces parallelism when spawn budget is insufficient", async () => {
    const mockDeps = makeMockDeps([
      { result: "alpha result" },
      { result: "beta result" },
    ]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "alpha", task: "do alpha" },
          { agent: "beta", task: "do beta" },
          { agent: "gamma", task: "do gamma" },
          { agent: "delta", task: "do delta" },
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
      getSpawnBudget: () => 2,
    });

    // Only 2 items should have been spawned (budget = 2)
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);
  });

  test("spawns all items when budget is sufficient", async () => {
    const mockDeps = makeMockDeps([
      { result: "alpha result" },
      { result: "beta result" },
      { result: "gamma result" },
    ]);

    const steps: ChainStep[] = [
      {
        parallel: [
          { agent: "alpha", task: "do alpha" },
          { agent: "beta", task: "do beta" },
          { agent: "gamma", task: "do gamma" },
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
      getSpawnBudget: () => 100,
    });

    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(3);
    expect(result.isError).toBe(false);
  });

  test("returns error when budget is zero", async () => {
    const mockDeps = makeMockDeps([]);

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
      getSpawnBudget: () => 0,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/spawn/i);
    expect(mockDeps.spawnAndWait).not.toHaveBeenCalled();
  });

  test("spawns all items when getSpawnBudget is not provided", async () => {
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

    // No budget function = no limit
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);
  });

  test("budget is checked per parallel step across multi-step chain", async () => {
    // Step 1: sequential (consumes 1 spawn from the mock)
    // Step 2: parallel with 3 items, but budget returns 2 on second call
    let callCount = 0;
    const mockDeps = makeMockDeps([
      { result: "seq output" },    // sequential step
      { result: "par result 1" },  // parallel item 1
      { result: "par result 2" },  // parallel item 2
    ]);

    const steps: ChainStep[] = [
      { agent: "planner", task: "plan {task}" },
      {
        parallel: [
          { agent: "worker-a", task: "work a" },
          { agent: "worker-b", task: "work b" },
          { agent: "worker-c", task: "work c" },
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
      getSpawnBudget: () => {
        callCount++;
        return 2; // always 2 remaining (budget callback is called per-step)
      },
    });

    // Sequential step ran (1 call), then parallel step ran 2 of 3 items (2 calls)
    expect(mockDeps.spawnAndWait).toHaveBeenCalledTimes(3);
    expect(result.isError).toBe(false);
    // Budget callback was called at least once (for the parallel step)
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency limiting (Phase 8)
// ---------------------------------------------------------------------------

describe("executeChain — concurrency limiting", () => {
  test.each([
    { name: "step.concurrency=2 caps 4 items", items: 4, concurrency: 2, globalLimit: undefined, expectedMax: 2 },
    { name: "globalConcurrencyLimit=1 caps 3 items", items: 3, concurrency: undefined, globalLimit: 1, expectedMax: 1 },
    { name: "no concurrency field: all run at once", items: 3, concurrency: undefined, globalLimit: undefined, expectedMax: 3 },
  ])("$name", async ({ items, concurrency, globalLimit, expectedMax }) => {
    let maxConcurrent = 0;
    let current = 0;

    const spawnAndWait = vi.fn(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
      return { id: "a", record: makeRecord("completed", "done") };
    });

    const steps: ChainStep[] = [
      {
        parallel: Array.from({ length: items }, (_, i) => ({ agent: "worker", task: `t${i}` })),
        ...(concurrency != null && { concurrency }),
      },
    ];

    await executeChain({
      steps,
      task: "test",
      spawnAndWait,
      findAgent: () => makeAgentDef("worker"),
      cwd: "/tmp",
      runId: "test-run",
      ...(globalLimit != null && { globalConcurrencyLimit: globalLimit }),
    });

    expect(maxConcurrent).toBeLessThanOrEqual(expectedMax);
    expect(maxConcurrent).toBeGreaterThanOrEqual(expectedMax);
    expect(spawnAndWait).toHaveBeenCalledTimes(items);
  });

  test("respects step.concurrency limit for dynamic parallel steps", async () => {
    let maxConcurrent = 0;
    let current = 0;
    let callCount = 0;

    const spawnAndWait = vi.fn(async (_agentDef: AgentDefinition, _prompt: string, _cwd: string) => {
      callCount++;
      if (callCount === 1) {
        // Scout: returns structured output for 4 items
        return {
          id: "scout",
          record: makeRecord(
            "completed",
            JSON.stringify({ items: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] }),
          ),
        };
      }
      // Workers: track concurrency
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
      return { id: "worker", record: makeRecord("completed", "done") };
    });

    const dynamicStep: DynamicParallelStep = {
      expand: { from: { output: "data", path: "/items" }, item: "item" },
      parallel: { agent: "worker", task: "{item.name}" },
      collect: { as: "results" },
      concurrency: 2,
    };

    await executeChain({
      steps: [
        { agent: "scout", task: "scan", as: "data", outputSchema: { type: "object" } },
        dynamicStep,
      ],
      task: "test",
      spawnAndWait,
      findAgent: (name) => makeAgentDef(name),
      cwd: "/tmp",
      runId: "test-dyn-concurrency",
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(callCount).toBe(5); // 1 scout + 4 workers
  });
});
