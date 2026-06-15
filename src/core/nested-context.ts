import { dirname, join } from "node:path";
import { resolveRuntimeArtifactsPaths } from "../shared/artifacts.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
  SubagentToolInput,
} from "../shared/types.js";

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

const ALL_NESTED_ENV_KEYS = [
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
] as const;

const ROUTE_FILE_NAME = "route.json";
const RUNTIME_STATE_FILE_NAME = "runtime.json";

export type NestedRuntimeContext = {
  isNestedChild: boolean;
  currentRunId?: string;
  depth: number;
  maxDepth: number;
  rootRunId?: string;
  allowedAgents?: string[];
  parentPath: string;
};

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

export function stripNestedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  for (const key of ALL_NESTED_ENV_KEYS) {
    delete childEnv[key];
  }
  return childEnv;
}

export function validateDelegation(
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
  const availableAgents =
    discovery.agents.map((a) => a.name).join(", ") || "none";

  if (allowedAgents.length === 0) {
    throw new Error(
      `Nested delegation is disabled for this agent. Allowed child agents: none. Requested: "${requestedAgent}". Available agents: ${availableAgents}`,
    );
  }

  const allowedKeys = new Set(
    allowedAgents.map((agentName) => agentName.trim().toLowerCase()),
  );
  if (!allowedKeys.has(requestedKey)) {
    throw new Error(
      `Child agent "${requestedAgent}" is not allowed. Allowed child agents: ${allowedAgents.join(", ")}. Available agents: ${availableAgents}`,
    );
  }
}

/** Parse nested-context env vars into a structured context. Accepts an optional `env` for hermetic testing. */
export function readContext(
  loadedConfig: LoadedConfig,
  env: NodeJS.ProcessEnv = process.env,
): NestedRuntimeContext {
  const isNestedChild = env[PI_SUBAGENT_CHILD] === "1";
  const depth = parseInteger(env[PI_SUBAGENT_DEPTH], 0);
  const maxDepth = parseInteger(
    env[PI_SUBAGENT_MAX_DEPTH],
    loadedConfig.config.maxRecursiveLevel,
  );
  const allowedAgents =
    env[PI_SUBAGENT_ALLOWED_AGENTS] === undefined
      ? undefined
      : splitCommaSeparatedList(env[PI_SUBAGENT_ALLOWED_AGENTS]);

  return {
    isNestedChild,
    currentRunId: env[PI_SUBAGENT_RUN_ID]?.trim() || undefined,
    depth,
    maxDepth,
    rootRunId: env[PI_SUBAGENT_PARENT_ROOT_RUN_ID]?.trim() || undefined,
    allowedAgents,
    parentPath: env[PI_SUBAGENT_PARENT_PATH] ?? "",
  };
}

export interface NestedContextRuntimeDeps {
  createRunId: () => string;
  writeFile: (path: string, content: string) => void;
  mkdirp: (path: string) => void;
}

export type BuildChildEnvParams = {
  agent: AgentDefinition;
  context: NestedRuntimeContext;
  childRunId: string;
  paths: ResolvedPaths;
  cwd: string;
  parentSessionFile?: string;
  parentSessionDir?: string;
  runtime: NestedContextRuntimeDeps;
  baseEnv?: NodeJS.ProcessEnv;
};

/** Build the child process env dict, route files, and runtime state. Accepts optional `baseEnv` for hermetic testing. */
export function buildChildEnv(
  params: BuildChildEnvParams,
): { env: NodeJS.ProcessEnv; routeDir: string } {
  const {
    agent,
    context,
    childRunId,
    paths,
    cwd,
    parentSessionFile,
    parentSessionDir,
    runtime,
    baseEnv = process.env,
  } = params;

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

  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
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

  return { env, routeDir };
}
