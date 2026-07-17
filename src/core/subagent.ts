import { resolve } from "node:path";
import type {
  AgentSession,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  ResolvedToolBudget,
  SubagentExecutionDetails,
  SubagentToolInput,
} from "../shared/types.js";
import { describeActivity } from "../tui/format.js";
import { renderSubagentCall, renderSubagentResult } from "../tui/render.js";
import { resolveInvocationConfig } from "./invocation-config.js";
import { resolveModel } from "./model-resolver.js";
import { checkModelScope, type ModelSource } from "./model-scope.js";
import { normalizeChainSteps } from "./chain-serializer.js";
import { getStepAgents } from "./chain-settings.js";
import { createOutputFilePath, streamToOutputFile, writeInitialEntry } from "./output-file.js";
import { writeExecutionArtifacts } from "./subagent-artifacts.js";
import { validateToolBudget } from "./tool-budget.js";

const CHAIN_OBJECT_SCHEMA = Type.Object({}, { additionalProperties: true });
const CHAIN_ACCEPTANCE = Type.Object({
  description: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
});
const CHAIN_TOOL_BUDGET = Type.Object({
  soft: Type.Optional(Type.Number()),
  hard: Type.Optional(Type.Number()),
  block: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal("*")])),
});
const CHAIN_TASK_FIELDS = {
  agent: Type.Optional(Type.String()),
  task: Type.Optional(Type.String()),
  phase: Type.Optional(Type.String()),
  label: Type.Optional(Type.String()),
  as: Type.Optional(Type.String()),
  outputSchema: Type.Optional(CHAIN_OBJECT_SCHEMA),
  output: Type.Optional(Type.Union([Type.String(), Type.Literal(false)])),
  outputMode: Type.Optional(Type.String()),
  reads: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
  model: Type.Optional(Type.String()),
  skills: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Literal(false)])),
  progress: Type.Optional(Type.Boolean()),
  cwd: Type.Optional(Type.String()),
  acceptance: Type.Optional(CHAIN_ACCEPTANCE),
  toolBudget: Type.Optional(CHAIN_TOOL_BUDGET),
};
const CHAIN_STATIC_TASK = Type.Object({
  ...CHAIN_TASK_FIELDS,
  count: Type.Optional(Type.Number()),
});
const CHAIN_DYNAMIC_EXPAND = Type.Object({
  from: Type.Optional(Type.Object({
    output: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
  })),
  item: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  maxItems: Type.Optional(Type.Number()),
  onEmpty: Type.Optional(Type.String()),
});
const { as: _as, ...CHAIN_DYNAMIC_TEMPLATE_FIELDS } = CHAIN_TASK_FIELDS;
const CHAIN_DYNAMIC_TEMPLATE = Type.Object(CHAIN_DYNAMIC_TEMPLATE_FIELDS);
const CHAIN_COLLECT = Type.Object({
  as: Type.Optional(Type.String()),
  outputSchema: Type.Optional(CHAIN_OBJECT_SCHEMA),
});
const CHAIN_STEP = Type.Object({
  ...CHAIN_TASK_FIELDS,
  parallel: Type.Optional(Type.Unsafe({
    anyOf: [Type.Array(CHAIN_STATIC_TASK), CHAIN_DYNAMIC_TEMPLATE],
  })),
  expand: Type.Optional(CHAIN_DYNAMIC_EXPAND),
  collect: Type.Optional(CHAIN_COLLECT),
  concurrency: Type.Optional(Type.Number()),
  failFast: Type.Optional(Type.Boolean()),
  worktree: Type.Optional(Type.Boolean()),
});

