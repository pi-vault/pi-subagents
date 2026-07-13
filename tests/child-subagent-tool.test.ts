import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createChildSubagentTool,
  createChildGetResultTool,
} from "../src/core/child-subagent-tool.js";
import { AgentManager } from "../src/core/agent-manager.js";
import { createAgent, createDeps, createDiscovery } from "./_test-helpers.js";

vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({
    responseText: "done",
    session: {},
    aborted: false,
    steered: false,
  }),
}));

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

const CTX = {} as never;
const scout = () => createAgent({ name: "Scout" });

function makeSubagentTool(
  manager: AgentManager,
  overrides: Record<string, unknown> = {},
) {
  const deps = createDeps({ manager });
  return createChildSubagentTool({
    manager,
    discovery: createDiscovery([scout()]),
    allowedAgents: ["Scout"],
    currentDepth: 1,
    parentCwd: "/tmp",
    parentAgentId: "parent-1",
    deps,
    ...overrides,
  });
}

const exec = (tool: ReturnType<typeof createChildSubagentTool>, params: Record<string, unknown>) =>
  tool.execute("tc-1", params as never, undefined, undefined, CTX) as unknown as Promise<ToolResult>;

describe("createChildSubagentTool", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager();
  });

  it("spawns an allowed agent in background", async () => {
    const result = await exec(makeSubagentTool(manager), { agent: "Scout", task: "find files" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Background agent started:");
  });

  it("rejects agent not in allowlist", async () => {
    const result = await exec(
      makeSubagentTool(manager, { allowedAgents: ["Writer"] }),
      { agent: "Scout", task: "find files" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowed");
  });

  it("rejects agent not found in discovery", async () => {
    const result = await exec(
      makeSubagentTool(manager, { allowedAgents: ["Ghost"], discovery: createDiscovery([]) }),
      { agent: "Ghost", task: "test" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found in discovery");
  });

  it("always spawns in background mode", async () => {
    await exec(makeSubagentTool(manager), { agent: "Scout", task: "test" });
    const agents = manager.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].isBackground).toBe(true);
  });

  it("sets spawnedBy on the record", async () => {
    await exec(makeSubagentTool(manager), { agent: "Scout", task: "test" });
    expect(manager.listAgents()[0].spawnedBy).toBe("parent-1");
  });

  it("passes incremented depth to spawn", async () => {
    const result = await exec(
      makeSubagentTool(manager, { currentDepth: 2 }),
      { agent: "Scout", task: "test" },
    );
    expect(result.isError).toBeUndefined();
  });

  it("returns error when depth limit exceeded", async () => {
    const shallow = new AgentManager(2);
    const result = await exec(
      makeSubagentTool(shallow, { manager: shallow, currentDepth: 2 }),
      { agent: "Scout", task: "test" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nesting limit");
  });

  it("is case-insensitive for agent names", async () => {
    const result = await exec(
      makeSubagentTool(manager, { allowedAgents: ["scout"] }),
      { agent: "SCOUT", task: "test" },
    );
    expect(result.isError).toBeUndefined();
  });
});

describe("createChildGetResultTool", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager();
  });

  const execGet = (tool: ReturnType<typeof createChildGetResultTool>, params: Record<string, unknown>) =>
    tool.execute("tc-1", params as never, undefined, undefined, CTX) as unknown as Promise<ToolResult>;

  it("returns result for agent spawned by parent", async () => {
    const { id } = await manager.spawnAndWait({}, scout(), { prompt: "test", cwd: "/tmp", spawnedBy: "parent-1" });
    const result = await execGet(createChildGetResultTool(manager, "parent-1"), { agent_id: id });
    expect(result.content[0].text).toContain("completed");
  });

  it("rejects agent not spawned by parent", async () => {
    const { id } = await manager.spawnAndWait({}, scout(), { prompt: "test", cwd: "/tmp" });
    const result = await execGet(createChildGetResultTool(manager, "parent-1"), { agent_id: id });
    expect(result.content[0].text).toContain("Agent not found");
  });

  it("rejects unknown agent id", async () => {
    const result = await execGet(createChildGetResultTool(manager, "parent-1"), { agent_id: "nonexistent" });
    expect(result.content[0].text).toContain("Agent not found");
  });

  it("waits for running agent when wait=true", async () => {
    const id = manager.spawn({}, scout(), { prompt: "test", cwd: "/tmp", isBackground: true, spawnedBy: "parent-1" });
    const result = await execGet(createChildGetResultTool(manager, "parent-1"), { agent_id: id, wait: true });
    expect(result.content[0].text).toContain("Status:");
  });

  it("sets resultConsumed on completed agent", async () => {
    const { id } = await manager.spawnAndWait({}, scout(), { prompt: "test", cwd: "/tmp", spawnedBy: "parent-1" });
    await execGet(createChildGetResultTool(manager, "parent-1"), { agent_id: id });
    expect(manager.getRecord(id)?.resultConsumed).toBe(true);
  });
});
