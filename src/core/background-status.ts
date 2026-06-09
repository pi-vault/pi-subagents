import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import type { BackgroundJobRecord } from "../shared/types.ts";

export const BG_ROOT_DIR = join(os.tmpdir(), "pi-subagents-bg");

export function bgRunDir(runId: string): string {
  return join(BG_ROOT_DIR, runId);
}

export function bgStatusPath(runId: string): string {
  return join(bgRunDir(runId), "status.json");
}

export function bgResultPath(runId: string): string {
  return join(bgRunDir(runId), "result.json");
}

export function bgConfigPath(runId: string): string {
  return join(bgRunDir(runId), "config.json");
}

export function ensureRunDir(runId: string): string {
  const dir = bgRunDir(runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeStatus(runId: string, record: BackgroundJobRecord): void {
  writeFileSync(bgStatusPath(runId), JSON.stringify(record, null, 2), "utf8");
}

export function readStatus(runId: string): BackgroundJobRecord | undefined {
  const path = bgStatusPath(runId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BackgroundJobRecord;
  } catch {
    return undefined;
  }
}

export function readResult(runId: string): { content: string; isError: boolean } | undefined {
  const path = bgResultPath(runId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { content: string; isError: boolean };
  } catch {
    return undefined;
  }
}

/** Scan BG_ROOT_DIR for all persisted status.json files. Used on startup to hydrate in-memory state. */
export function scanPersistedJobs(): BackgroundJobRecord[] {
  if (!existsSync(BG_ROOT_DIR)) return [];
  try {
    return readdirSync(BG_ROOT_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => readStatus(e.name))
      .filter((r): r is BackgroundJobRecord => r !== undefined);
  } catch {
    return [];
  }
}
