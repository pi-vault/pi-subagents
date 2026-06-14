import { type ChildProcessByStdio, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  getArtifactPaths,
  resolvePiEncodedSessionDir,
  resolveRuntimeArtifactsPaths,
  writeArtifact,
  writeMetadata,
} from "../shared/artifacts.js";
import {
  finalizeSlashLiveRequest,
  startSlashLiveRequest,
  updateSlashLiveRequest,
} from "./slash-live-state.js";
import {
  getDeferredSlashRequest,
  markDeferredSlashRequestConsumed,
  rememberDeferredSlashRequest,
  setDeferredSlashRuntimeState,
  takeDeferredSlashRuntimeState,
} from "./deferred-slash-state.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  ArtifactPaths,
  LoadedConfig,
  ResolvedPaths,
  RuntimeDeps,
  SubagentExecutionResult,
  SlashSubagentRequestPayload,
  SubagentToolActivity,
  SubagentToolInput,
  SubagentUsage,
} from "../shared/types.js";
import {
  renderSubagentCall,
  renderSubagentResult,
  toSubagentCommandMessage,
} from "../tui/render.js";
import { resolveSkillPaths } from "./skill-loader.js";

const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the child pi process" }),
  ),
});

const TERMINATION_GRACE_MS = 2_000;
const CHILD_SESSION_FILE_NAME = "session.jsonl";
const SYNTHETIC_PARENT_SESSION_STEM = "__foreground__";
const SUBAGENT_EXTENSION_ENTRY = fileURLToPath(
  new URL("../index.ts", import.meta.url),
);
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
const DEFERRED_TICKET_PREFIX = "__pi_subagents_deferred__ ";
const SLASH_AGENT_BRIDGE_UNAVAILABLE =
  "No active pi-subagents runtime bridge is available for /agent.";

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

type JsonToolExecutionStartEvent = {
  type?: string;
  toolName?: string;
  args?: unknown;
};

type JsonToolExecutionEndEvent = {
  type?: string;
  toolName?: string;
  result?: unknown;
  isError?: boolean;
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

type ProgressUpdate = {
  durationMs?: number;
  childSessionPath?: string;
  stderr?: string;
  activity?: SubagentToolActivity;
};

type ArtifactWriteInput = {
  requestedAgent: string;
  resolvedAgentName?: string;
  task: string;
  cwd: string;
  runId: string;
  sourcePath?: string;
  parentSessionFile?: string;
  parentSessionDir?: string;
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

function resolveEffectiveModel(
  agent: AgentDefinition,
  parentModel: string | undefined,
): string | undefined {
  const agentModel = agent.model?.trim();
  if (agentModel && agentModel.toLowerCase() !== "default") {
    return agentModel;
  }
  return parentModel?.trim() || undefined;
}

function getParentModelId(
  model:
    | {
        provider?: string;
        id?: string;
      }
    | undefined,
): string | undefined {
  if (!model) {
    return undefined;
  }

  if (model.provider?.trim() && model.id?.trim()) {
    return `${model.provider}/${model.id}`;
  }

  return model.id?.trim() || undefined;
}

function previewValue(value: unknown, maxLength = 120): string {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) {
      return "-";
    }
    return compact.length > maxLength
      ? `${compact.slice(0, maxLength - 3)}...`
      : compact;
  }

  if (value === null || value === undefined) {
    return "-";
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return "-";
    }
    return serialized.length > maxLength
      ? `${serialized.slice(0, maxLength - 3)}...`
      : serialized;
  } catch {
    return String(value);
  }
}

