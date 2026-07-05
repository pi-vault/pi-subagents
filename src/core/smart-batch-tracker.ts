import type { GroupJoinManager } from "./group-join-manager.js";
import type { AgentRecord, JoinMode } from "../shared/types.js";

const BATCH_DEBOUNCE_MS = 100;

export class SmartBatchTracker {
  private currentBatchAgents: { id: string; joinMode: JoinMode }[] = [];
  private batchFinalizeTimer: ReturnType<typeof setTimeout> | undefined;
  private batchCounter = 0;

  constructor(
    private groupJoin: GroupJoinManager,
    private getRecord: (id: string) => AgentRecord | undefined,
    private sendNudge: (record: AgentRecord) => void,
    private getJoinMode: () => JoinMode,
    private debounceMs = BATCH_DEBOUNCE_MS,
  ) {}

  isInCurrentBatch(id: string): boolean {
    return this.currentBatchAgents.some((a) => a.id === id);
  }

  register(id: string): void {
    const joinMode = this.getJoinMode();
    if (joinMode === "async") return;

    this.currentBatchAgents.push({ id, joinMode });
    // Reset debounce timer so parallel tool calls in the same turn are captured together
    if (this.batchFinalizeTimer) clearTimeout(this.batchFinalizeTimer);
    this.batchFinalizeTimer = setTimeout(
      () => this.finalizeBatch(),
      this.debounceMs,
    );
  }

  private finalizeBatch(): void {
    this.batchFinalizeTimer = undefined;
    const batchAgents = [...this.currentBatchAgents];
    this.currentBatchAgents = [];

    const smartAgents = batchAgents.filter(
      (a) => a.joinMode === "smart" || a.joinMode === "group",
    );

    if (smartAgents.length >= 2) {
      const groupId = `batch-${++this.batchCounter}`;
      const ids = smartAgents.map((a) => a.id);
      this.groupJoin.registerGroup(groupId, ids);
      // Retroactively process agents that already completed during the debounce window
      for (const agentId of ids) {
        const record = this.getRecord(agentId);
        if (!record) continue;
        record.groupId = groupId;
        if (record.completedAt != null && !record.resultConsumed) {
          this.groupJoin.onAgentComplete(record);
        }
      }
    } else {
      // No group formed — send individual nudges for any agents that completed during debounce
      for (const { id } of batchAgents) {
        const record = this.getRecord(id);
        if (record?.completedAt != null && !record.resultConsumed) {
          this.sendNudge(record);
        }
      }
    }
  }

  dispose(): void {
    if (this.batchFinalizeTimer) {
      clearTimeout(this.batchFinalizeTimer);
      this.batchFinalizeTimer = undefined;
    }
    this.currentBatchAgents = [];
  }
}
