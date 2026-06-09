import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BackgroundJobRecord } from "../shared/types.js";
import {
  bgConfigPath,
  bgResultPath,
  ensureRunDir,
  writeStatus,
} from "./background-status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = join(__dirname, "background-runner.ts");

/**
 * Resolve the jiti CLI by walking up the directory tree.
 *
 * jiti is a transitive dependency of the pi host, not declared by this package,
 * so import.meta.resolve("jiti") fails. Walking up from __dirname and finding
 * the real JS entrypoint avoids passing a shell wrapper to `node`.
 */
async function resolveJitiCliPath(): Promise<string | undefined> {
  const searchRoots: string[] = [];
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    searchRoots.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const cwd = process.cwd();
  if (!searchRoots.includes(cwd)) searchRoots.push(cwd);

  for (const root of searchRoots) {
    const directCli = join(root, "node_modules", "jiti", "lib", "jiti-cli.mjs");
    if (existsSync(directCli)) return directCli;

    // pnpm store: node_modules/.pnpm/jiti@*/node_modules/jiti/lib/jiti-cli.mjs
    const pnpmDir = join(root, "node_modules", ".pnpm");
    if (existsSync(pnpmDir)) {
      try {
        const entries = readdirSync(pnpmDir).filter((e) => e.startsWith("jiti@"));
        for (const entry of entries) {
          const cli = join(pnpmDir, entry, "node_modules", "jiti", "lib", "jiti-cli.mjs");
          if (existsSync(cli)) return cli;
        }
      } catch {
        // continue to next root
      }
    }
  }
  return undefined;
}

let jitiCliPathCache: string | undefined | null = null; // null = not yet resolved

export async function isBackgroundExecutionAvailable(): Promise<boolean> {
  if (jitiCliPathCache === null) {
    jitiCliPathCache = await resolveJitiCliPath();
  }
  return jitiCliPathCache !== undefined;
}

export interface BackgroundSpawnResult {
  pid: number;
  error?: never;
}

export interface BackgroundSpawnError {
  pid?: never;
  error: string;
}

export async function spawnBackgroundSubagent(
  runId: string,
  agent: string,
  task: string,
  cwd: string,
  parentSessionFile: string | undefined,
  parentSessionDir: string | undefined,
  parentModel: string | undefined,
): Promise<BackgroundSpawnResult | BackgroundSpawnError> {
  if (jitiCliPathCache === null) {
    jitiCliPathCache = await resolveJitiCliPath();
  }
  if (!jitiCliPathCache) {
    return { error: "jiti not found; background execution unavailable" };
  }

  ensureRunDir(runId);

  const config = {
    runId,
    agent,
    task,
    cwd,
    parentSessionFile,
    parentSessionDir,
    parentModel,
    resultPath: bgResultPath(runId),
  };

  writeFileSync(bgConfigPath(runId), JSON.stringify(config, null, 2), "utf8");

  const startedAt = Date.now();
  const initialRecord: BackgroundJobRecord = {
    id: runId,
    agent,
    task,
    cwd,
    state: "queued",
    startedAt,
  };
  writeStatus(runId, initialRecord);

  const proc = spawn(process.execPath, [jitiCliPathCache, RUNNER_PATH, bgConfigPath(runId)], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  proc.on("error", (err) => {
    console.error(`[pi-subagents] background spawn failed: ${err.message}`);
  });

  if (typeof proc.pid !== "number") {
    return { error: "background process did not produce a PID" };
  }

  proc.unref();
  writeStatus(runId, {
    id: runId,
    agent,
    task,
    cwd,
    state: "running",
    startedAt,
    pid: proc.pid,
  });
  return { pid: proc.pid };
}
