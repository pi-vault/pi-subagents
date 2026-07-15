import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { runAgent, resumeAgent } from "./agent-runner.js";
import {
  DEFAULT_MAX_SPAWNS_PER_SESSION,
  checkSpawnLimit,
  resolveMaxSpawns,
} from "./spawn-guard.js";
import { createWorktree, cleanupWorktree, pruneWorktrees } from "./worktree.js";
import {
  createChildSubagentTool,
  createChildGetResultTool,
} from "./child-subagent-tool.js";
import { createContactSupervisorTool } from "./intercom.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type {
  AgentDefinition,
  AgentRecord,
  SpawnOptions,
  ToolActivity,
} from "../shared/types.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

let idCounter = 0;
function generateId(): string {
  return `agent-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
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
  private runningBackground = 0;
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
      agentDef.maxDepth !== undefined
        ? Math.min(agentDef.maxDepth, this.maxDepth)
        : this.maxDepth;
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
      status:
        isBackground && this.runningBackground >= this.maxConcurrent ? "queued" : "running",
      toolUses: 0,
      turnCount: 0,
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      invocation: { agent: agentDef.name, task: options.prompt, cwd: options.cwd, description: options.description },
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

    if (record.status === "queued") {
      this.queue.push({ id, args });
    } else {
      this.startAgent(id, record, args);
    }

    return id;
  }

  /**
   * Register an externally-managed record (e.g. a background chain execution).
   * The caller is responsible for updating the record's lifecycle fields.
   */
  registerExternalRecord(id: string, record: AgentRecord): void {
    this.agents.set(id, record);
  }

  /**
   * Trigger completion notification for an externally-managed record.
   * Call this after updating the record's status/result fields.
   */
  notifyComplete(id: string): void {
    const record = this.agents.get(id);
    if (record) this.onComplete?.(record);
  }

  /**
   * Register a background chain and attach lifecycle handlers to the promise.
   * Returns the registered record.
   */
  fireAndForgetChain(
    id: string,
    task: string,
    promise: Promise<{ content: string; isError: boolean }>,
    cwd: string,
    onClear?: () => void,
  ): AgentRecord {
    const record: AgentRecord = {
      id,
      type: "(chain)",
      description: `Chain: ${task.slice(0, 60)}`,
      status: "running",
      startedAt: Date.now(),
      toolUses: 0,
      turnCount: 0,
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      isBackground: true,
      cwd,
    };
    this.registerExternalRecord(id, record);
    promise
      .then((result) => {
        record.status = result.isError ? "error" : "completed";
        record.result = result.content;
        record.error = result.isError ? result.content : undefined;
        record.completedAt = Date.now();
        record.durationMs = record.completedAt - record.startedAt;
        onClear?.();
        this.notifyComplete(id);
      })
      .catch((error) => {
        record.status = "error";
        record.error = error instanceof Error ? error.message : String(error);
        record.completedAt = Date.now();
        record.durationMs = record.completedAt - record.startedAt;
        onClear?.();
        this.notifyComplete(id);
      });
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

    if (isBackground) {
      record.status = "running";
      this.runningBackground++;
    }
    this.onStart?.(record);

    // Create worktree if requested
    let worktreeInfo:
      | { path: string; branch: string; baseSha: string; workPath: string }
      | undefined;
    if (options.isolation === "worktree") {
      worktreeInfo = createWorktree(options.cwd, id);
      if (worktreeInfo) record.worktree = worktreeInfo;
    }
    const effectiveCwd = worktreeInfo?.workPath ?? options.cwd;

    // Create AbortController
    const abortController = new AbortController();
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

    // Build custom tools for child sessions that allow recursion
    let customTools: unknown[] = [];
    if (allowRecursion) {
      const deps = (options as { _deps?: RuntimeDeps })._deps;
      const paths = deps?.resolvePaths?.();
      if (deps && paths) {
        const discovery = deps.discoverAgents(paths);
        customTools = [
          createChildSubagentTool({
            manager: this,
            discovery,
            allowedAgents: agentDef.subagentAgents,
            currentDepth: (options.currentDepth ?? 0) + 1,
            parentCwd: effectiveCwd,
            parentAgentId: id,
            deps,
          }),
          createChildGetResultTool(this, id),
        ];
      }
    }

    // Inject contact_supervisor tool for intercom-enabled agents
    if (agentDef.intercom) {
      const deps = (options as { _deps?: RuntimeDeps })._deps;
      if (deps?.intercom) {
        customTools.push(
          createContactSupervisorTool(deps.intercom, id, agentDef.name),
        );
      }
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
          if (activity.type === "end") record.toolUses++;
          options.onToolActivity?.(activity);
        },
        onTurnEnd: (count: number) => {
          record.turnCount = count;
          options.onTurnEnd?.(count);
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
          // Flush any pending steers
          if (record.pendingSteers && record.pendingSteers.length > 0) {
            for (const msg of record.pendingSteers) {
              (session as AgentSession).steer(msg).catch(() => {});
            }
            record.pendingSteers = [];
          }
        },
        onTextDelta: options.onTextDelta,
        toolBudget: options.toolBudget,
        customTools,
      },
      ctx as { model?: unknown; modelRegistry?: unknown },
    )
      .then((result) => {
        record.status = result.steered
          ? "steered"
          : result.aborted
            ? "aborted"
            : "completed";
        record.result = result.responseText;
        record.session = result.session;
        record.completedAt = Date.now();
        record.durationMs = record.completedAt - record.startedAt;
        // Cleanup worktree
        if (record.worktree) {
          try {
            record.worktreeResult = cleanupWorktree(
              options.cwd,
              record.worktree,
              record.invocation?.task ?? "",
            );
          } catch {
            // ignore
          }
        }
        record.outputCleanup?.();
        record.outputCleanup = undefined;
        if (isBackground) this.runningBackground = Math.max(0, this.runningBackground - 1);
        this.onComplete?.(record);
        this.drainQueue();
        return record.result ?? "";
      })
      .catch((error) => {
        record.status = "error";
        record.error = error instanceof Error ? error.message : String(error);
        record.completedAt = Date.now();
        record.durationMs = record.completedAt - record.startedAt;
        if (record.worktree) {
          try {
            cleanupWorktree(options.cwd, record.worktree, "error");
          } catch {
            // ignore
          }
        }
        record.outputCleanup?.();
        record.outputCleanup = undefined;
        if (isBackground) this.runningBackground = Math.max(0, this.runningBackground - 1);
        this.onComplete?.(record);
        this.drainQueue();
        return "";
      });

    // Store promise (resolves to response text string)
    record.promise = promise;
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
      const next = this.queue.shift();
      if (!next) break;
      const record = this.agents.get(next.id);
      if (record?.status !== "queued") continue;
      try {
        this.startAgent(next.id, record, next.args);
      } catch (err) {
        record.status = "error";
        record.error = err instanceof Error ? err.message : String(err);
        record.completedAt = Date.now();
        this.onComplete?.(record);
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

    record.status = "running";
    record.startedAt = Date.now();
    record.completedAt = undefined;
    record.result = undefined;
    record.error = undefined;

    try {
      const responseText = await resumeAgent(record.session as AgentSession, prompt, {
        onToolActivity: (activity) => {
          if (activity.type === "end") record.toolUses++;
        },
        onAssistantUsage: (usage) => {
          record.lifetimeUsage.inputTokens += usage.input;
          record.lifetimeUsage.outputTokens += usage.output;
          record.lifetimeUsage.cacheWriteTokens += usage.cacheWrite;
        },
        signal,
      });
      record.status = "completed";
      record.result = responseText;
      record.completedAt = Date.now();
    } catch (err) {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
      record.completedAt = Date.now();
    }

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
      record.status = "stopped";
      record.completedAt = Date.now();
      return true;
    }
    if (record.status !== "running") return false;
    record.abortController?.abort();
    return true;
  }

  /**
   * Abort all running and queued agents.
   */
  abortAll(): void {
    // Clear queue first
    for (const q of this.queue) {
      const record = this.agents.get(q.id);
      if (record) {
        record.status = "stopped";
        record.completedAt = Date.now();
      }
    }
    this.queue = [];
    // Abort running
    for (const record of this.agents.values()) {
      if (record.status === "running") {
        record.abortController?.abort();
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
        .filter((r) => r.promise && (r.status === "running" || r.status === "queued"))
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
      if (record.status !== "running" && record.status !== "queued") {
        this.agents.delete(id);
      }
    }
  }

  setMaxDepth(n: number): void {
    this.maxDepth = n;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = n;
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
      if (record.status === "running" || record.status === "queued") continue;
      if (record.completedAt && now - record.completedAt > CLEANUP_MAX_AGE_MS) {
        this.agents.delete(id);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    for (const record of this.agents.values()) {
      if (record.status === "running") {
        record.abortController?.abort();
      }
    }
    this.queue = [];
    this.agents.clear();
    this.spawnCount = 0;
    // Prune worktrees for crash recovery
    try {
      pruneWorktrees(process.cwd());
    } catch {
      // ignore
    }
  }
}
