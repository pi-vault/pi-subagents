import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createAgentFile,
  deleteUserAgentOverride,
  disableAgentInUserScope,
  discoverAgents,
  discoverToolNames,
  exportAgentToUserScope,
} from "./core/agents.js";
import { loadConfig, saveConfig } from "./core/config.js";
import { resolvePaths } from "./core/paths.js";
import {
  registerAgentCommand,
  registerSlashAgentBridge,
  registerSubagentTool,
} from "./core/subagent.js";
import {
  getJobStatuses,
  onJobComplete,
  startBackgroundTracker,
  stopBackgroundTracker,
} from "./core/background-tracker.js";
import { hydrateDeferredSlashRequestsFromSession } from "./core/deferred-slash-state.js";
import type { RuntimeDeps } from "./shared/types.js";
import { SLASH_RESULT_TYPE } from "./shared/types.js";
import { showAgentsMenu } from "./tui/agents-menu.js";
import { renderSubagentMessage } from "./tui/render.js";

export function createRuntimeDeps(pi: ExtensionAPI): RuntimeDeps {
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
  };
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(pi),
): void {
  pi.registerMessageRenderer(SLASH_RESULT_TYPE, renderSubagentMessage);
  registerSlashAgentBridge(pi, deps);
  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps);

  pi.registerCommand("agents", {
    description: "Open the interactive pi-subagents agents menu",
    handler: async (_args, ctx) => {
      await showAgentsMenu(ctx, deps);
    },
  });

  pi.registerTool({
    name: "subagent_status",
    label: "Subagent Status",
    description: "List all background subagent jobs or get a specific job by ID.",
    parameters: Type.Object({
      job_id: Type.Optional(
        Type.String({ description: "Job ID to look up. Omit to list all." }),
      ),
    }),
    async execute(_toolCallId, params) {
      const statuses = getJobStatuses();
      if (params.job_id) {
        const job = statuses.find((s) => s.id === params.job_id);
        if (!job) {
          return {
            content: [{ type: "text", text: `No job found with ID: ${params.job_id}` }],
            isError: true,
            details: undefined,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
          isError: false,
          details: undefined,
        };
      }
      if (statuses.length === 0) {
        return {
          content: [{ type: "text", text: "No background jobs." }],
          isError: false,
          details: undefined,
        };
      }
      const lines = statuses.map(
        (s) =>
          `[${s.state.toUpperCase()}] ${s.id} | ${s.agent} | ${Math.round(s.durationMs / 1000)}s | ${s.task.slice(0, 60)}`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        isError: false,
        details: undefined,
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    hydrateDeferredSlashRequestsFromSession(ctx.sessionManager);
  });

  onJobComplete((job, result) => {
    const duration = job.endedAt ? Math.round((job.endedAt - job.startedAt) / 1000) : "?";
    const icon = result.isError ? "✗" : "✓";
    pi.sendMessage({
      customType: SLASH_RESULT_TYPE,
      content: `${icon} Background agent **${job.agent}** completed in ${duration}s\nJob: ${job.id}\n\n${result.content.slice(0, 500)}`,
      display: true,
    });
  });

  startBackgroundTracker();

  pi.on("session_shutdown", () => {
    stopBackgroundTracker();
  });
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerSubagentsExtension(pi);
}
