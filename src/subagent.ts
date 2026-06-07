import {
  type ChildProcessByStdio,
  spawn,
} from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
  RuntimeDeps,
  SubagentCommandMessage,
  SubagentExecutionResult,
  SubagentToolInput,
  SubagentUsage,
} from "./types.js";

const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the child pi process" }),
  ),
});

const TERMINATION_GRACE_MS = 2_000;
const CHILD_SESSION_FILE_NAME = "session.jsonl";

type JsonContentPart = { type: string; text?: string };
type JsonAssistantMessage = {
  role?: string;
  content?: JsonContentPart[];
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: { total?: number };
  };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
};

type JsonMessageEndEvent = {
  type?: string;
  message?: JsonAssistantMessage;
};

type ChildSpawn = ChildProcessByStdio<null, Readable, Readable>;

type SpawnChildFn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    shell: false;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildSpawn;

export interface SubagentRuntimeDeps {
  spawnChild: SpawnChildFn;
  now: () => number;
  createRunId: () => string;
  mkdtemp: (prefix: string) => string;
  writeFile: (path: string, content: string) => void;
  mkdirp: (path: string) => void;
  removePath: (path: string) => void;
  resolvePiInvocation: (childArgs: string[]) => { command: string; args: string[] };
}

export function createSubagentRuntimeDeps(): SubagentRuntimeDeps {
  return {
    spawnChild: (command, args, options) => spawn(command, args, options),
    now: () => Date.now(),
    createRunId: () => Math.random().toString(36).slice(2, 12),
    mkdtemp: (prefix) => mkdtempSync(prefix),
    writeFile: (path, content) =>
      writeFileSync(path, content, { encoding: "utf8", mode: 0o600 }),
    mkdirp: (path) => mkdirSync(path, { recursive: true }),
    removePath: (path) => rmSync(path, { recursive: true, force: true }),
    resolvePiInvocation: (childArgs) => resolvePiInvocation(childArgs),
  };
}

export function resolvePiInvocation(childArgs: string[]): {
  command: string;
  args: string[];
} {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript) {
    try {
      readFileSync(currentScript, "utf8");
      return { command: process.execPath, args: [currentScript, ...childArgs] };
    } catch {
      // Fall through to other options.
    }
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args: childArgs };
  }

  return { command: "pi", args: childArgs };
}

export function findAgentByName(
  discovery: AgentDiscoveryResult,
  requestedName: string,
): AgentDefinition | undefined {
  const normalized = requestedName.trim().toLowerCase();
  return discovery.agents.find(
    (agent) => agent.name.trim().toLowerCase() === normalized,
  );
}

function listAvailableAgents(discovery: AgentDiscoveryResult): string {
  return discovery.agents.length > 0
    ? discovery.agents.map((agent) => agent.name).join(", ")
    : "none";
}

function createUsage(): SubagentUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    contextTokens: 0,
    cost: 0,
    turns: 0,
  };
}

function getAssistantText(message: JsonAssistantMessage | undefined): string {
  if (!message?.content) {
    return "";
  }

  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

function accumulateUsage(usage: SubagentUsage, message: JsonAssistantMessage): void {
  usage.turns += 1;
  usage.input += message.usage?.input ?? 0;
  usage.output += message.usage?.output ?? 0;
  usage.cacheRead += message.usage?.cacheRead ?? 0;
  usage.cacheWrite += message.usage?.cacheWrite ?? 0;
  usage.contextTokens = message.usage?.totalTokens ?? usage.contextTokens;
  usage.cost += message.usage?.cost?.total ?? 0;
}

function getCliModel(agent: AgentDefinition): string | undefined {
  return agent.model && agent.model !== "default" ? agent.model : undefined;
}

function buildChildArgs(
  agent: AgentDefinition,
  promptPath: string | undefined,
  childSessionPath: string,
): string[] {
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-extensions",
    "--session",
    childSessionPath,
    "--name",
    agent.name,
  ];

  const childTools = agent.tools.filter((tool) => tool !== "subagent");
  if (childTools.length > 0) {
    args.push("--tools", childTools.join(","));
  }
  const cliModel = getCliModel(agent);
  if (cliModel) {
    args.push("--model", cliModel);
  }
  if (agent.thinking) {
    args.push("--thinking", agent.thinking);
  }
  if (promptPath) {
    args.push("--append-system-prompt", promptPath);
  }

  return args;
}

