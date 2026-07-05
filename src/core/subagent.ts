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
  SubagentExecutionDetails,
  SubagentToolInput,
} from "../shared/types.js";
import {
  renderSubagentCall,
  renderSubagentResult,
} from "../tui/render.js";
import { resolveInvocationConfig } from "./invocation-config.js";
import { resolveModel } from "./model-resolver.js";
import { writeExecutionArtifacts } from "./subagent-artifacts.js";

const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the subagent" }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Model override (provider/modelId or fuzzy name like 'haiku', 'sonnet')",
    }),
  ),
  thinking: Type.Optional(
    Type.String({ description: "Thinking level: off, low, medium, high" }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description: "Maximum agentic turns before stopping",
      minimum: 1,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description:
        "If true, agent gets no extension/MCP tools, only built-in tools",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description: "If true, fork parent conversation into the agent",
    }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description: "Run in background and return agent ID immediately",
    }),
  ),
  resume: Type.Optional(
    Type.String({ description: "Agent ID to resume from previous context" }),
  ),
  isolation: Type.Optional(
    Type.String({ description: "Run agent in a temporary git worktree" }),
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
      const effectiveCwd = resolve(params.cwd ?? ctx.cwd);

      // Stub checks for unimplemented features
      if (params.run_in_background) {
        return {
          content: [{ type: "text", text: "run_in_background is not yet implemented. It will be available in a future update." }],
          isError: true,
          details: {
            status: "error" as const,
            agent: params.agent,
            task: params.task,
            sourcePath: "",
            cwd: effectiveCwd,
            maxTurns: 0,
            durationMs: 0,
            childSessionDir: "",
            childSessionPath: "",
            model: undefined,
            stopReason: "error",
            exitCode: null,
            stderr: "run_in_background is not yet implemented",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
            recentToolActivity: [],
          },
        };
      }
      if (params.resume) {
        return {
          content: [{ type: "text", text: "resume is not yet implemented. It will be available in a future update." }],
          isError: true,
          details: {
            status: "error" as const,
            agent: params.agent,
            task: params.task,
            sourcePath: "",
            cwd: effectiveCwd,
            maxTurns: 0,
            durationMs: 0,
            childSessionDir: "",
            childSessionPath: "",
            model: undefined,
            stopReason: "error",
            exitCode: null,
            stderr: "resume is not yet implemented",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
            recentToolActivity: [],
          },
        };
      }
      if (params.isolation) {
        return {
          content: [{ type: "text", text: "isolation is not yet implemented. It will be available in a future update." }],
          isError: true,
          details: {
            status: "error" as const,
            agent: params.agent,
            task: params.task,
            sourcePath: "",
            cwd: effectiveCwd,
            maxTurns: 0,
            durationMs: 0,
            childSessionDir: "",
            childSessionPath: "",
            model: undefined,
            stopReason: "error",
            exitCode: null,
            stderr: "isolation is not yet implemented",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
            recentToolActivity: [],
          },
        };
      }

      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);

      try {
        const agentDef = parseAndResolveAgent(discovery, params);

        const resolved = resolveInvocationConfig(
          {
            model: agentDef.model,
            thinking: agentDef.thinking,
            maxTurns: agentDef.maxTurns,
            isolated: agentDef.isolated,
            inheritContext: agentDef.inheritContext,
          },
          {
            model: params.model,
            thinking: params.thinking,
            maxTurns: params.max_turns,
            isolated: params.isolated,
            inheritContext: params.inherit_context,
          },
          {
            model: undefined,
            defaultMaxTurns: loadedConfig.config.defaultMaxTurns,
          },
        );

        // Validate model string against registry (if available)
        if (resolved.model) {
          const registry = (
            ctx as {
              modelRegistry?: {
                listModels?: () => Array<{
                  id: string;
                  provider: string;
                  name?: string;
                }>;
              };
            }
          ).modelRegistry;
          if (registry?.listModels) {
            const match = resolveModel(resolved.model, registry.listModels());
            if (!match) {
              const available = registry
                .listModels()
                .map((m) => `${m.provider}/${m.id}`)
                .join(", ");
              return {
                content: [
                  {
                    type: "text",
                    text: `Unknown model: "${resolved.model}". Available models: ${available}`,
                  },
                ],
                isError: true,
                details: {
                  status: "error" as const,
                  agent: params.agent,
                  task: params.task,
                  sourcePath: "",
                  cwd: effectiveCwd,
                  maxTurns: 0,
                  durationMs: 0,
                  childSessionDir: "",
                  childSessionPath: "",
                  model: resolved.model,
                  stopReason: "error",
                  exitCode: null,
                  stderr: `Unknown model: "${resolved.model}". Available models: ${available}`,
                  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
                  recentToolActivity: [],
                },
              };
            }
          }
        }

        // Get parent system prompt for append mode (if available on ctx)
        const parentSystemPrompt =
          (
            ctx as { resourceLoader?: { getSystemPrompt?: () => string } }
          ).resourceLoader?.getSystemPrompt?.() ?? undefined;

        const { id, record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          prompt: params.task.trim(),
          cwd: effectiveCwd,
          maxTurns: resolved.maxTurns,
          graceTurns: loadedConfig.config.graceTurns,
          inheritContext: resolved.inheritContext,
          parentSystemPrompt,
          parentSignal: signal,
          currentDepth: 0,
          allowedAgents: agentDef.subagentAgents,
        });

        // Build execution details (shared between artifacts and return value)
        const details: SubagentExecutionDetails = {
          status:
            record.status === "completed"
              ? "success"
              : record.status === "steered"
                ? "steered"
                : record.status === "aborted"
                  ? "aborted"
                  : "error",
          agent: agentDef.name,
          task: params.task,
          sourcePath: agentDef.sourcePath,
          cwd: effectiveCwd,
          maxTurns: resolved.maxTurns,
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
        };

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
            details,
          },
        );

        return {
          content: [{ type: "text", text: record.result ?? "(no output)" }],
          isError: record.status === "error",
          details: { ...details, artifactPaths },
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
            maxTurns: 0,
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
        const maxTurns =
          agentDef.maxTurns ?? loadedConfig.config.defaultMaxTurns;

        const { record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          prompt: input.task.trim(),
          cwd: ctx.cwd,
          maxTurns,
          currentDepth: 0,
          allowedAgents: agentDef.subagentAgents,
        });

        pi.sendMessage({
          customType: "pi-subagent-result",
          content: record.result ?? "(no output)",
          display: true,
          details: {
            status:
              record.status === "completed"
                ? "success"
                : record.status === "steered"
                  ? "steered"
                  : record.status === "aborted"
                    ? "aborted"
                    : "error",
            agent: agentDef.name,
            task: input.task,
            sourcePath: agentDef.sourcePath,
            cwd: ctx.cwd,
            maxTurns: maxTurns,
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
