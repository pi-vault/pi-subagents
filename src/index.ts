import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAgentFile,
  deleteUserAgentOverride,
  disableAgentInUserScope,
  discoverAgents,
  discoverToolNames,
  exportAgentToUserScope,
} from "./core/agents.js";
import { AgentManager } from "./core/agent-manager.js";
import { GroupJoinManager } from "./core/group-join-manager.js";
import { getAgentConversation } from "./core/agent-runner.js";
import { loadConfig, saveConfig } from "./core/config.js";
import { resolvePaths } from "./core/paths.js";
import {
  registerAgentCommand,
  registerSubagentTool,
} from "./core/subagent.js";
import type { NotificationDetails } from "./shared/types.js";
import type { RuntimeDeps } from "./shared/runtime-deps.js";
import { showAgentsMenu } from "./tui/agents-menu.js";
import { renderSubagentMessage } from "./tui/render.js";

const NUDGE_HOLD_MS = 200;

type AgentRecordSnapshot = {
  id: string;
  type: string;
  status: string;
  result?: string;
  error?: string;
  toolUses: number;
  turnCount: number;
  lifetimeUsage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number };
  startedAt: number;
  completedAt?: number;
  outputFile?: string;
};

function formatTaskNotification(record: AgentRecordSnapshot): string {
  const durationMs = record.completedAt ? record.completedAt - record.startedAt : 0;
  const totalTokens = record.lifetimeUsage.inputTokens + record.lifetimeUsage.outputTokens;
  const resultPreview = (record.result ?? record.error ?? "").slice(0, 200);
  return [
    "<task-notification>",
    `<task-id>${record.id}</task-id>`,
    `<status>${record.status}</status>`,
    `<summary>Agent "${record.type}" ${record.status}</summary>`,
    `<result>${resultPreview}</result>`,
    `<usage><total_tokens>${totalTokens}</total_tokens><tool_uses>${record.toolUses}</tool_uses><duration_ms>${durationMs}</duration_ms></usage>`,
    "</task-notification>",
  ].join("\n");
}

function buildNotificationDetails(record: AgentRecordSnapshot): NotificationDetails {
  const durationMs = record.completedAt ? record.completedAt - record.startedAt : 0;
  const totalTokens = record.lifetimeUsage.inputTokens + record.lifetimeUsage.outputTokens;
  return {
    id: record.id,
    description: record.type,
    status: record.status,
    toolUses: record.toolUses,
    turnCount: record.turnCount,
    totalTokens,
    durationMs,
    outputFile: record.outputFile,
    error: record.error,
    resultPreview: (record.result ?? record.error ?? "").slice(0, 200),
  };
}

