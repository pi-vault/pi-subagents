import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentManager } from "./agent-manager.js";
import type { AgentRecord } from "../shared/types.js";

interface CompletedEntry {
  id: string;
  type: string;
  status: string;
  result_preview?: string;
}

function toCompletedEntry(record: AgentRecord): CompletedEntry {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    ...(record.result ? { result_preview: record.result.slice(0, 200) } : {}),
  };
}

function countRunning(manager: AgentManager): number {
  return manager
    .listAgents()
    .filter((r) => r.status === "running" || r.status === "queued").length;
}

/**
 * Resolve an agent by exact ID or unambiguous prefix.
 * Returns the record, or an error string if not found or ambiguous.
 */
export function resolveById(
  manager: AgentManager,
  idOrPrefix: string,
): AgentRecord | string {
  const exact = manager.getRecord(idOrPrefix);
  if (exact) return exact;

  const matches = manager
    .listAgents()
    .filter((r) => r.id.startsWith(idOrPrefix));
  if (matches.length === 0) return `Agent not found: ${idOrPrefix}`;
  if (matches.length > 1) {
    return `Ambiguous prefix '${idOrPrefix}' matches: ${matches.map((r) => r.id).join(", ")}`;
  }
  return matches[0];
}

async function raceWithTimeout<T>(
  target: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T | "timeout" | "aborted"> {
  if (signal?.aborted) return "aborted";

  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const abortPromise = signal
    ? new Promise<"aborted">((resolve) => {
        signal.addEventListener("abort", () => resolve("aborted"), {
          once: true,
        });
      })
    : null;

  const contestants: Array<Promise<T | "timeout" | "aborted">> = [
    target,
    timeoutPromise,
  ];
  if (abortPromise) contestants.push(abortPromise);

  try {
    return await Promise.race(contestants);
  } finally {
    clearTimeout(timer!);
  }
}

interface WaitResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  details: undefined;
}

function ok(completed: CompletedEntry[], stillRunning: number): WaitResult {
  const text = JSON.stringify({ completed, still_running: stillRunning });
  return { content: [{ type: "text", text }], details: undefined };
}

function timedOut(stillRunning: number, completedDuringWait: CompletedEntry[]): WaitResult {
  const text = JSON.stringify({
    timed_out: true,
    still_running: stillRunning,
    completed_during_wait: completedDuringWait,
  });
  return { content: [{ type: "text", text }], details: undefined };
}

function error(text: string): WaitResult {
  return { content: [{ type: "text", text }], isError: true, details: undefined };
}

export async function waitForSpecific(
  manager: AgentManager,
  idOrPrefix: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const record = resolveById(manager, idOrPrefix);
  if (typeof record === "string") return error(record);

  // Already completed
  if (record.status !== "running" && record.status !== "queued") {
    record.resultConsumed = true;
    return ok([toCompletedEntry(record)], countRunning(manager));
  }

  // No promise means no way to wait
  if (!record.promise) {
    return ok([toCompletedEntry(record)], countRunning(manager));
  }

  const result = await raceWithTimeout(
    record.promise.then(() => "done" as const),
    timeoutMs,
    signal,
  );

  if (result === "timeout") {
    return timedOut(
      countRunning(manager),
      record.status !== "running" && record.status !== "queued"
        ? [toCompletedEntry(record)]
        : [],
    );
  }
  if (result === "aborted") {
    return ok([], countRunning(manager));
  }

  record.resultConsumed = true;
  return ok([toCompletedEntry(record)], countRunning(manager));
}

export async function waitForAll(
  manager: AgentManager,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const active = manager
    .listAgents()
    .filter((r) => r.status === "running" || r.status === "queued");

  if (active.length === 0) return ok([], 0);

  const promises = active
    .filter((r) => r.promise)
    .map((r) => r.promise as Promise<string>);

  if (promises.length === 0) {
    const entries = active.map(toCompletedEntry);
    for (const r of active) r.resultConsumed = true;
    return ok(entries, 0);
  }

  const result = await raceWithTimeout(
    Promise.allSettled(promises).then(() => "done" as const),
    timeoutMs,
    signal,
  );

  if (result === "timeout") {
    const completedDuringWait = active
      .filter((r) => r.status !== "running" && r.status !== "queued")
      .map(toCompletedEntry);
    return timedOut(countRunning(manager), completedDuringWait);
  }
  if (result === "aborted") {
    return ok([], countRunning(manager));
  }

  const entries = active.map((r) => {
    const fresh = manager.getRecord(r.id) ?? r;
    fresh.resultConsumed = true;
    return toCompletedEntry(fresh);
  });
  return ok(entries, countRunning(manager));
}

export async function waitForAny(
  manager: AgentManager,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const active = manager
    .listAgents()
    .filter((r) => r.status === "running" || r.status === "queued");

  if (active.length === 0) return ok([], 0);

  const promises = active
    .filter((r) => r.promise)
    .map((r) => (r.promise as Promise<string>).then(() => r.id));

  if (promises.length === 0) return ok([], countRunning(manager));

  const result = await raceWithTimeout(
    Promise.race(promises),
    timeoutMs,
    signal,
  );

  if (result === "timeout") return timedOut(countRunning(manager), []);
  if (result === "aborted") return ok([], countRunning(manager));

  const winner = manager.getRecord(result as string);
  if (winner) {
    winner.resultConsumed = true;
    return ok([toCompletedEntry(winner)], countRunning(manager));
  }
  return ok([], countRunning(manager));
}

// --- Registration ---

const DEFAULT_TIMEOUT_MS = 60_000;

const WAIT_PARAMS = Type.Object({
  id: Type.Optional(
    Type.String({
      description: "Wait for a specific agent (exact ID or unambiguous prefix)",
    }),
  ),
  all: Type.Optional(
    Type.Boolean({
      description: "Wait for ALL active agents (default: false = first-of-any)",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: "Give up after N ms (default: 60000)",
      minimum: 0,
    }),
  ),
});

export function registerWaitTool(pi: ExtensionAPI, manager: AgentManager): void {
  pi.registerTool({
    name: "wait",
    label: "Wait for Agents",
    description:
      "Block until background agent(s) complete. Use with no args to wait for the next completion, { all: true } for all, or { id } for a specific agent.",
    promptSnippet:
      "Block until background agent(s) complete instead of polling with get_subagent_result",
    parameters: WAIT_PARAMS,

    async execute(
      _toolCallId,
      params: { id?: string; all?: boolean; timeout_ms?: number },
      signal,
      _onUpdate,
      _ctx,
    ) {
      const timeoutMs = params.timeout_ms ?? DEFAULT_TIMEOUT_MS;

      if (params.id) return waitForSpecific(manager, params.id, timeoutMs, signal);
      if (params.all) return waitForAll(manager, timeoutMs, signal);
      return waitForAny(manager, timeoutMs, signal);
    },
  });
}
