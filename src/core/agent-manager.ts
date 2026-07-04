import { runAgent } from "./agent-runner.js";
import type {
  AgentDefinition,
  AgentRecord,
  SpawnOptions,
  ToolActivity,
} from "../shared/types.js";

let idCounter = 0;
function generateId(): string {
  return `agent-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export class AgentManager {
  private agents = new Map<string, AgentRecord>();
  private maxDepth: number;

  constructor(maxDepth = 3) {
    this.maxDepth = maxDepth;
  }

  async spawnAndWait(
    ctx: unknown,
    agentDef: AgentDefinition,
    options: SpawnOptions,
  ): Promise<{ id: string; record: AgentRecord }> {
    const currentDepth = options.currentDepth ?? 0;

    // Validate depth
    if (currentDepth >= this.maxDepth) {
      throw new Error(
        `Nested delegation blocked: current depth ${currentDepth} reached the nesting limit of ${this.maxDepth}.`,
      );
    }

    // Validate allowlist
    if (options.allowedAgents && options.allowedAgents.length > 0) {
      const allowedKeys = new Set(
        options.allowedAgents.map((a) => a.trim().toLowerCase()),
      );
      if (!allowedKeys.has(agentDef.name.trim().toLowerCase())) {
        throw new Error(
          `Agent "${agentDef.name}" is not allowed. Allowed agents: ${options.allowedAgents.join(", ")}`,
        );
      }
    }

    // Create record
    const id = generateId();
    const record: AgentRecord = {
      id,
      type: agentDef.name,
      status: "running",
      toolUses: 0,
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      invocation: {
        agent: agentDef.name,
        task: options.prompt,
        cwd: options.cwd,
      },
    };
    this.agents.set(id, record);

    // Create AbortController
    const abortController = new AbortController();
    record.abortController = abortController;
    if (options.parentSignal) {
      if (options.parentSignal.aborted) {
        abortController.abort();
      } else {
        options.parentSignal.addEventListener(
          "abort",
          () => abortController.abort(),
          { once: true },
        );
      }
    }

    // Compute allowRecursion: true if agent has subagentAgents AND depth+1 < maxDepth
    const allowRecursion =
      agentDef.subagentAgents.length > 0 && currentDepth + 1 < this.maxDepth;

    try {
      const result = await runAgent(
        agentDef,
        {
          prompt: options.prompt,
          cwd: options.cwd,
          agentId: id,
          timeoutMs: options.timeoutMs,
          allowRecursion,
          signal: abortController.signal,
          onToolActivity: (activity: ToolActivity) => {
            if (activity.type === "end") record.toolUses++;
            options.onToolActivity?.(activity);
          },
          onTurnEnd: (turnCount: number) => {
            options.onTurnEnd?.(turnCount);
          },
          onUsage: (usage) => {
            record.lifetimeUsage.inputTokens += usage.input;
            record.lifetimeUsage.outputTokens += usage.output;
            record.lifetimeUsage.cacheWriteTokens += usage.cacheWrite;
            options.onUsage?.(usage);
          },
          onSessionCreated: (session) => {
            record.session = session;
            options.onSessionCreated?.(session);
          },
          onTextDelta: options.onTextDelta,
        },
        ctx as { model?: unknown; modelRegistry?: unknown },
      );

      record.status = result.aborted ? "aborted" : "completed";
      record.result = result.responseText;
      record.session = result.session;
    } catch (error) {
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
    }

    return { id, record };
  }

  getRecord(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record || record.status !== "running") return false;
    record.abortController?.abort();
    return true;
  }

  clearCompleted(): void {
    for (const [id, record] of this.agents) {
      if (record.status !== "running") {
        this.agents.delete(id);
      }
    }
  }

  dispose(): void {
    for (const record of this.agents.values()) {
      if (record.status === "running") {
        record.abortController?.abort();
      }
    }
    this.agents.clear();
  }

  setMaxDepth(n: number): void {
    this.maxDepth = n;
  }
}


