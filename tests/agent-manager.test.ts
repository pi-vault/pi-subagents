import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import { createDeps } from "./_test-helpers.js";
import type { AgentDefinition } from "../src/shared/types.js";

const tmpDir = "/tmp";

// Mock the runner
vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: { isIdle: true },
    aborted: false,
    steered: false,
  }),
  resumeAgent: vi.fn().mockResolvedValue("resumed"),
}));

function makeAgentDef(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    name: "test-agent",
    description: "A test agent",
    tools: ["read", "bash"],
    subagentAgents: [],
    systemPrompt: "You are a test agent.",
    sourcePath: "/fake/path/test-agent.md",
    ...overrides,
  };
}

describe("AgentManager", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager(3);
  });

  it("rejects spawn when depth exceeds maxDepth", async () => {
    const agentDef = makeAgentDef();
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 3,
      }),
    ).rejects.toThrow(/nesting limit/i);
  });

  it("rejects spawn when agent not in allowlist", async () => {
    const agentDef = makeAgentDef({ name: "worker" });
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        allowedAgents: ["scout", "reviewer"],
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it("allows spawn when agent is in allowlist (case-insensitive)", async () => {
    const agentDef = makeAgentDef({ name: "scout" });
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      allowedAgents: ["Scout"],
    });
    expect(record.status).toBe("completed");
  });

  it("allows spawn when allowedAgents is empty (no restriction)", async () => {
    const agentDef = makeAgentDef({ name: "anything" });
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(record.status).toBe("completed");
  });

  it("tracks agent records", () => {
    expect(manager.listAgents()).toEqual([]);
  });

  it("records are tracked after spawn", async () => {
    const agentDef = makeAgentDef();
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(manager.listAgents()).toHaveLength(1);
    expect(manager.listAgents()[0].status).toBe("completed");
  });

  it("initializes live state with maxTurns", async () => {
    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
      maxTurns: 7,
    });

    expect(record.live).toEqual({
      activeTools: [],
      responseText: "",
      maxTurns: 7,
    });
  });

  it("tracks overlapping tools and unmatched ends", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockImplementationOnce(async (_agent, options) => {
      options.onToolActivity?.({ type: "start", toolName: "bash" });
      options.onToolActivity?.({ type: "start", toolName: "bash" });
      options.onToolActivity?.({ type: "end", toolName: "bash" });
      expect(manager.listAgents()[0]?.live.activeTools).toEqual(["bash"]);
      options.onToolActivity?.({ type: "end", toolName: "missing" });
      return {
        responseText: "done",
        session: { isIdle: true },
        aborted: false,
        steered: false,
      };
    });

    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });

    expect(record.live.activeTools).toEqual(["bash"]);
    expect(record.toolUses).toBe(2);
  });

  it("updates live state before notifying activity observers", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const snapshots: Array<{ tools: string[]; text: string; turns: number; input: number }> = [];
    vi.mocked(runAgent).mockImplementationOnce(async (_agent, options) => {
      options.onToolActivity?.({ type: "start", toolName: "read" });
      options.onTextDelta?.("hi", "hi");
      options.onTurnEnd?.(1);
      options.onUsage?.({ input: 2, output: 3, cacheWrite: 4 });
      return {
        responseText: "hi",
        session: { isIdle: true },
        aborted: false,
        steered: false,
      };
    });

    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
      onActivity: (record) => snapshots.push({
        tools: [...record.live.activeTools],
        text: record.live.responseText,
        turns: record.turnCount,
        input: record.lifetimeUsage.inputTokens,
      }),
    });

    expect(snapshots).toEqual([
      { tools: ["read"], text: "", turns: 0, input: 0 },
      { tools: ["read"], text: "hi", turns: 0, input: 0 },
      { tools: ["read"], text: "hi", turns: 1, input: 0 },
      { tools: ["read"], text: "hi", turns: 1, input: 2 },
    ]);
    expect(record.lifetimeUsage).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      cacheWriteTokens: 4,
    });
  });

  it("clears active tools only when settled", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    let release = () => {};
    vi.mocked(runAgent).mockImplementationOnce((_agent, options) => {
      options.onToolActivity?.({ type: "start", toolName: "bash" });
      return new Promise((resolve) => {
        release = () => resolve({
          responseText: "done",
          session: { isIdle: true },
          aborted: false,
          steered: false,
        });
      });
    });
    const id = manager.spawn({}, makeAgentDef(), { prompt: "test", cwd: "/tmp" });
    const options = vi.mocked(runAgent).mock.calls[0]?.[1];

    expect(manager.getRecord(id)?.live.activeTools).toEqual(["bash"]);
    options?.onSettled?.();
    expect(manager.getRecord(id)?.live.activeTools).toEqual([]);
    release();
    await manager.getRecord(id)?.promise;
  });

  it("clears active tools when execution rejects before settlement", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockImplementationOnce(async (_agent, options) => {
      options.onToolActivity?.({ type: "start", toolName: "bash" });
      throw new Error("failed");
    });

    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });

    expect(record.live.activeTools).toEqual([]);
  });

  it("swallows activity observer errors", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockImplementationOnce(async (_agent, options) => {
      options.onTextDelta?.("ok", "ok");
      return {
        responseText: "ok",
        session: { isIdle: true },
        aborted: false,
        steered: false,
      };
    });

    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
      onActivity: () => {
        throw new Error("renderer failed");
      },
    });

    expect(record.status).toBe("completed");
    expect(record.live.responseText).toBe("ok");
  });

  it("can abort a running agent (returns false for nonexistent)", () => {
    expect(manager.abort("nonexistent")).toBe(false);
  });

  it("setMaxDepth updates the limit", async () => {
    manager.setMaxDepth(5);
    const agentDef = makeAgentDef();
    // Depth 4 should work
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 4,
    });
    expect(record.status).toBe("completed");
    // Depth 5 should fail
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 5,
      }),
    ).rejects.toThrow(/nesting limit/i);
  });

  it("clearCompleted removes finished agents", async () => {
    const agentDef = makeAgentDef();
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(manager.listAgents()).toHaveLength(1);
    manager.clearCompleted();
    expect(manager.listAgents()).toEqual([]);
  });

  it("computes allowRecursion correctly", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const agentDef = makeAgentDef({ subagentAgents: ["helper"] });
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 0,
    });
    // With subagentAgents and depth+1 < maxDepth, allowRecursion should be true
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({ allowRecursion: true }),
      expect.anything(),
    );
  });

  it("sets allowRecursion to false when depth would exceed limit", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const agentDef = makeAgentDef({ subagentAgents: ["helper"] });
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 2, // maxDepth is 3, so depth+1=3 is NOT < 3
    });
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({ allowRecursion: false }),
      expect.anything(),
    );
  });

  it("constructs customTools when _deps and subagentAgents are present", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const deps = createDeps({ manager });
    const agentDef = makeAgentDef({ subagentAgents: ["helper"] });
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 0,
      _deps: deps,
    });
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({
        allowRecursion: true,
        customTools: expect.arrayContaining([
          expect.objectContaining({ name: "subagent" }),
          expect.objectContaining({ name: "get_subagent_result" }),
        ]),
      }),
      expect.anything(),
    );
  });

  it("passes empty customTools when _deps is absent", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const agentDef = makeAgentDef({ subagentAgents: ["helper"] });
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 0,
    });
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({
        allowRecursion: true,
        customTools: [],
      }),
      expect.anything(),
    );
  });

  it("records error status when runAgent throws", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockRejectedValueOnce(new Error("session failed"));
    const agentDef = makeAgentDef();
    const { record } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(record.status).toBe("error");
    expect(record.error).toBe("session failed");
  });

  it("getRecord returns record by id", async () => {
    const agentDef = makeAgentDef();
    const { id } = await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
    });
    const record = manager.getRecord(id);
    expect(record).toBeDefined();
    expect(record?.status).toBe("completed");
    expect(manager.getRecord("nonexistent")).toBeUndefined();
  });

  it("rejects relative cwd paths", async () => {
    const agentDef = makeAgentDef();
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "relative/path",
      }),
    ).rejects.toThrow(/absolute path/i);
  });

  it("rejects non-existent cwd paths", async () => {
    const agentDef = makeAgentDef();
    await expect(
      manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/nonexistent/path/xyz123",
      }),
    ).rejects.toThrow(/does not exist/i);
  });
});

