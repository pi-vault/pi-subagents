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
import { encodePiCwd } from "../src/shared/artifacts.js";
import {
  getDeferredSlashRequest,
  hydrateDeferredSlashRequestsFromSession,
  setDeferredSlashRuntimeState,
  takeDeferredSlashRuntimeState,
} from "../src/core/deferred-slash-state.js";
import { startSlashLiveRequest } from "../src/core/slash-live-state.js";
import {
  executeSubagent,
  parseAgentCommandArgs,
  registerAgentCommand,
  registerSlashAgentBridge,
  registerSubagentTool,
  type SubagentRuntimeDeps,
} from "../src/core/subagent.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
  RuntimeDeps,
} from "../src/shared/types.js";

function createPaths(rootDir: string): ResolvedPaths {
  return {
    agentDir: join(rootDir, "agent"),
    configPath: join(rootDir, "agent", "extensions", "subagents.json"),
    userAgentsDir: join(rootDir, "agent", "agents"),
    bundledAgentsDir: join(rootDir, "bundled-agents"),
    sessionsDir: join(rootDir, "agent", "sessions"),
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
      maxRecursiveLevel: 3,
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
    exportAgentToUserScope: () => {
      throw new Error("not used");
    },
    disableAgentInUserScope: () => {
      throw new Error("not used");
    },
    deleteUserAgentOverride: () => {
      throw new Error("not used");
    },
    saveConfig: () => {
      throw new Error("not used");
    },
  };
}

