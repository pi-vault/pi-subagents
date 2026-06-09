import type {
  SlashLiveDetails,
  SubagentExecutionResult,
  SubagentExecutionDetails,
  SubagentToolActivity,
} from "../shared/types.ts";

type SlashSnapshot = {
  live: SlashLiveDetails;
  final?: SubagentExecutionResult;
  version: number;
};

const liveRequests = new Map<string, SlashSnapshot>();
let versionCounter = 1;
const MAX_SNAPSHOTS = 100;

function nextVersion(): number {
  return versionCounter++;
}

function pruneSnapshots(): void {
  while (liveRequests.size > MAX_SNAPSHOTS) {
    const oldestKey = liveRequests.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    liveRequests.delete(oldestKey);
  }
}

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
    startedAt: Date.now(),
    recentToolActivity: [],
    model: input.model,
  };
  liveRequests.set(input.requestId, {
    live: details,
    version: nextVersion(),
  });
  pruneSnapshots();
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
  const snapshot = liveRequests.get(requestId);
  if (!snapshot) {
    return undefined;
  }

  const recentToolActivity = patch.activity
    ? [...snapshot.live.recentToolActivity, patch.activity].slice(-5)
    : snapshot.live.recentToolActivity;

  snapshot.live = {
    ...snapshot.live,
    durationMs: patch.durationMs ?? snapshot.live.durationMs,
    childSessionPath: patch.childSessionPath ?? snapshot.live.childSessionPath,
    stderr: patch.stderr ?? snapshot.live.stderr,
    recentToolActivity,
  };
  snapshot.version = nextVersion();
  return snapshot.live;
}

export function finalizeSlashLiveRequest(
  requestId: string,
  result: SubagentExecutionResult,
): void {
  const snapshot = liveRequests.get(requestId);
  if (!snapshot) {
    return;
  }
  snapshot.final = result;
  snapshot.version = nextVersion();
}

export function getSlashSnapshot(
  requestId: string,
): SlashSnapshot | undefined {
  return liveRequests.get(requestId);
}

export function isSlashLiveRunning(requestId: string): boolean {
  const snapshot = liveRequests.get(requestId);
  return Boolean(snapshot && !snapshot.final);
}

export function getSlashRenderableMessage(
  details: SlashLiveDetails | undefined,
): { content: string; details: SlashLiveDetails | SubagentExecutionDetails } | undefined {
  if (!details) {
    return undefined;
  }
  const snapshot = liveRequests.get(details.requestId);
  if (!snapshot) {
    return { content: "", details };
  }
  if (snapshot.final) {
    return {
      content: snapshot.final.content,
      details: snapshot.final.details,
    };
  }
  return {
    content: "",
    details: snapshot.live,
  };
}