describe("thinking passthrough", () => {
  it("passes thinking to runAgent when provided in SpawnOptions", async () => {
    const manager = new AgentManager(3);
    const spy = vi
      .spyOn(await import("../src/core/agent-runner.js"), "runAgent")
      .mockResolvedValue({
        responseText: "done",
        session: { isIdle: true },
        aborted: false,
        steered: false,
      });

    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: tmpDir,
      thinking: "high",
    });

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ thinking: "high" }),
      expect.anything(),
    );
    spy.mockRestore();
    manager.dispose();
  });
});

describe("maxTurns and graceTurns passthrough", () => {
  it("passes maxTurns and graceTurns to runAgent", async () => {
    const manager = new AgentManager(3);
    const spy = vi
      .spyOn(await import("../src/core/agent-runner.js"), "runAgent")
      .mockResolvedValue({
        responseText: "done",
        session: { isIdle: true },
        aborted: false,
        steered: false,
      });

    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: tmpDir,
      maxTurns: 10,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTurns: 10 }),
      expect.anything(),
    );
    spy.mockRestore();
  });

  it("passes toolBudget to runAgent", async () => {
    const manager = new AgentManager(3);
    const spy = vi
      .spyOn(await import("../src/core/agent-runner.js"), "runAgent")
      .mockResolvedValue({
        responseText: "done",
        session: { isIdle: true },
        aborted: false,
        steered: false,
      });

    const budget = { soft: 5, hard: 10, block: ["read"] as string[] };
    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: tmpDir,
      toolBudget: budget,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toolBudget: budget }),
      expect.anything(),
    );
    spy.mockRestore();
    manager.dispose();
  });
});

