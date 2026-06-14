import { Container, Text } from "@earendil-works/pi-tui";
import type { ExecutionStateStore } from "../core/execution-state.js";
import type {
  AgentToolResult,
  MessageRenderOptions,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type {
  SlashLiveDetails,
  SubagentCommandMessage,
  SubagentExecutionDetails,
  SubagentMessageDetails,
  SubagentToolInput,
} from "../shared/types.js";

const MAX_TASK_PREVIEW = 80;
const MAX_ACTIVITY_PREVIEW = 72;
const MAX_COLLAPSED_ACTIVITY = 5;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function previewText(value: string | undefined, maxLength: number): string {
  const compact = compactWhitespace(value ?? "");
  if (!compact) {
    return "-";
  }
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 3)}...`
    : compact;
}

function formatNumber(value: number | null | undefined): string {
  return value === undefined || value === null ? "-" : String(value);
}

function formatPath(value: string | undefined): string {
  return value?.trim() ? value : "-";
}

function formatUsage(details: SubagentExecutionDetails): string {
  return `${details.usage.input}/${details.usage.output} tok, ${details.usage.turns} turns`;
}

function isSlashLiveDetails(
  details: SubagentMessageDetails | undefined,
): details is SlashLiveDetails {
  return Boolean(details && "kind" in details && details.kind === "slash-live");
}

function normalizeMessageContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") {
    return content;
  }

  return (
    content
      .filter((entry) => entry.type === "text")
      .map((entry) => entry.text ?? "")
      .join("") || "(no output)"
  );
}

function getStatusColor(status: SubagentExecutionDetails["status"]):
  | "success"
  | "error"
  | "warning" {
  if (status === "success") {
    return "success";
  }
  return status === "error" ? "error" : "warning";
}

type RenderTheme = {
  fg: (color: ThemeColor, text: string) => string;
  bold: (text: string) => string;
};

export function buildSubagentCallText(
  args: SubagentToolInput,
  theme: RenderTheme,
): string {
  let text =
    theme.fg("toolTitle", theme.bold("subagent ")) +
    theme.fg("accent", args.agent || "...");
  text += `\n  ${theme.fg("dim", previewText(args.task, MAX_TASK_PREVIEW))}`;
  if (args.cwd?.trim()) {
    text += `\n  ${theme.fg("muted", `cwd: ${args.cwd}`)}`;
  }
  return text;
}

function buildSlashLiveText(
  details: SlashLiveDetails,
  expanded: boolean,
  theme: RenderTheme,
): string {
  const status = theme.fg("warning", "RUNNING");
  const lines = [
    `${status} ${theme.fg("toolTitle", theme.bold(details.agent))}`,
    theme.fg("muted", `task: ${details.task || "-"}`),
    theme.fg("muted", `cwd: ${formatPath(details.cwd)}`),
    theme.fg("muted", `duration: ${details.durationMs}ms`),
  ];

  const activityLabels = details.recentToolActivity.map((entry) => entry.label);
  if (activityLabels.length > 0) {
    lines.push(theme.fg("dim", `tools: ${activityLabels.join(", ")}`));
  }

  if (expanded && details.recentToolActivity.length > 0) {
    lines.push(theme.fg("muted", "recent tools:"));
    for (const activity of details.recentToolActivity) {
      lines.push(
        theme.fg(
          "dim",
          `  - ${activity.label}: ${previewText(activity.preview, MAX_ACTIVITY_PREVIEW)}`,
        ),
      );
    }
  }

  if (expanded && details.childSessionPath) {
    lines.push(theme.fg("muted", `child session path: ${details.childSessionPath}`));
  }

  if (expanded && details.stderr?.trim()) {
    lines.push(theme.fg("error", details.stderr.trim()));
  }

  return lines.join("\n");
}

export function buildSubagentResultText(
  content: string,
  details: SubagentMessageDetails | undefined,
  expanded: boolean,
  theme: RenderTheme,
): string {
  if (!details) {
    return content || "(no output)";
  }

  if (isSlashLiveDetails(details)) {
    return buildSlashLiveText(details, expanded, theme);
  }

  const statusColor = getStatusColor(details.status);
  const status = theme.fg(statusColor, details.status.toUpperCase());
  const headerParts = [
    status,
    theme.fg("toolTitle", theme.bold(details.agent)),
  ];
  if (details.model) {
    headerParts.push(theme.fg("muted", details.model));
  }

  if (!expanded) {
    const lines = [headerParts.join(" ")];
    lines.push(
      theme.fg(
        "muted",
        `duration ${details.durationMs}ms • usage ${formatUsage(details)} • session ${formatPath(details.childSessionPath)}`,
      ),
    );
    const activityLabels = details.recentToolActivity
      .slice(-MAX_COLLAPSED_ACTIVITY)
      .map((activity) => activity.label);
    if (activityLabels.length > 0) {
      lines.push(theme.fg("dim", `tools: ${activityLabels.join(", ")}`));
    }
    return lines.join("\n");
  }

  const lines = [headerParts.join(" ")];
  lines.push(theme.fg("muted", `task: ${details.task || "-"}`));
  lines.push(theme.fg("muted", `cwd: ${formatPath(details.cwd)}`));
  lines.push(theme.fg("muted", `source: ${formatPath(details.sourcePath)}`));
  lines.push(theme.fg("muted", `timeout: ${details.timeoutMs}ms`));
  lines.push(theme.fg("muted", `duration: ${details.durationMs}ms`));
  lines.push(theme.fg("muted", `usage: ${formatUsage(details)}`));
  lines.push(theme.fg("muted", `stop reason: ${details.stopReason || "-"}`));
  lines.push(theme.fg("muted", `exit code: ${formatNumber(details.exitCode)}`));
  lines.push(
    theme.fg("muted", `child session dir: ${formatPath(details.childSessionDir)}`),
  );
  lines.push(
    theme.fg("muted", `child session path: ${formatPath(details.childSessionPath)}`),
  );
  if (details.artifactPaths) {
    lines.push(
      theme.fg("muted", `artifact input: ${formatPath(details.artifactPaths.input)}`),
    );
    lines.push(
      theme.fg("muted", `artifact output: ${formatPath(details.artifactPaths.output)}`),
    );
    lines.push(
      theme.fg("muted", `artifact meta: ${formatPath(details.artifactPaths.meta)}`),
    );
  }

  if (details.recentToolActivity.length > 0) {
    lines.push(theme.fg("muted", "recent tools:"));
    for (const activity of details.recentToolActivity) {
      const preview = previewText(activity.preview, MAX_ACTIVITY_PREVIEW);
      lines.push(theme.fg("dim", `  - ${activity.label}: ${preview}`));
    }
  }

  if (details.stderr.trim()) {
    lines.push(theme.fg("muted", "stderr:"));
    lines.push(theme.fg("error", details.stderr.trim()));
  }

  lines.push(theme.fg("muted", "final output:"));
  lines.push(content || "(no output)");
  return lines.join("\n");
}

export function renderSubagentCall(
  args: SubagentToolInput,
  theme: Theme,
): Text {
  return new Text(buildSubagentCallText(args, theme), 0, 0);
}

export function renderSubagentResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  store: ExecutionStateStore,
): Text {
  const content = normalizeMessageContent(
    result.content as string | Array<{ type: string; text?: string }>,
  );
  let details = result.details as SubagentMessageDetails | undefined;
  if (store && details && isSlashLiveDetails(details)) {
    const snapshot = store.getSnapshot(details.requestId);
    if (snapshot?.live && snapshot.live.durationMs >= details.durationMs) {
      details = snapshot.live;
    }
  }
  return new Text(
    buildSubagentResultText(content, details, options.expanded, theme),
    0,
    0,
  );
}

export function renderSubagentMessage(
  message: {
    content: string | Array<{ type: string; text?: string }>;
    details?: SubagentMessageDetails;
  },
  options: MessageRenderOptions,
  theme: Theme,
  store: ExecutionStateStore,
): Text | Container {
  if (isSlashLiveDetails(message.details)) {
    return createSlashLiveMessageComponent(
      {
        content: message.content,
        details: message.details,
      },
      options,
      theme,
      store,
    );
  }

  const baseContent = normalizeMessageContent(
    message.content as string | Array<{ type: string; text?: string }>,
  );

  return new Text(
    buildSubagentResultText(
      baseContent,
      message.details,
      options.expanded,
      theme,
    ),
    0,
    0,
  );
}

function createSlashLiveMessageComponent(
  message: {
    content: string | Array<{ type: string; text?: string }>;
    details: SlashLiveDetails;
  },
  options: MessageRenderOptions,
  theme: Theme,
  store: ExecutionStateStore,
): Container {
  const container = new Container();
  let lastVersion = -1;

  container.render = (width: number): string[] => {
    const snapshot = store.getSnapshot(message.details.requestId);
    const currentVersion = snapshot?.version ?? 0;
    const running = store.isLiveRunning(message.details.requestId);

    if (currentVersion !== lastVersion || running) {
      lastVersion = currentVersion;
      const resolved = store.getRenderableMessage(message.details);
      const baseContent = normalizeMessageContent(
        message.content as string | Array<{ type: string; text?: string }>,
      );
      const content = resolved?.content ?? baseContent;
      let details = resolved?.details ?? message.details;

      if (running && "startedAt" in details) {
        details = {
          ...details,
          durationMs: Math.max(0, Date.now() - details.startedAt),
        };
      }

      container.clear();
      container.addChild(
        new Text(
          buildSubagentResultText(
            content,
            details,
            options.expanded,
            theme,
          ),
          0,
          0,
        ),
      );
    }
    return Container.prototype.render.call(container, width);
  };

  return container;
}

export function toSubagentCommandMessage(result: {
  content: string;
  details: SubagentMessageDetails;
  isError?: boolean;
}): SubagentCommandMessage {
  return {
    customType: "pi-subagent-result",
    content: result.content,
    display: true,
    details: result.details,
  };
}
