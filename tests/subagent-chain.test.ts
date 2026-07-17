import { describe, expect, test, vi } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import {
  createAgent,
  createDeps,
  createDiscovery,
  emptyUsage,
  executeTool,
} from "./_test-helpers.js";

// ---------------------------------------------------------------------------
// chain dispatch
// ---------------------------------------------------------------------------

describe("chain mode dispatch", () => {
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
    const deps = createDeps({
      discoverAgents: () => createDiscovery([createAgent()]),
    });
    const result = await executeTool(deps, {
      task: "do stuff",
      chain: [{ agent: "NonExistent", task: "explore" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown agent");
  });
});

// ---------------------------------------------------------------------------
// chain_append dispatch
// ---------------------------------------------------------------------------

describe("chain_append dispatch", () => {
  test("enqueues steps and returns success", async () => {
    const deps = createDeps();
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
