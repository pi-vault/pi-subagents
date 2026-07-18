import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  SpawnOptions,
  ToolActivity,
} from "../shared/types.js";
import { resumeAgent, runAgent } from "./agent-runner.js";
import { clearChainAppendRequests } from "./chain-append.js";
import {
  checkSpawnLimit,
  DEFAULT_MAX_SPAWNS_PER_SESSION,
  resolveMaxSpawns,
} from "./spawn-guard.js";
import { cleanupWorktree, createWorktree, pruneWorktrees } from "./worktree.js";

let idCounter = 0;
function generateId(): string {
  return `agent-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

function notifyActivity(record: AgentRecord, observer?: (record: AgentRecord) => void): void {
  try {
    observer?.(record);
  } catch {
    // Rendering must not fail an agent run.
  }
}

function closeChainAppendAdmission(record: AgentRecord): void {
  if (record.type !== "(chain)") return;
  record.acceptsChainAppends = false;
  clearChainAppendRequests(record.id);
}

export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;

const DEFAULT_MAX_CONCURRENT = 4;
const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

interface SpawnArgs {
  ctx: unknown;
  agentDef: AgentDefinition;
  options: SpawnOptions & { isBackground?: boolean; isolation?: string };
}

export class AgentManager {
  private agents = new Map<string, AgentRecord>();
  private maxDepth: number;
  private maxConcurrent: number;
  private queue: { id: string; args: SpawnArgs }[] = [];
  private readonly finalizedRuns = new Set<string>();
  private readonly runningBackgroundIds = new Set<string>();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private onComplete?: OnAgentComplete;
  private onStart?: OnAgentStart;
  private spawnCount = 0;
  private maxSpawnsPerSession = DEFAULT_MAX_SPAWNS_PER_SESSION;

  constructor(
    maxDepth = 3,
    onComplete?: OnAgentComplete,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    onStart?: OnAgentStart,
  ) {
    this.maxDepth = maxDepth;
    this.onComplete = onComplete;
    this.onStart = onStart;
    this.maxConcurrent = maxConcurrent;
    this.cleanupInterval = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  /**
   * Spawn an agent. Non-blocking — returns agent ID immediately.
   * For background agents: if at concurrency limit, queues the agent.
   * For non-background agents: starts immediately (bypasses queue).
   */
  spawn(
    ctx: unknown,
    agentDef: AgentDefinition,
    options: SpawnOptions & { isBackground?: boolean; isolation?: string },
  ): string {
    const currentDepth = options.currentDepth ?? 0;
    const isBackground = options.isBackground ?? false;

    const effectiveMaxDepth =
      agentDef.maxDepth !== undefined ? Math.min(agentDef.maxDepth, this.maxDepth) : this.maxDepth;
    if (currentDepth >= effectiveMaxDepth) {
      throw new Error(
        `Nested delegation blocked: current depth ${currentDepth} reached the nesting limit of ${effectiveMaxDepth}.`,
      );
    }
    if (!isAbsolute(options.cwd)) {
      throw new Error(`cwd must be an absolute path, got: ${options.cwd}`);
    }
    if (!existsSync(options.cwd)) {
      throw new Error(`cwd directory does not exist: ${options.cwd}`);
    }
    if (options.allowedAgents && options.allowedAgents.length > 0) {
      const allowedKeys = new Set(options.allowedAgents.map((a) => a.trim().toLowerCase()));
      if (!allowedKeys.has(agentDef.name.trim().toLowerCase())) {
        throw new Error(
          `Agent "${agentDef.name}" is not allowed. Allowed agents: ${options.allowedAgents.join(", ")}`,
        );
      }
    }

    const effectiveMax = resolveMaxSpawns(this.maxSpawnsPerSession);
    const spawnError = checkSpawnLimit(this.spawnCount, 1, effectiveMax);
    if (spawnError) {
      throw new Error(spawnError);
    }

    const id = generateId();
    const record: AgentRecord = {
      id,
      type: agentDef.name,
      description: options.description ?? options.prompt.slice(0, 80),
      status: "queued",
      toolUses: 0,
      turnCount: 0,
      live: { activeTools: [], responseText: "", maxTurns: options.maxTurns },
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      invocation: {
        agent: agentDef.name,
        task: options.prompt,
        cwd: options.cwd,
        description: options.description,
      },
      cwd: options.cwd,
      isBackground,
      compactionCount: 0,
    };
    if (options.spawnedBy) {
      record.spawnedBy = options.spawnedBy;
    }
    this.agents.set(id, record);
    this.spawnCount++;

    const args: SpawnArgs = { ctx, agentDef, options };

    if (isBackground && this.runningBackgroundIds.size >= this.maxConcurrent) {
      this.queue.push({ id, args });
    } else {
      try {
        this.startAgent(id, record, args);
      } catch (error) {
        this.agents.delete(id);
        this.spawnCount--;
        throw error;
      }
    }

    return id;
  }

  private finalizeRun(
    id: string,
    outcome: {
      status: Exclude<AgentRecord["status"], "queued" | "running">;
      result?: string;
      error?: string;
      session?: unknown;
    },
    options: { notify: boolean; cleanup?: () => void },
  ): void {
    if (this.finalizedRuns.has(id)) return;
    const record = this.agents.get(id);
    if (!record) return;

    this.finalizedRuns.add(id);
    if (record.status !== "stopped") record.status = outcome.status;
    if ("result" in outcome) record.result = outcome.result;
    if ("error" in outcome) record.error = outcome.error;
    if ("session" in outcome) record.session = outcome.session;
    record.completedAt ??= Date.now();
    record.durationMs = record.completedAt - record.startedAt;
    record.live.activeTools = [];

    try {
      options.cleanup?.();
    } catch {
      // Cleanup is best-effort and cannot change the terminal outcome.
    }
    if (this.runningBackgroundIds.delete(id)) this.drainQueue();
    if (options.notify) {
      try {
        this.onComplete?.(record);
      } catch {
        // Rendering must not change the terminal outcome.
      }
    }
  }

  /**
   * Register a background chain and attach lifecycle handlers to the promise.
   * Returns the registered record.
   */
  fireAndForgetChain(
    id: string,
    task: string,
    chainDefinition: ChainStep[],
    cwd: string,
    startFactory: (
      signal: AbortSignal,
      closeAppendAdmission: () => void,
    ) => Promise<{ content: string; isError: boolean }>,
    onClear?: () => void,
  ): AgentRecord {
    const abortController = new AbortController();
    const record: AgentRecord = {
      id,
      type: "(chain)",
      description: `Chain: ${task.slice(0, 60)}`,
      status: "running",
      startedAt: Date.now(),
      toolUses: 0,
      turnCount: 0,
      live: { activeTools: [], responseText: "" },
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      isBackground: true,
      cwd,
      chainSteps: [],
      chainDefinition: [...chainDefinition],
      acceptsChainAppends: true,
      abortController,
    };
    this.finalizedRuns.delete(id);
    this.agents.set(id, record);
    const closeAppendAdmission = () => closeChainAppendAdmission(record);
    abortController.signal.addEventListener("abort", closeAppendAdmission, {
      once: true,
    });
    let promise: Promise<{ content: string; isError: boolean }>;
    try {
      promise = startFactory(abortController.signal, closeAppendAdmission);
    } catch (error) {
      promise = Promise.reject(error);
    }
    record.promise = promise.then(
      (result) => {
        const aborted = abortController.signal.aborted;
        this.finalizeRun(
          id,
          {
            status: aborted ? "aborted" : result.isError ? "error" : "completed",
            result: result.content,
            error: !aborted && result.isError ? result.content : undefined,
          },
          {
            notify: true,
            cleanup: () => {
              closeAppendAdmission();
              onClear?.();
            },
          },
        );
        return result.content;
      },
      (error) => {
        const aborted = abortController.signal.aborted;
        this.finalizeRun(
          id,
          {
            status: aborted ? "aborted" : "error",
            error: aborted ? undefined : error instanceof Error ? error.message : String(error),
          },
          {
            notify: true,
            cleanup: () => {
              closeAppendAdmission();
              onClear?.();
            },
          },
        );
        return "";
      },
    );
    return record;
  }

  /**
   * Spawn and wait for completion. Returns { id, record }.
   * Backward-compatible with existing code.
   */
  async spawnAndWait(
    ctx: unknown,
    agentDef: AgentDefinition,
    options: SpawnOptions,
  ): Promise<{ id: string; record: AgentRecord }> {
    const id = this.spawn(ctx, agentDef, { ...options, isBackground: false });
    const record = this.agents.get(id);
    if (!record) throw new Error("Invariant violation: agent record not found after spawn");
    try {
      await record.promise;
    } catch {
      // Error is already captured in record.status/record.error
    }
    return { id, record };
  }

  /**
   * Start an agent — fires the runAgent promise, sets up callbacks.
   * Called for both immediate starts and queue drains.
   */
  private startAgent(id: string, record: AgentRecord, args: SpawnArgs): void {
    const { ctx, agentDef, options } = args;
    const isBackground = options.isBackground ?? false;
    this.finalizedRuns.delete(id);
    record.startedAt = Date.now();

    // Create worktree if requested
    let worktreeInfo:
      | { path: string; branch: string; baseSha: string; workPath: string }
      | undefined;
    let abortController: AbortController;
    let effectiveCwd: string;
    let customTools: unknown[];
    try {
      if (options.isolation === "worktree") {
        worktreeInfo = createWorktree(options.cwd, id);
        if (worktreeInfo) record.worktree = worktreeInfo;
      }
      effectiveCwd = worktreeInfo?.workPath ?? options.cwd;

      abortController = new AbortController();
      record.abortController = abortController;
      if (options.parentSignal) {
        if (options.parentSignal.aborted) {
          abortController.abort();
        } else {
          options.parentSignal.addEventListener("abort", () => abortController.abort(), {
            once: true,
          });
        }
      }

      const effectiveMaxDepth =
        agentDef.maxDepth !== undefined
          ? Math.min(agentDef.maxDepth, this.maxDepth)
          : this.maxDepth;
      const allowRecursion =
        agentDef.subagentAgents.length > 0 && (options.currentDepth ?? 0) + 1 < effectiveMaxDepth;

      customTools =
        options.createCustomTools?.({
          id,
          cwd: effectiveCwd,
          allowRecursion,
        }) ?? [];

      record.status = "running";
      if (isBackground) this.runningBackgroundIds.add(id);
      try {
        this.onStart?.(record);
      } catch {
        // Rendering must not fail an agent run.
      }

      const promise = runAgent(
        agentDef,
        {
          prompt: options.prompt,
          cwd: effectiveCwd,
          agentId: id,
          model: options.model,
          thinking: options.thinking,
          maxTurns: options.maxTurns,
          graceTurns: options.graceTurns,
          inheritContext: options.inheritContext,
          parentSystemPrompt: options.parentSystemPrompt,
          allowRecursion,
          signal: abortController.signal,
          onToolActivity: (activity: ToolActivity) => {
            if (activity.type === "start") {
              record.live.activeTools.push(activity.toolName);
            } else {
              const index = record.live.activeTools.indexOf(activity.toolName);
              if (index !== -1) record.live.activeTools.splice(index, 1);
              record.toolUses++;
            }
            notifyActivity(record, options.onActivity);
          },
          onTurnEnd: (count: number) => {
            record.turnCount = count;
            notifyActivity(record, options.onActivity);
          },
          onUsage: (usage) => {
            record.lifetimeUsage.inputTokens += usage.input;
            record.lifetimeUsage.outputTokens += usage.output;
            record.lifetimeUsage.cacheWriteTokens += usage.cacheWrite;
            notifyActivity(record, options.onActivity);
          },
          onSessionCreated: (session) => {
            record.session = session;
            options.onSessionCreated?.(session);
            // Flush any pending steers
            if (record.pendingSteers && record.pendingSteers.length > 0) {
              for (const msg of record.pendingSteers) {
                (session as AgentSession).steer(msg).catch(() => {});
              }
              record.pendingSteers = [];
            }
          },
          onTextDelta: (_delta, fullText) => {
            record.live.responseText = fullText;
            notifyActivity(record, options.onActivity);
          },
          onSettled: () => {
            record.live.activeTools = [];
            notifyActivity(record, options.onActivity);
          },
          toolBudget: options.toolBudget,
          customTools,
        },
        ctx as { model?: unknown; modelRegistry?: unknown },
      )
        .then((result) => {
          this.finalizeRun(
            id,
            {
              status: result.steered ? "steered" : result.aborted ? "aborted" : "completed",
              result: result.responseText,
              session: result.session,
            },
            { notify: true, cleanup: () => this.cleanupAgentRun(record, options) },
          );
          return record.result ?? "";
        })
        .catch((error) => {
          this.finalizeRun(
            id,
            { status: "error", error: error instanceof Error ? error.message : String(error) },
            { notify: true, cleanup: () => this.cleanupAgentRun(record, options) },
          );
          return "";
        });

      record.promise = promise;
    } catch (error) {
      if (record.worktree) {
        try {
          cleanupWorktree(options.cwd, record.worktree, record.invocation?.task ?? "");
        } catch {
          // Setup cleanup is best-effort.
        }
      }
      throw error;
    }
  }

  private cleanupAgentRun(record: AgentRecord, options: SpawnArgs["options"]): void {
    try {
      record.outputCleanup?.();
    } catch {
      // Output flush is best-effort.
    } finally {
      record.outputCleanup = undefined;
    }
    if (record.worktree) {
      try {
        record.worktreeResult = cleanupWorktree(
          options.cwd,
          record.worktree,
          record.invocation?.task ?? "",
        );
      } catch {
        // Worktree cleanup is best-effort.
      }
    }
    notifyActivity(record, options.onActivity);
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.runningBackgroundIds.size < this.maxConcurrent) {
      const next = this.queue.shift();
      if (!next) break;
      const record = this.agents.get(next.id);
      if (record?.status !== "queued") continue;
      try {
        this.startAgent(next.id, record, next.args);
      } catch (err) {
        this.finalizeRun(
          next.id,
          { status: "error", error: err instanceof Error ? err.message : String(err) },
          { notify: true },
        );
      }
    }
  }

  /**
   * Resume a completed/steered agent with a new prompt.
   * Only terminal statuses (completed, steered, error, aborted, stopped) can be resumed.
   */
  async resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined> {
    const record = this.agents.get(id);
    if (!record?.session) return undefined;
    if (record.status === "running" || record.status === "queued") return undefined;
    if (!(record.session as AgentSession).isIdle) return undefined;

    record.status = "running";
    record.startedAt = Date.now();
    record.completedAt = undefined;
    record.result = undefined;
    record.error = undefined;
    record.turnCount = 0;
    record.live = { activeTools: [], responseText: "" };
    this.finalizedRuns.delete(id);
    const abortController = new AbortController();
    record.abortController = abortController;
    const forwardAbort = () => abortController.abort();
    if (signal) {
      if (signal.aborted) abortController.abort();
      else signal.addEventListener("abort", forwardAbort, { once: true });
    }

    const promise = resumeAgent(record.session as AgentSession, prompt, {
      onToolActivity: (activity) => {
        if (activity.type === "start") {
          record.live.activeTools.push(activity.toolName);
        } else {
          const index = record.live.activeTools.indexOf(activity.toolName);
          if (index !== -1) record.live.activeTools.splice(index, 1);
          record.toolUses++;
        }
      },
      onTextDelta: (_delta, fullText) => {
        record.live.responseText = fullText;
      },
      onTurnEnd: () => {
        record.turnCount++;
      },
      onSettled: () => {
        record.live.activeTools = [];
      },
      onAssistantUsage: (usage) => {
        record.lifetimeUsage.inputTokens += usage.input;
        record.lifetimeUsage.outputTokens += usage.output;
        record.lifetimeUsage.cacheWriteTokens += usage.cacheWrite;
      },
      signal: abortController.signal,
    })
      .then((responseText) => {
        this.finalizeRun(id, { status: "completed", result: responseText }, { notify: false });
        return responseText;
      })
      .catch((err) => {
        this.finalizeRun(
          id,
          {
            status: abortController.signal.aborted ? "aborted" : "error",
            error: abortController.signal.aborted
              ? undefined
              : err instanceof Error
                ? err.message
                : String(err),
          },
          { notify: false },
        );
        return "";
      })
      .finally(() => signal?.removeEventListener("abort", forwardAbort));
    record.promise = promise;
    await promise;

    return record;
  }

  /**
   * Send a steering message to a running or queued agent.
   * If the agent's session isn't started yet, queues the message for delivery on start.
   */
  steer(id: string, message: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    if (record.status !== "running" && record.status !== "queued") return false;
    if (record.session) {
      (record.session as AgentSession).steer(message).catch(() => {});
    } else {
      if (!record.pendingSteers) record.pendingSteers = [];
      record.pendingSteers.push(message);
    }
    return true;
  }

  /**
   * Check if any agents are running or queued.
   */
  hasRunning(): boolean {
    for (const record of this.agents.values()) {
      if (record.status === "running" || record.status === "queued") return true;
    }
    return false;
  }

  /**
   * Abort an agent by id. Handles both queued and running agents.
   */
  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    if (record.status === "queued") {
      // Remove from queue
      this.queue = this.queue.filter((q) => q.id !== id);
      this.finalizeRun(id, { status: "stopped" }, { notify: false });
      return true;
    }
    if (record.status !== "running") return false;
    closeChainAppendAdmission(record);
    record.abortController?.abort();
    if (record.type !== "(chain)") {
      record.status = "stopped";
      record.completedAt ??= Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      record.live.activeTools = [];
    }
    return true;
  }

  /**
   * Abort all running and queued agents.
   */
  abortAll(): void {
    // Clear queue first
    for (const q of this.queue) {
      const record = this.agents.get(q.id);
      if (record) this.finalizeRun(q.id, { status: "stopped" }, { notify: false });
    }
    this.queue = [];
    // Abort running
    for (const record of this.agents.values()) {
      if (record.status === "running") {
        closeChainAppendAdmission(record);
        record.abortController?.abort();
        if (record.type !== "(chain)") {
          record.status = "stopped";
          record.completedAt ??= Date.now();
          record.durationMs = record.completedAt - record.startedAt;
          record.live.activeTools = [];
        }
      }
    }
  }

  /**
   * Wait for all running and queued agents to complete.
   */
  async waitForAll(): Promise<void> {
    for (;;) {
      this.drainQueue();
      const promises = [...this.agents.values()]
        .filter((r) => r.promise && !this.finalizedRuns.has(r.id))
        .map((r) => r.promise as Promise<string>);
      if (promises.length === 0) break;
      await Promise.allSettled(promises);
    }
  }

  getRecord(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  clearCompleted(): void {
    for (const [id, record] of this.agents) {
      if (
        this.finalizedRuns.has(id) &&
        record.status !== "running" &&
        record.status !== "queued"
      ) {
        this.agents.delete(id);
        this.finalizedRuns.delete(id);
      }
    }
  }

  setMaxDepth(n: number): void {
    this.maxDepth = n;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = n;
    this.drainQueue();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  setMaxSpawnsPerSession(n: number): void {
    this.maxSpawnsPerSession = n;
  }

  getSpawnBudget(): number {
    return Math.max(0, resolveMaxSpawns(this.maxSpawnsPerSession) - this.spawnCount);
  }

  getSpawnCount(): number {
    return this.spawnCount;
  }

  resetSpawnCounter(): void {
    this.spawnCount = 0;
  }

  /**
   * Remove old completed/errored agent records.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [id, record] of this.agents) {
      if (!this.finalizedRuns.has(id)) continue;
      if (record.status === "running" || record.status === "queued") continue;
      if (record.completedAt && now - record.completedAt > CLEANUP_MAX_AGE_MS) {
        this.agents.delete(id);
        this.finalizedRuns.delete(id);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    for (const record of this.agents.values()) {
      if (record.status === "running") {
        closeChainAppendAdmission(record);
        record.abortController?.abort();
        record.live.activeTools = [];
      }
    }
    this.queue = [];
    this.agents.clear();
    this.finalizedRuns.clear();
    this.runningBackgroundIds.clear();
    this.spawnCount = 0;
    // Prune worktrees for crash recovery
    try {
      pruneWorktrees(process.cwd());
    } catch {
      // ignore
    }
  }
}
