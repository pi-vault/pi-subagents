import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveById, waitForSpecific, waitForAll, waitForAny, registerWaitTool } from "../src/core/wait.js";
import { AgentManager } from "../src/core/agent-manager.js";
import { createAgent, createPi } from "./_test-helpers.js";

vi.mock("../src/core/agent-runner.js", () => ({
  runAgent: vi.fn(),
}));

const defaultRunAgent = () =>
  new Promise((resolve) =>
    setTimeout(
      () => resolve({ responseText: "done", session: {}, aborted: false, steered: false }),
      10,
    ),
  );

describe("wait tool", () => {
  let manager: AgentManager;

  beforeEach(async () => {
    // Reset mock implementation to default (resolves in 10ms)
    const { runAgent } = await import("../src/core/agent-runner.js");
    (runAgent as ReturnType<typeof vi.fn>).mockImplementation(defaultRunAgent);
    manager = new AgentManager();
  });

  describe("resolveById", () => {
    it("finds agent by exact id", async () => {
      const agentDef = createAgent();
      const { id } = await manager.spawnAndWait({}, agentDef, { prompt: "test", cwd: "/tmp" });
      const result = resolveById(manager, id);
      expect(typeof result).not.toBe("string");
      expect((result as { id: string }).id).toBe(id);
    });

    it("finds agent by unambiguous prefix", async () => {
      const agentDef = createAgent();
      const { id } = await manager.spawnAndWait({}, agentDef, { prompt: "test", cwd: "/tmp" });
      const prefix = id.slice(0, 8);
      const result = resolveById(manager, prefix);
      expect(typeof result).not.toBe("string");
      expect((result as { id: string }).id).toBe(id);
    });

    it("returns error string for unknown id", () => {
      const result = resolveById(manager, "nonexistent");
      expect(result).toBe("Agent not found: nonexistent");
    });

    it("returns error for ambiguous prefix", async () => {
      const agentDef = createAgent();
      await manager.spawnAndWait({}, agentDef, { prompt: "test 1", cwd: "/tmp" });
      await manager.spawnAndWait({}, agentDef, { prompt: "test 2", cwd: "/tmp" });
      const ids = manager.listAgents().map((r) => r.id);
      // IDs share "agent-" prefix from generateId()
      let prefix = "";
      for (let i = 0; i < Math.min(ids[0].length, ids[1].length); i++) {
        if (ids[0][i] === ids[1][i]) prefix += ids[0][i];
        else break;
      }
      expect(prefix.length).toBeGreaterThan(0);
      const result = resolveById(manager, prefix);
      expect(typeof result).toBe("string");
      expect(result as string).toContain("Ambiguous prefix");
    });
  });

  describe("waitForSpecific", () => {
    it("waits for a pending background Chain", async () => {
      let finish!: (result: { content: string; isError: boolean }) => void;
      const record = manager.fireAndForgetChain(
        "chain-wait-specific",
        "work",
        [{ agent: "Scout" }],
        "/tmp",
        () => new Promise((resolve) => { finish = resolve; }),
      );
      let settled = false;
      const waiting = waitForSpecific(manager, record.id, 5000).then((result) => {
        settled = true;
        return result;
      });

      await Promise.resolve();
      expect(settled).toBe(false);
      finish({ content: "done", isError: false });

      const result = await waiting;
      expect(JSON.parse(result.content[0].text).completed[0].status).toBe("completed");
    });

    it("returns immediately if agent already completed", async () => {
      const agentDef = createAgent();
      const { id } = await manager.spawnAndWait({}, agentDef, { prompt: "test", cwd: "/tmp" });

      const result = await waitForSpecific(manager, id, 5000);
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toHaveLength(1);
      expect(data.completed[0].id).toBe(id);
      expect(data.completed[0].status).toBe("completed");
    });

    it("waits for running agent to complete", async () => {
      const agentDef = createAgent();
      const id = manager.spawn({}, agentDef, { prompt: "test", cwd: "/tmp", isBackground: true });

      const result = await waitForSpecific(manager, id, 5000);
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toHaveLength(1);
      expect(data.completed[0].id).toBe(id);
    });

    it("returns error for unknown id", async () => {
      const result = await waitForSpecific(manager, "nonexistent", 5000);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Agent not found");
    });

    it("sets resultConsumed on completed agent", async () => {
      const agentDef = createAgent();
      const { id } = await manager.spawnAndWait({}, agentDef, { prompt: "test", cwd: "/tmp" });

      await waitForSpecific(manager, id, 5000);
      expect(manager.getRecord(id)?.resultConsumed).toBe(true);
    });

    it("times out for stuck agent", async () => {
      const { runAgent } = await import("../src/core/agent-runner.js");
      (runAgent as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

      const agentDef = createAgent();
      const id = manager.spawn({}, agentDef, { prompt: "forever", cwd: "/tmp", isBackground: true });

      const result = await waitForSpecific(manager, id, 50);
      const data = JSON.parse(result.content[0].text);
      expect(data.timed_out).toBe(true);
      expect(data.still_running).toBeGreaterThan(0);
    });

    it("respects pre-aborted signal", async () => {
      const agentDef = createAgent();
      const id = manager.spawn({}, agentDef, { prompt: "test", cwd: "/tmp", isBackground: true });

      const controller = new AbortController();
      controller.abort();
      const result = await waitForSpecific(manager, id, 5000, controller.signal);
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toEqual([]);
    });
  });

  describe("waitForAll", () => {
    it("waits for a pending background Chain", async () => {
      let finish!: (result: { content: string; isError: boolean }) => void;
      manager.fireAndForgetChain(
        "chain-wait-all",
        "work",
        [{ agent: "Scout" }],
        "/tmp",
        () => new Promise((resolve) => { finish = resolve; }),
      );
      let settled = false;
      const waiting = waitForAll(manager, 5000).then((result) => {
        settled = true;
        return result;
      });

      await Promise.resolve();
      expect(settled).toBe(false);
      finish({ content: "done", isError: false });

      const result = await waiting;
      expect(JSON.parse(result.content[0].text).completed[0].status).toBe("completed");
    });

    it("returns immediately when no active agents", async () => {
      const result = await waitForAll(manager, 5000);
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toEqual([]);
      expect(data.still_running).toBe(0);
    });

    it("waits for multiple agents", async () => {
      const agentDef = createAgent();
      const id1 = manager.spawn({}, agentDef, { prompt: "task 1", cwd: "/tmp", isBackground: true });
      const id2 = manager.spawn({}, agentDef, { prompt: "task 2", cwd: "/tmp", isBackground: true });

      const result = await waitForAll(manager, 5000);
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toHaveLength(2);
      const ids = data.completed.map((c: { id: string }) => c.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });

    it("sets resultConsumed on all agents", async () => {
      const agentDef = createAgent();
      const id1 = manager.spawn({}, agentDef, { prompt: "task 1", cwd: "/tmp", isBackground: true });
      const id2 = manager.spawn({}, agentDef, { prompt: "task 2", cwd: "/tmp", isBackground: true });

      await waitForAll(manager, 5000);
      expect(manager.getRecord(id1)?.resultConsumed).toBe(true);
      expect(manager.getRecord(id2)?.resultConsumed).toBe(true);
    });

    it("times out when agents are stuck", async () => {
      const { runAgent } = await import("../src/core/agent-runner.js");
      (runAgent as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

      const agentDef = createAgent();
      manager.spawn({}, agentDef, { prompt: "forever", cwd: "/tmp", isBackground: true });

      const result = await waitForAll(manager, 50);
      const data = JSON.parse(result.content[0].text);
      expect(data.timed_out).toBe(true);
    });
  });

  describe("waitForAny", () => {
    it("returns immediately when no active agents", async () => {
      const result = await waitForAny(manager, 5000);
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toEqual([]);
      expect(data.still_running).toBe(0);
    });

    it("returns the first agent to complete", async () => {
      const agentDef = createAgent();
      manager.spawn({}, agentDef, { prompt: "task 1", cwd: "/tmp", isBackground: true });

      const result = await waitForAny(manager, 5000);
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toHaveLength(1);
    });

    it("times out when agents are stuck", async () => {
      const { runAgent } = await import("../src/core/agent-runner.js");
      (runAgent as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

      const agentDef = createAgent();
      manager.spawn({}, agentDef, { prompt: "forever", cwd: "/tmp", isBackground: true });

      const result = await waitForAny(manager, 50);
      const data = JSON.parse(result.content[0].text);
      expect(data.timed_out).toBe(true);
    });
  });

  describe("registerWaitTool", () => {
    it("registers a tool named 'wait'", () => {
      const { pi, registeredTool } = createPi();
      registerWaitTool(pi, manager);
      const tool = registeredTool();
      expect(tool.name).toBe("wait");
      expect(tool.label).toBe("Wait for Agents");
    });

    it("execute with no active agents returns immediately", async () => {
      const { pi, registeredTool } = createPi();
      registerWaitTool(pi, manager);
      const tool = registeredTool();

      const result = await tool.execute("tc-1", {}, undefined, undefined, {}) as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toEqual([]);
      expect(data.still_running).toBe(0);
    });

    it("id takes precedence over all", async () => {
      const { pi, registeredTool } = createPi();
      registerWaitTool(pi, manager);
      const tool = registeredTool();

      const agentDef = createAgent();
      const { id } = await manager.spawnAndWait({}, agentDef, { prompt: "target", cwd: "/tmp" });
      manager.spawn({}, agentDef, { prompt: "other", cwd: "/tmp", isBackground: true });

      const result = await tool.execute("tc-1", { id, all: true }, undefined, undefined, {}) as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toHaveLength(1);
      expect(data.completed[0].id).toBe(id);
    });
  });
});
