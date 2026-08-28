import { Text } from "@earendil-works/pi-tui";
import type {
  AgentToolResult,
  MessageRenderOptions,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type {
  NotificationDetails,
  SubagentCommandMessage,
  SubagentExecutionDetails,
  SubagentToolInput,
} from "../shared/types.js";
import {
  formatWatchdogWarningText,
  type WatchdogWarningInput,
} from "../core/watchdog-render.js";
import type { IntercomRequest } from "../core/intercom.js";
import { formatMs, formatTokens, formatTurns } from "./format.js";

const MAX_TASK_PREVIEW = 80;
const MAX_ACTIVITY_PREVIEW = 72;
const MAX_COLLAPSED_ACTIVITY = 5;

function previewText(value: string | undefined, maxLength: number): string {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return "-";
  }
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 3)}...`
    : compact;
}

function formatPath(value: string | undefined): string {
  return value?.trim() ? value : "-";
}

function formatUsage(details: SubagentExecutionDetails): string {
  return `${details.usage.input}/${details.usage.output} tok, ${details.usage.turns} turns`;
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

type RenderTheme = {
  fg: (color: ThemeColor, text: string) => string;
  bold: (text: string) => string;
};

function statusHeader(icon: string, subject: string, status: string): string {
  return [icon, subject, status].filter((part) => part.trim()).join(" ");
}

function metadataLine(parts: readonly string[]): string {
  const text = parts.filter((part) => part.trim()).join(" · ");
  return text ? `  ${text}` : "";
}

function statusPresentation(status: Exclude<SubagentExecutionDetails["status"], "background">): {
  icon: string;
  color: "success" | "error" | "warning";
} {
  if (status === "success") return { icon: "✓", color: "success" };
  if (status === "steered") return { icon: "■", color: "warning" };
  return { icon: "✗", color: "error" };
}

export function buildSubagentCallText(
  args: SubagentToolInput,
  theme: RenderTheme,
): string {
  const lines = [
    statusHeader(
      theme.fg("accent", "●"),
      theme.fg("toolTitle", theme.bold(args.agent || "...")),
      theme.fg("accent", "running"),
    ),
  ];
  const metadata = metadataLine([args.cwd?.trim() ? `cwd ${args.cwd}` : ""]);
  if (metadata) lines.push(theme.fg("dim", metadata));
  lines.push(theme.fg("dim", `  ⎿  ${previewText(args.task, MAX_TASK_PREVIEW)}`));
  return lines.join("\n");
}

export function buildSubagentResultText(
  content: string,
  details: SubagentExecutionDetails | undefined,
  expanded: boolean,
  theme: RenderTheme,
): string {
  if (!details) {
    return content || "(no output)";
  }

  if (details.status === "background") {
    const lines = [
      statusHeader(
        theme.fg("accent", "●"),
        theme.fg("toolTitle", theme.bold(details.agent)),
        theme.fg("accent", "background"),
      ),
    ];
    const metadata = metadataLine([details.agentId ? `id ${details.agentId}` : ""]);
    if (metadata) lines.push(theme.fg("dim", metadata));
    return lines.join("\n");
  }

  const presentation = statusPresentation(details.status);
  const header = statusHeader(
    theme.fg(presentation.color, presentation.icon),
    theme.fg("toolTitle", theme.bold(details.agent)),
    theme.fg(presentation.color, details.status),
  );

  if (!expanded) {
    const lines = [header];
    const metadata = metadataLine([
      details.model ?? "",
      `${details.durationMs}ms`,
      `${details.usage.input}/${details.usage.output} tok`,
      `${details.usage.turns} turns`,
      `session ${formatPath(details.childSessionPath)}`,
    ]);
    if (metadata) lines.push(theme.fg("dim", metadata));
    const activityLabels = details.recentToolActivity
      .slice(-MAX_COLLAPSED_ACTIVITY)
      .map((activity) => activity.label);
    if (activityLabels.length > 0) {
      lines.push(theme.fg("dim", `  ⎿  tools ${activityLabels.join(", ")}`));
    }
    return lines.join("\n");
  }

  const lines = [header];
  lines.push(theme.fg("muted", `task: ${details.task || "-"}`));
  lines.push(theme.fg("muted", `cwd: ${formatPath(details.cwd)}`));
  lines.push(theme.fg("muted", `source: ${formatPath(details.sourcePath)}`));
  if (details.model) {
    lines.push(theme.fg("muted", `model: ${details.model}`));
  }
  lines.push(
    theme.fg(
      "muted",
      `turns: ${details.maxTurns === 0 ? "unlimited" : details.maxTurns}`,
    ),
  );
  if (details.thinking) {
    lines.push(theme.fg("muted", `thinking: ${details.thinking}`));
  }
  lines.push(theme.fg("muted", `duration: ${details.durationMs}ms`));
  lines.push(theme.fg("muted", `usage: ${formatUsage(details)}`));
  lines.push(theme.fg("muted", `stop reason: ${details.stopReason || "-"}`));
  lines.push(theme.fg("muted", `exit code: ${details.exitCode ?? "-"}`));
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
): Text {
  const content = normalizeMessageContent(
    result.content as string | Array<{ type: string; text?: string }>,
  );
  const details = result.details as SubagentExecutionDetails | undefined;
  return new Text(
    buildSubagentResultText(content, details, options.expanded, theme),
    0,
    0,
  );
}

export function renderSubagentMessage(
  message: {
    content: string | Array<{ type: string; text?: string }>;
    details?: SubagentExecutionDetails;
  },
  options: MessageRenderOptions,
  theme: Theme,
): Text {
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

export function toSubagentCommandMessage(result: {
  content: string;
  details: SubagentExecutionDetails;
  isError?: boolean;
}): SubagentCommandMessage {
  return {
    customType: "pi-subagent-result",
    content: result.content,
    display: true,
    details: result.details,
  };
}

function watchdogStateLabels(details: WatchdogWarningInput): string[] {
  const labels: string[] = [];
  if (details.state === "displayed") labels.push("displayed");
  if (details.state === "stale") labels.push("stale");
  if (details.state === "failed") labels.push("failed review");
  if (details.state === "stalemate") labels.push("stalemate");
  if (details.autoFollowAttempt !== undefined) {
    labels.push(`auto-follow attempt ${details.autoFollowAttempt}`);
  }
  return labels;
}

export function buildWatchdogWarningText(
  details: WatchdogWarningInput,
  expanded: boolean,
  theme: RenderTheme,
): string {
  const color = details.severity === "blocker" ? "error" : "warning";
  const subject = details.severity === "blocker" ? "Watchdog Blocker" : "Watchdog Concern";
  const parts = formatWatchdogWarningText(details);
  const labels = watchdogStateLabels(details).join(", ");
  const lines = [
    statusHeader(
      theme.fg(color, "⚠"),
      theme.fg("toolTitle", theme.bold(subject)),
      labels ? theme.fg(color, labels) : "",
    ),
  ];
  const metadata = metadataLine([
    details.category,
    details.agentId ? `agent ${details.agentId}` : "",
  ]);
  if (metadata) lines.push(theme.fg("dim", metadata));
  lines.push(theme.fg("dim", `  ⎿  ${details.summary}`));
  if (expanded) {
    lines.push(theme.fg("dim", `  ${parts.evidenceLine}`));
    lines.push(theme.fg("dim", `  ${parts.actionLine}`));
    lines.push(theme.fg("dim", `  ${parts.categoryLine}`));
  }
  return lines.join("\n");
}

export function buildIntercomRequestText(
  details: IntercomRequest,
  theme: RenderTheme,
): string {
  const metadata = metadataLine([
    `agent ${details.agentId}`,
    `request ${details.id}`,
    details.expectsReply ? "reply requested" : "no reply needed",
  ]);
  return [
    statusHeader(
      theme.fg("accent", "◆"),
      theme.fg("toolTitle", theme.bold(details.agentName)),
      theme.fg("dim", details.reason.replaceAll("_", " ")),
    ),
    theme.fg("dim", metadata),
    theme.fg("dim", `  ⎿  ${details.message}`),
  ].join("\n");
}

type NotifTheme = { fg(color: string, text: string): string; bold(text: string): string };

export function buildNotificationText(
  d: NotificationDetails,
  expanded: boolean,
  theme: NotifTheme,
): string {
  const isError = d.status === "error" || d.status === "stopped" || d.status === "aborted";
  const statusText = isError
    ? d.status
    : d.status === "steered"
      ? "completed (steered)"
      : "completed";
  const lines = [
    statusHeader(
      theme.fg(isError ? "error" : "success", isError ? "✗" : "✓"),
      theme.bold(d.description),
      theme.fg("dim", statusText),
    ),
  ];

  const metadata = metadataLine([
    d.turnCount > 0 ? formatTurns(d.turnCount, d.maxTurns) : "",
    d.toolUses > 0 ? `${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}` : "",
    d.totalTokens > 0 ? formatTokens(d.totalTokens) : "",
    d.durationMs > 0 ? formatMs(d.durationMs) : "",
  ]);
  if (metadata) lines.push(theme.fg("dim", metadata));

  if (expanded) {
    for (const line of d.resultPreview.split("\n").slice(0, 30)) {
      lines.push(theme.fg("dim", `  ${line}`));
    }
  } else {
    const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
    lines.push(theme.fg("dim", `  ⎿  ${preview}`));
  }

  if (d.outputFile) {
    lines.push(theme.fg("muted", `  transcript: ${d.outputFile}`));
  }

  return lines.join("\n");
}