describe("steered status", () => {
  it("maps steered result to 'steered' record status", async () => {
    const manager = new AgentManager(3);
    vi.spyOn(
      await import("../src/core/agent-runner.js"),
      "runAgent",
    ).mockResolvedValue({
      responseText: "wrapped up",
      session: { isIdle: true },
      aborted: false,
      steered: true,
    });

    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: tmpDir,
    });

    expect(record.status).toBe("steered");
  });
});

describe("spawn (background)", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager(3);
  });

  afterEach(() => {
    manager.dispose();
  });

  it("spawn returns agent id immediately", () => {
    const agentDef = makeAgentDef();
    const id = manager.spawn({}, agentDef, {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^agent-/);
  });

  it("spawn queues agent when at concurrency limit", () => {
    const m = new AgentManager(3, undefined, 1); // maxConcurrent = 1
    const id1 = m.spawn({}, makeAgentDef(), { prompt: "task 1", cwd: "/tmp", isBackground: true });
    const id2 = m.spawn({}, makeAgentDef(), { prompt: "task 2", cwd: "/tmp", isBackground: true });
    const r1 = m.getRecord(id1);
    const r2 = m.getRecord(id2);
    // First should be running, second should be queued
    expect(r1?.status).toBe("running");
    expect(r2?.status).toBe("queued");
    m.dispose();
  });

  it("abort removes queued agent and sets stopped status", () => {
    const m = new AgentManager(3, undefined, 1); // maxConcurrent = 1
    m.spawn({}, makeAgentDef(), { prompt: "task 1", cwd: "/tmp", isBackground: true });
    const id2 = m.spawn({}, makeAgentDef(), { prompt: "task 2", cwd: "/tmp", isBackground: true });
    expect(m.getRecord(id2)?.status).toBe("queued");
    m.abort(id2);
    expect(m.getRecord(id2)?.status).toBe("stopped");
    m.dispose();
  });

  it("steer queues message for unstarted agent", () => {
    const m = new AgentManager(3, undefined, 1);
    m.spawn({}, makeAgentDef(), { prompt: "task 1", cwd: "/tmp", isBackground: true });
    const id2 = m.spawn({}, makeAgentDef(), { prompt: "task 2", cwd: "/tmp", isBackground: true });
    const result = m.steer(id2, "redirect this");
    expect(result).toBe(true);
    expect(m.getRecord(id2)?.pendingSteers).toEqual(["redirect this"]);
    m.dispose();
  });

  it("steer returns false for nonexistent agent", () => {
    expect(manager.steer("nonexistent", "msg")).toBe(false);
  });

  it("steer returns false for completed agent", async () => {
    const { id } = await manager.spawnAndWait({}, makeAgentDef(), { prompt: "test", cwd: "/tmp" });
    expect(manager.steer(id, "msg")).toBe(false);
  });
});