function pushRecentToolActivity(
  recentToolActivity: SubagentToolActivity[],
  activity: SubagentToolActivity,
): void {
  recentToolActivity.push(activity);
  if (recentToolActivity.length > 10) {
    recentToolActivity.splice(0, recentToolActivity.length - 10);
  }
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
  effectiveModel: string | undefined,
  cwd: string,
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
  if (effectiveModel) {
    args.push("--model", effectiveModel);
  }
  if (agent.thinking) {
    args.push("--thinking", agent.thinking);
  }
  if (promptPath) {
    args.push("--append-system-prompt", promptPath);
  }

  // Always suppress host autodiscovery; only pass explicit skills
  args.push("--no-skills");
  if (Array.isArray(agent.skills)) {
    for (const skill of resolveSkillPaths(agent.skills, cwd)) {
      args.push("--skill", skill.path);
    }
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
  paths: ResolvedPaths,
  cwd: string,
  agent: AgentDefinition,
  promptPath: string | undefined,
  childSessionPath: string,
  loadedConfig: LoadedConfig,
  runtime: SubagentRuntimeDeps,
  childRunId: string,
  parentSessionFile: string | undefined,
  parentSessionDir: string | undefined,
  effectiveModel: string | undefined,
): NestedChildLaunch {
  const context = readNestedRuntimeContext(loadedConfig);
  const recursionEnabled =
    agent.tools.includes("subagent") && context.depth < context.maxDepth;
  const childArgs = buildChildArgs(
    agent,
    promptPath,
    childSessionPath,
    recursionEnabled,
    effectiveModel,
    cwd,
  );

  if (!recursionEnabled) {
    return { childArgs, childEnv: withoutNestedSubagentEnv(process.env) };
  }

  const childDepth = context.depth + 1;
  const rootRunId = context.rootRunId ?? childRunId;
  const parentRunId = context.currentRunId ?? "";
  const capabilityToken = runtime.createRunId();
  const childIndex = "0";
  const runtimeArtifacts = resolveRuntimeArtifactsPaths(
    paths,
    cwd,
    parentSessionFile,
    parentSessionDir,
  );
  const routeDir = join(
    runtimeArtifacts.nestedEventsDir,
    `${rootRunId}-${capabilityToken}`,
  );
  const parentEventSink = join(routeDir, "parent-event-sink.jsonl");
  const parentControlInbox = join(routeDir, "parent-control-inbox.jsonl");
  const routeFilePath = join(routeDir, ROUTE_FILE_NAME);
  const runtimeStatePath = join(
    runtimeArtifacts.nestedRunsDir,
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
  paths: ResolvedPaths,
  cwd: string,
  parentSessionFile: string | undefined,
  parentSessionDir: string | undefined,
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
    : join(
        resolvePiEncodedSessionDir(paths, cwd),
        SYNTHETIC_PARENT_SESSION_STEM,
      );
  const childSessionDir = join(childSessionRoot, runId, "run-0");

  return {
    childSessionDir,
    childSessionPath: join(childSessionDir, CHILD_SESSION_FILE_NAME),
  };
}

function buildArtifactInputMarkdown(input: ArtifactWriteInput): string {
  return [
    "# Subagent Input",
    "",
    `- requested agent: ${input.requestedAgent || "-"}`,
    `- resolved agent: ${input.resolvedAgentName || "-"}`,
    `- run id: ${input.runId}`,
    `- cwd: ${input.cwd}`,
    `- source: ${input.sourcePath || "-"}`,
    `- parent session file: ${input.parentSessionFile || "-"}`,
    `- parent session dir: ${input.parentSessionDir || "-"}`,
    "",
    "## Task",
    "",
    input.task || "(empty task)",
    "",
  ].join("\n");
}

function buildArtifactOutputMarkdown(
  result: SubagentExecutionResult,
): string {
  return [
    "# Subagent Output",
    "",
    `- status: ${result.details.status}`,
    `- stop reason: ${result.details.stopReason}`,
    `- exit code: ${result.details.exitCode ?? "-"}`,
    `- model: ${result.details.model || "-"}`,
    "",
    "## Output",
    "",
    result.content || "(no output)",
    "",
  ].join("\n");
}

function writeExecutionArtifacts(
  paths: ResolvedPaths,
  artifactInput: ArtifactWriteInput,
  result: SubagentExecutionResult,
): ArtifactPaths {
  const artifactPaths = getArtifactPaths(
    paths,
    artifactInput.cwd,
    artifactInput.runId,
    artifactInput.resolvedAgentName ?? artifactInput.requestedAgent,
    0,
    artifactInput.parentSessionFile,
    artifactInput.parentSessionDir,
  );

  writeArtifact(artifactPaths.input, buildArtifactInputMarkdown(artifactInput));
  writeArtifact(artifactPaths.output, buildArtifactOutputMarkdown(result));
  writeMetadata(artifactPaths.meta, {
    runId: artifactInput.runId,
    agent: artifactInput.resolvedAgentName ?? artifactInput.requestedAgent,
    requestedAgent: artifactInput.requestedAgent,
    task: artifactInput.task,
    status: result.details.status,
    error: result.isError ? result.content : undefined,
    model: result.details.model,
    durationMs: result.details.durationMs,
    timeoutMs: result.details.timeoutMs,
    usage: result.details.usage,
    exitCode: result.details.exitCode,
    stopReason: result.details.stopReason,
    cwd: result.details.cwd,
    sourcePath: result.details.sourcePath,
    childSessionDir: result.details.childSessionDir,
    childSessionPath: result.details.childSessionPath,
    stderr: result.details.stderr,
    timestamp: new Date().toISOString(),
  });

  return artifactPaths;
}

function withArtifacts(
  result: SubagentExecutionResult,
  artifactPaths: ArtifactPaths,
): SubagentExecutionResult {
  return {
    ...result,
    details: {
      ...result.details,
      artifactPaths,
    },
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

function encodeDeferredTicket(requestId: string): string {
  return `${DEFERRED_TICKET_PREFIX}${requestId}`;
}

function decodeDeferredTicket(text: string): string | undefined {
  if (!text.startsWith(DEFERRED_TICKET_PREFIX)) {
    return undefined;
  }
  return text.slice(DEFERRED_TICKET_PREFIX.length).trim() || undefined;
}

function buildExecutionResult(params: {
  agent: string;
  task: string;
  sourcePath?: string;
  cwd: string;
  timeoutMs: number;
  durationMs: number;
  childSessionDir?: string;
  childSessionPath?: string;
  model?: string;
  stopReason: string;
  exitCode: number | null;
  stderr: string;
  usage?: SubagentUsage;
  recentToolActivity?: SubagentToolActivity[];
  status: "success" | "error" | "timeout" | "aborted";
  content: string;
}): SubagentExecutionResult {
  return {
    content: params.content,
    isError: params.status !== "success",
    details: {
      status: params.status,
      agent: params.agent,
      task: params.task,
      sourcePath: params.sourcePath ?? "",
      cwd: params.cwd,
      timeoutMs: params.timeoutMs,
      durationMs: params.durationMs,
      childSessionDir: params.childSessionDir ?? "",
      childSessionPath: params.childSessionPath ?? "",
      model: params.model,
      stopReason: params.stopReason,
      exitCode: params.exitCode,
      stderr: params.stderr,
      usage: params.usage ?? createUsage(),
      recentToolActivity: params.recentToolActivity ?? [],
    },
  };
}

function buildSlashBridgeErrorResult(input: {
  requestId: string;
  message: string;
  agent?: string;
  task?: string;
  cwd?: string;
  model?: string;
  durationMs?: number;
}): SubagentExecutionResult {
  return buildExecutionResult({
    agent: input.agent ?? "(unknown)",
    task: input.task ?? "",
    cwd: input.cwd ?? "",
    timeoutMs: 0,
    durationMs: input.durationMs ?? 0,
    model: input.model,
    stopReason: "error",
    exitCode: null,
    stderr: input.message,
    status: "error",
    content: input.message,
  });
}

export async function executeSubagent(
  paths: ResolvedPaths,
  loadedConfig: LoadedConfig,
  discovery: AgentDiscoveryResult,
  input: SubagentToolInput,
  defaultCwd: string,
  signal: AbortSignal | undefined,
  parentSessionFile: string | undefined,
  parentSessionDir: string | undefined,
  parentModel: string | undefined,
  runtime: SubagentRuntimeDeps = createSubagentRuntimeDeps(),
  onProgress?: (update: ProgressUpdate) => void,
): Promise<SubagentExecutionResult> {
  const startedAt = runtime.now();
  const requestedAgent = input.agent.trim() || "(unspecified)";
  const task = input.task.trim();
  const effectiveCwd = resolve(input.cwd ?? defaultCwd);
  const fallbackTimeoutMs = loadedConfig.config.defaultTimeoutMs;
  const runId = runtime.createRunId();
  let childSessionDir = "";
  let childSessionPath = "";
  let promptDir: string | undefined;
  let promptPath: string | undefined;
  let agent: AgentDefinition | undefined;

  const artifactInput: ArtifactWriteInput = {
    requestedAgent,
    task,
    cwd: effectiveCwd,
    runId,
    parentSessionFile,
    parentSessionDir,
  };

  try {
    const nestedContext = readNestedRuntimeContext(loadedConfig);
    ensureNestedDelegationAllowed(discovery, input, nestedContext);
    agent = parseSubagentRequest(discovery, input);
    artifactInput.resolvedAgentName = agent.name;
    artifactInput.sourcePath = agent.sourcePath;
    const resolvedAgent = agent;
    const timeoutMs = resolvedAgent.timeoutMs ?? fallbackTimeoutMs;
    const effectiveModel = resolveEffectiveModel(resolvedAgent, parentModel);
    ({ childSessionDir, childSessionPath } = resolveChildSessionTarget(
      paths,
      effectiveCwd,
      parentSessionFile,
      parentSessionDir,
      runId,
    ));

    runtime.mkdirp(childSessionDir);
    onProgress?.({ childSessionPath, durationMs: runtime.now() - startedAt });
    if (resolvedAgent.systemPrompt.trim()) {
      promptDir = runtime.mkdtemp(join(tmpdir(), "pi-subagents-"));
      promptPath = join(
        promptDir,
        `${resolvedAgent.name.replace(/[^A-Za-z0-9_-]+/g, "_").toLowerCase()}.md`,
      );
      runtime.writeFile(promptPath, resolvedAgent.systemPrompt.trim());
    }

    const launch = createNestedChildLaunch(
      paths,
      effectiveCwd,
      resolvedAgent,
      promptPath,
      childSessionPath,
      loadedConfig,
      runtime,
      runId,
      parentSessionFile,
      parentSessionDir,
      effectiveModel,
    );
    const invocation = runtime.resolvePiInvocation([
      ...launch.childArgs,
      `Task: ${task}`,
    ]);
    const usage = createUsage();
    const recentToolActivity: SubagentToolActivity[] = [];
    const child = runtime.spawnChild(invocation.command, invocation.args, {
      cwd: effectiveCwd,
      env: launch.childEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let finalText = "";
    let model = effectiveModel;
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

      if (typeof event !== "object" || event === null || !("type" in event)) {
        return;
      }

      if (event.type === "tool_execution_start") {
        const toolEvent = event as JsonToolExecutionStartEvent;
        const activity = {
          label: `${toolEvent.toolName ?? "tool"} start`,
          preview: previewValue(toolEvent.args),
        };
        pushRecentToolActivity(recentToolActivity, activity);
        onProgress?.({
          activity,
          childSessionPath,
          durationMs: runtime.now() - startedAt,
        });
        return;
      }

      if (event.type === "tool_execution_end") {
        const toolEvent = event as JsonToolExecutionEndEvent;
        const activity = {
          label: `${toolEvent.toolName ?? "tool"} ${toolEvent.isError ? "error" : "done"}`,
          preview: previewValue(toolEvent.result),
        };
        pushRecentToolActivity(recentToolActivity, activity);
        onProgress?.({
          activity,
          childSessionPath,
          durationMs: runtime.now() - startedAt,
        });
        return;
      }

      if (event.type !== "message_end") {
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
          onProgress?.({
            stderr,
            childSessionPath,
            durationMs: runtime.now() - startedAt,
          });
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
          const status = timedOut
            ? "timeout"
            : aborted
              ? "aborted"
              : (code ?? 0) !== 0 ||
                  normalizedStopReason === "error" ||
                  normalizedStopReason === "aborted"
                ? "error"
                : "success";
          const failureText = timedOut
            ? `Subagent timed out after ${timeoutMs}ms.`
            : aborted
              ? "Subagent aborted."
              : (errorMessage ?? stderr.trim()) ||
                `Subagent exited with code ${code ?? "unknown"}.`;

          resolveResult(
            buildExecutionResult({
              agent: resolvedAgent.name,
              task,
              sourcePath: resolvedAgent.sourcePath,
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
              recentToolActivity,
              status,
              content:
                status === "success" ? finalText || "(no output)" : failureText,
            }),
          );
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

    return withArtifacts(result, writeExecutionArtifacts(paths, artifactInput, result));
  } catch (error) {
    const durationMs = runtime.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const result = buildExecutionResult({
      agent: agent?.name ?? requestedAgent,
      task,
      sourcePath: agent?.sourcePath,
      cwd: effectiveCwd,
      timeoutMs: agent?.timeoutMs ?? fallbackTimeoutMs,
      durationMs,
      childSessionDir,
      childSessionPath,
      model: agent ? resolveEffectiveModel(agent, parentModel) : parentModel,
      stopReason: "error",
      exitCode: null,
      stderr: message,
      status: "error",
      content: message,
    });
    return withArtifacts(
      result,
      writeExecutionArtifacts(paths, artifactInput, result),
    );
  } finally {
    if (promptDir) {
      runtime.removePath(promptDir);
    }
  }
}

export function registerSlashAgentBridge(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
  runtime: SubagentRuntimeDeps = createSubagentRuntimeDeps(),
): void {
  pi.on("input", async (event) => {
    if (event.source !== "extension") {
      return;
    }

    const requestId = decodeDeferredTicket(event.text);
    if (!requestId) {
      return;
    }

    const persisted = getDeferredSlashRequest(requestId);
    if (!persisted) {
      const result = buildSlashBridgeErrorResult({
        requestId,
        message: `Deferred /agent request could not be restored for ${requestId}.`,
      });
      finalizeSlashLiveRequest(requestId, result);
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: result.content,
        display: true,
        details: result.details,
      });
      return { action: "handled" };
    }

    const runtimeState = takeDeferredSlashRuntimeState(requestId);
    const payload: SlashSubagentRequestPayload = {
      requestId,
      agent: persisted.agent,
      task: persisted.task,
      cwd: persisted.cwd,
      parentSessionFile: persisted.parentSessionFile,
      parentSessionDir: persisted.parentSessionDir,
      parentModel: persisted.parentModel,
      signal: runtimeState?.signal,
      requestRender: runtimeState?.requestRender,
      cleanup: runtimeState?.cleanup,
    };

    const startedAt = Date.now();
    let tickInterval: ReturnType<typeof setInterval> | undefined;
    let result: SubagentExecutionResult;

    try {
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);

      tickInterval = setInterval(() => {
        updateSlashLiveRequest(requestId, {
          durationMs: Date.now() - startedAt,
        });
        payload.requestRender?.();
      }, 250);

      result = await executeSubagent(
        paths,
        loadedConfig,
        discovery,
        { agent: payload.agent, task: payload.task, cwd: payload.cwd },
        payload.cwd,
        payload.signal,
        payload.parentSessionFile,
        payload.parentSessionDir,
        payload.parentModel,
        runtime,
        (update) => {
          updateSlashLiveRequest(requestId, update);
          payload.requestRender?.();
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = buildSlashBridgeErrorResult({
        requestId,
        agent: payload.agent,
        task: payload.task,
        cwd: payload.cwd,
        model: payload.parentModel,
        message,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      if (tickInterval) {
        clearInterval(tickInterval);
      }
      payload.cleanup?.();
      if ("appendEntry" in pi && typeof pi.appendEntry === "function") {
        markDeferredSlashRequestConsumed(pi as { appendEntry(customType: string, data: unknown): void }, requestId);
      }
    }

    finalizeSlashLiveRequest(requestId, result);
    return { action: "handled" };
  });
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
    renderCall: renderSubagentCall,
    renderResult: renderSubagentResult,
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
        getParentModelId(ctx.model),
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
  _deps: RuntimeDeps,
  _runtime: SubagentRuntimeDeps = createSubagentRuntimeDeps(),
  isBridgeAvailable: () => boolean = () => true,
): void {
  pi.registerCommand("agent", {
    description: "Run a discovered pi-subagents agent in the foreground",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!isBridgeAvailable()) {
        pi.sendMessage({
          customType: "pi-subagent-result",
          content: SLASH_AGENT_BRIDGE_UNAVAILABLE,
          display: true,
        });
        return;
      }

      const input = parseAgentCommandArgs(args);
      const requestId = _runtime.createRunId();

      pi.sendMessage({
        customType: "pi-subagent-result",
        content: "",
        display: true,
        details: startSlashLiveRequest({
          requestId,
          agent: input.agent,
          task: input.task,
          cwd: ctx.cwd,
          model: getParentModelId(ctx.model),
        }),
      });

      let liveTui: { requestRender?: () => void } | undefined;
      const tickerKey = `pi-subagents-ticker-${requestId}`;
      ctx.ui.setWidget?.(tickerKey, (tui: unknown) => {
        liveTui = tui as { requestRender?: () => void };
        return { render: () => [], invalidate: () => {} };
      });

      const persistedRequest = {
        requestId,
        agent: input.agent,
        task: input.task,
        cwd: ctx.cwd,
        parentSessionFile: ctx.sessionManager.getSessionFile(),
        parentSessionDir: ctx.sessionManager.getSessionFile()
          ? ctx.sessionManager.getSessionDir()
          : undefined,
        parentModel: getParentModelId(ctx.model),
        createdAt: Date.now(),
      };

      if ("appendEntry" in pi && typeof pi.appendEntry === "function") {
        rememberDeferredSlashRequest(
          pi as { appendEntry(customType: string, data: unknown): void },
          persistedRequest,
        );
      }
      setDeferredSlashRuntimeState(requestId, {
        signal: ctx.signal,
        requestRender: () => liveTui?.requestRender?.(),
        cleanup: () => ctx.ui.setWidget?.(tickerKey, undefined),
      });

      pi.sendUserMessage(encodeDeferredTicket(requestId), {
        deliverAs: ctx.isIdle() ? undefined : "followUp",
      });
    },
  });
}
