import { resolve } from "node:path";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  SubagentToolInput,
} from "../shared/types.js";
import {
  renderSubagentCall,
  renderSubagentResult,
} from "../tui/render.js";
import { writeExecutionArtifacts } from "./subagent-artifacts.js";

const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the subagent" }),
  ),
});

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

export function parseAgentCommandArgs(args: string): SubagentToolInput {
  const trimmed = args.trim();
  if (!trimmed) return { agent: "", task: "" };

  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return { agent: trimmed, task: "" };

  return {
    agent: trimmed.slice(0, firstSpace),
    task: trimmed.slice(firstSpace).trim(),
  };
}

function parseAndResolveAgent(
  discovery: AgentDiscoveryResult,
  input: SubagentToolInput,
): AgentDefinition {
  const requestedAgent = input.agent.trim();
  if (!requestedAgent) {
    throw new Error(
      `Missing agent. Available agents: ${listAvailableAgents(discovery)}`,
    );
  }
  if (!input.task.trim()) {
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

export function registerSubagentTool(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Delegate a task to a discovered agent.",
    parameters: SUBAGENT_TOOL_PARAMETERS,
    renderCall: renderSubagentCall,
    renderResult: (result, options, theme) =>
      renderSubagentResult(result, options, theme),
    async execute(
      _toolCallId,
      params: SubagentToolInput,
      signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);
      const effectiveCwd = resolve(params.cwd ?? ctx.cwd);

      try {
        const agentDef = parseAndResolveAgent(discovery, params);
        const timeoutMs =
          agentDef.timeoutMs ?? loadedConfig.config.defaultTimeoutMs;

        const { id, record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          prompt: params.task.trim(),
          cwd: effectiveCwd,
          timeoutMs,
          parentSignal: signal,
          currentDepth: 0,
          allowedAgents: agentDef.subagentAgents,
        });

        // Write artifacts
        const artifactPaths = writeExecutionArtifacts(
          paths,
          {
            requestedAgent: params.agent,
            resolvedAgentName: agentDef.name,
            task: params.task,
            cwd: effectiveCwd,
            runId: id,
            sourcePath: agentDef.sourcePath,
          },
          {
            content: record.result ?? "(no output)",
            isError: record.status === "error",
            details: {
              status:
                record.status === "completed"
                  ? "success"
                  : record.status === "aborted"
                    ? "aborted"
                    : "error",
              agent: agentDef.name,
              task: params.task,
              sourcePath: agentDef.sourcePath,
              cwd: effectiveCwd,
              timeoutMs,
              durationMs: record.durationMs ?? 0,
              childSessionDir: "",
              childSessionPath: "",
              model: agentDef.model,
              stopReason: record.status,
              exitCode: null,
              stderr: record.error ?? "",
              usage: {
                input: record.lifetimeUsage.inputTokens,
                output: record.lifetimeUsage.outputTokens,
                cacheRead: 0,
                cacheWrite: record.lifetimeUsage.cacheWriteTokens,
                contextTokens: 0,
                cost: 0,
                turns: 0,
              },
              recentToolActivity: [],
            },
          },
        );

        return {
          content: [{ type: "text", text: record.result ?? "(no output)" }],
          isError: record.status === "error",
          details: {
            status:
              record.status === "completed"
                ? "success"
                : record.status === "aborted"
                  ? "aborted"
                  : "error",
            agent: agentDef.name,
            task: params.task,
            sourcePath: agentDef.sourcePath,
            cwd: effectiveCwd,
            timeoutMs,
            durationMs: record.durationMs ?? 0,
            childSessionDir: "",
            childSessionPath: "",
            artifactPaths,
            model: agentDef.model,
            stopReason: record.status,
            exitCode: null,
            stderr: record.error ?? "",
            usage: {
              input: record.lifetimeUsage.inputTokens,
              output: record.lifetimeUsage.outputTokens,
              cacheRead: 0,
              cacheWrite: record.lifetimeUsage.cacheWriteTokens,
              contextTokens: 0,
              cost: 0,
              turns: 0,
            },
            recentToolActivity: [],
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
          details: {
            status: "error" as const,
            agent: params.agent,
            task: params.task,
            sourcePath: "",
            cwd: effectiveCwd,
            timeoutMs: 0,
            durationMs: 0,
            childSessionDir: "",
            childSessionPath: "",
            model: undefined,
            stopReason: "error",
            exitCode: null,
            stderr: message,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
            recentToolActivity: [],
          },
        };
      }
    },
  });
}

export function registerAgentCommand(
  pi: ExtensionAPI,
  deps: RuntimeDeps,
): void {
  pi.registerCommand("agent", {
    description: "Run a discovered pi-subagents agent in the foreground",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const input = parseAgentCommandArgs(args);
      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);

      try {
        const agentDef = parseAndResolveAgent(discovery, input);
        const timeoutMs =
          agentDef.timeoutMs ?? loadedConfig.config.defaultTimeoutMs;

        const { record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          prompt: input.task.trim(),
          cwd: ctx.cwd,
          timeoutMs,
          currentDepth: 0,
          allowedAgents: agentDef.subagentAgents,
        });

        pi.sendMessage({
          customType: "pi-subagent-result",
          content: record.result ?? "(no output)",
          display: true,
          details: {
            status: record.status === "completed" ? "success" : "error",
            agent: agentDef.name,
            task: input.task,
            sourcePath: agentDef.sourcePath,
            cwd: ctx.cwd,
            timeoutMs,
            durationMs: record.durationMs ?? 0,
            childSessionDir: "",
            childSessionPath: "",
            model: agentDef.model,
            stopReason: record.status,
            exitCode: null,
            stderr: record.error ?? "",
            usage: {
              input: record.lifetimeUsage.inputTokens,
              output: record.lifetimeUsage.outputTokens,
              cacheRead: 0,
              cacheWrite: record.lifetimeUsage.cacheWriteTokens,
              contextTokens: 0,
              cost: 0,
              turns: 0,
            },
            recentToolActivity: [],
          },
        });
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