describe("AgentManager onComplete callback", () => {
  beforeEach(async () => {
    // Restore any spies left over from preceding describe blocks (e.g. "steered status")
    vi.restoreAllMocks();
    // Explicitly reset runAgent to the non-steered default
    const { runAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "done",
      session: { isIdle: true },
      aborted: false,
      steered: false,
    });
  });

  it("calls onComplete when agent finishes", async () => {
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete);
    await manager.spawnAndWait({}, makeAgentDef(), { prompt: "test", cwd: "/tmp" });
    expect(onComplete).toHaveBeenCalledOnce();
    const record = onComplete.mock.calls[0][0];
    expect(record.status).toBe("completed");
    manager.dispose();
  });

  it("calls onComplete with error status when agent throws", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockRejectedValueOnce(new Error("agent failed"));
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete);
    await manager.spawnAndWait({}, makeAgentDef(), { prompt: "test", cwd: "/tmp" });
    expect(onComplete).toHaveBeenCalledOnce();
    const record = onComplete.mock.calls[0][0];
    expect(record.status).toBe("error");
    manager.dispose();
  });
});

describe("setMaxConcurrent / getMaxConcurrent", () => {
  it("getMaxConcurrent returns default", () => {
    const manager = new AgentManager();
    expect(manager.getMaxConcurrent()).toBe(4); // DEFAULT_MAX_CONCURRENT
    manager.dispose();
  });

  it("setMaxConcurrent updates the limit", () => {
    const manager = new AgentManager();
    manager.setMaxConcurrent(8);
    expect(manager.getMaxConcurrent()).toBe(8);
    manager.dispose();
  });

  it("starts queued agents when the concurrency limit increases", () => {
    const manager = new AgentManager(3, undefined, 1);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task 1",
      cwd: "/tmp",
      isBackground: true,
    });
    const queuedId = manager.spawn({}, makeAgentDef(), {
      prompt: "task 2",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getRecord(queuedId)?.status).toBe("queued");

    manager.setMaxConcurrent(2);

    expect(manager.getRecord(queuedId)?.status).toBe("running");
    manager.dispose();
  });
});

describe("waitForAll", () => {
  it("resolves immediately when no agents are running", async () => {
    const manager = new AgentManager();
    await expect(manager.waitForAll()).resolves.toBeUndefined();
    manager.dispose();
  });

  it("waits for background agents to complete", async () => {
    const manager = new AgentManager();
    manager.spawn({}, makeAgentDef(), { prompt: "task", cwd: "/tmp", isBackground: true });
    await manager.waitForAll();
    const agents = manager.listAgents();
    expect(agents.every(r => r.status !== "running" && r.status !== "queued")).toBe(true);
    manager.dispose();
  });
});