function createRuntime(
  spawnChild: SubagentRuntimeDeps["spawnChild"],
  options: {
    runId?: string;
  } = {},
): SubagentRuntimeDeps {
  const { runId = "run-123" } = options;

  return {
    spawnChild,
    now: (() => {
      let time = 0;
      return () => ++time;
    })(),
    createRunId: () => runId,
    mkdtemp: (prefix) => mkdtempSync(prefix),
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
      undefined,
      runtime,
    );

    expect(result.content).toBe("final answer");
    expect(result.isError).toBe(false);
    const artifactPaths = {
      input: join(
        parentSessionDir,
        "subagent-artifacts",
        "run-123_Scout_0_input.md",
      ),
      output: join(
        parentSessionDir,
        "subagent-artifacts",
        "run-123_Scout_0_output.md",
      ),
      meta: join(
        parentSessionDir,
        "subagent-artifacts",
        "run-123_Scout_0_meta.json",
      ),
    };

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
      artifactPaths,
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
    expect(readFileSync(artifactPaths.input, "utf8")).toContain("Inspect repo");
    expect(readFileSync(artifactPaths.output, "utf8")).toContain("final answer");
    expect(JSON.parse(readFileSync(artifactPaths.meta, "utf8"))).toMatchObject({
      runId: "run-123",
      agent: "Scout",
      status: "success",
      cwd: "/worktree",
      childSessionPath,
      stopReason: "end",
      exitCode: 0,
    });
  });

  test("inherits the parent session model when agent model is default", async () => {
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
      "openai/gpt-5",
      runtime,
    );

    expect(result.isError).toBe(false);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toEqual(
      expect.arrayContaining(["--model", "openai/gpt-5"]),
    );
    expect(result.details.model).toBe("openai/gpt-5");
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
      PI_SUBAGENT_MAX_DEPTH: "3",
      PI_SUBAGENT_ALLOWED_AGENTS: "researcher,scout",
      PI_SUBAGENT_PARENT_ROOT_RUN_ID: "run-123",
      PI_SUBAGENT_PARENT_RUN_ID: "",
      PI_SUBAGENT_PARENT_CHILD_INDEX: "0",
      PI_SUBAGENT_PARENT_DEPTH: "0",
      PI_SUBAGENT_PARENT_PATH: "",
    });

    const runtimeStatePath = spawnCalls[0]?.env?.PI_SUBAGENT_RUNTIME_STATE;
    expect(runtimeStatePath).toBeTruthy();
    expect(runtimeStatePath).toContain(
      join(paths.sessionsDir, encodePiCwd("/repo"), "subagent-artifacts"),
    );
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
      maxDepth: 3,
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
      PI_SUBAGENT_MAX_DEPTH: "3",
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
      maxDepth: 3,
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

  test("uses the pi encoded cwd session root for no-session parents", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const encodedCwd = encodePiCwd("/repo");
    const childSessionDir = join(
      paths.sessionsDir,
      encodedCwd,
      "__foreground__",
      "run-123",
      "run-0",
    );
    const childSessionPath = join(childSessionDir, "session.jsonl");
    const runtime = createRuntime(
      ((_, args, ___) => {
        const sessionIndex = args.indexOf("--session");
        writeChildSessionFile(args[sessionIndex + 1] ?? childSessionPath);
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
      undefined,
      runtime,
    );

    expect(result.details.childSessionDir).toBe(childSessionDir);
    expect(result.details.childSessionPath).toBe(childSessionPath);
    expect(result.details.artifactPaths).toEqual({
      input: join(
        paths.sessionsDir,
        encodedCwd,
        "subagent-artifacts",
        "run-123_Scout_0_input.md",
      ),
      output: join(
        paths.sessionsDir,
        encodedCwd,
        "subagent-artifacts",
        "run-123_Scout_0_output.md",
      ),
      meta: join(
        paths.sessionsDir,
        encodedCwd,
        "subagent-artifacts",
        "run-123_Scout_0_meta.json",
      ),
    });
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
      undefined,
      runtime,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toBe("child failed");
    expect(result.details.status).toBe("error");
    expect(result.details.exitCode).toBe(2);
    expect(result.details.stopReason).toBe("error");
    expect(result.details.stderr).toBe("child failed");
    expect(readFileSync(result.details.artifactPaths?.output ?? "", "utf8")).toContain(
      "child failed",
    );
    expect(
      JSON.parse(readFileSync(result.details.artifactPaths?.meta ?? "", "utf8")),
    ).toMatchObject({
      status: "error",
      error: "child failed",
      exitCode: 2,
      stopReason: "error",
    });
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
      expect(
        JSON.parse(readFileSync(result.details.artifactPaths?.meta ?? "", "utf8")),
      ).toMatchObject({
        status: "timeout",
        error: "Subagent timed out after 10ms.",
        exitCode: 143,
      });
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
      undefined,
      runtime,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toBe("spawn failed");
    expect(result.details.status).toBe("error");
    expect(result.details.stopReason).toBe("error");
    expect(result.details.exitCode).toBeNull();
    expect(readFileSync(result.details.artifactPaths?.output ?? "", "utf8")).toContain(
      "spawn failed",
    );
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

  test("injects preloaded skills into the system prompt file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-skills-"));
    const skillsDir = join(cwd, ".pi", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "test-skill.md"), "# Test Skill\nDo TDD.");

    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [createAgent({ skills: ["test-skill"], systemPrompt: "You are Worker." })],
      diagnostics: [],
    };

    const writtenFiles: Array<{ path: string; content: string }> = [];
    const runtime: SubagentRuntimeDeps = {
      spawnChild: ((_command, _args, _options) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
      now: (() => {
        let time = 0;
        return () => ++time;
      })(),
      createRunId: () => "run-123",
      mkdtemp: (prefix) => mkdtempSync(prefix),
      writeFile: (path, content) => {
        writtenFiles.push({ path, content });
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

    await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Do work", cwd },
      "/repo",
      undefined,
      undefined,
      undefined,
      undefined,
      runtime,
    );

    const promptFile = writtenFiles.find((f) => f.path.endsWith(".md"));
    expect(promptFile).toBeDefined();
    const writtenPrompt = promptFile?.content ?? "";

    expect(writtenPrompt).toContain("You are Worker.");
    expect(writtenPrompt).toContain("# Preloaded Skill: test-skill");
    expect(writtenPrompt).toContain("Do TDD.");

    rmSync(cwd, { recursive: true, force: true });
  });

  test("skills: false suppresses skill injection", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-no-skills-"));
    const skillsDir = join(cwd, ".pi", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "unwanted.md"),
      "# Unwanted\nShould not appear.",
    );

    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [createAgent({ skills: false, systemPrompt: "You are Worker." })],
      diagnostics: [],
    };

    const writtenFiles: Array<{ path: string; content: string }> = [];
    const runtime: SubagentRuntimeDeps = {
      spawnChild: ((_command, _args, _options) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
      now: (() => {
        let time = 0;
        return () => ++time;
      })(),
      createRunId: () => "run-123",
      mkdtemp: (prefix) => mkdtempSync(prefix),
      writeFile: (path, content) => {
        writtenFiles.push({ path, content });
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

    await executeSubagent(
      paths,
      createDeps(paths, discovery).loadConfig(paths),
      discovery,
      { agent: "Scout", task: "Do work", cwd },
      "/repo",
      undefined,
      undefined,
      undefined,
      undefined,
      runtime,
    );

    const promptFile = writtenFiles.find((f) => f.path.endsWith(".md"));
    expect(promptFile).toBeDefined();
    const writtenPrompt = promptFile?.content ?? "";

    expect(writtenPrompt).toContain("You are Worker.");
    expect(writtenPrompt).not.toContain("Preloaded Skill");
    expect(writtenPrompt).not.toContain("Unwanted");

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("deferred slash state", () => {
  test("deferred slash requests survive reload via session-backed persistence", () => {
    const entries = [
      {
        type: "custom",
        customType: "pi-subagents:deferred-request",
        data: {
          requestId: "req-persist-1",
          agent: "Scout",
          task: "inspect repo",
          cwd: "/repo",
          createdAt: 1,
        },
      },
    ];

    hydrateDeferredSlashRequestsFromSession({
      getEntries() {
        return entries as never[];
      },
    } as never);

    expect(getDeferredSlashRequest("req-persist-1")).toMatchObject({
      requestId: "req-persist-1",
      agent: "Scout",
      task: "inspect repo",
    });
  });

  test("runtime-only deferred slash state is returned once", () => {
    setDeferredSlashRuntimeState("req-runtime-1", {
      signal: undefined,
      requestRender: () => undefined,
      cleanup: () => undefined,
    });

    expect(takeDeferredSlashRuntimeState("req-runtime-1")).toBeDefined();
    expect(takeDeferredSlashRuntimeState("req-runtime-1")).toBeUndefined();
  });
});

describe("subagent registration", () => {
  test("agent command queues followUp ticket and persists request payload", async () => {
    const appended: Array<{ customType: string; data: unknown }> = [];
    const sent: Array<{ text: string; options?: unknown }> = [];
    const commands = new Map<string, RegisteredCommand>();
    const deps = createDeps(createPaths("/tmp/pi-subagents-cmd"), {
      agents: [createAgent({ systemPrompt: "" })],
      diagnostics: [],
    });
    const runtime = createRuntime(vi.fn() as never, { runId: "req-busy-1" });

    const pi = {
      on() {},
      events: { emit() {}, on() { return () => {}; } },
      registerTool() {},
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      appendEntry(customType: string, data: unknown) {
        appended.push({ customType, data });
      },
      sendMessage() {},
      sendUserMessage(text: string, options?: unknown) {
        sent.push({ text, options });
      },
    } as unknown as ExtensionAPI;

    registerAgentCommand(pi, deps, runtime);
    await commands.get("agent")?.handler("Scout inspect repo", {
      cwd: "/repo",
      signal: undefined,
      model: { provider: "openai", id: "gpt-5" },
      isIdle() {
        return false;
      },
      sessionManager: {
        getSessionFile() {
          return "/sessions/parent.jsonl";
        },
        isPersisted() {
          return true;
        },
        getSessionDir() {
          return "/sessions";
        },
        getEntries() {
          return [];
        },
      },
      ui: { notify() {}, setWidget() {} },
    } as never);

    expect(appended[0]?.customType).toBe("pi-subagents:deferred-request");
    expect(sent[0]).toMatchObject({
      text: expect.stringContaining("__pi_subagents_deferred__"),
      options: { deliverAs: "followUp" },
    });
  });

  test("bridge finalizes slash-live request with error when deferred ticket has no persisted payload", async () => {
    const sentMessages: unknown[] = [];
    const inputHandlers: Array<(event: { source: string; text: string }) => unknown> = [];
    const deps = createDeps(createPaths("/tmp/pi-subagents-bridge"), {
      agents: [createAgent({ systemPrompt: "" })],
      diagnostics: [],
    });
    const runtime = createRuntime(vi.fn() as never, { runId: "req-missing-1" });
    startSlashLiveRequest({
      requestId: "req-missing-1",
      agent: "Scout",
      task: "inspect repo",
      cwd: "/repo",
      model: "gpt-5",
    });

    const pi = {
      on(event: string, handler: (payload: unknown) => unknown) {
        if (event === "input") inputHandlers.push(handler as never);
      },
      events: { emit() {}, on() { return () => {}; } },
      registerTool() {},
      registerCommand() {},
      sendUserMessage() {},
      sendMessage(message: unknown) {
        sentMessages.push(message);
      },
    } as unknown as ExtensionAPI;

    registerSlashAgentBridge(pi, deps, runtime);
    await inputHandlers[0]?.({
      source: "extension",
      text: "__pi_subagents_deferred__ req-missing-1",
    });

    expect(sentMessages).toContainEqual(
      expect.objectContaining({
        customType: "pi-subagent-result",
        content: expect.stringContaining("Deferred /agent request could not be restored"),
      }),
    );
  });
  test("deferred slash bridge clears the zero-height ticker widget after completion", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const deps = createDeps(paths, discovery);
    const commands = new Map<string, RegisteredCommand>();
    const appended: Array<{ customType: string; data: unknown }> = [];
    let inputHandler:
      | ((event: { text: string; source: "extension" }, ctx: unknown) => Promise<{ action: "handled" } | undefined>)
      | undefined;
    const setWidget = vi.fn();
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n');
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
      { runId: "req-cleanup-1" },
    );

    const pi = {
      on(_event: string, handler: typeof inputHandler) {
        inputHandler = handler;
      },
      appendEntry(customType: string, data: unknown) {
        appended.push({ customType, data });
      },
      registerTool() {},
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      sendMessage() {},
      sendUserMessage(text: string) {
        return inputHandler?.(
          { text, source: "extension" },
          {
            cwd: "/repo",
            signal: undefined,
            model: { provider: "openai", id: "gpt-5" },
            sessionManager: {
              getSessionFile() {
                return "/sessions/parent.jsonl";
              },
              getSessionDir() {
                return "/sessions";
              },
            },
          },
        );
      },
    } as unknown as ExtensionAPI;

    registerSlashAgentBridge(pi, deps, runtime);
    registerAgentCommand(pi, deps, runtime);

    await commands.get("agent")?.handler("Scout inspect this repo", {
      cwd: "/repo",
      signal: undefined,
      isIdle() {
        return true;
      },
      model: { provider: "openai", id: "gpt-5" },
      sessionManager: {
        getSessionFile() {
          return "/sessions/parent.jsonl";
        },
        isPersisted() {
          return true;
        },
        getSessionDir() {
          return "/sessions";
        },
        getEntries() {
          return [];
        },
      },
      ui: { setWidget, notify() {} },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appended.some((entry) => entry.customType === "pi-subagents:deferred-request")).toBe(true);
    expect(setWidget).toHaveBeenCalledWith("pi-subagents-ticker-req-cleanup-1", undefined);
  });

  test("/agent finalizes controller on bridge unavailable", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const deps = createDeps(paths, discovery);
    const commands = new Map<string, RegisteredCommand>();
    const messages: unknown[] = [];
    const pi = {
      registerTool() {},
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      sendMessage(message: unknown) {
        messages.push(message);
      },
    } as unknown as ExtensionAPI;

    registerAgentCommand(pi, deps, undefined, () => false);

    await commands.get("agent")?.handler("Scout inspect this repo", {
      cwd: "/repo",
      signal: undefined,
      isIdle() {
        return true;
      },
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

    expect(messages).toContainEqual(
      expect.objectContaining({
        customType: "pi-subagent-result",
        content: "No active pi-subagents runtime bridge is available for /agent.",
      }),
    );
  });

  test("/agent emits one live slash card instead of appending every progress update", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const deps = createDeps(paths, discovery);
    const tools: Array<{ name: string; renderCall?: unknown; renderResult?: unknown }> = [];
    const commands = new Map<string, RegisteredCommand>();
    const messages: unknown[] = [];
    const appended: Array<{ customType: string; data: unknown }> = [];
    let inputHandler:
      | ((event: { text: string; source: "extension" }, ctx: unknown) => Promise<{ action: "handled" } | undefined>)
      | undefined;
    const runtime = createRuntime(
      ((_, __, ___) => {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write(
            '{"type":"tool_execution_start","toolName":"read","args":{"path":"package.json"}}\n',
          );
          child.stdout.write(
            '{"type":"tool_execution_end","toolName":"read","result":{"ok":true},"isError":false}\n',
          );
          child.stdout.write(
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"end"}}\n',
          );
          child.close(0);
        });
        return child as never;
      }) as SubagentRuntimeDeps["spawnChild"],
    );

    const pi = {
      on(_event: string, handler: typeof inputHandler) {
        inputHandler = handler;
      },
      registerTool(definition: { name: string; renderCall?: unknown; renderResult?: unknown }) {
        tools.push(definition);
      },
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      appendEntry(customType: string, data: unknown) {
        appended.push({ customType, data });
      },
      sendMessage(message: unknown) {
        messages.push(message);
      },
      sendUserMessage(text: string) {
        return inputHandler?.(
          { text, source: "extension" },
          {
            cwd: "/repo",
            signal: undefined,
            model: { provider: "openai", id: "gpt-5" },
            sessionManager: {
              getSessionFile() {
                return "/sessions/parent.jsonl";
              },
              getSessionDir() {
                return "/sessions";
              },
            },
          },
        );
      },
    } as unknown as ExtensionAPI;

    registerSlashAgentBridge(pi, deps, runtime);
    registerSubagentTool(pi, deps, runtime);
    registerAgentCommand(pi, deps, runtime, () => true);

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
      isIdle() {
        return true;
      },
      sessionManager: {
        getSessionFile() {
          return "/sessions/parent.jsonl";
        },
        isPersisted() {
          return true;
        },
        getSessionDir() {
          return "/sessions";
        },
        getEntries() {
          return [];
        },
      },
      ui: { notify() {}, setWidget() {} },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages).toEqual([
      expect.objectContaining({
        customType: "pi-subagent-result",
        details: expect.objectContaining({
          kind: "slash-live",
          requestId: expect.any(String),
        }),
      }),
    ]);
  });

  test("/agent reports a visible bridge error when no runtime bridge is available", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-subagent-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [createAgent({ systemPrompt: "" })], diagnostics: [] };
    const deps = createDeps(paths, discovery);
    const commands = new Map<string, RegisteredCommand>();
    const messages: unknown[] = [];

    const pi = {
      registerTool() {},
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      sendMessage(message: unknown) {
        messages.push(message);
      },
    } as unknown as ExtensionAPI;

    registerAgentCommand(pi, deps, undefined, () => false);

    const handler = commands.get("agent")?.handler;
    expect(handler).toBeDefined();
    await handler?.("Scout", {
      cwd: "/repo",
      signal: undefined,
      isIdle() {
        return true;
      },
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
        content: "No active pi-subagents runtime bridge is available for /agent.",
        display: true,
      }),
    ]);
  });
});