function parseSubagentRequest(
  discovery: AgentDiscoveryResult,
  input: SubagentToolInput,
): AgentDefinition {
  const requestedAgent = input.agent.trim();
  if (!requestedAgent) {
    throw new Error(
      `Missing agent. Available agents: ${listAvailableAgents(discovery)}`,
    );
  }

  const task = input.task.trim();
  if (!task) {
    throw new Error(
      `Missing task for agent "${requestedAgent}". Available agents: ${listAvailableAgents(discovery)}`,
    );
  }

  const agent = findAgentByName(discovery, requestedAgent);
  if (!agent) {
    throw new Error(
      `Unknown agent: "${requestedAgent}". Available agents: ${listAvailableAgents(discovery)}`,
    );
  }

  return agent;
}

function getParentSessionStem(parentSessionFile: string): string {
  return basename(parentSessionFile, ".jsonl");
}

function resolveChildSessionTarget(
  parentSessionFile: string | undefined,
  parentSessionDir: string | undefined,
  runtime: SubagentRuntimeDeps,
  runId: string,
): {
  childSessionDir: string;
  childSessionPath: string;
} {
  const childSessionRoot = parentSessionFile
    ? join(
        parentSessionDir ?? dirname(parentSessionFile),
        getParentSessionStem(parentSessionFile),
      )
    : runtime.mkdtemp(join(tmpdir(), "pi-subagent-session-"));
  const childSessionDir = join(childSessionRoot, runId, "run-0");

  return {
    childSessionDir,
    childSessionPath: join(childSessionDir, CHILD_SESSION_FILE_NAME),
  };
}

export function parseAgentCommandArgs(args: string): SubagentToolInput {
  const trimmed = args.trim();
  if (!trimmed) {
    return { agent: "", task: "" };
  }

  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) {
    return { agent: trimmed, task: "" };
  }

  return {
    agent: trimmed.slice(0, firstSpace),
    task: trimmed.slice(firstSpace).trim(),
  };
}