describe("resume", () => {
  it("returns undefined for unknown agent id", async () => {
    const manager = new AgentManager();
    const result = await manager.resume("nonexistent", "prompt");
    expect(result).toBeUndefined();
    manager.dispose();
  });

  it("returns undefined for agent with no session", async () => {
    const manager = new AgentManager();
    const { id } = await manager.spawnAndWait({}, makeAgentDef(), { prompt: "test", cwd: "/tmp" });
    // Clear session to simulate no session
    const record = manager.getRecord(id);
    if (record) record.session = undefined;
    const result = await manager.resume(id, "continue");
    expect(result).toBeUndefined();
    manager.dispose();
  });

  it("refuses a non-idle session without calling the runner", async () => {
    const { resumeAgent } = await import("../src/core/agent-runner.js");
    const manager = new AgentManager();
    const { id, record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });
    record.session = { isIdle: false };
    vi.mocked(resumeAgent).mockClear();

    expect(await manager.resume(id, "continue")).toBeUndefined();
    expect(resumeAgent).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("resets per-run state and repopulates live and cumulative state", async () => {
    const { resumeAgent } = await import("../src/core/agent-runner.js");
    const manager = new AgentManager();
    const { id, record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
      maxTurns: 5,
    });
    record.toolUses = 2;
    record.turnCount = 4;
    record.live = { activeTools: ["old"], responseText: "old", maxTurns: 5 };
    record.lifetimeUsage = { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 30 };
    vi.mocked(resumeAgent).mockImplementationOnce(async (_session, _prompt, options) => {
      expect(record.live).toEqual({ activeTools: [], responseText: "" });
      expect(record.turnCount).toBe(0);
      options?.onToolActivity?.({ type: "start", toolName: "read" });
      options?.onTextDelta?.("new", "new");
      options?.onTurnEnd?.();
      options?.onAssistantUsage?.({ input: 1, output: 2, cacheWrite: 3 });
      options?.onToolActivity?.({ type: "end", toolName: "read" });
      options?.onSettled?.();
      return "new";
    });

    await manager.resume(id, "continue");

    expect(record.live).toEqual({ activeTools: [], responseText: "new" });
    expect(record.turnCount).toBe(1);
    expect(record.toolUses).toBe(3);
    expect(record.lifetimeUsage).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheWriteTokens: 33,
    });
    manager.dispose();
  });
});

describe("spawn limits", () => {
  it("blocks spawn when limit reached", () => {
    const manager = new AgentManager(3);
    manager.setMaxSpawnsPerSession(2);
    // First two succeed
    manager.spawn({}, makeAgentDef(), {
      prompt: "task 1",
      cwd: "/tmp",
      isBackground: true,
    });
    manager.spawn({}, makeAgentDef(), {
      prompt: "task 2",
      cwd: "/tmp",
      isBackground: true,
    });
    // Third should fail
    expect(() =>
      manager.spawn({}, makeAgentDef(), {
        prompt: "task 3",
        cwd: "/tmp",
        isBackground: true,
      }),
    ).toThrow(/spawn limit/i);
    manager.dispose();
  });

  it("increments spawn counter on each spawn", () => {
    const manager = new AgentManager(3);
    expect(manager.getSpawnCount()).toBe(0);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(2);
    manager.dispose();
  });

  it("resetSpawnCounter resets to zero", () => {
    const manager = new AgentManager(3);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.resetSpawnCounter();
    expect(manager.getSpawnCount()).toBe(0);
    manager.dispose();
  });

  it("dispose resets spawn counter", () => {
    const manager = new AgentManager(3);
    manager.spawn({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.dispose();
    expect(manager.getSpawnCount()).toBe(0);
  });

  it("spawnAndWait also increments counter", async () => {
    const manager = new AgentManager(3);
    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "task",
      cwd: "/tmp",
    });
    expect(manager.getSpawnCount()).toBe(1);
    manager.dispose();
  });

  it("maxSpawnsPerSession = 0 blocks all spawns", () => {
    const manager = new AgentManager(3);
    manager.setMaxSpawnsPerSession(0);
    expect(() =>
      manager.spawn({}, makeAgentDef(), {
        prompt: "task",
        cwd: "/tmp",
        isBackground: true,
      }),
    ).toThrow(/spawn limit/i);
    manager.dispose();
  });

  it("resume does not increment spawn counter", async () => {
    const manager = new AgentManager(3);
    const { id } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });
    expect(manager.getSpawnCount()).toBe(1);
    await manager.resume(id, "continue");
    expect(manager.getSpawnCount()).toBe(1);
    manager.dispose();
  });
});

