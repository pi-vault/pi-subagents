import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type {
  AgentDefinition,
  SubagentToolActivity,
  SubagentUsage,
} from "../shared/types.js";
import { resolveSkillPaths } from "./skill-loader.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TERMINATION_GRACE_MS = 2_000;
export const SUBAGENT_EXTENSION_ENTRY = fileURLToPath(
  new URL("../index.ts", import.meta.url),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JsonContentPart = { type: string; text?: string };
export type JsonAssistantMessage = {
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

export type JsonMessageEndEvent = {
  type?: string;
  message?: JsonAssistantMessage;
};

export type JsonToolExecutionStartEvent = {
  type?: string;
  toolName?: string;
  args?: unknown;
};

export type JsonToolExecutionEndEvent = {
  type?: string;
  toolName?: string;
  result?: unknown;
  isError?: boolean;
};

export type ChildSpawn = ChildProcessByStdio<null, Readable, Readable>;

export type SpawnChildFn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildSpawn;

export type ProgressUpdate = {
  durationMs?: number;
  childSessionPath?: string;
  stderr?: string;
  activity?: SubagentToolActivity;
};

export type RawChildResult = {
  finalText: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  exitCode: number | null;
  stderr: string;
  usage: SubagentUsage;
  recentToolActivity: SubagentToolActivity[];
  timedOut: boolean;
  aborted: boolean;
};

export type SpawnCollectParams = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  effectiveModel: string | undefined;
  runtime: Pick<SpawnCollectRuntime, "spawnChild" | "now">;
  onProgress?: (update: ProgressUpdate) => void;
  childSessionPath?: string;
  startedAt: number;
};

type SpawnCollectRuntime = {
  spawnChild: SpawnChildFn;
  now: () => number;
};

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

export function buildChildArgs(
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

export function resolveEffectiveModel(
  agent: AgentDefinition,
  parentModel: string | undefined,
): string | undefined {
  const agentModel = agent.model?.trim();
  if (agentModel && agentModel.toLowerCase() !== "default") {
    return agentModel;
  }
  return parentModel?.trim() || undefined;
}

export function getParentModelId(
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

// ---------------------------------------------------------------------------
// spawnAndCollect
// ---------------------------------------------------------------------------

export async function spawnAndCollect(
  params: SpawnCollectParams,
): Promise<RawChildResult> {
  const {
    command,
    args,
    cwd,
    env,
    timeoutMs,
    signal,
    effectiveModel,
    runtime,
    onProgress,
    childSessionPath,
    startedAt,
  } = params;

  const usage = createUsage();
  const recentToolActivity: SubagentToolActivity[] = [];
  const child = runtime.spawnChild(command, args, {
    cwd,
    env,
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

  return new Promise<RawChildResult>((resolveResult, reject) => {
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

      resolveResult({
        finalText,
        model,
        stopReason,
        errorMessage,
        exitCode,
        stderr,
        usage,
        recentToolActivity,
        timedOut,
        aborted,
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
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

export function createUsage(): SubagentUsage {
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
