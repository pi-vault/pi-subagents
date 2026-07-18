import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "./agent-manager.js";
import type { AgentDefinition, AgentDiscoveryResult, SpawnOptions } from "../shared/types.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import { resolveInvocationConfig } from "./invocation-config.js";
import { createContactSupervisorTool } from "./intercom.js";

export function createAgentCustomToolsFactory(
  manager: AgentManager,
  deps: RuntimeDeps,
  agentDef: AgentDefinition,
  currentDepth: number,
): NonNullable<SpawnOptions["createCustomTools"]> {
  return (context) => {
    const discovery = deps.discoverAgents(deps.resolvePaths());
    const tools: unknown[] = [];
    if (context.allowRecursion) {
      tools.push(
        createChildSubagentTool({
          manager,
          discovery,
          allowedAgents: agentDef.subagentAgents,
          currentDepth: currentDepth + 1,
          parentCwd: context.cwd,
          parentAgentId: context.id,
          deps,
        }),
        createChildGetResultTool(manager, context.id),
      );
    }
    if (agentDef.intercom && deps.intercom) {
      tools.push(createContactSupervisorTool(deps.intercom, context.id, agentDef.name));
    }
    return tools;
  };
}

const err = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
  details: undefined,
});
const ok = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: undefined,
});

const CHILD_SUBAGENT_PARAMS = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
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
});

export function createChildSubagentTool(opts: {
  manager: AgentManager;
  discovery: AgentDiscoveryResult;
  allowedAgents: string[];
  currentDepth: number;
  parentCwd: string;
  parentAgentId: string;
  deps: RuntimeDeps;
}) {
  const { manager, discovery, allowedAgents, currentDepth, parentCwd, parentAgentId, deps } = opts;

  const allowedSet = new Set(allowedAgents.map((a) => a.trim().toLowerCase()));

  return defineTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate a task to a sub-agent. Always runs in background.",
      `Allowed agents: ${allowedAgents.join(", ") || "(none)"}`,
    ].join("\n"),
    promptSnippet: `Delegate to a sub-agent (allowed: ${allowedAgents.join(", ") || "none"})`,
    parameters: CHILD_SUBAGENT_PARAMS,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const agentName = params.agent.trim().toLowerCase();

      if (!allowedSet.has(agentName))
        return err(`Agent "${params.agent}" is not allowed. Allowed agents: ${allowedAgents.join(", ")}`);

      const agentDef = discovery.agents.find(
        (a) => a.name.trim().toLowerCase() === agentName,
      );
      if (!agentDef)
        return err(`Agent "${params.agent}" not found in discovery.`);

      const settings = deps.settings;
      const resolved = resolveInvocationConfig(
        agentDef,
        {
          maxTurns: params.max_turns,
          inheritContext: params.inherit_context,
          isolated: params.isolated,
        },
        settings,
      );

      try {
        const id = manager.spawn(ctx as unknown, agentDef, {
          prompt: params.task.trim(),
          cwd: parentCwd,
          maxTurns: resolved.maxTurns,
          graceTurns: settings.graceTurns,
          inheritContext: resolved.inheritContext,
          parentSignal: signal ?? undefined,
          currentDepth,
          isBackground: true,
          spawnedBy: parentAgentId,
          createCustomTools: createAgentCustomToolsFactory(manager, deps, agentDef, currentDepth),
          ...(params.thinking ? { thinking: params.thinking } : {}),
        });

        return ok(`Background agent started: ${id}\nAgent: ${agentDef.name}\nTask: ${params.task.slice(0, 80)}`);
      } catch (e) {
        return err(`Failed to spawn agent: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });
}

/**
 * Create a scoped get_subagent_result that only sees agents spawned by parentAgentId.
 */
export function createChildGetResultTool(
  manager: AgentManager,
  parentAgentId: string,
) {
  return defineTool({
    name: "get_subagent_result",
    label: "Get Agent Result",
    description:
      "Check status and retrieve results from a background agent you spawned.",
    promptSnippet:
      "Check status and retrieve results from a background agent you spawned",
    parameters: Type.Object({
      agent_id: Type.String({ description: "The agent ID to check." }),
      wait: Type.Optional(
        Type.Boolean({
          description: "If true, wait for completion. Default: false.",
        }),
      ),
    }),

    async execute(_toolCallId, params) {
      const record = manager.getRecord(params.agent_id);
      if (!record || record.spawnedBy !== parentAgentId)
        return ok(`Agent not found: "${params.agent_id}".`);

      if (params.wait && record.status === "running" && record.promise) {
        record.resultConsumed = true;
        await record.promise;
      }

      let output = `Agent: ${record.id}\nStatus: ${record.status}\n`;
      if (record.status === "running" || record.status === "queued") {
        output += "Agent is still running. Use wait: true or check back later.";
      } else if (record.status === "error") {
        output += `Error: ${record.error}`;
      } else {
        output += record.result?.trim() || "No output.";
      }

      if (record.status !== "running" && record.status !== "queued") {
        record.resultConsumed = true;
      }

      return ok(output);
    },
  });
}
