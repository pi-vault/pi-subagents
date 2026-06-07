import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  ArtifactPaths,
  ResolvedPaths,
  RuntimeArtifactsPaths,
} from "./types.js";

const ARTIFACTS_DIR_NAME = "subagent-artifacts";

export function encodePiCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  const trimmed = resolvedCwd.replace(/^[/\\]/, "");
  return `--${trimmed.replace(/[\\/:]/g, "-")}--`;
}

export function resolvePiEncodedSessionDir(
  paths: ResolvedPaths,
  cwd: string,
): string {
  return join(paths.sessionsDir, encodePiCwd(cwd));
}

export function getArtifactsDir(
  paths: ResolvedPaths,
  cwd: string,
  parentSessionFile?: string,
  parentSessionDir?: string,
): string {
  const sessionRoot = parentSessionFile
    ? (parentSessionDir ?? dirname(parentSessionFile))
    : resolvePiEncodedSessionDir(paths, cwd);

  return join(sessionRoot, ARTIFACTS_DIR_NAME);
}

export function resolveRuntimeArtifactsPaths(
  paths: ResolvedPaths,
  cwd: string,
  parentSessionFile?: string,
  parentSessionDir?: string,
): RuntimeArtifactsPaths {
  const rootDir = getArtifactsDir(paths, cwd, parentSessionFile, parentSessionDir);
  return {
    rootDir,
    nestedEventsDir: join(rootDir, "nested-subagent-events"),
    nestedRunsDir: join(rootDir, "nested-subagent-runs"),
  };
}

function toSafeAgentName(agent: string): string {
  const safe = agent.trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  return safe || "agent";
}

export function getArtifactPaths(
  paths: ResolvedPaths,
  cwd: string,
  runId: string,
  agent: string,
  index: number,
  parentSessionFile?: string,
  parentSessionDir?: string,
): ArtifactPaths {
  const artifactsDir = getArtifactsDir(
    paths,
    cwd,
    parentSessionFile,
    parentSessionDir,
  );
  const baseName = `${runId}_${toSafeAgentName(agent)}_${index}`;
  return {
    input: join(artifactsDir, `${baseName}_input.md`),
    output: join(artifactsDir, `${baseName}_output.md`),
    meta: join(artifactsDir, `${baseName}_meta.json`),
  };
}

export function ensureArtifactsDir(artifactPaths: ArtifactPaths): void {
  mkdirSync(dirname(artifactPaths.input), { recursive: true });
}

export function writeArtifact(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}

export function writeMetadata(path: string, metadata: unknown): void {
  writeArtifact(path, `${JSON.stringify(metadata, null, 2)}\n`);
}
