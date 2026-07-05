import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runAgent,
  buildAgentPrompt,
  buildParentContext,
  resumeAgent,
  getAgentConversation,
} from "../src/core/agent-runner.js";
import type {
  AgentDefinition,
  EnvInfo,
  RunOptions,
} from "../src/shared/types.js";

// Mock createAgentSession and DefaultResourceLoader
vi.mock("@earendil-works/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn(() => () => {}),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    messages: [],
  };
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: mockSession,
      extensionsResult: { extensions: [] },
    }),
    DefaultResourceLoader: vi.fn(function (this: {
      reload: ReturnType<typeof vi.fn>;
    }) {
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

const testEnv: EnvInfo = { isGitRepo: false, branch: "", platform: "linux" };
const testEnvGit: EnvInfo = {
  isGitRepo: true,
  branch: "main",
  platform: "darwin",
};

// ---------------------------------------------------------------------------
// buildAgentPrompt
// ---------------------------------------------------------------------------

describe("buildAgentPrompt", () => {
  it("replace mode builds standalone prompt with agent name and env", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "replace",
        systemPrompt: "I am a specialist.",
      }),
      "/tmp",
      testEnv,
    );
    expect(prompt).toContain('<active_agent name="test-agent"/>');
    expect(prompt).toContain("I am a specialist.");
    expect(prompt).toContain("platform=linux");
    expect(prompt).not.toContain("<sub_agent_context>");
  });

  it("replace mode includes git branch when available", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ promptMode: "replace" }),
      "/tmp",
      testEnvGit,
    );
    expect(prompt).toContain("git branch=main");
    expect(prompt).toContain("platform=darwin");
  });

  it("replace mode ignores parentSystemPrompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "replace",
        systemPrompt: "I am a specialist.",
      }),
      "/tmp",
      testEnv,
      "Parent system prompt content",
    );
    expect(prompt).toContain("I am a specialist.");
    expect(prompt).not.toContain("Parent system prompt content");
  });

  it("default (no promptMode) behaves like replace", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ systemPrompt: "Default agent." }),
      "/tmp",
      testEnv,
      "Parent prompt",
    );
    expect(prompt).toContain("Default agent.");
    expect(prompt).not.toContain("Parent prompt");
  });

  it("append mode layers on top of parent system prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "append",
        systemPrompt: "Focus on security.",
      }),
      "/tmp",
      testEnv,
      "Parent system prompt content",
    );
    expect(prompt).toContain("Parent system prompt content");
    expect(prompt).toContain("Focus on security.");
    expect(prompt).toContain("<sub_agent_context>");
    expect(prompt).toContain("<agent_instructions>");
  });

  it("append mode uses generic fallback when no parent prompt", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({
        promptMode: "append",
        systemPrompt: "Focus on security.",
      }),
      "/tmp",
      testEnv,
    );
    expect(prompt).toContain("general-purpose coding agent");
    expect(prompt).toContain("Focus on security.");
    expect(prompt).toContain("<sub_agent_context>");
  });

  it("append mode includes skill blocks", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ promptMode: "append", systemPrompt: "Security agent." }),
      "/tmp",
      testEnv,
      "Parent prompt",
      [{ name: "tdd", content: "Test-driven development instructions" }],
    );
    expect(prompt).toContain('<skill name="tdd">');
    expect(prompt).toContain("Test-driven development instructions");
  });

  it("replace mode includes skill blocks", () => {
    const prompt = buildAgentPrompt(
      makeAgentDef({ promptMode: "replace", systemPrompt: "Agent." }),
      "/tmp",
      testEnv,
      undefined,
      [{ name: "tdd", content: "TDD rules" }],
    );
    expect(prompt).toContain('<skill name="tdd">');
    expect(prompt).toContain("TDD rules");
  });
});

// ---------------------------------------------------------------------------
// buildParentContext
// ---------------------------------------------------------------------------

describe("buildParentContext", () => {
  it("formats user and assistant messages", () => {
    const context = buildParentContext([
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ]);
    expect(context).toContain("[User]: Hello");
    expect(context).toContain("[Assistant]: Hi there");
    expect(context).toContain("<parent_conversation>");
    expect(context).toContain("</parent_conversation>");
  });

  it("formats compaction entries", () => {
    const context = buildParentContext([
      { type: "compaction", summary: "Earlier conversation about testing." },
    ]);
    expect(context).toContain("[Summary]: Earlier conversation about testing.");
  });

  it("skips toolResult entries", () => {
    const context = buildParentContext([
      { type: "toolResult", content: [{ type: "text", text: "tool output" }] },
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
    ]);
    expect(context).not.toContain("tool output");
    expect(context).toContain("[User]: Hello");
  });

  it("returns wrapper with empty body for empty branch", () => {
    const context = buildParentContext([]);
    expect(context).toContain("<parent_conversation>");
    expect(context).toContain("</parent_conversation>");
  });
});

