/**
 * Standalone entry point for detached background subagent execution.
 * Spawned by background-execution.ts via: node jiti-cli.mjs background-runner.ts config.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { discoverAgents } from "./agents.ts";
import { loadConfig } from "./config.ts";
import { resolvePaths } from "./paths.ts";
import { executeSubagent, createSubagentRuntimeDeps } from "./subagent.ts";
import { readStatus, writeStatus, bgResultPath } from "./background-status.ts";
import type { BackgroundJobRecord } from "../shared/types.ts";

const configPath = process.argv[2];
if (!configPath) {
  console.error("[pi-subagents-runner] no config path provided");
  process.exit(1);
}

interface RunnerConfig {
  runId: string;
  agent: string;
  task: string;
  cwd: string;
  parentSessionFile: string | undefined;
  parentSessionDir: string | undefined;
  parentModel: string | undefined;
  resultPath: string;
}

async function run(): Promise<void> {
  const config: RunnerConfig = JSON.parse(readFileSync(configPath, "utf8"));
  const { runId, agent, task, cwd, parentSessionFile, parentSessionDir, parentModel } = config;

  const paths = resolvePaths();
  const loadedConfig = loadConfig(paths);
  const discovery = discoverAgents(paths);
  const runtime = createSubagentRuntimeDeps();

  const updateState = (state: BackgroundJobRecord["state"]): void => {
    const existing = readStatus(runId);
    if (existing) writeStatus(runId, { ...existing, state });
  };

  updateState("running");

  let result: { content: string; isError: boolean };
  try {
    const execResult = await executeSubagent(
      paths,
      loadedConfig,
      discovery,
      { agent, task, cwd },
      cwd,
      undefined,
      parentSessionFile,
      parentSessionDir,
      parentModel,
      runtime,
    );
    result = { content: execResult.content, isError: execResult.isError };

    const current = readStatus(runId);
    if (current) {
      writeStatus(runId, {
        ...current,
        state: result.isError ? "failed" : "complete",
        endedAt: Date.now(),
        errorMessage: result.isError ? result.content : undefined,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { content: message, isError: true };
    const current = readStatus(runId);
    if (current) {
      writeStatus(runId, {
        ...current,
        state: "failed",
        endedAt: Date.now(),
        errorMessage: message,
      });
    }
  }

  writeFileSync(bgResultPath(runId), JSON.stringify(result, null, 2), "utf8");
}

run().catch((err) => {
  console.error("[pi-subagents-runner]", err);
  process.exit(1);
});
