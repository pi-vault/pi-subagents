import type { AgentRecord } from "../shared/types.js";

export function formatChainStatus(record: AgentRecord): string {
  const elapsed = record.completedAt
    ? record.completedAt - record.startedAt
    : Date.now() - record.startedAt;
  const elapsedStr =
    elapsed >= 60_000
      ? `${Math.floor(elapsed / 60_000)}m ${Math.floor((elapsed % 60_000) / 1000)}s`
      : `${Math.floor(elapsed / 1000)}s`;

  const lines: string[] = [
    `Chain: ${record.id}  Status: ${record.status}  Elapsed: ${elapsedStr}`,
    `Task: ${record.description ?? "\u2014"}`,
  ];

  if (record.chainSteps && record.chainSteps.length > 0) {
    lines.push("", "Steps:");
    for (const step of record.chainSteps) {
      const icon =
        step.status === "completed"
          ? "\u2713"
          : step.status === "running"
            ? "\u25b8"
            : step.status === "failed"
              ? "\u2717"
              : "\u25cb";
      const dur = step.durationMs != null ? ` (${Math.floor(step.durationMs / 1000)}s)` : "";
      const err = step.error ? ` \u2014 ${step.error}` : "";
      lines.push(`  ${icon} ${step.label} \u2014 ${step.status}${dur}${err}`);
    }
  }

  return lines.join("\n");
}

export function listChains(agents: AgentRecord[]): AgentRecord[] {
  return agents.filter((r) => r.type === "(chain)");
}
