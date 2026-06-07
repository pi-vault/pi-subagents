import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import type {
  ExtensionAPI,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import {
  executeSubagent,
  parseAgentCommandArgs,
  registerAgentCommand,
  registerSubagentTool,
  type SubagentRuntimeDeps,
} from "../src/subagent.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
  RuntimeDeps,
} from "../src/types.js";

function createPaths(rootDir: string): ResolvedPaths {
  return {
    agentDir: join(rootDir, "agent"),
    configPath: join(rootDir, "agent", "extensions", "subagents.json"),
    userAgentsDir: join(rootDir, "agent", "agents"),
    bundledAgentsDir: join(rootDir, "bundled-agents"),
    sessionsDir: join(rootDir, "agent", "sessions"),
    runtimeCacheDir: join(rootDir, "agent", "cache", "pi-subagents"),
  };
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

function createDeps(paths: ResolvedPaths, discovery: AgentDiscoveryResult): RuntimeDeps {
  const loadedConfig: LoadedConfig = {
    exists: false,
    config: {
      maxConcurrency: 3,
      maxRecursiveLevel: 2,
      defaultTimeoutMs: 500,
    },
  };

  return {
    resolvePaths: () => paths,
    loadConfig: () => loadedConfig,
    discoverAgents: () => discovery,
    discoverToolNames: () => ["bash", "read"],
    createAgentFile: () => {
      throw new Error("not used");
    },
  };
}

function createRuntime(
  spawnChild: SubagentRuntimeDeps["spawnChild"],
  options: {
    runId?: string;
    tempSessionRoot?: string;
  } = {},
): SubagentRuntimeDeps {
  const { runId = "run-123", tempSessionRoot } = options;

  return {
    spawnChild,
    now: (() => {
      let time = 0;
      return () => ++time;
    })(),
    createRunId: () => runId,
    mkdtemp: (prefix) => {
      if (prefix.includes("pi-subagent-session-") && tempSessionRoot) {
        mkdirSync(tempSessionRoot, { recursive: true });
        return tempSessionRoot;
      }
      return mkdtempSync(prefix);
    },
    writeFile: (path, content) => {
      writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
    },
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    removePath: (path) => {
      rmSync(path, { recursive: true, force: true });
    },
    resolvePiInvocation: (childArgs) => ({ command: "pi", args: childArgs }),
  };
}

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

function writeChildSessionFile(childSessionPath: string): string {
  mkdirSync(dirname(childSessionPath), { recursive: true });
  writeFileSync(childSessionPath, '{"type":"session"}\n', "utf8");
  return childSessionPath;
}

async function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("subagent execution", () => {
  test("returns structured errors for missing task and unknown agents before spawn", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent()], diagnostics: [] };
    const runtime = {
      spawnChild: vi.fn(),
      now: () => 0,
      createRunId: () => "run-123",
      mkdtemp: vi.fn(),
      writeFile: vi.fn(),
      mkdirp: vi.fn(),
      removePath: vi.fn(),
      resolvePiInvocation: vi.fn(() => ({ command: "pi", args: [] })),
    } satisfies SubagentRuntimeDeps;

    const missingTask = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "   " },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(missingTask.isError).toBe(true);
    expect(missingTask.content).toBe(
      'Missing task for agent "Scout". Available agents: Scout',
    );
    expect(missingTask.details.status).toBe("error");

    const unknownAgent = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "missing", task: "Do work" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(unknownAgent.isError).toBe(true);
    expect(unknownAgent.content).toBe(
      'Unknown agent: "missing". Available agents: Scout',
    );
    expect(unknownAgent.details.status).toBe("error");
    expect(runtime.spawnChild).not.toHaveBeenCalled();
  });

  test("spawns child pi with expected args and returns only final assistant text", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent()], diagnostics: [] };
    const parentSessionDir = join(rootDir, "project-sessions");
    const parentSessionFile = join(parentSessionDir, "2026-06-06_parent.jsonl");
    const parentSessionStem = basename(parentSessionFile, ".jsonl");
    const childSessionDir = join(parentSessionDir, parentSessionStem, "run-123", "run-0");
    const childSessionPath = writeChildSessionFile(
      join(childSessionDir, "session.jsonl"),
    );
    const spawnCalls: Array<{
      command: string;
      args: string[];
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }> = [];

    const runtime = createRuntime(
      ((command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
        spawnCalls.push({ command, args, cwd: options.cwd, env: options.env });
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"session","id":"child-session-id","timestamp":"2026-06-06T17:00:00.000Z","cwd":"/worktree"}\n',
          );
          child.stdout.write(
            '{"type":"tool_execution_start","toolCallId":"call-1","toolName":"read","args":{"path":"src/index.ts"}}\n',
          );
          child.stdout.write(
            '{"type":"tool_execution_end","toolCallId":"call-1","toolName":"read","result":{"content":[{"type":"text","text":"done"}]},"isError":false}\n',
          );
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"partial"}],"usage":{"input":10,"output":2,"cost":{"total":0.1}},"model":"openai/gpt-5","stopReason":"tool_use"}}\n',
          );
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"final answer"}],"usage":{"input":20,"output":5,"cacheRead":3,"cacheWrite":4,"totalTokens":99,"cost":{"total":0.2}},"model":"openai/gpt-5","stopReason":"end"}}\n',
          );
          child.stderr.write("warn on stderr");
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "scout", task: "Inspect repo", cwd: "/worktree" },
      "/repo",
      undefined,
      parentSessionFile,
      parentSessionDir,
      runtime,
    );

    expect(result.content).toBe("final answer");
    expect(result.isError).toBe(false);
    expect(result.details).toMatchObject({
      status: "success",
      agent: "Scout",
      task: "Inspect repo",
      cwd: "/worktree",
      model: "openai/gpt-5",
      stopReason: "end",
      exitCode: 0,
      stderr: "warn on stderr",
      usage: {
        input: 30,
        output: 7,
        cacheRead: 3,
        cacheWrite: 4,
        contextTokens: 99,
        cost: 0.30000000000000004,
        turns: 2,
      },
      childSessionDir,
      childSessionPath,
    });
    expect(result.details.recentToolActivity).toEqual([
      { label: "read start", preview: '{"path":"src/index.ts"}' },
      {
        label: "read done",
        preview: '{"content":[{"type":"text","text":"done"}]}',
      },
    ]);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      command: "pi",
      cwd: "/worktree",
    });
    expect(spawnCalls[0].args).toEqual(
      expect.arrayContaining([
        "--mode",
        "json",
        "-p",
        "--no-extensions",
        "--session",
        childSessionPath,
        "--name",
        "Scout",
        "--tools",
        "read,bash",
        "--model",
        "openai/gpt-5",
        "--thinking",
        "medium",
        "--append-system-prompt",
        expect.stringMatching(/\.md$/),
        "Task: Inspect repo",
      ]),
    );
    expect(spawnCalls[0].args).not.toContain("--session-dir");
    expect(spawnCalls[0].args).not.toContain("--session-id");
    expect(spawnCalls[0]?.env?.PI_SUBAGENT_CHILD).toBeUndefined();
    expect(existsSync(result.details.childSessionPath)).toBe(true);
  });

  test("omits --model when agent model is default", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [createAgent({ model: "default", systemPrompt: "" })],
      diagnostics: [],
    };
    const spawnCalls: Array<{ args: string[] }> = [];
    const runtime = createRuntime(
      ((_, args, ___) => {
        spawnCalls.push({ args });
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(false);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).not.toContain("--model");
    expect(result.details.model).toBeUndefined();
    expect(result.details.status).toBe("success");
  });

  test("keeps phase 4 spawn behavior for agents without subagent", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [createAgent({ tools: ["read", "bash"], systemPrompt: "" })],
      diagnostics: [],
    };
    const spawnCalls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const runtime = createRuntime(
      ((_, args, options) => {
        spawnCalls.push({ args, env: options.env });
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(false);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toEqual(
      expect.arrayContaining(["--no-extensions", "--tools", "read,bash"]),
    );
    expect(spawnCalls[0]?.args).not.toContain("--extension");
    expect(spawnCalls[0]?.env?.PI_SUBAGENT_CHILD).toBeUndefined();
  });

  test("enables recursive child runs, preserves subagent, and writes nested runtime files", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [
        createAgent({
          tools: ["read", "subagent", "bash"],
          subagentAgents: ["researcher", "scout"],
          systemPrompt: "",
        }),
      ],
      diagnostics: [],
    };
    const spawnCalls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const runtime = createRuntime(
      ((_, args, options) => {
        spawnCalls.push({ args, env: options.env });
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
      { runId: "run-123" },
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(false);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toEqual(
      expect.arrayContaining([
        "--no-extensions",
        "--extension",
        expect.stringMatching(/src\/index\.ts$/),
        "--tools",
        "read,subagent,bash",
      ]),
    );
    expect(spawnCalls[0]?.env).toMatchObject({
      PI_SUBAGENT_CHILD: "1",
      PI_SUBAGENT_FANOUT_CHILD: "1",
      PI_SUBAGENT_RUN_ID: "run-123",
      PI_SUBAGENT_DEPTH: "1",
      PI_SUBAGENT_MAX_DEPTH: "2",
      PI_SUBAGENT_ALLOWED_AGENTS: "researcher,scout",
      PI_SUBAGENT_PARENT_ROOT_RUN_ID: "run-123",
      PI_SUBAGENT_PARENT_RUN_ID: "",
      PI_SUBAGENT_PARENT_CHILD_INDEX: "0",
      PI_SUBAGENT_PARENT_DEPTH: "0",
      PI_SUBAGENT_PARENT_PATH: "",
    });

    const runtimeStatePath = spawnCalls[0]?.env?.PI_SUBAGENT_RUNTIME_STATE;
    expect(runtimeStatePath).toBeTruthy();
    const runtimeState = JSON.parse(readFileSync(runtimeStatePath ?? "", "utf8")) as {
      rootRunId: string;
      runId: string;
      depth: number;
      maxDepth: number;
      allowedAgents: string[];
      routeFilePath: string;
      parentEventSink: string;
      parentControlInbox: string;
    };
    expect(runtimeState).toMatchObject({
      rootRunId: "run-123",
      runId: "run-123",
      depth: 1,
      maxDepth: 2,
      allowedAgents: ["researcher", "scout"],
    });
    expect(existsSync(runtimeState.routeFilePath)).toBe(true);
    const route = JSON.parse(readFileSync(runtimeState.routeFilePath, "utf8")) as {
      rootRunId: string;
      childRunId: string;
      parentEventSink: string;
      parentControlInbox: string;
    };
    expect(route).toMatchObject({
      rootRunId: "run-123",
      childRunId: "run-123",
      parentEventSink: runtimeState.parentEventSink,
      parentControlInbox: runtimeState.parentControlInbox,
    });
  });

  test("strips nested subagent env vars when a nested child launches a non-recursive agent", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [createAgent({ tools: ["read", "bash"], systemPrompt: "" })],
      diagnostics: [],
    };
    const spawnCalls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const runtime = createRuntime(
      ((_, args, options) => {
        spawnCalls.push({ args, env: options.env });
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    await withEnv(
      {
        PI_SUBAGENT_CHILD: "1",
        PI_SUBAGENT_FANOUT_CHILD: "1",
        PI_SUBAGENT_RUN_ID: "parent-run",
        PI_SUBAGENT_DEPTH: "1",
        PI_SUBAGENT_MAX_DEPTH: "2",
        PI_SUBAGENT_ALLOWED_AGENTS: "scout",
        PI_SUBAGENT_RUNTIME_STATE: "/tmp/runtime.json",
        PI_SUBAGENT_PARENT_EVENT_SINK: "/tmp/event-sink.jsonl",
        PI_SUBAGENT_PARENT_CONTROL_INBOX: "/tmp/control-inbox.jsonl",
        PI_SUBAGENT_PARENT_ROOT_RUN_ID: "root-run",
        PI_SUBAGENT_PARENT_RUN_ID: "parent-run",
        PI_SUBAGENT_PARENT_CHILD_INDEX: "0",
        PI_SUBAGENT_PARENT_DEPTH: "1",
        PI_SUBAGENT_PARENT_PATH: "root-run/parent-run",
        PI_SUBAGENT_PARENT_CAPABILITY_TOKEN: "cap-token",
      },
      async () => {
        const result = await executeSubagent(
          paths,
          createDeps(paths, discovery).loadConfig(paths),
          discovery,
          { agent: "Scout", task: "Inspect repo" },
          "/repo",
          undefined,
          undefined,
          undefined,
          runtime,
        );

        expect(result.isError).toBe(false);
      },
    );

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toEqual(
      expect.arrayContaining(["--no-extensions", "--tools", "read,bash"]),
    );
    expect(spawnCalls[0]?.args).not.toContain("--extension");
    expect(spawnCalls[0]?.env?.PI_SUBAGENT_CHILD).toBeUndefined();
    expect(spawnCalls[0]?.env?.PI_SUBAGENT_PARENT_ROOT_RUN_ID).toBeUndefined();
    expect(spawnCalls[0]?.env?.PI_SUBAGENT_RUNTIME_STATE).toBeUndefined();
  });

  test("scout self-recursion: spawns child scout with correct allowlist and depth tracking", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [
        createAgent({
          name: "scout",
          tools: ["read", "subagent", "bash"],
          subagentAgents: ["scout"],
          systemPrompt: "",
        }),
      ],
      diagnostics: [],
    };
    const spawnCalls: Array<{
      args: string[];
      env?: NodeJS.ProcessEnv;
    }> = [];
    const runtime = createRuntime(
      ((_, args, options) => {
        spawnCalls.push({ args, env: options.env });
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"scout-result"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
      { runId: "scout-self-recursion-run" },
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "scout", task: "Explore repo structure" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toBe("scout-result");
    expect(spawnCalls).toHaveLength(1);

    const childArgs = spawnCalls[0]?.args;
    expect(childArgs).toEqual(
      expect.arrayContaining(["--extension"]),
    );
    expect(childArgs).toEqual(
      expect.arrayContaining(["--no-extensions"]),
    );
    expect(childArgs).toEqual(
      expect.arrayContaining(["--tools", "read,subagent,bash"]),
    );
    expect(childArgs).toEqual(
      expect.arrayContaining(["--name", "scout"]),
    );

    const childEnv = spawnCalls[0]?.env;
    expect(childEnv).toMatchObject({
      PI_SUBAGENT_CHILD: "1",
      PI_SUBAGENT_FANOUT_CHILD: "1",
      PI_SUBAGENT_RUN_ID: "scout-self-recursion-run",
      PI_SUBAGENT_DEPTH: "1",
      PI_SUBAGENT_MAX_DEPTH: "2",
      PI_SUBAGENT_ALLOWED_AGENTS: "scout",
      PI_SUBAGENT_PARENT_ROOT_RUN_ID: "scout-self-recursion-run",
      PI_SUBAGENT_PARENT_DEPTH: "0",
    });

    // Verify the child scout can also recurse (scout is in its own allowlist)
    expect(childEnv?.PI_SUBAGENT_ALLOWED_AGENTS).toBe("scout");

    // Verify runtime state file was written with correct depth
    const runtimeStatePath = childEnv?.PI_SUBAGENT_RUNTIME_STATE;
    expect(runtimeStatePath).toBeTruthy();
    const runtimeState = JSON.parse(
      readFileSync(runtimeStatePath ?? "", "utf8"),
    ) as {
      depth: number;
      maxDepth: number;
      allowedAgents: string[];
      routeFilePath: string;
    };
    expect(runtimeState).toMatchObject({
      depth: 1,
      maxDepth: 2,
      allowedAgents: ["scout"],
    });

    // Verify route file was written
    expect(existsSync(runtimeState.routeFilePath)).toBe(true);
  });

  test("allows case-insensitive nested child selection when present in the allowlist", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [createAgent({ name: "Researcher", systemPrompt: "" })],
      diagnostics: [],
    };
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    await withEnv(
      {
        PI_SUBAGENT_CHILD: "1",
        PI_SUBAGENT_RUN_ID: "parent-run",
        PI_SUBAGENT_DEPTH: "1",
        PI_SUBAGENT_MAX_DEPTH: "2",
        PI_SUBAGENT_ALLOWED_AGENTS: "researcher",
        PI_SUBAGENT_PARENT_ROOT_RUN_ID: "root-run",
      },
      async () => {
        const result = await executeSubagent(
          paths,
          createDeps(paths, discovery).loadConfig(paths),
          discovery,
          { agent: "RESEARCHER", task: "Inspect repo" },
          "/repo",
          undefined,
          undefined,
          undefined,
          runtime,
        );

        expect(result.isError).toBe(false);
      },
    );
  });

  test("blocks nested delegation when current depth reaches maxRecursiveLevel", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const runtime = createRuntime(
      vi.fn(() => {
        throw new Error("spawn should not be called");
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    await withEnv(
      {
        PI_SUBAGENT_CHILD: "1",
        PI_SUBAGENT_RUN_ID: "parent-run",
        PI_SUBAGENT_DEPTH: "2",
        PI_SUBAGENT_MAX_DEPTH: "2",
        PI_SUBAGENT_ALLOWED_AGENTS: "Scout",
        PI_SUBAGENT_PARENT_ROOT_RUN_ID: "root-run",
      },
      async () => {
        const result = await executeSubagent(
          paths,
          createDeps(paths, discovery).loadConfig(paths),
          discovery,
          { agent: "Scout", task: "Inspect repo" },
          "/repo",
          undefined,
          undefined,
          undefined,
          runtime,
        );

        expect(result.isError).toBe(true);
        expect(result.details.status).toBe("error");
        expect(result.content).toContain(
          "Nested delegation blocked at depth 2; maxRecursiveLevel=2.",
        );
      },
    );
  });

  test("blocks nested delegation when the child allowlist is empty", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const runtime = createRuntime(
      vi.fn(() => {
        throw new Error("spawn should not be called");
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    await withEnv(
      {
        PI_SUBAGENT_CHILD: "1",
        PI_SUBAGENT_RUN_ID: "parent-run",
        PI_SUBAGENT_DEPTH: "1",
        PI_SUBAGENT_MAX_DEPTH: "2",
        PI_SUBAGENT_ALLOWED_AGENTS: "",
        PI_SUBAGENT_PARENT_ROOT_RUN_ID: "root-run",
      },
      async () => {
        const result = await executeSubagent(
          paths,
          createDeps(paths, discovery).loadConfig(paths),
          discovery,
          { agent: "Scout", task: "Inspect repo" },
          "/repo",
          undefined,
          undefined,
          undefined,
          runtime,
        );

        expect(result.isError).toBe(true);
        expect(result.details.status).toBe("error");
        expect(result.content).toContain(
          "Nested delegation is disabled for this agent",
        );
      },
    );
  });

  test("blocks nested delegation when the requested child is not in the allowlist", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [createAgent({ name: "Researcher", systemPrompt: "" })],
      diagnostics: [],
    };
    const runtime = createRuntime(
      vi.fn(() => {
        throw new Error("spawn should not be called");
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    await withEnv(
      {
        PI_SUBAGENT_CHILD: "1",
        PI_SUBAGENT_RUN_ID: "parent-run",
        PI_SUBAGENT_DEPTH: "1",
        PI_SUBAGENT_MAX_DEPTH: "2",
        PI_SUBAGENT_ALLOWED_AGENTS: "scout",
        PI_SUBAGENT_PARENT_ROOT_RUN_ID: "root-run",
      },
      async () => {
        const result = await executeSubagent(
          paths,
          createDeps(paths, discovery).loadConfig(paths),
          discovery,
          { agent: "Researcher", task: "Inspect repo" },
          "/repo",
          undefined,
          undefined,
          undefined,
          runtime,
        );

        expect(result.isError).toBe(true);
        expect(result.details.status).toBe("error");
        expect(result.content).toContain(
          'Child agent "Researcher" is not allowed. Allowed child agents: scout.',
        );
      },
    );
  });

  test("uses a temp child session root for no-session parents", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const tempSessionRoot = join(rootDir, "tmp", "pi-subagent-session-fixed");
    const childSessionDir = join(tempSessionRoot, "run-123", "run-0");
    const childSessionPath = writeChildSessionFile(join(childSessionDir, "session.jsonl"));
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
      { tempSessionRoot },
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.details.childSessionDir).toBe(childSessionDir);
    expect(result.details.childSessionPath).toBe(childSessionPath);
  });

  test("surfaces non-zero exits with stderr and exit metadata", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ timeoutMs: undefined })], diagnostics: [] };
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stderr.write("child failed");
          child.close(2);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toBe("child failed");
    expect(result.details.status).toBe("error");
    expect(result.details.exitCode).toBe(2);
    expect(result.details.stopReason).toBe("error");
    expect(result.details.stderr).toBe("child failed");
  });

  test("treats assistant aborted stop reason as an error", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ timeoutMs: undefined })], diagnostics: [] };
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"partial"}],"stopReason":"aborted","errorMessage":"child aborted"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toBe("child aborted");
    expect(result.details.status).toBe("error");
    expect(result.details.stopReason).toBe("aborted");
    expect(result.details.exitCode).toBe(0);
  });

  test("times out with SIGTERM then SIGKILL fallback metadata", async () => {
    vi.useFakeTimers();
    try {
      const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
      const paths = createPaths(rootDir);
      const discovery = {
        agents: [createAgent({ timeoutMs: 10, systemPrompt: "" })],
        diagnostics: [],
      };
      const child = new FakeChildProcess();
      child.kill = function kill(signal?: string): boolean {
        this.killed = true;
        this.killSignals.push(signal ?? "SIGTERM");
        if (signal === "SIGTERM") {
          setTimeout(() => this.close(143), 0);
        }
        return true;
      };
      const runtime = createRuntime(
        ((_, __, ___) => child as never) as SubagentRuntimeDeps["spawnChild"],
      );

      const promise = executeSubagent(
        paths,
        createDeps(paths, discovery).loadConfig(paths),
        discovery,
        { agent: "Scout", task: "Inspect repo" },
        "/repo",
        undefined,
        undefined,
        undefined,
        runtime,
      );

      await vi.advanceTimersByTimeAsync(20);
      const result = await promise;

      expect(result.isError).toBe(true);
      expect(result.content).toBe("Subagent timed out after 10ms.");
      expect(result.details.status).toBe("timeout");
      expect(result.details.stopReason).toBe("timeout");
      expect(result.details.exitCode).toBe(143);
      expect(child.killSignals[0]).toBe("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });

  test("surfaces spawn failures with structured error details", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const runtime = createRuntime(
      vi.fn(() => {
        throw new Error("spawn failed");
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toBe("spawn failed");
    expect(result.details.status).toBe("error");
    expect(result.details.stopReason).toBe("error");
    expect(result.details.exitCode).toBeNull();
  });

  test("retains only the most recent 10 tool activity entries", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          for (let i = 0; i < 12; i += 1) {
            child.stdout.write(
              `{"type":"tool_execution_start","toolCallId":"call-${i}","toolName":"read","args":{"path":"file-${i}.ts"}}\n`,
            );
          }
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const result = await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Inspect repo" },
      "/repo",
      undefined,
      undefined,
      undefined,
      runtime,
    );

    expect(result.isError).toBe(false);
    expect(result.details.recentToolActivity).toHaveLength(10);
    expect(result.details.recentToolActivity[0]).toEqual({
      label: "read start",
      preview: '{"path":"file-2.ts"}',
    });
    expect(result.details.recentToolActivity[9]).toEqual({
      label: "read start",
      preview: '{"path":"file-11.ts"}',
    });
  });
});

describe("subagent registration", () => {
  test("registers tool renderers and /agent command, and /agent sends a visible custom message", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const deps = createDeps(paths, discovery);
    const tools: Array<{ name: string; renderCall?: unknown; renderResult?: unknown }> = [];
    const commands = new Map<string, RegisteredCommand>();
    const messages: unknown[] = [];
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const pi = {
      registerTool(definition: { name: string; renderCall?: unknown; renderResult?: unknown }) {
        tools.push(definition);
      },
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      sendMessage(message: unknown) {
        messages.push(message);
      },
    } as unknown as ExtensionAPI;

    registerSubagentTool(pi, deps, runtime);
    registerAgentCommand(pi, deps, runtime);

    expect(tools).toContainEqual(
      expect.objectContaining({
        name: "subagent",
        renderCall: expect.any(Function),
        renderResult: expect.any(Function),
      }),
    );
    expect(commands.has("agent")).toBe(true);
    expect(parseAgentCommandArgs("Scout inspect this repo")).toEqual({
      agent: "Scout",
      task: "inspect this repo",
    });

    const handler = commands.get("agent")?.handler;
    expect(handler).toBeDefined();
    await handler?.("Scout inspect this repo", {
      cwd: "/repo",
      signal: undefined,
      sessionManager: {
        getSessionFile() {
          return undefined;
        },
        isPersisted() {
          return false;
        },
        getSessionDir() {
          return "/unused";
        },
      },
      ui: { notify() {} },
    } as never);

    expect(messages).toEqual([
      expect.objectContaining({
        customType: "pi-subagent-result",
        content: "done",
        display: true,
        details: expect.objectContaining({ stopReason: "end" }),
      }),
    ]);
  });

  test("/agent sends a visible error message for validation failures before spawn", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const deps = createDeps(paths, discovery);
    const commands = new Map<string, RegisteredCommand>();
    const messages: unknown[] = [];
    const notify = vi.fn();
    const runtime = createRuntime(
      vi.fn(() => {
        throw new Error("spawn should not be called");
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const pi = {
      registerTool() {},
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      sendMessage(message: unknown) {
        messages.push(message);
      },
    } as unknown as ExtensionAPI;

    registerAgentCommand(pi, deps, runtime);

    const handler = commands.get("agent")?.handler;
    expect(handler).toBeDefined();
    await handler?.("Scout", {
      cwd: "/repo",
      signal: undefined,
      sessionManager: {
        getSessionFile() {
          return undefined;
        },
        isPersisted() {
          return false;
        },
        getSessionDir() {
          return "/unused";
        },
      },
      ui: { notify },
    } as never);

    expect(messages).toEqual([
      expect.objectContaining({
        customType: "pi-subagent-result",
        content: 'Missing task for agent "Scout". Available agents: Scout',
        display: true,
        details: expect.objectContaining({ status: "error", stopReason: "error" }),
      }),
    ]);
    expect(notify).not.toHaveBeenCalled();
  });
});