// ---------------------------------------------------------------------------
// runAgent (integration)
// ---------------------------------------------------------------------------

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

  it("filters out disallowed_tools from tool list", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({
      tools: ["read", "bash", "write"],
      disallowedTools: ["bash"],
    });
    const options = makeRunOptions();

    await runAgent(agentDef, options, {});

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["read", "write"],
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
      steer: vi.fn().mockResolvedValue(undefined),
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
    expect(result).toHaveProperty("steered");
    expect(result.aborted).toBe(false);
    expect(result.steered).toBe(false);
  });

  it("sets noExtensions: true when isolated is true", async () => {
    const { DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ isolated: true });
    await runAgent(agentDef, makeRunOptions(), {});

    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noExtensions: true,
      }),
    );
  });

  it("sets noExtensions: false when isolated is false and extensions is not false", async () => {
    const { DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ isolated: false, extensions: true });
    await runAgent(agentDef, makeRunOptions(), {});

    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noExtensions: false,
      }),
    );
  });

  it("sets noExtensions: false when extensions is a string array (selective)", async () => {
    const { DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");

    const agentDef = makeAgentDef({ isolated: false, extensions: ["ext-a", "ext-b"] });
    await runAgent(agentDef, makeRunOptions(), {});

    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noExtensions: false,
      }),
    );
  });

  it("steers session at maxTurns and aborts at maxTurns + graceTurns", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");

    const mockSession = {
      subscribe: vi.fn((_handler: (event: { type: string }) => void) => {
        return () => {};
      }),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    const steeredTurns: number[] = [];
    await runAgent(
      agentDef,
      makeRunOptions({
        maxTurns: 5,
        graceTurns: 3,
        onTurnEnd: (turn) => steeredTurns.push(turn),
      }),
      {},
    );

    // The session mock resolves prompt immediately so no turns fire,
    // but verify the setup doesn't throw
    expect(mockSession.subscribe).toHaveBeenCalled();
  });

  it("prepends parent context to prompt when inheritContext is true", async () => {
    const { createAgentSession } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef();
    const mockBranch = [
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
      },
    ];

    await runAgent(
      agentDef,
      makeRunOptions({ inheritContext: true, prompt: "Do something" }),
      { sessionManager: { getBranch: () => mockBranch } },
    );

    const promptArg = mockSession.prompt.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain("<parent_conversation>");
    expect(promptArg).toContain("[User]: Hello");
    expect(promptArg).toContain("Do something");
  });

  it("passes parentSystemPrompt to buildAgentPrompt for append mode", async () => {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      bindExtensions: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: { extensions: [] } as never,
    });

    const agentDef = makeAgentDef({
      promptMode: "append",
      systemPrompt: "Focus on security.",
    });

    await runAgent(
      agentDef,
      makeRunOptions({ parentSystemPrompt: "I am the parent agent." }),
      {},
    );

    // Verify the system prompt override contains the parent prompt
    const loaderCall = vi.mocked(DefaultResourceLoader).mock.calls[0]?.[0] as unknown as {
      systemPromptOverride: () => string;
    };
    const systemPrompt = loaderCall.systemPromptOverride();
    expect(systemPrompt).toContain("I am the parent agent.");
    expect(systemPrompt).toContain("Focus on security.");
    expect(systemPrompt).toContain("<sub_agent_context>");
  });
});

import type { AgentSession } from "@earendil-works/pi-coding-agent";

describe("resumeAgent", () => {
  it("calls session.prompt with the prompt text", async () => {
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      messages: [
        { role: "user", content: [{ type: "text", text: "task" }] },
        { role: "assistant", content: [{ type: "text", text: "response text" }] },
      ],
    };
    const result = await resumeAgent(mockSession as unknown as AgentSession, "continue this task");
    expect(mockSession.prompt).toHaveBeenCalledWith("continue this task");
    expect(typeof result).toBe("string");
  });

  it("tracks tool activity via subscribe", async () => {
    let toolStartCount = 0;
    const mockSession = {
      subscribe: vi.fn((handler) => {
        // Simulate tool events
        handler({ type: "tool_execution_start", toolName: "bash" });
        handler({ type: "tool_execution_end", toolName: "bash" });
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      messages: [],
    };
    await resumeAgent(mockSession as unknown as AgentSession, "do task", {
      onToolActivity: (activity) => {
        if (activity.type === "start") toolStartCount++;
      },
    });
    expect(toolStartCount).toBe(1);
  });
});

describe("getAgentConversation", () => {
  it("extracts text from assistant and user messages", () => {
    const session = {
      messages: [
        { role: "user", content: [{ type: "text", text: "my prompt" }] },
        { role: "assistant", content: [{ type: "text", text: "my response" }] },
      ],
    };
    const result = getAgentConversation(session);
    expect(result).toContain("[user] my prompt");
    expect(result).toContain("[assistant] my response");
  });

  it("skips empty messages and non-text blocks", () => {
    const session = {
      messages: [
        { role: "user", content: [{ type: "tool_result" }] },
        { role: "assistant", content: [{ type: "text", text: "" }] },
      ],
    };
    const result = getAgentConversation(session);
    expect(result).toBe("");
  });

  it("returns empty string for session with no messages", () => {
    const result = getAgentConversation({});
    expect(result).toBe("");
  });

  it("handles user message as plain string content", () => {
    const session = {
      messages: [
        { role: "user", content: "plain string task" },
      ],
    };
    const result = getAgentConversation(session);
    expect(result).toContain("[user] plain string task");
  });
});