export function createRuntimeDeps(pi: ExtensionAPI): RuntimeDeps {
  const pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();

  const groupJoin = new GroupJoinManager((records, partial) => {
    for (const record of records) {
      const notification = formatTaskNotification(record);
      const details = buildNotificationDetails(record);
      if (partial) {
        details.others = records
          .filter((r) => r.id !== record.id)
          .map((r) => buildNotificationDetails(r));
      }
      (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
        {
          customType: "subagent-notification",
          content: notification,
          display: true,
          details,
        } as unknown as Parameters<typeof pi.sendMessage>[0],
        { deliverAs: "followUp", triggerTurn: true },
      );
    }
  });

  const manager = new AgentManager(3, (record) => {
    // Fire lifecycle events
    const isError =
      record.status === "error" ||
      record.status === "stopped" ||
      record.status === "aborted";
    (
      pi as unknown as { events?: { emit: (ch: string, data: unknown) => void } }
    ).events?.emit(isError ? "subagents:failed" : "subagents:completed", {
      id: record.id,
      type: record.type,
      status: record.status,
      result: record.result,
      error: record.error,
    });

    // Persist record
    (pi as unknown as { appendEntry?: (t: string, d: unknown) => void }).appendEntry?.(
      "subagents:record",
      {
        id: record.id,
        type: record.type,
        status: record.status,
        result: record.result,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
    );

    if (record.resultConsumed) return;

    const joinResult = groupJoin.onAgentComplete(record);
    if (joinResult === "pass") {
      // Hold briefly so get_subagent_result can cancel before we send
      const timerId = setTimeout(() => {
        pendingNudges.delete(record.id);
        if (record.resultConsumed) return;
        const notification = formatTaskNotification(record);
        (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
          {
            customType: "subagent-notification",
            content: notification,
            display: true,
            details: buildNotificationDetails(record),
          } as unknown as Parameters<typeof pi.sendMessage>[0],
          { deliverAs: "followUp", triggerTurn: true },
        );
      }, NUDGE_HOLD_MS);
      pendingNudges.set(record.id, timerId);
    }
  });

  return {
    resolvePaths,
    loadConfig,
    discoverAgents,
    discoverToolNames: () =>
      discoverToolNames(pi.getAllTools().map((tool) => tool.name)),
    createAgentFile,
    exportAgentToUserScope,
    disableAgentInUserScope,
    deleteUserAgentOverride,
    saveConfig,
    manager,
    groupJoin,
    pendingNudges,
  };
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(pi),
): void {
  pi.registerMessageRenderer("pi-subagent-result", (msg, opts, theme) =>
    renderSubagentMessage(
      msg as Parameters<typeof renderSubagentMessage>[0],
      opts,
      theme,
    ),
  );

  // Background notification renderer
  pi.registerMessageRenderer("subagent-notification", (msg, _opts, theme) => {
    const d = (msg as { details?: NotificationDetails }).details;
    if (!d) return new Text("", 0, 0);
    const t = theme as { fg: (color: string, text: string) => string };
    const isError =
      d.status === "error" || d.status === "stopped" || d.status === "aborted";
    const lines = [
      t.fg(
        isError ? "error" : "success",
        `${isError ? "Agent failed" : "Agent completed"}: ${d.description}`,
      ),
      t.fg(
        "dim",
        `${d.toolUses} tools, ${d.turnCount} turns, ${d.totalTokens} tokens, ${d.durationMs}ms`,
      ),
    ];
    if (d.resultPreview) {
      lines.push(t.fg("muted", d.resultPreview.slice(0, 120)));
    }
    return new Text(lines.join("\n"), 0, 0);
  });

  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps);

  // get_subagent_result tool
  pi.registerTool({
    name: "get_subagent_result",
    label: "Get Agent Result",
    description: "Check status and retrieve results from a background agent.",
    promptSnippet: "Check status and retrieve results from a background agent",
    parameters: Type.Object({
      agent_id: Type.String({ description: "The agent ID to check." }),
      wait: Type.Optional(
        Type.Boolean({
          description: "If true, wait for completion. Default: false.",
        }),
      ),
      verbose: Type.Optional(
        Type.Boolean({
          description: "If true, include full conversation. Default: false.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const record = deps.manager.getRecord(params.agent_id);
      if (!record) {
        return {
          content: [{ type: "text", text: `Agent not found: "${params.agent_id}".` }],
          details: undefined,
        };
      }

      // Cancel pending nudge — we're retrieving the result, no notification needed
      const nudgeTimer = deps.pendingNudges?.get(params.agent_id);
      if (nudgeTimer != null) {
        clearTimeout(nudgeTimer);
        deps.pendingNudges?.delete(params.agent_id);
      }

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

      if (params.verbose && record.session) {
        const conversation = getAgentConversation(record.session);
        if (conversation) output += `\n\n--- Agent Conversation ---\n${conversation}`;
      }

      return { content: [{ type: "text", text: output }], details: undefined };
    },
  });

  // steer_subagent tool
  pi.registerTool({
    name: "steer_subagent",
    label: "Steer Agent",
    description: "Send a steering message to a running background agent.",
    promptSnippet: "Send a steering message to redirect a running background agent",
    parameters: Type.Object({
      agent_id: Type.String({ description: "Agent ID to steer." }),
      message: Type.String({ description: "Message to send." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const record = deps.manager.getRecord(params.agent_id);
      if (!record) {
        return {
          content: [{ type: "text", text: `Agent not found: "${params.agent_id}".` }],
          details: undefined,
        };
      }
      if (record.status !== "running" && record.status !== "queued") {
        return {
          content: [
            {
              type: "text",
              text: `Agent is not running (status: ${record.status}).`,
            },
          ],
          details: undefined,
        };
      }

      const success = deps.manager.steer(params.agent_id, params.message);
      if (!success) {
        return {
          content: [{ type: "text", text: "Failed to steer agent." }],
          details: undefined,
        };
      }

      (
        pi as unknown as { events?: { emit: (ch: string, data: unknown) => void } }
      ).events?.emit("subagents:steered", {
        id: record.id,
        message: params.message,
      });
      return {
        content: [{ type: "text", text: `Steering message sent to agent ${record.id}.` }],
        details: undefined,
      };
    },
  });

  // Cleanup on session shutdown
  pi.on("session_shutdown", () => {
    deps.manager.abortAll();
    deps.manager.dispose();
    deps.groupJoin?.dispose();
  });

  // Clear completed on session switch (keep running ones)
  pi.on("session_before_switch", () => {
    deps.manager.clearCompleted();
  });

  pi.registerCommand("agents", {
    description: "Open the interactive pi-subagents agents menu",
    handler: async (_args, ctx) => {
      await showAgentsMenu(ctx, deps);
    },
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
