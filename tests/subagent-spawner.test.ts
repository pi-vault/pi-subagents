import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import {
  buildChildArgs,
  resolveEffectiveModel,
  getParentModelId,
  spawnAndCollect,
  TERMINATION_GRACE_MS,
  type ChildSpawn,
  type SpawnChildFn,
  type ProgressUpdate,
} from "../src/core/subagent-spawner.js";
import type { AgentDefinition } from "../src/shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  killSignals: string[] = [];

  kill(signal?: string): boolean {
    this.killed = true;
    this.killSignals.push(signal ?? "SIGTERM");
    return true;
  }

  close(code = 0): void {
    this.emit("close", code);
  }
}

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "Scout",
    description: "Scout files",
    tools: ["read", "bash"],
    model: "openai/gpt-5",
    thinking: "medium",
    subagentAgents: [],
    timeoutMs: 250,
    systemPrompt: "You are Scout.",
    sourcePath: "/repo/agents/scout.md",
    ...overrides,
  };
}

function emitMessageEnd(
  child: FakeChildProcess,
  text: string,
  extras: Record<string, unknown> = {},
): void {
  const event = {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 100, cost: { total: 0.01 } },
      model: "openai/gpt-5",
      stopReason: "end",
      ...extras,
    },
  };
  child.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitToolStart(child: FakeChildProcess, toolName: string, args: unknown = {}): void {
  child.stdout.write(`${JSON.stringify({ type: "tool_execution_start", toolName, args })}\n`);
}

function emitToolEnd(child: FakeChildProcess, toolName: string, result: unknown = "ok", isError = false): void {
  child.stdout.write(`${JSON.stringify({ type: "tool_execution_end", toolName, result, isError })}\n`);
}

// ---------------------------------------------------------------------------
// buildChildArgs
// ---------------------------------------------------------------------------

