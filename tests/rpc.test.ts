import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerRpcHandlers } from "../src/core/rpc.js";
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

type Handler = (data: unknown) => void;

function createMockEvents() {
  const handlers = new Map<string, Handler[]>();
  return {
    on(channel: string, handler: Handler): () => void {
      const list = handlers.get(channel) ?? [];
      list.push(handler);
      handlers.set(channel, list);
      return () => {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    emit(channel: string, data: unknown): void {
      for (const h of handlers.get(channel) ?? []) h(data);
    },
    handlers,
  };
}

function createMockPi(events: ReturnType<typeof createMockEvents>) {
  return { events } as never;
}

describe("RPC handlers", () => {
  let manager: AgentManager;
  let events: ReturnType<typeof createMockEvents>;
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager();
    events = createMockEvents();
    const pi = createMockPi(events);
    const deps = createDeps({ manager });
    const result = registerRpcHandlers(pi, manager, deps);
    dispose = result.dispose;
  });

  describe("ping", () => {
    it("replies with version and methods", () => {
      let reply: unknown;
      events.on("subagents:rpc:ping:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:ping", { requestId: "r1" });
      expect(reply).toEqual({
        success: true,
        data: {
          version: 1,
          methods: ["ping", "spawn", "stop", "status", "steer"],
        },
      });
    });

    it.each([
      ["missing", undefined],
      ["non-string", 42],
      ["empty", ""],
      ["colon (injection)", "a:b"],
      ["newline", "a\nb"],
    ])("ignores %s requestId", (_label, requestId) => {
      let called = false;
      events.on(`subagents:rpc:ping:reply:${requestId}`, () => { called = true; });
      events.emit("subagents:rpc:ping", { requestId });
      expect(called).toBe(false);
    });
  });

  describe("spawn", () => {
    it("spawns a background agent and returns id", () => {
      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "Scout",
        task: "find files",
      });
      const r = reply as { success: boolean; data?: { id: string } };
      expect(r.success).toBe(true);
      expect(r.data?.id).toMatch(/^agent-/);
    });

    it("returns error for unknown agent", () => {
      dispose();
      events = createMockEvents();
      const pi2 = createMockPi(events);
      const deps = createDeps({
        manager,
        discoverAgents: () => createDiscovery([]),
      });
      const result = registerRpcHandlers(pi2, manager, deps);
      dispose = result.dispose;

      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "NonExistent",
        task: "test",
      });
      expect(reply).toEqual({
        success: false,
        error: "Unknown agent: NonExistent",
      });
    });

    it("returns error when agent field is missing", () => {
      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", { requestId: "r1", task: "test" });
      expect(reply).toEqual({
        success: false,
        error: "Missing required field: agent",
      });
    });

    it("returns error when task field is missing", () => {
      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", { requestId: "r1", agent: "Scout" });
      expect(reply).toEqual({
        success: false,
        error: "Missing required field: task",
      });
    });

    it("resolves model via registry when provided", () => {
      dispose();
      events = createMockEvents();
      const pi2 = createMockPi(events);
      const deps = createDeps({ manager });
      const fakeModel = { id: "claude-sonnet-4", provider: "anthropic", name: "Claude Sonnet" };
      const mockRegistry = {
        getAll: () => [fakeModel],
        find: (provider: string, id: string) =>
          provider === "anthropic" && id === "claude-sonnet-4" ? fakeModel : undefined,
      };
      const result = registerRpcHandlers(pi2, manager, deps, () => mockRegistry);
      dispose = result.dispose;

      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "Scout",
        task: "find files",
        model: "sonnet",
      });
      const r = reply as { success: boolean; data?: { id: string } };
      expect(r.success).toBe(true);
      expect(r.data?.id).toMatch(/^agent-/);
    });

    it("returns error for unknown model", () => {
      dispose();
      events = createMockEvents();
      const pi2 = createMockPi(events);
      const deps = createDeps({ manager });
      const mockRegistry = {
        getAll: () => [{ id: "claude-sonnet-4", provider: "anthropic", name: "Sonnet" }],
        find: () => undefined,
      };
      const result = registerRpcHandlers(pi2, manager, deps, () => mockRegistry);
      dispose = result.dispose;

      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "Scout",
        task: "test",
        model: "nonexistent-model-xyz",
      });
      expect(reply).toEqual({
        success: false,
        error: "Unknown model: nonexistent-model-xyz",
      });
    });

    it("skips model resolution when registry is unavailable", () => {
      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "Scout",
        task: "find files",
        model: "anything",
      });
      const r = reply as { success: boolean; data?: { id: string } };
      expect(r.success).toBe(true);
    });

    it("is case-insensitive for agent name", () => {
      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "scout",
        task: "find files",
      });
      const r = reply as { success: boolean; data?: { id: string } };
      expect(r.success).toBe(true);
    });

    it("passes validated toolBudget from agent config to spawn", () => {
      dispose();
      events = createMockEvents();
      const pi2 = createMockPi(events);
      const agentWithBudget = createAgent({ toolBudget: { hard: 20, soft: 15 } });
      const deps = createDeps({
        manager,
        discoverAgents: () => createDiscovery([agentWithBudget]),
      });
      const result = registerRpcHandlers(pi2, manager, deps);
      dispose = result.dispose;

      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "Scout",
        task: "budget test",
      });
      const r = reply as { success: boolean; data?: { id: string } };
      expect(r.success).toBe(true);
      const record = manager.getRecord(r.data!.id);
      expect(record).toBeDefined();
    });

    it("returns error for invalid toolBudget config", () => {
      dispose();
      events = createMockEvents();
      const pi2 = createMockPi(events);
      const agentWithBadBudget = createAgent({ toolBudget: { hard: -1 } as never });
      const deps = createDeps({
        manager,
        discoverAgents: () => createDiscovery([agentWithBadBudget]),
      });
      const result = registerRpcHandlers(pi2, manager, deps);
      dispose = result.dispose;

      let reply: unknown;
      events.on("subagents:rpc:spawn:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:spawn", {
        requestId: "r1",
        agent: "Scout",
        task: "test",
      });
      const r = reply as { success: boolean; error?: string };
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/hard must be an integer/);
    });
  });

  describe("stop", () => {
    it("aborts a running agent", () => {
      const agentDef = createAgent();
      const id = manager.spawn({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        isBackground: true,
      });

      let reply: unknown;
      events.on("subagents:rpc:stop:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:stop", { requestId: "r1", id });
      expect(reply).toEqual({ success: true });
    });

    it("returns error for unknown id", () => {
      let reply: unknown;
      events.on("subagents:rpc:stop:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:stop", { requestId: "r1", id: "nonexistent" });
      expect(reply).toEqual({
        success: false,
        error: "Agent not found: nonexistent",
      });
    });

    it("returns error when id is missing", () => {
      let reply: unknown;
      events.on("subagents:rpc:stop:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:stop", { requestId: "r1" });
      expect(reply).toEqual({
        success: false,
        error: "Missing required field: id",
      });
    });
  });

  describe("status", () => {
    it("returns agent status", () => {
      const agentDef = createAgent();
      const id = manager.spawn({}, agentDef, {
        prompt: "test task",
        cwd: "/tmp",
        isBackground: true,
      });

      let reply: unknown;
      events.on("subagents:rpc:status:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:status", { requestId: "r1", id });
      const r = reply as { success: boolean; data?: Record<string, unknown> };
      expect(r.success).toBe(true);
      expect(r.data?.status).toBe("running");
      expect(r.data?.type).toBe("Scout");
    });

    it("returns error for unknown id", () => {
      let reply: unknown;
      events.on("subagents:rpc:status:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:status", { requestId: "r1", id: "bad" });
      expect(reply).toEqual({
        success: false,
        error: "Agent not found: bad",
      });
    });
  });

  describe("steer", () => {
    it("steers a running agent", () => {
      const agentDef = createAgent();
      const id = manager.spawn({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        isBackground: true,
      });

      let reply: unknown;
      events.on("subagents:rpc:steer:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:steer", {
        requestId: "r1",
        id,
        message: "change direction",
      });
      expect(reply).toEqual({ success: true });
    });

    it("returns error for unknown id", () => {
      let reply: unknown;
      events.on("subagents:rpc:steer:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:steer", {
        requestId: "r1",
        id: "bad",
        message: "go",
      });
      expect(reply).toEqual({
        success: false,
        error: "Agent not found: bad",
      });
    });

    it("returns error when message is missing", () => {
      const agentDef = createAgent();
      const id = manager.spawn({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
        isBackground: true,
      });

      let reply: unknown;
      events.on("subagents:rpc:steer:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:steer", { requestId: "r1", id });
      expect(reply).toEqual({
        success: false,
        error: "Missing required field: message",
      });
    });

    it("returns error when agent is not running", async () => {
      const agentDef = createAgent();
      const { id } = await manager.spawnAndWait({}, agentDef, {
        prompt: "test",
        cwd: "/tmp",
      });

      let reply: unknown;
      events.on("subagents:rpc:steer:reply:r1", (data) => {
        reply = data;
      });
      events.emit("subagents:rpc:steer", {
        requestId: "r1",
        id,
        message: "go",
      });
      const r = reply as { success: boolean; error?: string };
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not running/);
    });
  });

  describe("dispose", () => {
    it("unsubscribes all handlers", () => {
      dispose();
      for (const method of ["ping", "spawn", "stop", "status", "steer"]) {
        const list = events.handlers.get(`subagents:rpc:${method}`);
        expect(list?.length ?? 0).toBe(0);
      }
    });
  });
});
