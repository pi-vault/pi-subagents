// ─── Watchdog Warning Rendering ───────────────────────────────────────────────

export interface WatchdogWarningInput {
  severity: "blocker" | "concern";
  summary: string;
  evidence: string;
  recommendedAction: string;
  category: string;
  state?: "displayed" | "stale" | "failed" | "stalemate";
  autoFollowAttempt?: number;
  agentId?: string;
}

export interface WatchdogWarningTextParts {
  /** Color key for theme.fg() */
  color: "error" | "warning";
  /** First line: subject, state labels, summary */
  header: string;
  /** Second line: evidence */
  evidenceLine: string;
  /** Third line: recommended action */
  actionLine: string;
  /** Fourth line: category and agent */
  categoryLine: string;
}

/**
 * Format a watchdog warning into text parts for TUI rendering.
 * Pure function — no dependency on theme or TUI components.
 */
export function formatWatchdogWarningText(
  d: WatchdogWarningInput,
): WatchdogWarningTextParts {
  const subject = d.severity === "blocker" ? "Blocker" : "Concern";
  const color: "error" | "warning" = d.severity === "blocker" ? "error" : "warning";

  const labels: string[] = [];
  if (d.state === "displayed") labels.push("displayed");
  if (d.state === "stale") labels.push("stale");
  if (d.state === "failed") labels.push("failed review");
  if (d.state === "stalemate") labels.push("stalemate");
  if (d.autoFollowAttempt !== undefined) labels.push(`auto-follow attempt ${d.autoFollowAttempt}`);
  const labelSuffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";

  return {
    color,
    header: `Watchdog ${subject}${labelSuffix}: ${d.summary}`,
    evidenceLine: `Evidence: ${d.evidence}`,
    actionLine: `Recommended action: ${d.recommendedAction}`,
    categoryLine: `Category: ${d.category}${d.agentId ? ` \u00B7 Agent: ${d.agentId}` : ""}`,
  };
}
