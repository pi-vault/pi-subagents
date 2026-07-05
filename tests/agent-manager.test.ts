import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import type { AgentDefinition } from "../src/shared/types.js";

// Mock the runner
vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: {},
    aborted: false,
    steered: false,
  }),
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
