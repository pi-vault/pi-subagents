import { describe, expect, test, vi } from "vitest";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { AgentManager } from "../src/core/agent-manager.js";
import { registerSubagentTool } from "../src/core/subagent.js";
import {
  CTX,
  completedRecord,
  createAgent,
  createDeps,
  createDiscovery,
  createPi,
  emptyUsage,
  executeTool,
} from "./_test-helpers.js";

// ---------------------------------------------------------------------------
// chain dispatch
// ---------------------------------------------------------------------------

describe("chain mode dispatch", () => {
  test("TypeBox accepts sequential, static parallel, and dynamic parallel chain shapes", () => {
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, createDeps());
    const schema = registeredTool().parameters as TSchema;

    for (const chain of [
      [{ agent: "Scout", task: "scan", acceptance: { description: "done" } }],
      [{ parallel: [{ agent: "Scout", count: 2, toolBudget: { hard: 3 } }] }],
      [
        {
          expand: { from: { output: "targets", path: "/items" } },
          parallel: { agent: "Scout", outputSchema: { type: "object" } },
          collect: { as: "results", outputSchema: { type: "array" } },
        },
      ],
    ]) {
      expect(Value.Check(schema, { task: "work", chain })).toBe(true);
    }
  });

  test("outer schema admits malformed chain structure for domain validation", async () => {
    const manager = new AgentManager();
    const background = vi.spyOn(manager, "fireAndForgetChain");
    const spawn = vi.spyOn(manager, "spawnAndWait");
    const deps = createDeps({ manager });
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, deps);
    const tool = registeredTool();
    const params = { task: "work", chain: [{}], run_in_background: true };

    expect(Value.Check(tool.parameters as TSchema, params)).toBe(true);
    const result = (await tool.execute("tc-1", params, undefined, undefined, CTX)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("agent must be a non-blank string");
    expect(background).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test("rejects an empty static parallel definition without dispatch", async () => {
    const manager = new AgentManager();
    const background = vi.spyOn(manager, "fireAndForgetChain");
    const spawn = vi.spyOn(manager, "spawnAndWait");
    const result = await executeTool(createDeps({ manager }), {
      task: "work",
      chain: [{ parallel: [] }],
      run_in_background: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("parallel must be a non-empty array");
    expect(background).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test("dispatches to executeChain and returns success", async () => {
    const manager = new AgentManager();
    vi.spyOn(manager, "spawnAndWait").mockResolvedValue({
      id: "step-1",
      record: {
        id: "step-1",
        type: "subagent",
        description: "chain step",
        status: "completed",
        startedAt: 1000,
        durationMs: 10,
        result: "step output",
        error: undefined,
        toolUses: 0,
        turnCount: 0,
        live: { activeTools: [], responseText: "" },
        lifetimeUsage: emptyUsage(),
      },
    });

    const deps = createDeps({ manager });
    const result = await executeTool(deps, {
      task: "do stuff",
      chain: [{ agent: "Scout", task: "explore {task}" }],
    });

    expect(result.isError).toBe(false);
    expect(result.details.agent).toBe("(chain)");
    expect(result.details.status).toBe("success");
  });

  test("returns error details when executeChain throws", async () => {
    const deps = createDeps({
      discoverAgents: () => createDiscovery([]),
    });
    const result = await executeTool(deps, {
      task: "do stuff",
      chain: [{ task: "explore" }],
    });

    expect(result.isError).toBe(true);
    expect(result.details.status).toBe("error");
    expect(result.details.agent).toBe("(chain)");
    expect(result.details.stopReason).toBe("error");
    expect(typeof result.content[0]?.text).toBe("string");
  });

  test("returns error when chain step agent is unknown", async () => {
    const manager = new AgentManager();
    const background = vi.spyOn(manager, "fireAndForgetChain");
    const deps = createDeps({
      manager,
      discoverAgents: () => createDiscovery([createAgent()]),
    });
    const result = await executeTool(deps, {
      task: "do stuff",
      chain: [{ agent: "NonExistent", task: "explore" }],
      run_in_background: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown agent");
    expect(background).not.toHaveBeenCalled();
  });

  test("rejects invalid clarification edits before execution", async () => {
    const manager = new AgentManager();
    const spawn = vi.spyOn(manager, "spawnAndWait");
    const deps = createDeps({ manager });
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, deps);
    const ctx = {
      ...CTX,
      ui: {
        custom: async () => ({ action: "run", steps: [{ task: "missing agent" }] }),
      },
    };

    const result = (await registeredTool().execute(
      "tc-1",
      { task: "work", chain: [{ agent: "Scout" }], clarify: true },
      undefined,
      undefined,
      ctx,
    )) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("agent must be a non-blank string");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("rejects invalid clarification output references before execution", async () => {
    const manager = new AgentManager();
    const spawn = vi.spyOn(manager, "spawnAndWait");
    const deps = createDeps({ manager });
    const { pi, registeredTool } = createPi();
    registerSubagentTool(pi, deps);
    const ctx = {
      ...CTX,
      ui: {
        custom: async () => ({
          action: "run",
          steps: [{ agent: "Scout", task: "use {outputs.missing}" }],
        }),
      },
    };

    const result = (await registeredTool().execute(
      "tc-1",
      { task: "work", chain: [{ agent: "Scout" }], clarify: true },
      undefined,
      undefined,
      ctx,
    )) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("outputs.missing");
    expect(spawn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chain_append dispatch
// ---------------------------------------------------------------------------

describe("chain_append dispatch", () => {
  test("enqueues steps and returns success", async () => {
    const manager = new AgentManager();
    manager.registerExternalRecord("chain-abc", {
      id: "chain-abc",
      type: "(chain)",
      description: "Chain: test",
      status: "running",
      toolUses: 0,
      turnCount: 0,
      live: { activeTools: [], responseText: "" },
      startedAt: Date.now(),
      lifetimeUsage: emptyUsage(),
      isBackground: true,
      chainDefinition: [{ agent: "Scout" }],
      acceptsChainAppends: true,
    });
    const deps = createDeps({ manager });
    const result = await executeTool(deps, {
      task: "",
      chain_append: {
        chain_id: "chain-abc",
        steps: [{ agent: "Scout", task: "more work" }],
      },
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain("chain-abc");
    expect(result.details.status).toBe("success");
    manager.dispose();
  });

  test("a background chain consumes an appended batch", async () => {
    const manager = new AgentManager();
    let release!: () => void;
    const first = new Promise<{ id: string; record: ReturnType<typeof completedRecord> }>((resolve) => {
      release = () => resolve({ id: "step-1", record: completedRecord("first") });
    });
    const spawn = vi.spyOn(manager, "spawnAndWait")
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ id: "step-2", record: completedRecord("second") });
    const deps = createDeps({ manager });

    const started = await executeTool(deps, {
      task: "work",
      chain: [{ agent: "Scout", as: "first" }],
      run_in_background: true,
    });
    const chainId = started.content[0]?.text.match(/Chain ID: (\S+)/)?.[1];
    expect(chainId).toBeTruthy();
    if (!chainId) throw new Error("background chain ID missing");

    const appended = await executeTool(deps, {
      task: "",
      chain_append: {
        chain_id: chainId,
        steps: [{ agent: "Scout", task: "use {outputs.first}" }],
      },
    });
    expect(appended.isError).toBe(false);

    release();
    await vi.waitFor(() => expect(manager.getRecord(chainId)?.status).toBe("completed"));
    expect(spawn).toHaveBeenCalledTimes(2);
    manager.dispose();
  });
});

// ---------------------------------------------------------------------------
// missing agent guard
// ---------------------------------------------------------------------------

describe("missing agent guard", () => {
  test("returns error when neither agent nor chain provided", async () => {
    const deps = createDeps();
    const result = await executeTool(deps, { task: "do stuff" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Missing 'agent'");
  });
});
