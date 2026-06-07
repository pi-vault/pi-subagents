import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ResolvedPaths } from "./types.js";

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
