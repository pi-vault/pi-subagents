import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAgent } from "../src/core/agent-runner.js";
import type { AgentDefinition, RunOptions } from "../src/shared/types.js";

// Mock createAgentSession and DefaultResourceLoader
vi.mock("@earendil-works/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn(() => () => {}),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    messages: [],
  };
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: mockSession,
      extensionsResult: { extensions: [] },
    }),
    DefaultResourceLoader: vi.fn(function (
      this: { reload: ReturnType<typeof vi.fn> },
    ) {
      this.reload = vi.fn().mockResolvedValue(undefined);
    }),
    SessionManager: { inMemory: vi.fn(() => ({})) },
    SettingsManager: { create: vi.fn(() => ({})) },
    getAgentDir: vi.fn(() => "/fake/agent-dir"),
  };
});

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

function makeRunOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    prompt: "Do something",
    cwd: "/tmp/test",
    agentId: "test-123",
    ...overrides,
  };
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createAgentSession with correct options", async () => {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ tools: ["read", "bash", "write"] });
    const options = makeRunOptions();

    await runAgent(agentDef, options, {});

    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/test",
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      }),
    );
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/test",
        tools: ["read", "bash", "write"],
      }),
    );
  });

  it("excludes subagent tool when allowRecursion is false", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ tools: ["read", "bash", "subagent"] });
    const options = makeRunOptions({ allowRecursion: false });

    await runAgent(agentDef, options, {});

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["read", "bash"],
      }),
    );
  });

  it("includes subagent tool when allowRecursion is true", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ tools: ["read", "bash", "subagent"] });
    const options = makeRunOptions({ allowRecursion: true });

    await runAgent(agentDef, options, {});

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["read", "bash", "subagent"],
      }),
    );
  });

  it("calls session.bindExtensions after creation", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    await runAgent(agentDef, makeRunOptions(), {});

    expect(mockSession.bindExtensions).toHaveBeenCalledWith({});
  });

  it("returns RunResult with responseText, aborted, and steered flags", async () => {
    const agentDef = makeAgentDef();
    const result = await runAgent(agentDef, makeRunOptions(), {});

    expect(result).toHaveProperty("responseText");
    expect(result).toHaveProperty("session");
    expect(result).toHaveProperty("aborted");
    expect(result.aborted).toBe(false);
    expect(result.steered).toBe(false);
  });

  it("enforces timeout via setTimeout + session.abort()", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
      ),
      abort: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    const result = await runAgent(
      agentDef,
      makeRunOptions({ timeoutMs: 50 }),
      {},
    );

    expect(mockSession.abort).toHaveBeenCalled();
    expect(result.aborted).toBe(true);
  });
});