describe("registerExternalRecord / notifyComplete", () => {
  it("initializes external chain records with empty live state", () => {
    const manager = new AgentManager();
    const record = manager.fireAndForgetChain(
      "chain-live",
      "test",
      new Promise(() => {}),
      "/tmp",
    );

    expect(record.live).toEqual({ activeTools: [], responseText: "" });
    manager.dispose();
  });

  it("registerExternalRecord makes record visible via getRecord", () => {
    const manager = new AgentManager();
    const record = {
      id: "chain-abc",
      type: "(chain)",
      description: "Chain: test",
      status: "running" as const,
      startedAt: Date.now(),
      toolUses: 0,
      turnCount: 0,
      live: { activeTools: [], responseText: "" },
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      isBackground: true,
    };
    manager.registerExternalRecord("chain-abc", record);
    expect(manager.getRecord("chain-abc")).toBe(record);
    manager.dispose();
  });

  it("notifyComplete triggers onComplete callback with the record", () => {
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete);
    const record = {
      id: "chain-xyz",
      type: "(chain)",
      description: "Chain: bg test",
      status: "completed" as const,
      startedAt: Date.now(),
      completedAt: Date.now(),
      toolUses: 0,
      turnCount: 0,
      live: { activeTools: [], responseText: "" },
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      isBackground: true,
    };
    manager.registerExternalRecord("chain-xyz", record);
    manager.notifyComplete("chain-xyz");
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toBe(record);
    manager.dispose();
  });

  it("notifyComplete is a no-op for unknown id", () => {
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete);
    manager.notifyComplete("nonexistent");
    expect(onComplete).not.toHaveBeenCalled();
    manager.dispose();
  });
});

describe("per-agent maxDepth", () => {
  it("uses agent maxDepth when lower than global", () => {
    const manager = new AgentManager(5);
    const agentDef = makeAgentDef({ maxDepth: 2 });
    // Depth 2 should fail because 2 >= agent.maxDepth (2)
    expect(() =>
      manager.spawn({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 2,
        isBackground: true,
      }),
    ).toThrow(/nesting limit/i);
    manager.dispose();
  });

  it("allows spawn when depth is below agent maxDepth", () => {
    const manager = new AgentManager(5);
    const agentDef = makeAgentDef({ maxDepth: 3 });
    // Depth 1 should succeed (1 < 3)
    const id = manager.spawn({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 1,
      isBackground: true,
    });
    expect(id).toBeTruthy();
    manager.dispose();
  });

  it("uses global maxDepth when agent has no override", () => {
    const manager = new AgentManager(3);
    const agentDef = makeAgentDef(); // no maxDepth
    // Depth 2 should succeed (2 < 3)
    const id = manager.spawn({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 2,
      isBackground: true,
    });
    expect(id).toBeTruthy();
    manager.dispose();
  });

  it("uses global maxDepth when agent maxDepth is higher", () => {
    const manager = new AgentManager(2);
    const agentDef = makeAgentDef({ maxDepth: 5 });
    // Depth 2 should fail because 2 >= global maxDepth (2), even though agent allows 5
    expect(() =>
      manager.spawn({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        currentDepth: 2,
        isBackground: true,
      }),
    ).toThrow(/nesting limit/i);
    manager.dispose();
  });

  it("allowRecursion respects per-agent maxDepth, not global maxDepth", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    // Global maxDepth=3, agent maxDepth=1.
    // At currentDepth=0: effectiveMaxDepth=1, so (0+1) < 1 = false → allowRecursion=false.
    // Without the fix, this.maxDepth=3 is used: (0+1) < 3 = true → allowRecursion=true (WRONG).
    const manager = new AgentManager(3);
    const agentDef = makeAgentDef({ subagentAgents: ["helper"], maxDepth: 1 });
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 0,
    });
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({ allowRecursion: false }),
      expect.anything(),
    );
    manager.dispose();
  });
});
