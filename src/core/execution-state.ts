import type { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY,
  DEFERRED_SLASH_REQUEST_ENTRY,
  type DeferredSlashRuntimeState,
  type PersistedDeferredSlashRequest,
  type SlashLiveDetails,
  type SlashSnapshot,
  type SubagentExecutionDetails,
  type SubagentExecutionResult,
  type SubagentToolActivity,
} from "../shared/types.js";

const MAX_SNAPSHOTS = 100;

export class ExecutionStateStore {
  private liveRequests = new Map<string, SlashSnapshot>();
  private versionCounter = 1;
  private persistedRequests = new Map<string, PersistedDeferredSlashRequest>();
  private runtimeState = new Map<string, DeferredSlashRuntimeState>();

  private nextVersion(): number {
    return this.versionCounter++;
  }

  private pruneSnapshots(): void {
    while (this.liveRequests.size > MAX_SNAPSHOTS) {
      const oldestKey = this.liveRequests.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.liveRequests.delete(oldestKey);
    }
  }

  startLive(input: {
    requestId: string;
    agent: string;
    task: string;
    cwd: string;
    model?: string;
    startedAtMs?: number;
  }): SlashLiveDetails {
    const startedAt = input.startedAtMs ?? Date.now();
    const details: SlashLiveDetails = {
      kind: "slash-live",
      requestId: input.requestId,
      status: "running",
      agent: input.agent,
      task: input.task,
      cwd: input.cwd,
      durationMs: 0,
      startedAt,
      recentToolActivity: [],
      model: input.model,
    };
    this.liveRequests.set(input.requestId, {
      live: details,
      version: this.nextVersion(),
    });
    this.pruneSnapshots();
    return details;
  }

  updateLive(
    requestId: string,
    patch: {
      durationMs?: number;
      childSessionPath?: string;
      stderr?: string;
      activity?: SubagentToolActivity;
    },
  ): SlashLiveDetails | undefined {
    const snapshot = this.liveRequests.get(requestId);
    if (!snapshot) return undefined;

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
    snapshot.version = this.nextVersion();
    return snapshot.live;
  }

  tickLive(
    requestId: string,
    nowMs = Date.now(),
  ): SlashLiveDetails | undefined {
    const snapshot = this.liveRequests.get(requestId);
    if (!snapshot || snapshot.final) return undefined;

    snapshot.live.durationMs = Math.max(0, nowMs - snapshot.live.startedAt);
    snapshot.version = this.nextVersion();
    return snapshot.live;
  }

  finalizeLive(requestId: string, result: SubagentExecutionResult): void {
    const snapshot = this.liveRequests.get(requestId);
    if (!snapshot) return;
    snapshot.final = result;
    snapshot.version = this.nextVersion();
  }

  isLiveRunning(requestId: string): boolean {
    const snapshot = this.liveRequests.get(requestId);
    return Boolean(snapshot && !snapshot.final);
  }

  clearLive(requestId: string): void {
    this.liveRequests.delete(requestId);
  }

  getSnapshot(requestId: string): SlashSnapshot | undefined {
    return this.liveRequests.get(requestId);
  }

  getRenderableMessage(
    details: SlashLiveDetails | undefined,
  ):
    | { content: string; details: SlashLiveDetails | SubagentExecutionDetails }
    | undefined {
    if (!details) return undefined;
    const snapshot = this.liveRequests.get(details.requestId);
    if (!snapshot) {
      return { content: "", details };
    }
    if (snapshot.final) {
      return {
        content: snapshot.final.content,
        details: snapshot.final.details,
      };
    }
    return { content: "", details: snapshot.live };
  }

  rememberDeferred(
    pi: { appendEntry(customType: string, data: unknown): void },
    request: PersistedDeferredSlashRequest,
  ): void {
    this.persistedRequests.set(request.requestId, request);
    pi.appendEntry(DEFERRED_SLASH_REQUEST_ENTRY, request);
  }

  markDeferredConsumed(
    pi: { appendEntry(customType: string, data: unknown): void },
    requestId: string,
  ): void {
    this.persistedRequests.delete(requestId);
    this.runtimeState.delete(requestId);
    pi.appendEntry(DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY, {
      requestId,
      consumedAt: Date.now(),
    });
  }

  setDeferredRuntimeState(
    requestId: string,
    state: DeferredSlashRuntimeState,
  ): void {
    this.runtimeState.set(requestId, state);
  }

  takeDeferredRuntimeState(
    requestId: string,
  ): DeferredSlashRuntimeState | undefined {
    const state = this.runtimeState.get(requestId);
    this.runtimeState.delete(requestId);
    return state;
  }

  getDeferredRequest(
    requestId: string,
  ): PersistedDeferredSlashRequest | undefined {
    return this.persistedRequests.get(requestId);
  }

  hydrateFromSession(
    sessionManager: Pick<SessionManager, "getEntries">,
  ): void {
    this.persistedRequests.clear();
    this.runtimeState.clear();
    const consumed = new Set<string>();

    for (const entry of sessionManager.getEntries()) {
      if (entry.type !== "custom") continue;
      const data = entry.data as { requestId?: string } | undefined;

      if (
        entry.customType === DEFERRED_SLASH_REQUEST_ENTRY &&
        data?.requestId
      ) {
        this.persistedRequests.set(
          data.requestId,
          entry.data as PersistedDeferredSlashRequest,
        );
      }
      if (
        entry.customType === DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY &&
        data?.requestId
      ) {
        consumed.add(data.requestId);
      }
    }

    for (const requestId of consumed) {
      this.persistedRequests.delete(requestId);
    }
  }
}
