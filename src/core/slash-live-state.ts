import type {
  SlashLiveDetails,
  SubagentToolActivity,
} from "../shared/types.js";

const liveRequests = new Map<string, SlashLiveDetails>();

export function startSlashLiveRequest(input: {
  requestId: string;
  agent: string;
  task: string;
  cwd: string;
  model?: string;
}): SlashLiveDetails {
  const details: SlashLiveDetails = {
    kind: "slash-live",
    requestId: input.requestId,
    status: "running",
    agent: input.agent,
    task: input.task,
    cwd: input.cwd,
    durationMs: 0,
    recentToolActivity: [],
    model: input.model,
  };
  liveRequests.set(input.requestId, details);
  return details;
}

export function updateSlashLiveRequest(
  requestId: string,
  patch: {
    durationMs?: number;
    childSessionPath?: string;
    stderr?: string;
    activity?: SubagentToolActivity;
  },
): SlashLiveDetails | undefined {
  const current = liveRequests.get(requestId);
  if (!current) {
    return undefined;
  }

  const recentToolActivity = patch.activity
    ? [...current.recentToolActivity, patch.activity].slice(-5)
    : current.recentToolActivity;

  const next: SlashLiveDetails = {
    ...current,
    durationMs: patch.durationMs ?? current.durationMs,
    childSessionPath: patch.childSessionPath ?? current.childSessionPath,
    stderr: patch.stderr ?? current.stderr,
    recentToolActivity,
  };
  liveRequests.set(requestId, next);
  return next;
}

export function finishSlashLiveRequest(requestId: string): void {
  liveRequests.delete(requestId);
}
