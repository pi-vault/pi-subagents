import { mkdirSync } from "node:fs";
import type { BackgroundJobRecord, BackgroundJobStatus } from "../shared/types.js";
import {
  BG_ROOT_DIR,
  readResult,
  readStatus,
  scanPersistedJobs,
  writeStatus,
} from "./background-status.js";

const POLL_INTERVAL_MS = 250;
const STALE_GRACE_MS = 5_000;

const jobs = new Map<string, BackgroundJobRecord>();
let pollInterval: ReturnType<typeof setInterval> | undefined;
let isRunning = false;

type CompletionCallback = (
  job: BackgroundJobRecord,
  result: { content: string; isError: boolean },
) => void;

let completionCallback: CompletionCallback | undefined;

export function onJobComplete(cb: CompletionCallback): void {
  completionCallback = cb;
}

export function registerJob(record: BackgroundJobRecord): void {
  jobs.set(record.id, record);
}

export function getJob(id: string): BackgroundJobRecord | undefined {
  return jobs.get(id);
}

export function getAllJobs(): BackgroundJobRecord[] {
  return Array.from(jobs.values());
}

export function getJobStatuses(): BackgroundJobStatus[] {
  return getAllJobs().map((job) => ({
    id: job.id,
    agent: job.agent,
    task: job.task,
    state: job.state,
    durationMs: job.endedAt
      ? job.endedAt - job.startedAt
      : Date.now() - job.startedAt,
    errorMessage: job.errorMessage,
  }));
}

function checkForCompletion(runId: string): void {
  const job = jobs.get(runId);
  if (!job || job.state === "complete" || job.state === "failed") return;

  const result = readResult(runId);
  if (!result) return;

  const updatedJob: BackgroundJobRecord = {
    ...job,
    state: result.isError ? "failed" : "complete",
    endedAt: Date.now(),
    errorMessage: result.isError ? result.content : undefined,
  };
  jobs.set(runId, updatedJob);
  writeStatus(runId, updatedJob);
  completionCallback?.(updatedJob, result);
}

function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function reconcileRunningJob(job: BackgroundJobRecord): BackgroundJobRecord {
  const diskStatus = readStatus(job.id);
  const current = diskStatus ?? job;

  if (readResult(job.id)) {
    return current;
  }

  if (
    (current.state === "queued" || current.state === "running") &&
    Date.now() - current.startedAt > STALE_GRACE_MS &&
    !isPidAlive(current.pid)
  ) {
    const failed: BackgroundJobRecord = {
      ...current,
      state: "failed",
      endedAt: Date.now(),
      errorMessage: "Background process exited before writing result.json",
    };
    writeStatus(job.id, failed);
    return failed;
  }

  return current;
}

function pollRunningJobs(): void {
  for (const [id, job] of jobs) {
    const reconciled = reconcileRunningJob(job);
    jobs.set(id, reconciled);
    checkForCompletion(id);
  }
}

export function startBackgroundTracker(): void {
  // Guard against duplicate starts (extension reload, test re-use)
  if (isRunning) {
    stopBackgroundTracker();
  }
  isRunning = true;

  mkdirSync(BG_ROOT_DIR, { recursive: true });
  jobs.clear();

  // Load persisted jobs from disk so prior-session runs are visible after reload
  for (const record of scanPersistedJobs()) {
    if (!jobs.has(record.id)) {
      jobs.set(record.id, record);
    }
  }

  pollInterval = setInterval(pollRunningJobs, POLL_INTERVAL_MS);
}

export function stopBackgroundTracker(): void {
  isRunning = false;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = undefined;
  }
}
