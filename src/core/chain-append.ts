import type { ChainStep } from "../shared/types.js";

const pendingQueues = new Map<string, ChainStep[][]>();

export function enqueueChainAppendRequest(
  chainId: string,
  steps: ChainStep[],
): void {
  if (!pendingQueues.has(chainId)) pendingQueues.set(chainId, []);
  pendingQueues.get(chainId)!.push(steps);
}

export function consumeChainAppendRequests(chainId: string): ChainStep[] {
  return pendingQueues.get(chainId)?.splice(0).flat() ?? [];
}

export function countPendingChainAppendRequests(chainId: string): number {
  return pendingQueues.get(chainId)?.length ?? 0;
}

export function resetAppendQueues(): void {
  pendingQueues.clear();
}