export async function executeSubagent(
  _paths: ResolvedPaths,
  loadedConfig: LoadedConfig,
  discovery: AgentDiscoveryResult,
  input: SubagentToolInput,
  defaultCwd: string,
  signal: AbortSignal | undefined,
  parentSessionFile: string | undefined,
  parentSessionDir: string | undefined,
  runtime: SubagentRuntimeDeps = createSubagentRuntimeDeps(),
): Promise<SubagentExecutionResult> {
  const startedAt = runtime.now();
  const agent = parseSubagentRequest(discovery, input);
  const task = input.task.trim();
  const timeoutMs = agent.timeoutMs ?? loadedConfig.config.defaultTimeoutMs;
  const effectiveCwd = input.cwd ?? defaultCwd;
  const runId = runtime.createRunId();
  const { childSessionDir, childSessionPath } = resolveChildSessionTarget(
    parentSessionFile,
    parentSessionDir,
    runtime,
    runId,
  );
  let promptDir: string | undefined;
  let promptPath: string | undefined;

  runtime.mkdirp(childSessionDir);

  try {
    if (agent.systemPrompt.trim()) {
      promptDir = runtime.mkdtemp(join(tmpdir(), "pi-subagents-"));
      promptPath = join(
        promptDir,
        `${agent.name.replace(/[^A-Za-z0-9_-]+/g, "_").toLowerCase()}.md`,
      );
      runtime.writeFile(promptPath, agent.systemPrompt);
    }

    const childArgs = [
      ...buildChildArgs(agent, promptPath, childSessionPath),
      `Task: ${task}`,
    ];
    const invocation = runtime.resolvePiInvocation(childArgs);
    const child = runtime.spawnChild(invocation.command, invocation.args, {
      cwd: effectiveCwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const usage = createUsage();
    let finalText = "";
    let model = getCliModel(agent);
    let stopReason: string | undefined;
    let errorMessage: string | undefined;
    let stderr = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let aborted = false;
    let stdoutBuffer = "";
    let terminated = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const terminate = (reason: "timeout" | "aborted") => {
      if (terminated) {
        return;
      }
      terminated = true;
      if (reason === "timeout") {
        timedOut = true;
      } else {
        aborted = true;
      }
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, TERMINATION_GRACE_MS);
    };

    const processLine = (line: string) => {
      if (!line.trim()) {
        return;
      }

      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        return;
      }

      if (
        typeof event !== "object" ||
        event === null ||
        !("type" in event) ||
        event.type !== "message_end"
      ) {
        return;
      }

      const messageEvent = event as JsonMessageEndEvent;
      if (messageEvent.message?.role !== "assistant") {
        return;
      }

      finalText = getAssistantText(messageEvent.message);
      accumulateUsage(usage, messageEvent.message);
      model = messageEvent.message.model ?? model;
      stopReason = messageEvent.message.stopReason ?? stopReason;
      errorMessage = messageEvent.message.errorMessage ?? errorMessage;
    };

    const result = await new Promise<SubagentExecutionResult>((resolveResult, reject) => {
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          processLine(line);
        }
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        exitCode = code;
        if (stdoutBuffer.trim()) {
          processLine(stdoutBuffer);
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }

        const durationMs = runtime.now() - startedAt;
        const normalizedStopReason = timedOut
          ? "timeout"
          : aborted
            ? "aborted"
            : stopReason ?? (code === 0 ? "end" : "error");
        const failureText = timedOut
          ? `Subagent timed out after ${timeoutMs}ms.`
          : aborted
            ? "Subagent aborted."
            : (errorMessage ?? stderr.trim()) ||
              `Subagent exited with code ${code ?? "unknown"}.`;
        const isError =
          timedOut ||
          aborted ||
          (code ?? 0) !== 0 ||
          normalizedStopReason === "error" ||
          normalizedStopReason === "aborted";

        resolveResult({
          content: isError ? failureText : (finalText || "(no output)"),
          isError,
          details: {
            agent: agent.name,
            sourcePath: agent.sourcePath,
            cwd: effectiveCwd,
            timeoutMs,
            durationMs,
            childSessionDir,
            childSessionPath,
            model,
            stopReason: normalizedStopReason,
            exitCode,
            stderr,
            usage,
          },
        });
      });

      if (signal) {
        if (signal.aborted) {
          terminate("aborted");
        } else {
          signal.addEventListener("abort", () => terminate("aborted"), {
            once: true,
          });
        }
      }

      timeoutHandle = setTimeout(() => terminate("timeout"), timeoutMs);
    });

    return result;
  } finally {
    if (promptDir) {
      runtime.removePath(promptDir);
    }
  }
}

export function registerSubagentTool(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
  runtime: SubagentRuntimeDeps = createSubagentRuntimeDeps(),
): void {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a task to a discovered agent in an isolated foreground pi process.",
    parameters: SUBAGENT_TOOL_PARAMETERS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);
      const parentSessionFile = ctx.sessionManager.getSessionFile();
      const result = await executeSubagent(
        paths,
        loadedConfig,
        discovery,
        params,
        ctx.cwd,
        signal,
        parentSessionFile,
        parentSessionFile ? ctx.sessionManager.getSessionDir() : undefined,
        runtime,
      );

      return {
        content: [{ type: "text", text: result.content }],
        isError: result.isError,
        details: result.details,
      };
    },
  });
}

export function registerAgentCommand(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
  runtime: SubagentRuntimeDeps = createSubagentRuntimeDeps(),
): void {
  pi.registerCommand("agent", {
    description: "Run a discovered pi-subagents agent in the foreground",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const input = parseAgentCommandArgs(args);
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);

      try {
        const parentSessionFile = ctx.sessionManager.getSessionFile();
        const result = await executeSubagent(
          paths,
          loadedConfig,
          discovery,
          input,
          ctx.cwd,
          ctx.signal,
          parentSessionFile,
          parentSessionFile ? ctx.sessionManager.getSessionDir() : undefined,
          runtime,
        );

        const message: SubagentCommandMessage = {
          customType: "pi-subagent-result",
          content: result.content,
          display: true,
          details: result.details,
        };
        pi.sendMessage(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pi.sendMessage({
          customType: "pi-subagent-result",
          content: message,
          display: true,
        });
      }
    },
  });
}
