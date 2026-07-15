import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { AgentManager } from "./core/agent-manager.js";
import { getAgentConversation } from "./core/agent-runner.js";
import {
  createAgentFile,
  deleteUserAgentOverride,
  disableAgentInUserScope,
  discoverAgents,
  discoverToolNames,
  exportAgentToUserScope,
} from "./core/agents.js";
import { loadConfig, saveConfig } from "./core/config.js";
import { GroupJoinManager } from "./core/group-join-manager.js";
import { resolvePaths } from "./core/paths.js";
import { applySettings, loadSettings } from "./core/settings.js";
import { SmartBatchTracker } from "./core/smart-batch-tracker.js";
import { registerAgentCommand, registerSubagentTool } from "./core/subagent.js";
import { registerRpcHandlers } from "./core/rpc.js";
import { registerWaitTool } from "./core/wait.js";
import {
  createIntercomManager,
  createIntercomTool,
  type IntercomRequest,
} from "./core/intercom.js";
import { checkLocalMemoryGitignore } from "./core/memory.js";
import { registerChainCommands } from "./core/slash-chain.js";
import { registerPromptWorkflowCommands } from "./core/prompt-workflows.js";
import { createWatchdogRuntime, parseWatchdogConfig } from "./core/watchdog.js";
import type { WatchdogWarning } from "./core/watchdog.js";
import { resolveChildWatchdogConfig } from "./core/watchdog-child.js";
import { formatWatchdogWarningText } from "./core/watchdog-render.js";
import type { RuntimeDeps } from "./shared/runtime-deps.js";
import type { JoinMode, NotificationDetails, WidgetMode } from "./shared/types.js";
import type { AgentActivity } from "./tui/activity.js";
import { AgentWidget, type UICtx } from "./tui/agent-widget.js";
import { showAgentsMenu } from "./tui/agents-menu.js";
import { ChainWidget } from "./tui/chain-widget.js";
import { FleetList, type FleetUICtx } from "./tui/fleet-list.js";
import { buildNotificationText, renderSubagentMessage } from "./tui/render.js";

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

  // ---- TUI: per-agent activity tracking + widget/fleet (forward-declared) ----
  // widget and fleet are created after the manager (they need it), but the manager's
  // callbacks close over them. Safe because callbacks only fire after full init.
  const agentActivity = new Map<string, AgentActivity>();
  let widget!: AgentWidget;
  let fleet!: FleetList;

  const groupJoin = new GroupJoinManager((records, partial) => {
    for (const record of records) {
      // TUI cleanup already handled by manager onComplete callback (lines below).
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
    widget.update();
  });

  // Load settings early (needed for watchdog config before manager construction)
  const settings = loadSettings(process.cwd());

  // Watchdog: adversarial reviewer at agent-end boundaries
  const watchdogConfig = parseWatchdogConfig(settings.watchdog);
  // Late-bound: manager is constructed below; callbacks are only invoked async after that
  let sessionMessageSource: ((agentId: string) => unknown[] | undefined) | undefined;
  let resumeAgentFn: ((id: string, msg: string) => Promise<void>) | undefined;
  const watchdog = createWatchdogRuntime(watchdogConfig, {
    onWarnings: (agentId, warnings) => {
      for (const w of warnings) {
        const content = `[watchdog/${w.severity}] ${w.summary}\nEvidence: ${w.evidence}\nAction: ${w.recommendedAction}`;
        (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
          {
            customType: "watchdog-warning",
            content,
            display: true,
            details: { agentId, ...w, state: "displayed" },
          } as unknown as Parameters<typeof pi.sendMessage>[0],
          { deliverAs: "followUp", triggerTurn: true },
        );
      }
    },
    getSessionMessages: (agentId) => sessionMessageSource?.(agentId),
    resumeAgent: async (agentId, message) => { await resumeAgentFn?.(agentId, message); },
  });

  // Intercom: child↔parent communication channel
  const intercom = createIntercomManager({
    onRequest: (request) => {
      const label = `[${request.agentName}] ${request.reason}: ${request.message}`;
      (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
        {
          customType: "intercom-request",
          content: label,
          display: true,
          details: request,
        } as unknown as Parameters<typeof pi.sendMessage>[0],
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
  });

  const manager = new AgentManager(3, (record) => {
    // Fire lifecycle events
    const isError =
      record.status === "error" || record.status === "stopped" || record.status === "aborted";
    (pi as unknown as { events?: { emit: (ch: string, data: unknown) => void } }).events?.emit(
      isError ? "subagents:failed" : "subagents:completed",
      {
        id: record.id,
        type: record.type,
        status: record.status,
        result: record.result,
        error: record.error,
      },
    );

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

    // Cancel any pending intercom requests for this agent
    intercom.cancelForAgent(record.id);

    // Trigger watchdog review non-blocking after agent completes
    if (watchdog.status() !== "disabled" && record.status === "completed") {
      const childConfig = resolveChildWatchdogConfig(watchdogConfig, record.type);
      if (childConfig) {
        // Child-specific review: run with potentially different model/thinking
        const childOverrideConfig = {
          ...watchdogConfig,
          ...(childConfig.model ? { model: childConfig.model } : {}),
          ...(childConfig.thinking ? { thinking: childConfig.thinking } : {}),
        };
        const sendWarning = (agentId: string, w: WatchdogWarning) => {
          const content = `[watchdog/child/${w.severity}] ${w.summary}\nEvidence: ${w.evidence}\nAction: ${w.recommendedAction}`;
          (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
            {
              customType: "watchdog-warning",
              content,
              display: true,
              details: { agentId, ...w, state: "displayed", source: "child" },
            } as unknown as Parameters<typeof pi.sendMessage>[0],
            { deliverAs: "followUp", triggerTurn: true },
          );
        };
        const childWatchdog = createWatchdogRuntime(childOverrideConfig, {
          onWarnings: (agentId, ws) => {
            for (const w of ws) sendWarning(agentId, w);
          },
          getSessionMessages: (agentId) => sessionMessageSource?.(agentId),
        });
        childWatchdog.handleAgentEnd(record.id, record.cwd ?? process.cwd())
          .catch((err) => { console.error("[watchdog/child] handleAgentEnd failed:", err); })
          .finally(() => { childWatchdog.dispose(); });
      } else {
        watchdog.handleAgentEnd(record.id, record.cwd ?? process.cwd()).catch((err) => {
          console.error("[watchdog] handleAgentEnd failed:", err);
        });
      }
    }

    // TUI: mark agent finished immediately regardless of notification path
    agentActivity.delete(record.id);
    widget.markFinished(record.id);
    fleet.update();

    if (record.resultConsumed) {
      widget.update();
      return;
    }

    // If agent is in the current batch, defer notification to finalizeBatch
    if (tracker.isInCurrentBatch(record.id)) {
      widget.update();
      return;
    }

    const joinResult = groupJoin.onAgentComplete(record);
    if (joinResult === "pass") {
      // Hold briefly so get_subagent_result can cancel before we send
      const timerId = setTimeout(() => {
        pendingNudges.delete(record.id);
        if (record.resultConsumed) return;
        sendNudge(record);
      }, NUDGE_HOLD_MS);
      pendingNudges.set(record.id, timerId);
    }
    widget.update();
  });

  // Apply spawn limit from config
  manager.setMaxSpawnsPerSession(loadConfig(resolvePaths()).config.maxSpawnsPerSession);

  // Wire session message source for watchdog turn-delta mode (late-bound, manager now exists)
  sessionMessageSource = (agentId) => {
    const record = manager.getRecord(agentId);
    if (!record?.session) return undefined;
    return (record.session as { messages?: unknown[] }).messages;
  };
  // Wire resume agent for watchdog auto-follow steering
  resumeAgentFn = async (id, msg) => { await manager.resume(id, msg); };

  function sendNudge(record: Parameters<typeof formatTaskNotification>[0]): void {
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
  }

  const tracker = new SmartBatchTracker(
    groupJoin,
    (id) => manager.getRecord(id),
    sendNudge,
    () => deps.defaultJoinMode ?? "smart",
  );

  // ---- TUI: create widget and fleet (after manager) ----
  let widgetMode: WidgetMode = "background";
  widget = new AgentWidget(manager, agentActivity, () => widgetMode);
  fleet = new FleetList(manager, agentActivity);
  const chainWidget = new ChainWidget();

  function applyWidgetMode(mode: WidgetMode): void {
    widgetMode = mode;
    widget.update();
  }
  function applyFleetView(enabled: boolean): void {
    fleet.setEnabled(enabled);
  }

  const deps: RuntimeDeps = {
    resolvePaths,
    loadConfig,
    discoverAgents,
    discoverToolNames: () => discoverToolNames(pi.getAllTools().map((tool) => tool.name)),
    createAgentFile,
    exportAgentToUserScope,
    disableAgentInUserScope,
    deleteUserAgentOverride,
    saveConfig,
    manager,
    groupJoin,
    pendingNudges,
    defaultJoinMode: "smart" as JoinMode,
    registerBatchAgent: (id) => tracker.register(id),
    disposeBatchTracker: () => tracker.dispose(),
    widget,
    fleet,
    agentActivity,
    chainWidget,
    intercom,
    watchdog,
    ensureTimers: () => {
      widget.ensureTimer();
      fleet.ensureTimer();
    },
    setWidgetMode: applyWidgetMode,
    setFleetView: applyFleetView,
  };

  // Apply persisted settings to live state
  applySettings(settings, {
    setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
    setDefaultJoinMode: (mode) => {
      deps.defaultJoinMode = mode;
    },
    setWidgetMode: applyWidgetMode,
    setFleetView: applyFleetView,
    setMaxSpawnsPerSession: (n) => manager.setMaxSpawnsPerSession(n),
  });

  // One-time gitignore check for local memory
  const gitignoreWarning = checkLocalMemoryGitignore(process.cwd());
  if (gitignoreWarning) {
    (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
      {
        customType: "subagent-notification",
        content: gitignoreWarning,
        display: true,
      } as unknown as Parameters<typeof pi.sendMessage>[0],
      { deliverAs: "followUp" },
    );
  }

  return deps;
}

export function registerSubagentsExtension(
  pi: ExtensionAPI,
  deps: RuntimeDeps = createRuntimeDeps(pi),
): void {
  pi.registerMessageRenderer("pi-subagent-result", (msg, opts, theme) =>
    renderSubagentMessage(msg as Parameters<typeof renderSubagentMessage>[0], opts, theme),
  );

  // Background notification renderer
  pi.registerMessageRenderer("subagent-notification", (msg, opts, theme) => {
    const d = (msg as { details?: NotificationDetails }).details;
    if (!d) return new Text("", 0, 0);
    const t = theme as {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    };
    const all = [d, ...(d.others ?? [])];
    return new Text(
      all.map((item) => buildNotificationText(item, opts.expanded ?? false, t)).join("\n"),
      0,
      0,
    );
  });

  // Watchdog warning renderer with severity colors and state labels
  pi.registerMessageRenderer("watchdog-warning", (msg, opts, theme) => {
    const d = (msg as { details?: {
      severity?: string; summary?: string; evidence?: string;
      recommendedAction?: string; category?: string; state?: string;
      autoFollowAttempt?: number; agentId?: string;
    } }).details;
    const fallback = typeof (msg as { content?: string }).content === "string"
      ? (msg as { content: string }).content : "";
    if (!d?.summary) return new Text(fallback, 0, 0);
    const t = theme as {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    };
    const parts = formatWatchdogWarningText(d as Parameters<typeof formatWatchdogWarningText>[0]);
    const header = t.fg(parts.color, t.bold(parts.header));
    const container = new Container();
    container.addChild(new Text(header, 0, 0));
    if (opts.expanded) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(t.fg("dim", parts.evidenceLine), 0, 0));
      container.addChild(new Text(t.fg("dim", parts.actionLine), 0, 0));
      container.addChild(new Text(t.fg("dim", parts.categoryLine), 0, 0));
    } else if (d.evidence) {
      container.addChild(new Text(t.fg("dim", `  \u23BF  ${parts.evidenceLine}`), 0, 0));
    }
    return container;
  });

  registerSubagentTool(pi, deps);
  registerAgentCommand(pi, deps);
  registerChainCommands(pi, deps);
  registerPromptWorkflowCommands(pi, deps);

  // Watchdog slash command: /watchdog [status|off|recommend-model]
  pi.registerCommand("watchdog", {
    description: "Watchdog control: status, off, recommend-model",
    handler: async (args) => {
      const sub = args.trim().toLowerCase();
      const sendMsg = (content: string) =>
        (pi as unknown as { sendMessage: (msg: unknown, opts?: unknown) => void }).sendMessage(
          { customType: "notification", content, display: true } as unknown as Parameters<typeof pi.sendMessage>[0],
        );

      if (sub === "off") {
        deps.watchdog?.dispose();
        sendMsg("Watchdog disabled for this session.");
      } else if (sub === "recommend-model") {
        const { recommendWatchdogModel, detectProviderFamily } = await import("./core/watchdog-model-selection.js");
        const currentFamily = detectProviderFamily(
          capturedCurrentModel?.provider,
          capturedCurrentModel?.id,
        );
        const rec = recommendWatchdogModel(currentFamily);
        sendMsg([
          `Recommended watchdog model: ${rec.model}`,
          `Thinking level: ${rec.thinking}`,
          `Reason: ${rec.reason}`,
          ``,
          `To apply, add to .pi/subagents.json:`,
          `  "watchdog": { "model": "${rec.model}", "thinking": "${rec.thinking}" }`,
        ].join("\n"));
      } else {
        const st = deps.watchdog?.status() ?? "not initialized";
        sendMsg(`Watchdog status: ${st}`);
      }
    },
  });

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

      (pi as unknown as { events?: { emit: (ch: string, data: unknown) => void } }).events?.emit(
        "subagents:steered",
        {
          id: record.id,
          message: params.message,
        },
      );
      return {
        content: [{ type: "text", text: `Steering message sent to agent ${record.id}.` }],
        details: undefined,
      };
    },
  });

  // wait tool — blocks until background agent(s) complete
  registerWaitTool(pi, deps.manager);

  // Intercom: parent-side reply tool
  if (deps.intercom) {
    pi.registerTool(createIntercomTool(deps.intercom) as never);

    // Render intercom requests from children
    pi.registerMessageRenderer("intercom-request", (msg, _opts, theme) => {
      const d = (msg as { details?: IntercomRequest }).details;
      if (!d) return new Text("", 0, 0);
      const t = theme as {
        fg: (color: string, text: string) => string;
        bold: (text: string) => string;
      };
      return new Text(
        `${t.bold(t.fg("cyan", `[${d.agentName}]`))} ${d.reason}: ${d.message}`,
        0,
        0,
      );
    });
  }

  // Captured from ExtensionContext during tool execution for RPC model resolution
  let capturedModelRegistry: {
    getAll: () => Array<{ id: string; provider: string; name?: string }>;
    find: (provider: string, id: string) => { id: string; provider: string } | undefined;
  } | undefined;
  let capturedCurrentModel: { provider?: string; id?: string } | undefined;

  // RPC handlers for cross-extension communication
  const rpcDispose = registerRpcHandlers(
    pi,
    deps.manager,
    deps,
    () => capturedModelRegistry,
  );

  // Acquire TUI context on each tool execution: set UI context on widget and fleet,
  // and age finished agents so they clear from the widget after one turn.
  pi.on("tool_execution_start", (_event, ctx) => {
    deps.widget?.setUICtx(ctx.ui as UICtx);
    deps.chainWidget?.setUICtx(ctx.ui as UICtx);
    deps.fleet?.setUICtx(ctx.ui as unknown as FleetUICtx);
    deps.widget?.onTurnStart();
    capturedModelRegistry = (ctx as { modelRegistry?: typeof capturedModelRegistry }).modelRegistry;
    capturedCurrentModel = (ctx as { model?: typeof capturedCurrentModel }).model;
  });

  // Cleanup on session shutdown
  pi.on("session_shutdown", () => {
    rpcDispose.dispose();
    deps.watchdog?.dispose();
    deps.widget?.dispose();
    deps.chainWidget?.dispose();
    deps.fleet?.dispose();
    deps.agentActivity?.clear();
    deps.intercom?.dispose();
    deps.manager.abortAll();
    deps.manager.dispose();
    deps.groupJoin?.dispose();
    deps.disposeBatchTracker?.();
  });

  // Clear completed on session switch (keep running ones), reset spawn counter
  pi.on("session_before_switch", () => {
    deps.manager.resetSpawnCounter();
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
