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

export function buildSubagentResultText(
  content: string,
  details: SubagentExecutionDetails | undefined,
  expanded: boolean,
  theme: RenderTheme,
): string {
  if (!details) {
    return content || "(no output)";
  }

  // Background spawn — render minimal status line
  if (details.status === "background") {
    const agentId = details.agentId ? ` (id: ${details.agentId})` : "";
    return theme.fg("dim", `Running in background${agentId}`);
  }

  const statusColor = details.status === "success" ? "success" : details.status === "error" ? "error" : "warning";
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

type NotifTheme = { fg(color: string, text: string): string; bold(text: string): string };

export function buildNotificationText(
  d: NotificationDetails,
  expanded: boolean,
  theme: NotifTheme,
): string {
  const isError = d.status === "error" || d.status === "stopped" || d.status === "aborted";
  const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
  const statusText = isError
    ? d.status
    : d.status === "steered"
      ? "completed (steered)"
      : "completed";

  let line = `${icon} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

  const parts: string[] = [];
  if (d.turnCount > 0) parts.push(formatTurns(d.turnCount, d.maxTurns));
  if (d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
  if (d.totalTokens > 0) parts.push(formatTokens(d.totalTokens));
  if (d.durationMs > 0) parts.push(formatMs(d.durationMs));
  if (parts.length) {
    line +=
      "\n  " +
      parts.map((p) => theme.fg("dim", p)).join(` ${theme.fg("dim", "·")} `);
  }

  if (expanded) {
    const lines = d.resultPreview.split("\n").slice(0, 30);
    for (const l of lines) line += `\n${theme.fg("dim", `  ${l}`)}`;
  } else {
    const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
    line += `\n  ${theme.fg("dim", `⎿  ${preview}`)}`;
  }

  if (d.outputFile) {
    line += `\n  ${theme.fg("muted", `transcript: ${d.outputFile}`)}`;
  }

  return line;
}
