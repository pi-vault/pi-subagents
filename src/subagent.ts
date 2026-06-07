import { type ChildProcessByStdio, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
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
const SUBAGENT_EXTENSION_ENTRY = fileURLToPath(
  new URL("./index.ts", import.meta.url),
);
const NESTED_EVENTS_DIR_NAME = "nested-subagent-events";
const NESTED_RUNS_DIR_NAME = "nested-subagent-runs";
const ROUTE_FILE_NAME = "route.json";
const RUNTIME_STATE_FILE_NAME = "runtime.json";
const PI_SUBAGENT_CHILD = "PI_SUBAGENT_CHILD";
const PI_SUBAGENT_FANOUT_CHILD = "PI_SUBAGENT_FANOUT_CHILD";
const PI_SUBAGENT_RUN_ID = "PI_SUBAGENT_RUN_ID";
const PI_SUBAGENT_DEPTH = "PI_SUBAGENT_DEPTH";
const PI_SUBAGENT_MAX_DEPTH = "PI_SUBAGENT_MAX_DEPTH";
const PI_SUBAGENT_ALLOWED_AGENTS = "PI_SUBAGENT_ALLOWED_AGENTS";
const PI_SUBAGENT_RUNTIME_STATE = "PI_SUBAGENT_RUNTIME_STATE";
const PI_SUBAGENT_PARENT_EVENT_SINK = "PI_SUBAGENT_PARENT_EVENT_SINK";
const PI_SUBAGENT_PARENT_CONTROL_INBOX = "PI_SUBAGENT_PARENT_CONTROL_INBOX";
const PI_SUBAGENT_PARENT_ROOT_RUN_ID = "PI_SUBAGENT_PARENT_ROOT_RUN_ID";
const PI_SUBAGENT_PARENT_RUN_ID = "PI_SUBAGENT_PARENT_RUN_ID";
const PI_SUBAGENT_PARENT_CHILD_INDEX = "PI_SUBAGENT_PARENT_CHILD_INDEX";
const PI_SUBAGENT_PARENT_DEPTH = "PI_SUBAGENT_PARENT_DEPTH";
const PI_SUBAGENT_PARENT_PATH = "PI_SUBAGENT_PARENT_PATH";
const PI_SUBAGENT_PARENT_CAPABILITY_TOKEN =
  "PI_SUBAGENT_PARENT_CAPABILITY_TOKEN";

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
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildSpawn;

type NestedRuntimeContext = {
  isNestedChild: boolean;
  currentRunId?: string;
  depth: number;
  maxDepth: number;
  rootRunId?: string;
  allowedAgents?: string[];
  parentPath: string;
};

type NestedChildLaunch = {
  childArgs: string[];
  childEnv: NodeJS.ProcessEnv;
};

export interface SubagentRuntimeDeps {
  spawnChild: SpawnChildFn;
  now: () => number;
  createRunId: () => string;
  mkdtemp: (prefix: string) => string;
  writeFile: (path: string, content: string) => void;
  mkdirp: (path: string) => void;
  removePath: (path: string) => void;
  resolvePiInvocation: (childArgs: string[]) => {
    command: string;
    args: string[];
  };
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

function accumulateUsage(
  usage: SubagentUsage,
  message: JsonAssistantMessage,
): void {
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

function sanitizeScopeSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
}

function getScopeId(): string {
  const getuid = process.getuid;
  if (typeof getuid === "function") {
    try {
      return `uid-${String(getuid())}`;
    } catch {
      // Fall through.
    }
  }

  for (const key of ["USERNAME", "USER", "LOGNAME"] as const) {
    const username = process.env[key];
    if (username?.trim()) {
      return `user-${sanitizeScopeSegment(username)}`;
    }
  }

  try {
    const username = userInfo().username;
    if (username?.trim()) {
      return `user-${sanitizeScopeSegment(username)}`;
    }
  } catch {
    // Fall through to home-directory-based scoping.
  }

  const homeDir = process.env.USERPROFILE ?? process.env.HOME;
  if (homeDir?.trim()) {
    return `home-${sanitizeScopeSegment(homeDir)}`;
  }

  try {
    const resolvedHomeDir = homedir();
    if (resolvedHomeDir?.trim()) {
      return `home-${sanitizeScopeSegment(resolvedHomeDir)}`;
    }
  } catch {
    // Fall through to shared scope.
  }

  return "shared";
}

function getScopedTempRoot(): string {
  return join(tmpdir(), `pi-subagents-${getScopeId()}`);
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitCommaSeparatedList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readNestedRuntimeContext(
  loadedConfig: LoadedConfig,
): NestedRuntimeContext {
  const isNestedChild = process.env[PI_SUBAGENT_CHILD] === "1";
  const depth = parseInteger(process.env[PI_SUBAGENT_DEPTH], 0);
  const maxDepth = parseInteger(
    process.env[PI_SUBAGENT_MAX_DEPTH],
    loadedConfig.config.maxRecursiveLevel,
  );
  const allowedAgents =
    process.env[PI_SUBAGENT_ALLOWED_AGENTS] === undefined
      ? undefined
      : splitCommaSeparatedList(process.env[PI_SUBAGENT_ALLOWED_AGENTS]);

  return {
    isNestedChild,
    currentRunId: process.env[PI_SUBAGENT_RUN_ID]?.trim() || undefined,
    depth,
    maxDepth,
    rootRunId: process.env[PI_SUBAGENT_PARENT_ROOT_RUN_ID]?.trim() || undefined,
    allowedAgents,
    parentPath: process.env[PI_SUBAGENT_PARENT_PATH] ?? "",
  };
}

function ensureNestedDelegationAllowed(
  discovery: AgentDiscoveryResult,
  input: SubagentToolInput,
  context: NestedRuntimeContext,
): void {
  if (!context.isNestedChild) {
    return;
  }

  if (context.depth >= context.maxDepth) {
    throw new Error(
      `Nested delegation blocked at depth ${context.depth}; maxRecursiveLevel=${context.maxDepth}.`,
    );
  }

  const requestedAgent = input.agent.trim();
  const requestedKey = requestedAgent.toLowerCase();
  const allowedAgents = context.allowedAgents ?? [];
  if (allowedAgents.length === 0) {
    throw new Error(
      `Nested delegation is disabled for this agent. Allowed child agents: none. Requested: "${requestedAgent}". Available agents: ${listAvailableAgents(discovery)}`,
    );
  }

  const allowedKeys = new Set(
    allowedAgents.map((agentName) => agentName.trim().toLowerCase()),
  );
  if (!allowedKeys.has(requestedKey)) {
    throw new Error(
      `Child agent "${requestedAgent}" is not allowed. Allowed child agents: ${allowedAgents.join(", ")}. Available agents: ${listAvailableAgents(discovery)}`,
    );
  }
}

function buildChildArgs(
  agent: AgentDefinition,
  promptPath: string | undefined,
  childSessionPath: string,
  recursionEnabled: boolean,
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

  if (recursionEnabled) {
    args.push("--extension", SUBAGENT_EXTENSION_ENTRY);
  }

  const childTools = recursionEnabled
    ? agent.tools
    : agent.tools.filter((tool) => tool !== "subagent");
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

function withoutNestedSubagentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  for (const key of [
    PI_SUBAGENT_CHILD,
    PI_SUBAGENT_FANOUT_CHILD,
    PI_SUBAGENT_RUN_ID,
    PI_SUBAGENT_DEPTH,
    PI_SUBAGENT_MAX_DEPTH,
    PI_SUBAGENT_ALLOWED_AGENTS,
    PI_SUBAGENT_RUNTIME_STATE,
    PI_SUBAGENT_PARENT_EVENT_SINK,
    PI_SUBAGENT_PARENT_CONTROL_INBOX,
    PI_SUBAGENT_PARENT_ROOT_RUN_ID,
    PI_SUBAGENT_PARENT_RUN_ID,
    PI_SUBAGENT_PARENT_CHILD_INDEX,
    PI_SUBAGENT_PARENT_DEPTH,
    PI_SUBAGENT_PARENT_PATH,
    PI_SUBAGENT_PARENT_CAPABILITY_TOKEN,
  ]) {
    delete childEnv[key];
  }
  return childEnv;
}

function createNestedChildLaunch(
  agent: AgentDefinition,
  promptPath: string | undefined,
  childSessionPath: string,
  loadedConfig: LoadedConfig,
  runtime: SubagentRuntimeDeps,
  childRunId: string,
): NestedChildLaunch {
  const context = readNestedRuntimeContext(loadedConfig);
  const recursionEnabled =
    agent.tools.includes("subagent") && context.depth < context.maxDepth;
  const childArgs = buildChildArgs(
    agent,
    promptPath,
    childSessionPath,
    recursionEnabled,
  );

  if (!recursionEnabled) {
    return { childArgs, childEnv: withoutNestedSubagentEnv(process.env) };
  }

  const childDepth = context.depth + 1;
  const rootRunId = context.rootRunId ?? childRunId;
  const parentRunId = context.currentRunId ?? "";
  const capabilityToken = runtime.createRunId();
  const childIndex = "0";
  const scopedTempRoot = getScopedTempRoot();
  const routeDir = join(
    scopedTempRoot,
    NESTED_EVENTS_DIR_NAME,
    `${rootRunId}-${capabilityToken}`,
  );
  const parentEventSink = join(routeDir, "parent-event-sink.jsonl");
  const parentControlInbox = join(routeDir, "parent-control-inbox.jsonl");
  const routeFilePath = join(routeDir, ROUTE_FILE_NAME);
  const runtimeStatePath = join(
    scopedTempRoot,
    NESTED_RUNS_DIR_NAME,
    rootRunId,
    childRunId,
    RUNTIME_STATE_FILE_NAME,
  );
  const parentPath = context.currentRunId
    ? [context.parentPath, context.currentRunId].filter(Boolean).join("/")
    : context.parentPath;

  runtime.mkdirp(routeDir);
  runtime.mkdirp(dirname(runtimeStatePath));
  runtime.writeFile(
    routeFilePath,
    `${JSON.stringify(
      {
        rootRunId,
        parentRunId,
        childRunId,
        capabilityToken,
        childIndex,
        parentDepth: context.depth,
        parentPath,
        parentEventSink,
        parentControlInbox,
      },
      null,
      2,
    )}\n`,
  );
  runtime.writeFile(
    runtimeStatePath,
    `${JSON.stringify(
      {
        runId: childRunId,
        rootRunId,
        parentRunId,
        depth: childDepth,
        maxDepth: context.maxDepth,
        allowedAgents: agent.subagentAgents,
        routeDir,
        routeFilePath,
        parentEventSink,
        parentControlInbox,
        parentChildIndex: childIndex,
        parentDepth: context.depth,
        parentPath,
        parentCapabilityToken: capabilityToken,
      },
      null,
      2,
    )}\n`,
  );

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    [PI_SUBAGENT_CHILD]: "1",
    [PI_SUBAGENT_FANOUT_CHILD]: "1",
    [PI_SUBAGENT_RUN_ID]: childRunId,
    [PI_SUBAGENT_DEPTH]: String(childDepth),
    [PI_SUBAGENT_MAX_DEPTH]: String(context.maxDepth),
    [PI_SUBAGENT_ALLOWED_AGENTS]: agent.subagentAgents.join(","),
    [PI_SUBAGENT_RUNTIME_STATE]: runtimeStatePath,
    [PI_SUBAGENT_PARENT_EVENT_SINK]: parentEventSink,
    [PI_SUBAGENT_PARENT_CONTROL_INBOX]: parentControlInbox,
    [PI_SUBAGENT_PARENT_ROOT_RUN_ID]: rootRunId,
    [PI_SUBAGENT_PARENT_RUN_ID]: parentRunId,
    [PI_SUBAGENT_PARENT_CHILD_INDEX]: childIndex,
    [PI_SUBAGENT_PARENT_DEPTH]: String(context.depth),
    [PI_SUBAGENT_PARENT_PATH]: parentPath,
    [PI_SUBAGENT_PARENT_CAPABILITY_TOKEN]: capabilityToken,
  };

  return { childArgs, childEnv };
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
  const nestedContext = readNestedRuntimeContext(loadedConfig);
  ensureNestedDelegationAllowed(discovery, input, nestedContext);
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

    const launch = createNestedChildLaunch(
      agent,
      promptPath,
      childSessionPath,
      loadedConfig,
      runtime,
      runId,
    );
    const invocation = runtime.resolvePiInvocation([
      ...launch.childArgs,
      `Task: ${task}`,
    ]);
    const child = runtime.spawnChild(invocation.command, invocation.args, {
      cwd: effectiveCwd,
      env: launch.childEnv,
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

    const result = await new Promise<SubagentExecutionResult>(
      (resolveResult, reject) => {
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
              : (stopReason ?? (code === 0 ? "end" : "error"));
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
            content: isError ? failureText : finalText || "(no output)",
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
      },
    );

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
    async execute(
      _toolCallId,
      params,
      signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
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