const SUBAGENT_TOOL_PARAMETERS = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke" })),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagent" })),
  model: Type.Optional(
    Type.String({
      description: "Model override (provider/modelId or fuzzy name like 'haiku', 'sonnet')",
    }),
  ),
  thinking: Type.Optional(Type.String({ description: "Thinking level: off, low, medium, high" })),
  max_turns: Type.Optional(
    Type.Number({
      description: "Maximum agentic turns before stopping",
      minimum: 1,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description: "If true, agent gets no extension/MCP tools, only built-in tools",
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
  resume: Type.Optional(Type.String({ description: "Agent ID to resume from previous context" })),
  isolation: Type.Optional(Type.String({ description: "Run agent in a temporary git worktree" })),
  tool_budget: Type.Optional(
    Type.Object(
      {
        soft: Type.Optional(Type.Number({ minimum: 1, description: "Advisory nudge threshold" })),
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
      CHAIN_STEP,
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
      description: "If true, show chain preview TUI before execution (interactive only).",
    }),
  ),
});

export function findAgentByName(
  discovery: AgentDiscoveryResult,
  requestedName: string,
): AgentDefinition | undefined {
  const normalized = requestedName.trim().toLowerCase();
  return discovery.agents.find((agent) => agent.name.trim().toLowerCase() === normalized);
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
    throw new Error(`Missing agent. Available agents: ${listAvailableAgents(discovery)}`);
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

export function registerSubagentTool(pi: ExtensionAPI, deps: RuntimeDeps): void {
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
    renderResult: (result, options, theme) => renderSubagentResult(result, options, theme),
    async execute(
      _toolCallId,
      params: SubagentToolInput,
      signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
      const effectiveCwd = resolve(params.cwd ?? ctx.cwd);

      const paths = deps.resolvePaths();
      const settings = deps.settings;
      const discovery = deps.discoverAgents(paths);

      const stubDetails = (o: Partial<SubagentExecutionDetails>): SubagentExecutionDetails => ({
        status: "error",
        agent: "",
        task: "",
        sourcePath: "",
        cwd: effectiveCwd,
        maxTurns: 0,
        durationMs: 0,
        childSessionDir: "",
        childSessionPath: "",
        stopReason: "error",
        exitCode: null,
        stderr: "",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          contextTokens: 0,
          cost: 0,
          turns: 0,
        },
        recentToolActivity: [],
        ...o,
      });

      // --- Chain mode dispatch ---
      if (params.chain) {
        try {
          // Clarification TUI — show before execution when clarify=true (interactive only)
          const normalizeAndPreflight = (value: unknown) => {
            const steps = normalizeChainSteps(value, "subagent chain");
            for (const step of steps) {
              for (const name of getStepAgents(step)) {
                if (!findAgentByName(discovery, name)) throw new Error(`Unknown agent: "${name}"`);
              }
            }
            return steps;
          };
          let chainSteps = normalizeAndPreflight(params.chain);
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
              const result = await customUI.custom<
                import("../tui/chain-clarify.js").ChainClarifyResult
              >(
                (tui, theme, _kb, done) =>
                  new ChainClarifyComponent(
                    tui,
                    theme as unknown as import("../tui/agent-widget.js").Theme,
                    chainSteps,
                    done,
                  ),
              );
              if (result.action === "cancel") {
                return {
                  content: [{ type: "text", text: "Chain cancelled." }],
                  isError: false,
                  details: stubDetails({
                    agent: "(chain)",
                    task: params.task ?? "",
                    status: "aborted" as const,
                  }),
                };
              }
              if (result.action === "bg") {
                params.run_in_background = true;
              }
              chainSteps = normalizeAndPreflight(result.steps);
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

            // Model scope enforcement for chain steps
            // Note: uses raw model string; chain steps don't canonicalize through
            // ctx.modelRegistry (registry resolution happens inside spawnAndWait).
            const stepModel = options?.model ?? agentDef.model;
            if (stepModel && settings.modelScope) {
              const source: ModelSource = options?.model ? "explicit" : "inherited";
              const violation = checkModelScope(stepModel, settings.modelScope, source);
              if (violation && violation.severity === "error") {
                throw new Error(violation.message);
              }
              if (violation && violation.severity === "warn") {
                pi.sendMessage({
                  customType: "model_scope_warning",
                  content: `[chain step] ${violation.message}`,
                  display: true,
                });
              }
            }

            return deps.manager.spawnAndWait(ctx, effectiveAgentDef, {
              prompt,
              cwd: stepCwd || effectiveCwd,
              maxTurns: settings.defaultMaxTurns,
              toolBudget: options?.toolBudget,
              isolation: options?.isolation,
              parentSignal: options?.parentSignal,
            });
          };

          const findAgent = (name: string) => {
            const agent = findAgentByName(discovery, name);
            if (!agent) throw new Error(`Unknown agent: "${name}"`);
            return agent;
          };

          // Background chain dispatch — fire and forget
          if (params.run_in_background) {
            deps.manager.fireAndForgetChain(
              chainRunId,
              params.task ?? "",
              chainSteps,
              effectiveCwd,
              (chainSignal, closeAppendAdmission) => executeChain({
                steps: chainSteps,
                task: params.task ?? "",
                spawnAndWait,
                findAgent,
                cwd: effectiveCwd,
                runId: chainRunId,
                signal: chainSignal,
                isAsync: true,
                onAppendClose: closeAppendAdmission,
                onGraphUpdate: (snapshot) => {
                  deps.chainWidget?.update(snapshot);
                  const record = deps.manager.getRecord(chainRunId);
                  if (record) {
                    record.chainSteps = snapshot.nodes
                      .filter((n) => n.kind === "step" || n.kind === "agent")
                      .map((n) => ({ label: n.label, status: n.status, error: n.error }));
                  }
                },
                getSpawnBudget: () => deps.manager.getSpawnBudget(),
              }),
              () => deps.chainWidget?.clear(),
            );
            return {
              content: [
                { type: "text", text: `Chain started in background.\nChain ID: ${chainRunId}` },
              ],
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
            getSpawnBudget: () => deps.manager.getSpawnBudget(),
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
        try {
          enqueueChainAppendRequest(
            deps.manager,
            params.chain_append.chain_id,
            params.chain_append.steps,
            (name) => {
              const agent = findAgentByName(discovery, name);
              if (!agent) throw new Error(`Unknown agent: "${name}"`);
              return agent;
            },
          );
          return {
            content: [
              { type: "text", text: `Steps appended to chain ${params.chain_append.chain_id}.` },
            ],
            isError: false,
            details: stubDetails({
              status: "success",
              agent: "(chain-append)",
              task: `append to ${params.chain_append.chain_id}`,
              stopReason: "completed",
            }),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: message }],
            isError: true,
            details: stubDetails({
              agent: "(chain-append)",
              task: `append to ${params.chain_append.chain_id}`,
              stderr: message,
            }),
          };
        }
      }

      // --- Guard: agent required for single mode ---
      if (!params.agent) {
        return {
          content: [
            {
              type: "text",
              text: "Missing 'agent'. Provide 'agent' for single mode or 'chain' for chain mode.",
            },
          ],
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
            defaultMaxTurns: settings.defaultMaxTurns,
            toolBudget: settings.toolBudget,
          },
        );

        // Validate model string against registry (if available)
        let resolvedModelId = resolved.model;
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
                  usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    contextTokens: 0,
                    cost: 0,
                    turns: 0,
                  },
                  recentToolActivity: [],
                },
              };
            }
            resolvedModelId = `${match.provider}/${match.id}`;
          }
        }

        // Model scope enforcement
        if (resolvedModelId) {
          if (settings.modelScope) {
            const source: ModelSource = agentDef.model
              ? "inherited"
              : params.model
                ? "explicit"
                : "inherited";
            const violation = checkModelScope(resolvedModelId, settings.modelScope, source);
            if (violation && violation.severity === "error") {
              return {
                content: [{ type: "text", text: violation.message }],
                isError: true,
                details: stubDetails({
                  status: "error",
                  agent: agentDef.name,
                  task: params.task,
                  model: resolved.model,
                  stopReason: "error",
                  stderr: violation.message,
                }),
              };
            }
            if (violation && violation.severity === "warn") {
              pi.sendMessage({
                customType: "model_scope_warning",
                content: violation.message,
                display: true,
              });
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
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            contextTokens: 0,
            cost: 0,
            turns: 0,
          },
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
              details: {
                ...detailBase,
                status: "error" as const,
                stopReason: "error",
                stderr: validated.error,
              },
            };
          }
          resolvedBudget = validated.budget;
        }

        const spawnOptions = {
          prompt: params.task.trim(),
          cwd: effectiveCwd,
          maxTurns: resolved.maxTurns,
          graceTurns: settings.graceTurns,
          inheritContext: resolved.inheritContext,
          parentSystemPrompt,
          parentSignal: signal,
          currentDepth: 0,
          toolBudget: resolvedBudget,
          _deps: deps,
        };

        // Resume path
        if (params.resume) {
          const resume = deps.manager.resume(params.resume, params.task.trim(), signal);
          deps.ensureTimers?.();
          const resumed = await resume;
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
              status:
                resumed.status === "completed"
                  ? ("success" as const)
                  : resumed.status === "error"
                    ? ("error" as const)
                    : ("aborted" as const),
              durationMs: resumed.durationMs ?? 0,
              stopReason: resumed.status,
              stderr: resumed.error ?? "",
            },
          };
        }

        // Background spawn path
        if (params.run_in_background) {
          const id = deps.manager.spawn(ctx, agentDef, {
            ...spawnOptions,
            isBackground: true,
            isolation: params.isolation as "worktree" | undefined,
            onActivity: () => deps.widget?.update(),
            onSessionCreated: (session) => {
              try {
                const sessionPath = createOutputFilePath(effectiveCwd, id, `bg-${Date.now()}`);
                writeInitialEntry(sessionPath, id, params.task.trim(), effectiveCwd);
                const cleanup = streamToOutputFile(
                  session as AgentSession,
                  sessionPath,
                  id,
                  effectiveCwd,
                );
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

          deps.ensureTimers?.();

          // Register in batch tracker for smart group detection
          deps.registerBatchAgent?.(id);

          const bgRecord = deps.manager.getRecord(id);
          const queued = bgRecord?.status === "queued";
          return {
            content: [
              {
                type: "text",
                text:
                  `Agent ${queued ? "queued" : "started"} in background.\n` +
                  `Agent ID: ${id}\n` +
                  `You will be notified when this agent completes.\n` +
                  `Use get_subagent_result to retrieve full results, or steer_subagent to send messages.`,
              },
            ],
            isError: false,
            details: {
              ...detailBase,
              status: "background" as const,
              agentId: id,
            },
          };
        }

        // Synchronous foreground path (with optional isolation)
        const { id, record } = await deps.manager.spawnAndWait(ctx, agentDef, {
          ...spawnOptions,
          isolation: params.isolation as "worktree" | undefined,
          onActivity: (record) => {
            ctx.ui?.setWorkingMessage?.(
              `${agentDef.name}: ${describeActivity(record.live.activeTools, record.live.responseText)}`,
            );
          },
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
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              contextTokens: 0,
              cost: 0,
              turns: 0,
            },
            recentToolActivity: [],
          },
        };
      }
    },
  });
}

export function registerAgentCommand(pi: ExtensionAPI, deps: RuntimeDeps): void {
  pi.registerCommand("agent", {
    description: "Run a discovered pi-subagents agent in the foreground",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const input = parseAgentCommandArgs(args);
      const paths = deps.resolvePaths();
      const settings = deps.settings;
      const discovery = deps.discoverAgents(paths);

      try {
        const agentDef = parseAndResolveAgent(discovery, input);
        const maxTurns = agentDef.maxTurns ?? settings.defaultMaxTurns;

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
