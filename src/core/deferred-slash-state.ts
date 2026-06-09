import type { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY,
  DEFERRED_SLASH_REQUEST_ENTRY,
  type DeferredSlashRuntimeState,
  type PersistedDeferredSlashRequest,
} from "../shared/types.js";

const persistedRequests = new Map<string, PersistedDeferredSlashRequest>();
const runtimeState = new Map<string, DeferredSlashRuntimeState>();

export function rememberDeferredSlashRequest(
  pi: { appendEntry(customType: string, data: unknown): void },
  request: PersistedDeferredSlashRequest,
): void {
  persistedRequests.set(request.requestId, request);
  pi.appendEntry(DEFERRED_SLASH_REQUEST_ENTRY, request);
}

export function markDeferredSlashRequestConsumed(
  pi: { appendEntry(customType: string, data: unknown): void },
  requestId: string,
): void {
  persistedRequests.delete(requestId);
  runtimeState.delete(requestId);
  pi.appendEntry(DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY, {
    requestId,
    consumedAt: Date.now(),
  });
}

export function setDeferredSlashRuntimeState(
  requestId: string,
  state: DeferredSlashRuntimeState,
): void {
  runtimeState.set(requestId, state);
}

export function takeDeferredSlashRuntimeState(
  requestId: string,
): DeferredSlashRuntimeState | undefined {
  const state = runtimeState.get(requestId);
  runtimeState.delete(requestId);
  return state;
}

export function getDeferredSlashRequest(
  requestId: string,
): PersistedDeferredSlashRequest | undefined {
  return persistedRequests.get(requestId);
}

export function hydrateDeferredSlashRequestsFromSession(
  sessionManager: Pick<SessionManager, "getEntries">,
): void {
  persistedRequests.clear();
  runtimeState.clear();
  const consumed = new Set<string>();

  for (const entry of sessionManager.getEntries()) {
    if (entry.type !== "custom") continue;
    const data = entry.data as { requestId?: string } | undefined;

    if (entry.customType === DEFERRED_SLASH_REQUEST_ENTRY && data?.requestId) {
      persistedRequests.set(
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
    persistedRequests.delete(requestId);
  }
}
