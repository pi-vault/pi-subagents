import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import type { AgentDefinition, AgentRecord } from "../src/shared/types.js";
import { cleanupWorktree, createWorktree } from "../src/core/worktree.js";

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

vi.mock("../src/core/worktree.js", () => ({
  createWorktree: vi.fn().mockReturnValue(undefined),
  cleanupWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
}));

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function expectTerminal(record: ReturnType<AgentManager["getRecord"]>, status: string) {
  expect(record?.status).toBe(status);
  expect(record?.completedAt).toBeTypeOf("number");
  expect(record?.durationMs).toBe((record?.completedAt ?? 0) - (record?.startedAt ?? 0));
  expect(record?.live.activeTools).toEqual([]);
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

    expect(record.live.activeTools).toEqual([]);
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
      onActivity: (record) =>
        snapshots.push({
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
      { tools: [], text: "hi", turns: 1, input: 2 },
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
        release = () =>
          resolve({
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

  it("creates customTools once with the generated id, cwd, and recursion flag", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const agentDef = makeAgentDef({ subagentAgents: ["helper"] });
    const tools = [{ name: "factory-tool" }];
    const createCustomTools = vi.fn().mockReturnValue(tools);
    await manager.spawnAndWait({}, agentDef, {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 0,
      createCustomTools,
    });
    const id = manager.listAgents()[0]?.id;
    expect(createCustomTools).toHaveBeenCalledOnce();
    expect(createCustomTools).toHaveBeenCalledWith({ id, cwd: "/tmp", allowRecursion: true });
    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      agentDef,
      expect.objectContaining({
        allowRecursion: true,
        customTools: tools,
      }),
      expect.anything(),
    );
  });

  it("passes empty customTools when no factory is supplied", async () => {
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

  it("creates tools with the worktree cwd", async () => {
    vi.mocked(createWorktree).mockReturnValueOnce({
      path: "/tmp/repo/.git/worktrees/agent",
      branch: "agent/test",
      baseSha: "abc123",
      workPath: "/tmp/worktree",
    });
    const createCustomTools = vi.fn().mockReturnValue([]);

    await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
      isolation: "worktree",
      createCustomTools,
    });

    expect(createCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/worktree" }),
    );
  });

  it("tells the factory when recursion is blocked at the depth limit", async () => {
    const createCustomTools = vi.fn().mockReturnValue([]);
    await manager.spawnAndWait({}, makeAgentDef({ subagentAgents: ["helper"] }), {
      prompt: "test",
      cwd: "/tmp",
      currentDepth: 2,
      createCustomTools,
    });

    expect(createCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({ allowRecursion: false }),
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
    vi.spyOn(await import("../src/core/agent-runner.js"), "runAgent").mockResolvedValue({
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
    expect(agents.every((r) => r.status !== "running" && r.status !== "queued")).toBe(true);
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

describe("external chain lifecycle", () => {
  it("initializes external chain records with empty live state", () => {
    const manager = new AgentManager();
    const record = manager.fireAndForgetChain(
      "chain-live",
      "test",
      [],
      "/tmp",
      () => new Promise(() => {}),
    );

    expect(record.live).toEqual({ activeTools: [], responseText: "" });
    manager.dispose();
  });

  it("registers a copied chain definition before starting execution", () => {
    const manager = new AgentManager();
    const definition = [{ agent: "Scout", task: "work" }];
    const start = vi.fn(() => {
      const record = manager.getRecord("chain-visible");
      expect(record?.chainDefinition).toEqual(definition);
      expect(record?.chainDefinition).not.toBe(definition);
      return new Promise<{ content: string; isError: boolean }>(() => {});
    });

    manager.fireAndForgetChain("chain-visible", "test", definition, "/tmp", start);

    expect(start).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it("clears chain append requests when background execution settles", async () => {
    const { countPendingChainAppendRequests, enqueueChainAppendRequest } = await import(
      "../src/core/chain-append.js"
    );
    const manager = new AgentManager();
    let finish!: (result: { content: string; isError: boolean }) => void;
    manager.fireAndForgetChain(
      "chain-cleanup",
      "test",
      [{ agent: "Scout" }],
      "/tmp",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    enqueueChainAppendRequest(manager, "chain-cleanup", [{ agent: "Scout" }], () => makeAgentDef());

    finish({ content: "done", isError: false });
    await vi.waitFor(() => expect(manager.getRecord("chain-cleanup")?.status).toBe("completed"));

    expect(countPendingChainAppendRequests("chain-cleanup")).toBe(0);
    manager.dispose();
  });

  it("clears chain append requests when a background chain is aborted", async () => {
    const { countPendingChainAppendRequests, enqueueChainAppendRequest } = await import(
      "../src/core/chain-append.js"
    );
    const manager = new AgentManager();
    manager.fireAndForgetChain(
      "chain-abort-cleanup",
      "test",
      [{ agent: "Scout" }],
      "/tmp",
      () => new Promise(() => {}),
    );
    enqueueChainAppendRequest(manager, "chain-abort-cleanup", [{ agent: "Scout" }], () =>
      makeAgentDef(),
    );
    const record = manager.getRecord("chain-abort-cleanup");
    const definitionLength = record?.chainDefinition?.length;

    expect(manager.abort("chain-abort-cleanup")).toBe(true);
    expect(() =>
      enqueueChainAppendRequest(manager, "chain-abort-cleanup", [{ agent: "Scout" }], () =>
        makeAgentDef(),
      ),
    ).toThrow();
    expect(record?.chainDefinition).toHaveLength(definitionLength ?? 0);
    expect(countPendingChainAppendRequests("chain-abort-cleanup")).toBe(0);
    manager.dispose();
  });
});

describe("centralized lifecycle finalization", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    const { runAgent, resumeAgent } = await import("../src/core/agent-runner.js");
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "done",
      session: { isIdle: true },
      aborted: false,
      steered: false,
    });
    vi.mocked(resumeAgent).mockResolvedValue("resumed");
    vi.mocked(createWorktree).mockReturnValue(undefined);
    vi.mocked(cleanupWorktree).mockReturnValue({ hasChanges: false });
  });

  it.each([
    { name: "success", reject: undefined, status: "completed", result: "done" },
    {
      name: "runner rejection",
      reject: new Error("runner failed"),
      status: "error",
      result: undefined,
    },
    {
      name: "output cleanup failure",
      reject: undefined,
      status: "completed",
      result: "done",
      outputFailure: true,
    },
    {
      name: "worktree cleanup failure",
      reject: undefined,
      status: "completed",
      result: "done",
      worktreeFailure: true,
    },
  ])(
    "finalizes a normal agent once after $name",
    async ({ reject, status, result, outputFailure, worktreeFailure }) => {
      const { runAgent } = await import("../src/core/agent-runner.js");
      const run = deferred<{
        responseText: string;
        session: { isIdle: boolean };
        aborted: boolean;
        steered: boolean;
      }>();
      vi.mocked(runAgent).mockReturnValueOnce(run.promise);
      if (worktreeFailure) {
        vi.mocked(createWorktree).mockReturnValueOnce({
          path: "/tmp/worktree-meta",
          branch: "agent/test",
          baseSha: "base",
          workPath: "/tmp/worktree",
        });
        vi.mocked(cleanupWorktree).mockImplementationOnce(() => {
          throw new Error("cleanup failed");
        });
      }
      const onComplete = vi.fn();
      const manager = new AgentManager(3, onComplete, 1);
      const id = manager.spawn({}, makeAgentDef(), {
        prompt: "first",
        cwd: "/tmp",
        isBackground: true,
        isolation: worktreeFailure ? "worktree" : undefined,
      });
      const record = manager.getRecord(id);
      if (!record) throw new Error("spawned record missing");
      record.live.activeTools = ["bash"];
      if (outputFailure)
        record.outputCleanup = () => {
          throw new Error("flush failed");
        };

      if (reject) run.reject(reject);
      else
        run.resolve({
          responseText: "done",
          session: { isIdle: true },
          aborted: false,
          steered: false,
        });
      await record?.promise;

      expectTerminal(record, status);
      expect(record?.result).toBe(result);
      expect(record?.error).toBe(reject?.message);
      expect(record?.outputCleanup).toBeUndefined();
      expect(onComplete).toHaveBeenCalledOnce();
      const next = manager.spawn({}, makeAgentDef(), {
        prompt: "next",
        cwd: "/tmp",
        isBackground: true,
      });
      expect(manager.getRecord(next)?.status).toBe("running");
      manager.dispose();
    },
  );

  it("removes an immediate setup failure and restores the spawn budget", () => {
    vi.mocked(createWorktree).mockReturnValueOnce({
      path: "/tmp/worktree-meta",
      branch: "agent/test",
      baseSha: "base",
      workPath: "/tmp/worktree",
    });
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete, 1);

    expect(() =>
      manager.spawn({}, makeAgentDef(), {
        prompt: "fail setup",
        cwd: "/tmp",
        isBackground: true,
        isolation: "worktree",
        createCustomTools: () => {
          throw new Error("tool factory failed");
        },
      }),
    ).toThrow("tool factory failed");

    expect(manager.listAgents()).toEqual([]);
    expect(manager.getSpawnCount()).toBe(0);
    expect(cleanupWorktree).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    const next = manager.spawn({}, makeAgentDef(), {
      prompt: "next",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getRecord(next)?.status).toBe("running");
    manager.dispose();
  });

  it("finalizes a queued setup failure and continues draining", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const first = deferred<{
      responseText: string;
      session: { isIdle: boolean };
      aborted: boolean;
      steered: boolean;
    }>();
    vi.mocked(runAgent).mockReturnValueOnce(first.promise);
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete, 1);
    const firstId = manager.spawn({}, makeAgentDef(), {
      prompt: "first",
      cwd: "/tmp",
      isBackground: true,
    });
    const failedId = manager.spawn({}, makeAgentDef(), {
      prompt: "fail setup",
      cwd: "/tmp",
      isBackground: true,
      createCustomTools: () => {
        throw new Error("queued setup failed");
      },
    });
    const thirdId = manager.spawn({}, makeAgentDef(), {
      prompt: "third",
      cwd: "/tmp",
      isBackground: true,
    });
    const queuedRecord = manager.getRecord(failedId);
    if (!queuedRecord) throw new Error("queued record missing");
    const queuedStartedAt = queuedRecord.startedAt;
    await new Promise((resolve) => setTimeout(resolve, 2));

    first.resolve({
      responseText: "done",
      session: { isIdle: true },
      aborted: false,
      steered: false,
    });
    await manager.getRecord(firstId)?.promise;
    await vi.waitFor(() => expect(manager.getRecord(thirdId)?.status).not.toBe("queued"));

    const failed = manager.getRecord(failedId);
    expect(failed?.startedAt).toBeGreaterThan(queuedStartedAt);
    expectTerminal(failed, "error");
    expect(failed?.error).toBe("queued setup failed");
    expect(onComplete.mock.calls.filter(([completed]) => completed.id === failedId)).toHaveLength(
      1,
    );
    manager.dispose();
  });

  it("stops a queued agent without notifying or consuming a slot", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const first = deferred<{
      responseText: string;
      session: { isIdle: boolean };
      aborted: boolean;
      steered: boolean;
    }>();
    vi.mocked(runAgent).mockReturnValueOnce(first.promise);
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete, 1);
    const firstId = manager.spawn({}, makeAgentDef(), {
      prompt: "first",
      cwd: "/tmp",
      isBackground: true,
    });
    const stoppedId = manager.spawn({}, makeAgentDef(), {
      prompt: "stop",
      cwd: "/tmp",
      isBackground: true,
    });

    expect(manager.abort(stoppedId)).toBe(true);
    expectTerminal(manager.getRecord(stoppedId), "stopped");
    expect(onComplete).not.toHaveBeenCalled();

    first.resolve({
      responseText: "done",
      session: { isIdle: true },
      aborted: false,
      steered: false,
    });
    await manager.getRecord(firstId)?.promise;
    const next = manager.spawn({}, makeAgentDef(), {
      prompt: "next",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getRecord(next)?.status).toBe("running");
    manager.dispose();
  });

  it("immediately stops a running normal agent but retains its slot and status until settlement", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const run = deferred<{
      responseText: string;
      session: { isIdle: boolean };
      aborted: boolean;
      steered: boolean;
    }>();
    vi.mocked(runAgent).mockReturnValueOnce(run.promise);
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete, 1);
    const id = manager.spawn({}, makeAgentDef(), {
      prompt: "first",
      cwd: "/tmp",
      isBackground: true,
    });
    const queuedId = manager.spawn({}, makeAgentDef(), {
      prompt: "queued",
      cwd: "/tmp",
      isBackground: true,
    });
    const runningRecord = manager.getRecord(id);
    if (!runningRecord) throw new Error("running record missing");
    runningRecord.live.activeTools = ["bash"];

    expect(manager.abort(id)).toBe(true);
    expectTerminal(manager.getRecord(id), "stopped");
    expect(manager.getRecord(queuedId)?.status).toBe("queued");
    expect(onComplete).not.toHaveBeenCalled();
    let waited = false;
    const waiting = manager.waitForAll().then(() => {
      waited = true;
    });
    await Promise.resolve();
    expect(waited).toBe(false);

    run.resolve({
      responseText: "late result",
      session: { isIdle: true },
      aborted: true,
      steered: false,
    });
    await manager.getRecord(id)?.promise;
    expectTerminal(manager.getRecord(id), "stopped");
    expect(manager.getRecord(id)?.result).toBe("late result");
    expect(manager.getRecord(id)?.error).toBeUndefined();
    expect(onComplete.mock.calls.filter(([completed]) => completed.id === id)).toHaveLength(1);
    await waiting;
    manager.dispose();
  });

  it("retains a stopped unsettled agent until finalization releases its slot", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const run = deferred<{
      responseText: string;
      session: { isIdle: boolean };
      aborted: boolean;
      steered: boolean;
    }>();
    vi.mocked(runAgent).mockReturnValueOnce(run.promise);
    const manager = new AgentManager(3, undefined, 1);
    const firstId = manager.spawn({}, makeAgentDef(), {
      prompt: "first",
      cwd: "/tmp",
      isBackground: true,
    });
    const secondId = manager.spawn({}, makeAgentDef(), {
      prompt: "second",
      cwd: "/tmp",
      isBackground: true,
    });

    expect(manager.abort(firstId)).toBe(true);
    manager.clearCompleted();
    expect(manager.getRecord(firstId)?.status).toBe("stopped");
    expect(manager.getRecord(secondId)?.status).toBe("queued");

    run.resolve({
      responseText: "late",
      session: { isIdle: true },
      aborted: true,
      steered: false,
    });
    await manager.getRecord(firstId)?.promise;
    await vi.waitFor(() => expect(manager.getRecord(secondId)?.status).not.toBe("queued"));
    manager.clearCompleted();
    expect(manager.getRecord(firstId)).toBeUndefined();
    manager.dispose();
  });

  it("releases capacity before notifying completion observers", async () => {
    const { runAgent } = await import("../src/core/agent-runner.js");
    const run = deferred<{
      responseText: string;
      session: { isIdle: boolean };
      aborted: boolean;
      steered: boolean;
    }>();
    vi.mocked(runAgent).mockReturnValueOnce(run.promise);
    let firstId = "";
    let secondId = "";
    let secondStatusAtCallback: string | undefined;
    const manager = new AgentManager(3, (record) => {
      if (record.id === firstId) secondStatusAtCallback = manager.getRecord(secondId)?.status;
    }, 1);
    firstId = manager.spawn({}, makeAgentDef(), {
      prompt: "first",
      cwd: "/tmp",
      isBackground: true,
    });
    secondId = manager.spawn({}, makeAgentDef(), {
      prompt: "second",
      cwd: "/tmp",
      isBackground: true,
    });

    run.resolve({
      responseText: "done",
      session: { isIdle: true },
      aborted: false,
      steered: false,
    });
    await manager.getRecord(firstId)?.promise;

    expect(secondStatusAtCallback).not.toBe("queued");
    manager.dispose();
  });

  it("keeps terminal state and exact-once notification when onComplete throws", async () => {
    const onComplete = vi.fn((_record: AgentRecord) => {
      throw new Error("renderer failed");
    });
    const manager = new AgentManager(3, onComplete);
    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });

    expectTerminal(record, "completed");
    expect(onComplete.mock.calls.filter(([completed]) => completed.id === record.id)).toHaveLength(
      1,
    );
    manager.dispose();
  });

  it("does not let onStart prevent execution", async () => {
    const onStart = vi.fn(() => {
      throw new Error("renderer failed");
    });
    const manager = new AgentManager(3, undefined, 4, onStart);
    const { record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });
    expectTerminal(record, "completed");
    expect(onStart).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it.each([
    {
      name: "completion",
      value: { content: "done", isError: false },
      reject: undefined,
      status: "completed",
    },
    {
      name: "error result",
      value: { content: "bad", isError: true },
      reject: undefined,
      status: "error",
    },
    { name: "rejection", value: undefined, reject: new Error("chain failed"), status: "error" },
  ])(
    "finalizes Chain $name once without consuming a normal background slot",
    async ({ value, reject, status }) => {
      const chain = deferred<{ content: string; isError: boolean }>();
      const onComplete = vi.fn();
      const manager = new AgentManager(3, onComplete, 1);
      const record = manager.fireAndForgetChain("chain", "test", [], "/tmp", () => chain.promise);
      const normalId = manager.spawn({}, makeAgentDef(), {
        prompt: "normal",
        cwd: "/tmp",
        isBackground: true,
      });
      expect(manager.getRecord(normalId)?.status).toBe("running");
      record.live.activeTools = ["chain-tool"];

      if (reject) chain.reject(reject);
      else if (value) chain.resolve(value);
      else throw new Error("Chain test outcome missing");
      await record.promise;

      expectTerminal(record, status);
      expect(record.result).toBe(value?.content);
      expect(record.error).toBe(reject?.message ?? (value?.isError ? value.content : undefined));
      expect(
        onComplete.mock.calls.filter(([completed]) => completed.id === record.id),
      ).toHaveLength(1);
      manager.dispose();
    },
  );

  it("finalizes an aborted Chain after settlement", async () => {
    const chain = deferred<{ content: string; isError: boolean }>();
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete);
    const record = manager.fireAndForgetChain(
      "chain-abort",
      "test",
      [],
      "/tmp",
      () => chain.promise,
    );
    const normalId = manager.spawn({}, makeAgentDef(), {
      prompt: "normal",
      cwd: "/tmp",
      isBackground: true,
    });
    expect(manager.getRecord(normalId)?.status).toBe("running");

    expect(manager.abort(record.id)).toBe(true);
    expect(record.status).toBe("running");
    chain.resolve({ content: "aborted output", isError: false });
    await record.promise;

    expectTerminal(record, "aborted");
    expect(record.result).toBe("aborted output");
    expect(record.error).toBeUndefined();
    expect(onComplete.mock.calls.filter(([completed]) => completed.id === record.id)).toHaveLength(1);
    manager.dispose();
  });

  it("keeps Chain status and exact-once notification when onClear throws", async () => {
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete);
    const record = manager.fireAndForgetChain(
      "chain-clear",
      "test",
      [],
      "/tmp",
      async () => ({ content: "done", isError: false }),
      () => {
        throw new Error("clear failed");
      },
    );
    await record.promise;

    expectTerminal(record, "completed");
    expect(onComplete).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it.each([
    { name: "completion", reject: undefined, abort: false, status: "completed" },
    { name: "error", reject: new Error("resume failed"), abort: false, status: "error" },
    { name: "abort", reject: new Error("aborted"), abort: true, status: "aborted" },
  ])(
    "finalizes resume $name with current promise and duration",
    async ({ reject, abort, status }) => {
      const { resumeAgent } = await import("../src/core/agent-runner.js");
      const onComplete = vi.fn();
      const manager = new AgentManager(3, onComplete);
      const { id, record } = await manager.spawnAndWait({}, makeAgentDef(), {
        prompt: "test",
        cwd: "/tmp",
      });
      const resumed = deferred<string>();
      onComplete.mockClear();
      vi.mocked(resumeAgent).mockReturnValueOnce(resumed.promise);
      const externalAbort = new AbortController();
      const resume = manager.resume(id, "continue", externalAbort.signal);
      const currentPromise = record.promise;
      record.live.activeTools = ["read"];
      if (abort) externalAbort.abort();
      if (reject) resumed.reject(reject);
      else resumed.resolve("resumed output");
      await resume;

      expect(record.promise).toBe(currentPromise);
      expectTerminal(record, status);
      expect(record.result).toBe(abort || reject ? undefined : "resumed output");
      expect(record.error).toBe(abort ? undefined : reject?.message);
      expect(onComplete).not.toHaveBeenCalled();
      manager.dispose();
    },
  );

  it.each([
    { name: "completion", reject: undefined, abort: false },
    { name: "error", reject: new Error("resume failed"), abort: false },
    { name: "abort", reject: new Error("aborted"), abort: true },
  ])("removes the forwarded resume abort listener after $name", async ({ reject, abort }) => {
    const { resumeAgent } = await import("../src/core/agent-runner.js");
    const manager = new AgentManager();
    const { id } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });
    const resumed = deferred<string>();
    vi.mocked(resumeAgent).mockReturnValueOnce(resumed.promise);
    const externalAbort = new AbortController();
    const add = vi.spyOn(externalAbort.signal, "addEventListener");
    const remove = vi.spyOn(externalAbort.signal, "removeEventListener");

    const resume = manager.resume(id, "continue", externalAbort.signal);
    const abortRegistration = add.mock.calls.find(([type]) => type === "abort");
    if (!abortRegistration) throw new Error("resume abort listener missing");
    if (abort) externalAbort.abort();
    if (reject) resumed.reject(reject);
    else resumed.resolve("resumed");
    await resume;

    expect(remove).toHaveBeenCalledWith("abort", abortRegistration[1]);
    manager.dispose();
  });

  it("manager abort immediately stops a resumed agent without late replacement", async () => {
    const { resumeAgent } = await import("../src/core/agent-runner.js");
    const onComplete = vi.fn();
    const manager = new AgentManager(3, onComplete);
    const { id, record } = await manager.spawnAndWait({}, makeAgentDef(), {
      prompt: "test",
      cwd: "/tmp",
    });
    const resumed = deferred<string>();
    onComplete.mockClear();
    vi.mocked(resumeAgent).mockReturnValueOnce(resumed.promise);
    const resume = manager.resume(id, "continue");

    expect(manager.abort(id)).toBe(true);
    expectTerminal(record, "stopped");
    resumed.reject(new Error("aborted"));
    await resume;

    expectTerminal(record, "stopped");
    expect(record.error).toBeUndefined();
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
