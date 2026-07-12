import { resolve } from "node:path";
import { Type } from "typebox";
import type {
  AgentSession,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  AgentRecord,
  ChainStep,
  ResolvedToolBudget,
  SubagentExecutionDetails,
  SubagentToolInput,
} from "../shared/types.js";
import { validateToolBudget } from "./tool-budget.js";
import {
  renderSubagentCall,
  renderSubagentResult,
} from "../tui/render.js";
import { createActivityTracker } from "../tui/activity.js";
import { describeActivity } from "../tui/format.js";
import { resolveInvocationConfig } from "./invocation-config.js";
import { resolveModel } from "./model-resolver.js";
import {
  createOutputFilePath,
  streamToOutputFile,
  writeInitialEntry,
} from "./output-file.js";
import { writeExecutionArtifacts } from "./subagent-artifacts.js";

const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke" })),
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
  tool_budget: Type.Optional(
    Type.Object(
      {
        soft: Type.Optional(
          Type.Number({ minimum: 1, description: "Advisory nudge threshold" }),
        ),
        hard: Type.Number({ minimum: 1, description: "Hard block threshold" }),
        block: Type.Optional(
          Type.Union([Type.Array(Type.String()), Type.Literal("*")], {
            description: "Tools to block at hard limit. Default: read, grep, find, ls",
          }),
        ),
      },
      { description: "Tool call budget with soft/hard limits" },
    ),
  ),
  chain: Type.Optional(
    Type.Array(
      Type.Object({
        agent: Type.Optional(Type.String()),
        task: Type.Optional(Type.String()),
        phase: Type.Optional(Type.String()),
        label: Type.Optional(Type.String()),
        as: Type.Optional(Type.String()),
        output: Type.Optional(Type.Union([Type.String(), Type.Literal(false)])),
        outputMode: Type.Optional(Type.String()),
        reads: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
        model: Type.Optional(Type.String()),
        skills: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
        progress: Type.Optional(Type.Boolean()),
        cwd: Type.Optional(Type.String()),
        parallel: Type.Optional(Type.Array(Type.Any())),
        concurrency: Type.Optional(Type.Number()),
        failFast: Type.Optional(Type.Boolean()),
        worktree: Type.Optional(Type.Boolean()),
        expand: Type.Optional(Type.Any()),
        collect: Type.Optional(Type.Any()),
      }),
      { description: "Chain execution: sequential/parallel steps" },
    ),
  ),
  chain_append: Type.Optional(
    Type.Object({
      chain_id: Type.String({ description: "ID of running async chain" }),
      steps: Type.Array(Type.Any(), { description: "Steps to append" }),
    }),
  ),
  clarify: Type.Optional(
    Type.Boolean({
      description:
        "If true, show chain preview TUI before execution (interactive only).",
    }),
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
  const requestedAgent = (input.agent ?? "").trim();
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
    description: `Delegate a task to a discovered agent. Supports single agent, chain (sequential/parallel pipeline), and chain_append modes.

## CHAIN mode

Pass a \`chain\` array to run multiple agents in sequence/parallel:

chain: [
  { agent: "scout", task: "Analyze {task}", as: "context" },
  { agent: "planner", task: "Plan based on {outputs.context}" }
]

Template variables: {task}, {previous}, {chain_dir}, {outputs.<name>}`,
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

      const paths = deps.resolvePaths();
      const loadedConfig = deps.loadConfig(paths);
      const discovery = deps.discoverAgents(paths);

      const stubDetails = (o: Partial<SubagentExecutionDetails>): SubagentExecutionDetails => ({
        status: "error", agent: "", task: "", sourcePath: "", cwd: effectiveCwd,
        maxTurns: 0, durationMs: 0, childSessionDir: "", childSessionPath: "",
        stopReason: "error", exitCode: null, stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
        recentToolActivity: [], ...o,
      });

      // --- Chain mode dispatch ---
      if (params.chain) {
        try {
          // Clarification TUI — show before execution when clarify=true (interactive only)
          let chainSteps = params.chain as ChainStep[];
          if (params.clarify && !params.run_in_background) {
            const customUI = (
              ctx as {
                ui?: {
                  custom?: <T>(
                    factory: (
                      tui: import("@earendil-works/pi-tui").TUI,
                      theme: import("../tui/agent-widget.js").Theme,
                      kb: unknown,
                      done: (r: T) => void,
                    ) => import("@earendil-works/pi-tui").Component,
                  ) => Promise<T>;
                };
              }
            ).ui;
            if (customUI?.custom) {
              const { ChainClarifyComponent } = await import("../tui/chain-clarify.js");
              const result = await customUI.custom<import("../tui/chain-clarify.js").ChainClarifyResult>(
                (tui, theme, _kb, done) =>
                  new ChainClarifyComponent(
                    tui,
                    theme as unknown as import("../tui/agent-widget.js").Theme, // safely cast — Theme is structurally identical
                    chainSteps,
                    discovery.agents,
                    params.task ?? "",
                    done,
                  ),
              );
              if (result.action === "cancel") {
                return {
                  content: [{ type: "text", text: "Chain cancelled." }],
                  isError: false,
                  details: stubDetails({ agent: "(chain)", task: params.task ?? "", status: "aborted" as const }),
                };
              }
              if (result.action === "bg") {
                params.run_in_background = true;
              }
              chainSteps = result.steps;
            }
          }

          const { executeChain } = await import("./chain-execution.js");
          const chainRunId = `chain-${Date.now().toString(36)}`;

          const spawnAndWait = async (
            agentDef: AgentDefinition,
            prompt: string,
            stepCwd: string,
            options?: import("./chain-execution.js").StepSpawnOptions,
          ) => {
            let effectiveAgentDef = options?.skills
              ? { ...agentDef, skills: options.skills }
              : agentDef;
            if (options?.model) effectiveAgentDef = { ...effectiveAgentDef, model: options.model };
            return deps.manager.spawnAndWait(ctx, effectiveAgentDef, {
              prompt,
              cwd: stepCwd || effectiveCwd,
              maxTurns: loadedConfig.config.defaultMaxTurns,
              toolBudget: options?.toolBudget,
              isolation: options?.isolation,
            });
          };

          const findAgent = (name: string) => {
            const agent = findAgentByName(discovery, name);
            if (!agent) throw new Error(`Unknown agent: "${name}"`);
            return agent;
          };

          // Background chain dispatch — fire and forget
          if (params.run_in_background) {
            const record: AgentRecord = {
              id: chainRunId,
              type: "(chain)",
              description: `Chain: ${(params.task ?? "").slice(0, 60)}`,
              status: "running",
              startedAt: Date.now(),
              toolUses: 0,
              turnCount: 0,
              lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
              isBackground: true,
            };
            deps.manager.registerExternalRecord(chainRunId, record);

            executeChain({ steps: chainSteps, task: params.task ?? "", spawnAndWait, findAgent, cwd: effectiveCwd, runId: chainRunId, onGraphUpdate: (s) => deps.chainWidget?.update(s) })
              .then((chainResult) => {
                record.status = chainResult.isError ? "error" : "completed";
                record.result = chainResult.content;
                record.error = chainResult.isError ? chainResult.content : undefined;
                record.completedAt = Date.now();
                record.durationMs = record.completedAt - record.startedAt;
                deps.chainWidget?.clear();
                deps.manager.notifyComplete(chainRunId);
              })
              .catch((error) => {
                record.status = "error";
                record.error = error instanceof Error ? error.message : String(error);
                record.completedAt = Date.now();
                record.durationMs = record.completedAt - record.startedAt;
                deps.chainWidget?.clear();
                deps.manager.notifyComplete(chainRunId);
              });

            return {
              content: [{ type: "text", text: `Chain started in background.\nChain ID: ${chainRunId}` }],
              isError: false,
              details: stubDetails({
                status: "success",
                agent: "(chain)",
                task: params.task ?? "",
                stopReason: "completed",
              }),
            };
          }

          // Foreground chain execution
          const chainResult = await executeChain({
            steps: chainSteps,
            task: params.task ?? "",
            spawnAndWait,
            findAgent,
            cwd: effectiveCwd,
            runId: chainRunId,
            signal,
            onGraphUpdate: (snapshot) => deps.chainWidget?.update(snapshot),
          });
          deps.chainWidget?.clear();
          return {
            content: [{ type: "text", text: chainResult.content }],
            isError: chainResult.isError,
            details: stubDetails({
              status: chainResult.isError ? "error" : "success",
              agent: "(chain)",
              task: params.task ?? "",
              stopReason: chainResult.isError ? "error" : "completed",
              stderr: chainResult.isError ? chainResult.content : "",
            }),
          };
        } catch (error) {
          deps.chainWidget?.clear();
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: message }],
            isError: true,
            details: stubDetails({ agent: "(chain)", task: params.task ?? "", stderr: message }),
          };
        }
      }

      // --- Chain append dispatch ---
      if (params.chain_append) {
        const { enqueueChainAppendRequest } = await import("./chain-append.js");
        enqueueChainAppendRequest(
          params.chain_append.chain_id,
          params.chain_append.steps as ChainStep[],
        );
        return {
          content: [{ type: "text", text: `Steps appended to chain ${params.chain_append.chain_id}.` }],
          isError: false,
          details: stubDetails({
            status: "success",
            agent: "(chain-append)",
            task: `append to ${params.chain_append.chain_id}`,
            stopReason: "completed",
          }),
        };
      }

      // --- Guard: agent required for single mode ---
      if (!params.agent) {
        return {
          content: [{ type: "text", text: "Missing 'agent'. Provide 'agent' for single mode or 'chain' for chain mode." }],
          isError: true,
          details: stubDetails({ task: params.task ?? "", stderr: "Missing agent" }),
        };
      }

      try {
        const agentDef = parseAndResolveAgent(discovery, params);

        const resolved = resolveInvocationConfig(
          {
            model: agentDef.model,
            thinking: agentDef.thinking,
            maxTurns: agentDef.maxTurns,
            isolated: agentDef.isolated,
            inheritContext: agentDef.inheritContext,
            toolBudget: agentDef.toolBudget,
          },
          {
            model: params.model,
            thinking: params.thinking,
            maxTurns: params.max_turns,
            isolated: params.isolated,
            inheritContext: params.inherit_context,
            toolBudget: params.tool_budget,
          },
          {
            model: undefined,
            defaultMaxTurns: loadedConfig.config.defaultMaxTurns,
            toolBudget: loadedConfig.config.toolBudget,
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

        const detailBase = {
          agent: agentDef.name,
          task: params.task,
          sourcePath: agentDef.sourcePath,
          cwd: effectiveCwd,
          maxTurns: resolved.maxTurns,
          durationMs: 0,
          childSessionDir: "",
          childSessionPath: "",
          model: agentDef.model,
          stopReason: "background",
          exitCode: null as null,
          stderr: "",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, cost: 0, turns: 0 },
          recentToolActivity: [] as SubagentExecutionDetails["recentToolActivity"],
        };

        // Validate the merged tool budget
        let resolvedBudget: ResolvedToolBudget | undefined;
        if (resolved.toolBudget) {
          const validated = validateToolBudget(resolved.toolBudget);
          if (validated.error) {
            return {
              content: [{ type: "text", text: validated.error }],
              isError: true,
              details: { ...detailBase, status: "error" as const, stopReason: "error", stderr: validated.error },
            };
          }
          resolvedBudget = validated.budget;
        }

        const spawnOptions = {
          prompt: params.task.trim(),
          cwd: effectiveCwd,
          maxTurns: resolved.maxTurns,
          graceTurns: loadedConfig.config.graceTurns,
          inheritContext: resolved.inheritContext,
          parentSystemPrompt,
          parentSignal: signal,
          currentDepth: 0,
          toolBudget: resolvedBudget,
        };

        // Resume path
        if (params.resume) {
          const resumed = await deps.manager.resume(params.resume, params.task.trim(), signal);
          if (!resumed) {
            return {
              content: [{ type: "text", text: `Agent not found: "${params.resume}".` }],
              isError: true,
              details: {
                ...detailBase,
                status: "error" as const,
                stopReason: "error",
                stderr: `Agent not found: "${params.resume}"`,
              },
            };
          }
          return {
            content: [{ type: "text", text: resumed.result ?? "(no output)" }],
            isError: resumed.status === "error",
            details: {
              ...detailBase,
              status: resumed.status === "completed"
                ? "success" as const
                : resumed.status === "error"
                  ? "error" as const
                  : "aborted" as const,
              durationMs: resumed.durationMs ?? 0,
              stopReason: resumed.status,
              stderr: resumed.error ?? "",
            },
          };
        }

        // Background spawn path
        if (params.run_in_background) {
          // Create activity tracker for live widget/fleet updates
          const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(
            resolved.maxTurns,
            () => deps.widget?.update(),
          );

          const id = deps.manager.spawn(ctx, agentDef, {
            ...spawnOptions,
            isBackground: true,
            isolation: params.isolation as "worktree" | undefined,
            ...bgCallbacks,
            onSessionCreated: (session) => {
              try {
                const sessionPath = createOutputFilePath(effectiveCwd, id, `bg-${Date.now()}`);
                writeInitialEntry(sessionPath, id, params.task.trim(), effectiveCwd);
                const cleanup = streamToOutputFile(session as AgentSession, sessionPath, id, effectiveCwd);
                const bgRecord = deps.manager.getRecord(id);
                if (bgRecord) {
                  bgRecord.outputFile = sessionPath;
                  bgRecord.outputCleanup = cleanup;
                }
              } catch {
                // ignore output file errors
              }
            },
          });

          // Store in shared activity map and start timers
          deps.agentActivity?.set(id, bgState);
          deps.ensureTimers?.();

          // Register in batch tracker for smart group detection
          deps.registerBatchAgent?.(id);

          const bgRecord = deps.manager.getRecord(id);
          const queued = bgRecord?.status === "queued";
          return {
            content: [{ type: "text", text:
              `Agent ${queued ? "queued" : "started"} in background.\n` +
              `Agent ID: ${id}\n` +
              `You will be notified when this agent completes.\n` +
              `Use get_subagent_result to retrieve full results, or steer_subagent to send messages.`,
            }],
            isError: false,
            details: {
              ...detailBase,
              status: "background" as const,
              agentId: id,
            },
          };
        }

        // Synchronous foreground path (with optional isolation)
        const { state: fgState, callbacks: fgCallbacks } = createActivityTracker(
          resolved.maxTurns,
          () => {
            ctx.ui?.setWorkingMessage?.(
              `${agentDef.name}: ${describeActivity(fgState.activeTools, fgState.responseText)}`,
            );
          },
        );

        const { id, record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          ...spawnOptions,
          isolation: params.isolation as "worktree" | undefined,
          ...fgCallbacks,
        });

        ctx.ui?.setWorkingMessage?.();

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
            agent: params.agent ?? "",
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
