import type { AgentManager } from "./agent-manager.js";
import type { AgentDefinition, ChainStep } from "../shared/types.js";
import { getChainOutputNames } from "./chain-outputs.js";
import { normalizeChainSteps } from "./chain-serializer.js";
import { getStepAgents } from "./chain-settings.js";

const pendingQueues = new Map<string, ChainStep[][]>();

export function enqueueChainAppendRequest(
  manager: AgentManager,
  chainId: string,
  steps: unknown,
  findAgent: (name: string) => AgentDefinition,
): void {
  const record = manager.getRecord(chainId);
  if (
    record?.status !== "running" ||
    !record.isBackground ||
    record.type !== "(chain)" ||
    !record.chainDefinition ||
    !record.acceptsChainAppends ||
    record.abortController?.signal.aborted
  ) {
    throw new Error(`Chain ${chainId} is not a running background chain.`);
  }
  if (Array.isArray(steps) && steps.length === 0) return;

  const normalized = normalizeChainSteps(steps, "chain append", {
    priorOutputNames: getChainOutputNames(record.chainDefinition),
    startStepIndex: record.chainDefinition.length,
  });
  for (const step of normalized) {
    for (const name of getStepAgents(step)) findAgent(name);
  }

  record.chainDefinition.push(...normalized);
  const queue = pendingQueues.get(chainId) ?? [];
  queue.push(normalized);
  pendingQueues.set(chainId, queue);
}

export function consumeChainAppendRequests(chainId: string): ChainStep[] {
  const queued = pendingQueues.get(chainId);
  pendingQueues.delete(chainId);
  return queued?.flat() ?? [];
}

export function countPendingChainAppendRequests(chainId: string): number {
  return pendingQueues.get(chainId)?.length ?? 0;
}

export function clearChainAppendRequests(chainId: string): void {
  pendingQueues.delete(chainId);
}

export function resetAppendQueues(): void {
  pendingQueues.clear();
}