describe("buildChildArgs", () => {
  test("assembles base flags without recursion", () => {
    const agent = createAgent();
    const args = buildChildArgs(agent, "/tmp/prompt.md", "/sessions/child.jsonl", false, "openai/gpt-5", "/repo");

    expect(args).toContain("--mode");
    expect(args).toContain("json");
    expect(args).toContain("-p");
    expect(args).toContain("--no-extensions");
    expect(args).toContain("--session");
    expect(args).toContain("/sessions/child.jsonl");
    expect(args).toContain("--name");
    expect(args).toContain("Scout");
    expect(args).toContain("--model");
    expect(args).toContain("openai/gpt-5");
    expect(args).toContain("--thinking");
    expect(args).toContain("medium");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("/tmp/prompt.md");
    expect(args).toContain("--no-skills");
    // no --extension when recursion disabled
    expect(args).not.toContain("--extension");
    // subagent tool filtered out when not recursive
    const toolsIdx = args.indexOf("--tools");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(args[toolsIdx + 1]).toBe("read,bash");
  });

  test("adds --extension flag when recursion enabled", () => {
    const agent = createAgent({ tools: ["read", "bash", "subagent"] });
    const args = buildChildArgs(agent, undefined, "/s/c.jsonl", true, undefined, "/repo");

    expect(args).toContain("--extension");
    // subagent kept in tools when recursive
    const toolsIdx = args.indexOf("--tools");
    expect(args[toolsIdx + 1]).toBe("read,bash,subagent");
  });

  test("omits --tools when agent has no tools", () => {
    const agent = createAgent({ tools: [] });
    const args = buildChildArgs(agent, undefined, "/s/c.jsonl", false, undefined, "/repo");
    expect(args).not.toContain("--tools");
  });

  test("omits --model when effectiveModel is undefined", () => {
    const agent = createAgent();
    const args = buildChildArgs(agent, undefined, "/s/c.jsonl", false, undefined, "/repo");
    expect(args).not.toContain("--model");
  });

  test("omits --thinking when agent has no thinking", () => {
    const agent = createAgent({ thinking: undefined });
    const args = buildChildArgs(agent, undefined, "/s/c.jsonl", false, undefined, "/repo");
    expect(args).not.toContain("--thinking");
  });

  test("always passes --no-skills even when skills array provided", () => {
    // resolveSkillPaths filters to skills that exist on disk;
    // with non-existent skill names, no --skill flags are emitted
    const agent = createAgent({ skills: ["nonexistent-skill"] });
    const args = buildChildArgs(agent, undefined, "/s/c.jsonl", false, undefined, "/repo");
    expect(args).toContain("--no-skills");
  });

  test("omits --append-system-prompt when promptPath is undefined", () => {
    const agent = createAgent();
    const args = buildChildArgs(agent, undefined, "/s/c.jsonl", false, undefined, "/repo");
    expect(args).not.toContain("--append-system-prompt");
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveModel
// ---------------------------------------------------------------------------

describe("resolveEffectiveModel", () => {
  test("returns agent model when set and not default", () => {
    const agent = createAgent({ model: "anthropic/claude-4" });
    expect(resolveEffectiveModel(agent, "openai/gpt-5")).toBe("anthropic/claude-4");
  });

  test("falls back to parent model when agent model is 'default'", () => {
    const agent = createAgent({ model: "default" });
    expect(resolveEffectiveModel(agent, "openai/gpt-5")).toBe("openai/gpt-5");
  });

  test("falls back to parent model when agent model is 'Default' (case-insensitive)", () => {
    const agent = createAgent({ model: "Default" });
    expect(resolveEffectiveModel(agent, "openai/gpt-5")).toBe("openai/gpt-5");
  });

  test("returns undefined when both agent and parent are empty", () => {
    const agent = createAgent({ model: "" });
    expect(resolveEffectiveModel(agent, "")).toBeUndefined();
  });

  test("returns undefined when agent model is undefined and parent is undefined", () => {
    const agent = createAgent({ model: undefined });
    expect(resolveEffectiveModel(agent, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getParentModelId
// ---------------------------------------------------------------------------

describe("getParentModelId", () => {
  test("returns provider/id when both present", () => {
    expect(getParentModelId({ provider: "openai", id: "gpt-5" })).toBe("openai/gpt-5");
  });

  test("returns id alone when provider is missing", () => {
    expect(getParentModelId({ id: "gpt-5" })).toBe("gpt-5");
  });

  test("returns undefined for undefined model", () => {
    expect(getParentModelId(undefined)).toBeUndefined();
  });

  test("returns undefined when id is empty", () => {
    expect(getParentModelId({ provider: "openai", id: "" })).toBeUndefined();
  });

  test("returns undefined when model is empty object", () => {
    expect(getParentModelId({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// spawnAndCollect
// ---------------------------------------------------------------------------

describe("spawnAndCollect", () => {
  test("parses message_end events and returns final text", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;

    const promise = spawnAndCollect({
      command: "pi",
      args: ["--mode", "json"],
      cwd: "/repo",
      env: {},
      timeoutMs: 5000,
      signal: undefined,
      effectiveModel: "openai/gpt-5",
      runtime: { spawnChild, now: () => 1 },
      startedAt: 0,
    });

    emitMessageEnd(child, "Hello from Scout");
    child.stdout.end();
    child.close(0);

    const result = await promise;
    expect(result.finalText).toBe("Hello from Scout");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.usage.turns).toBe(1);
    expect(result.usage.input).toBe(10);
    expect(result.usage.output).toBe(5);
    expect(result.model).toBe("openai/gpt-5");
    expect(result.stopReason).toBe("end");
  });

  test("accumulates usage across multiple message_end events", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;

    const promise = spawnAndCollect({
      command: "pi",
      args: [],
      cwd: "/repo",
      env: {},
      timeoutMs: 5000,
      signal: undefined,
      effectiveModel: undefined,
      runtime: { spawnChild, now: () => 1 },
      startedAt: 0,
    });

    emitMessageEnd(child, "first");
    emitMessageEnd(child, "second");
    child.stdout.end();
    child.close(0);

    const result = await promise;
    expect(result.finalText).toBe("second");
    expect(result.usage.turns).toBe(2);
    expect(result.usage.input).toBe(20);
    expect(result.usage.output).toBe(10);
  });

  test("tracks tool_execution_start and tool_execution_end events", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;
    const updates: ProgressUpdate[] = [];

    const promise = spawnAndCollect({
      command: "pi",
      args: [],
      cwd: "/repo",
      env: {},
      timeoutMs: 5000,
      signal: undefined,
      effectiveModel: undefined,
      runtime: { spawnChild, now: () => 1 },
      onProgress: (u) => updates.push({ ...u }),
      startedAt: 0,
    });

    emitToolStart(child, "bash", "ls -la");
    emitToolEnd(child, "bash", "file.txt", false);
    emitMessageEnd(child, "done");
    child.stdout.end();
    child.close(0);

    const result = await promise;
    expect(result.recentToolActivity).toHaveLength(2);
    expect(result.recentToolActivity[0].label).toBe("bash start");
    expect(result.recentToolActivity[1].label).toBe("bash done");
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  test("handles timeout with SIGTERM then SIGKILL after grace period", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;

    const promise = spawnAndCollect({
      command: "pi",
      args: [],
      cwd: "/repo",
      env: {},
      timeoutMs: 1, // very short timeout
      signal: undefined,
      effectiveModel: undefined,
      runtime: { spawnChild, now: () => Date.now() },
      startedAt: Date.now(),
    });

    // Wait for timeout to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(child.killSignals).toContain("SIGTERM");

    // Wait for SIGKILL grace period
    await new Promise((r) => setTimeout(r, TERMINATION_GRACE_MS + 100));
    expect(child.killSignals).toContain("SIGKILL");

    child.stdout.end();
    child.close(1);

    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
  });

  test("abort signal terminates child", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;
    const controller = new AbortController();

    const promise = spawnAndCollect({
      command: "pi",
      args: [],
      cwd: "/repo",
      env: {},
      timeoutMs: 60_000,
      signal: controller.signal,
      effectiveModel: undefined,
      runtime: { spawnChild, now: () => 1 },
      startedAt: 0,
    });

    controller.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(child.killSignals).toContain("SIGTERM");

    child.stdout.end();
    child.close(1);

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  test("buffers partial JSON lines correctly", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;

    const promise = spawnAndCollect({
      command: "pi",
      args: [],
      cwd: "/repo",
      env: {},
      timeoutMs: 5000,
      signal: undefined,
      effectiveModel: undefined,
      runtime: { spawnChild, now: () => 1 },
      startedAt: 0,
    });

    // Write a message_end event split across two chunks
    const event = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "buffered" }],
        usage: { input: 1, output: 1 },
        stopReason: "end",
      },
    });
    const midpoint = Math.floor(event.length / 2);
    child.stdout.write(event.slice(0, midpoint));
    child.stdout.write(`${event.slice(midpoint)}\n`);
    child.stdout.end();
    child.close(0);

    const result = await promise;
    expect(result.finalText).toBe("buffered");
  });

  test("collects stderr output", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;

    const promise = spawnAndCollect({
      command: "pi",
      args: [],
      cwd: "/repo",
      env: {},
      timeoutMs: 5000,
      signal: undefined,
      effectiveModel: undefined,
      runtime: { spawnChild, now: () => 1 },
      startedAt: 0,
    });

    child.stderr.write("warning: something\n");
    emitMessageEnd(child, "ok");
    child.stdout.end();
    child.close(0);

    const result = await promise;
    expect(result.stderr).toContain("warning: something");
  });

  test("captures errorMessage from message_end", async () => {
    const child = new FakeChildProcess();
    const spawnChild: SpawnChildFn = () => child as unknown as ChildSpawn;

    const promise = spawnAndCollect({
      command: "pi",
      args: [],
      cwd: "/repo",
      env: {},
      timeoutMs: 5000,
      signal: undefined,
      effectiveModel: undefined,
      runtime: { spawnChild, now: () => 1 },
      startedAt: 0,
    });

    emitMessageEnd(child, "", { stopReason: "aborted", errorMessage: "rate limited" });
    child.stdout.end();
    child.close(1);

    const result = await promise;
    expect(result.errorMessage).toBe("rate limited");
    expect(result.stopReason).toBe("aborted");
  });
});
