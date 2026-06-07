import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ResolvedPaths, RuntimeArtifactsPaths } from "./types.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

export function getBundledAgentsDir(): string {
  return resolve(currentDir, "../agents");
}

export function resolvePaths(agentDir = getAgentDir()): ResolvedPaths {
  return {
    agentDir,
    configPath: join(agentDir, "extensions", "subagents.json"),
    userAgentsDir: join(agentDir, "agents"),
    bundledAgentsDir: getBundledAgentsDir(),
    sessionsDir: join(agentDir, "sessions"),
    runtimeCacheDir: join(agentDir, "cache", "pi-subagents"),
  };
}

export function resolveRuntimeArtifactsPaths(
  paths: ResolvedPaths,
  parentSessionFile: string | undefined,
  parentSessionDir: string | undefined,
): RuntimeArtifactsPaths {
  const rootDir = parentSessionFile
    ? join(parentSessionDir ?? dirname(parentSessionFile), "subagent-artifacts")
    : join(paths.runtimeCacheDir, "subagent-artifacts");

  return {
    rootDir,
    nestedEventsDir: join(rootDir, "nested-subagent-events"),
    nestedRunsDir: join(rootDir, "nested-subagent-runs"),
  };
}
