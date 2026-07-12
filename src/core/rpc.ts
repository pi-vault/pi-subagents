import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "./agent-manager.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type { AgentDefinition, AgentDiscoveryResult, ResolvedToolBudget } from "../shared/types.js";
import { resolveModel } from "./model-resolver.js";
import { validateToolBudget } from "./tool-budget.js";

const RPC_VERSION = 1;

interface RpcRequest {
  requestId?: string;
  [key: string]: unknown;
}

/** Reject requestIds that could inject into EventBus channel names. */
function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\n\r:]/.test(value);
}

function reply(
  events: { emit: (channel: string, data: unknown) => void },
  baseChannel: string,
  requestId: string,
  payload: { success: true; data?: unknown } | { success: false; error: string },
): void {
  events.emit(`${baseChannel}:reply:${requestId}`, payload);
}

/**
 * Register RPC event handlers for cross-extension communication.
 *
 * Model resolution requires a captured ModelRegistry from ExtensionContext.
 * Pass `getModelRegistry` to enable model validation on spawn requests.
 * If omitted or returns undefined, the agent's default model is used.
 */
export function registerRpcHandlers(
  pi: ExtensionAPI,
  manager: AgentManager,
  deps: RuntimeDeps,
  getModelRegistry?: () =>
    | {
        getAll: () => Array<{ id: string; provider: string; name?: string }>;
        find: (
          provider: string,
          id: string,
        ) => { id: string; provider: string } | undefined;
      }
    | undefined,
): { dispose: () => void } {
  const unsubs: Array<() => void> = [];

  // ping
  unsubs.push(
    pi.events.on("subagents:rpc:ping", (data) => {
      const req = data as RpcRequest;
      if (!isValidRequestId(req.requestId)) return;
      reply(pi.events, "subagents:rpc:ping", req.requestId, {
        success: true,
        data: { version: RPC_VERSION, methods: ["ping", "spawn", "stop", "status", "steer"] },
      });
    }),
  );

  // spawn
  unsubs.push(
    pi.events.on("subagents:rpc:spawn", (data) => {
      const req = data as RpcRequest;
      if (!isValidRequestId(req.requestId)) return;
      const channel = "subagents:rpc:spawn";

      const agent = req.agent;
      const task = req.task;
      if (typeof agent !== "string" || !agent) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: "Missing required field: agent",
        });
        return;
      }
      if (typeof task !== "string" || !task) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: "Missing required field: task",
        });
        return;
      }

      const paths = deps.resolvePaths();
      const discovery = deps.discoverAgents(paths);
      const agentDef = findAgent(discovery, agent);
      if (!agentDef) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: `Unknown agent: ${agent}`,
        });
        return;
      }

      // Resolve model if provided
      let model: unknown;
      if (req.model && typeof req.model === "string") {
        const registry = getModelRegistry?.();
        if (registry) {
          const allModels = registry.getAll();
          const match = resolveModel(req.model, allModels);
          if (!match) {
            reply(pi.events, channel, req.requestId, {
              success: false,
              error: `Unknown model: ${req.model}`,
            });
            return;
          }
          model = registry.find(match.provider, match.id);
        }
      }

      const loadedConfig = deps.loadConfig(paths);
      const maxTurns = agentDef.maxTurns ?? loadedConfig.config.defaultMaxTurns ?? 0;
      const rawBudget = agentDef.toolBudget ?? loadedConfig.config.toolBudget;

      // Validate merged tool budget (mirrors subagent.ts behavior)
      let resolvedBudget: ResolvedToolBudget | undefined;
      if (rawBudget) {
        const validated = validateToolBudget(rawBudget);
        if (validated.error) {
          reply(pi.events, channel, req.requestId, {
            success: false,
            error: validated.error,
          });
          return;
        }
        resolvedBudget = validated.budget;
      }

      try {
        const spawnCtx = { modelRegistry: getModelRegistry?.() };
        const id = manager.spawn(spawnCtx, agentDef, {
          prompt: task,
          cwd: process.cwd(),
          maxTurns,
          graceTurns: loadedConfig.config.graceTurns,
          isBackground: true,
          model,
          toolBudget: resolvedBudget,
          ...(typeof req.thinking === "string"
            ? { thinking: req.thinking }
            : {}),
        });
        deps.registerBatchAgent?.(id);
        reply(pi.events, channel, req.requestId, {
          success: true,
          data: { id },
        });
      } catch (err) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // stop
  unsubs.push(
    pi.events.on("subagents:rpc:stop", (data) => {
      const req = data as RpcRequest;
      if (!isValidRequestId(req.requestId)) return;
      const channel = "subagents:rpc:stop";

      const id = req.id;
      if (typeof id !== "string" || !id) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: "Missing required field: id",
        });
        return;
      }

      const record = manager.getRecord(id);
      if (!record) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: `Agent not found: ${id}`,
        });
        return;
      }

      manager.abort(id);
      reply(pi.events, channel, req.requestId, { success: true });
    }),
  );

  // status
  unsubs.push(
    pi.events.on("subagents:rpc:status", (data) => {
      const req = data as RpcRequest;
      if (!isValidRequestId(req.requestId)) return;
      const channel = "subagents:rpc:status";

      const id = req.id;
      if (typeof id !== "string" || !id) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: "Missing required field: id",
        });
        return;
      }

      const record = manager.getRecord(id);
      if (!record) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: `Agent not found: ${id}`,
        });
        return;
      }

      reply(pi.events, channel, req.requestId, {
        success: true,
        data: {
          status: record.status,
          type: record.type,
          description: record.description,
          toolUses: record.toolUses,
          turnCount: record.turnCount,
          ...(record.result != null ? { result: record.result } : {}),
          ...(record.error != null ? { error: record.error } : {}),
        },
      });
    }),
  );

  // steer
  unsubs.push(
    pi.events.on("subagents:rpc:steer", (data) => {
      const req = data as RpcRequest;
      if (!isValidRequestId(req.requestId)) return;
      const channel = "subagents:rpc:steer";

      const id = req.id;
      const message = req.message;
      if (typeof id !== "string" || !id) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: "Missing required field: id",
        });
        return;
      }
      if (typeof message !== "string" || !message) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: "Missing required field: message",
        });
        return;
      }

      const record = manager.getRecord(id);
      if (!record) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: `Agent not found: ${id}`,
        });
        return;
      }

      const success = manager.steer(id, message);
      if (!success) {
        reply(pi.events, channel, req.requestId, {
          success: false,
          error: `Agent is not running (status: ${record.status})`,
        });
        return;
      }

      reply(pi.events, channel, req.requestId, { success: true });
    }),
  );

  return {
    dispose() {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
    },
  };
}

function findAgent(
  discovery: AgentDiscoveryResult,
  name: string,
): AgentDefinition | undefined {
  const key = name.trim().toLowerCase();
  return discovery.agents.find((a) => a.name.trim().toLowerCase() === key);
}
