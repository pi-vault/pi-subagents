import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createChildSubagentTool,
  createChildGetResultTool,
  createAgentCustomToolsFactory,
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
const execGet = (tool: ReturnType<typeof createChildGetResultTool>, params: Record<string, unknown>) =>
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

  it("gives the spawned child its own custom-tool factory", async () => {
    const spawn = vi.spyOn(manager, "spawn").mockReturnValue("child-1");
    await exec(
      makeSubagentTool(manager, {
        discovery: createDiscovery([createAgent({ subagentAgents: ["Scout"] })]),
      }),
      { agent: "Scout", task: "test" },
    );

    const options = spawn.mock.calls[0]?.[2];
    expect(options?.createCustomTools).toBeTypeOf("function");
    const tools = options?.createCustomTools?.({
      id: "child-1",
      cwd: "/tmp",
      allowRecursion: true,
    });
    expect(tools?.map((tool) => (tool as { name: string }).name)).toEqual([
      "subagent",
      "get_subagent_result",
    ]);

    spawn.mockRestore();
    const ownChild = manager.spawn({}, scout(), {
      prompt: "nested",
      cwd: "/tmp",
      isBackground: true,
      spawnedBy: "child-1",
    });
    const getResult = tools?.find(
      (tool) => (tool as { name: string }).name === "get_subagent_result",
    ) as ReturnType<typeof createChildGetResultTool>;
    const result = await execGet(getResult, { agent_id: ownChild });
    expect(result.content[0].text).not.toContain("Agent not found");
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

describe("createAgentCustomToolsFactory", () => {
  it("discovers agents lazily and returns recursion and intercom tools", () => {
    const manager = new AgentManager();
    const discoverAgents = vi.fn(() => createDiscovery([scout()]));
    const deps = createDeps({
      manager,
      discoverAgents,
      intercom: { sendRequest: vi.fn() } as never,
    });
    const factory = createAgentCustomToolsFactory(
      manager,
      deps,
      createAgent({ subagentAgents: ["Scout"], intercom: true }),
      1,
    );
    expect(discoverAgents).not.toHaveBeenCalled();

    const tools = factory({ id: "child-2", cwd: "/tmp", allowRecursion: true });

    expect(discoverAgents).toHaveBeenCalledOnce();
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      "subagent",
      "get_subagent_result",
      "contact_supervisor",
    ]);
  });

  it("returns only intercom for an intercom-only agent", () => {
    const manager = new AgentManager();
    const deps = createDeps({ manager, intercom: { sendRequest: vi.fn() } as never });
    const factory = createAgentCustomToolsFactory(
      manager,
      deps,
      createAgent({ intercom: true, subagentAgents: [] }),
      0,
    );

    expect(factory({ id: "agent-1", cwd: "/tmp", allowRecursion: false }))
      .toEqual([expect.objectContaining({ name: "contact_supervisor" })]);
  });
});

describe("createChildGetResultTool", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager();
  });

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
