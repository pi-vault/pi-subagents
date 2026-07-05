import {
  getArtifactPaths,
  writeArtifact,
  writeMetadata,
} from "../shared/artifacts.js";
import type {
  ArtifactPaths,
  ResolvedPaths,
  SubagentExecutionResult,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArtifactWriteInput = {
  requestedAgent: string;
  resolvedAgentName?: string;
  task: string;
  cwd: string;
  runId: string;
  sourcePath?: string;
  parentSessionFile?: string;
  parentSessionDir?: string;
};

// ---------------------------------------------------------------------------
// Markdown builders
// ---------------------------------------------------------------------------

export function buildArtifactInputMarkdown(input: ArtifactWriteInput): string {
  return [
    "# Subagent Input",
    "",
    `- requested agent: ${input.requestedAgent || "-"}`,
    `- resolved agent: ${input.resolvedAgentName || "-"}`,
    `- run id: ${input.runId}`,
    `- cwd: ${input.cwd}`,
    `- source: ${input.sourcePath || "-"}`,
    `- parent session file: ${input.parentSessionFile || "-"}`,
    `- parent session dir: ${input.parentSessionDir || "-"}`,
    "",
    "## Task",
    "",
    input.task || "(empty task)",
    "",
  ].join("\n");
}

export function buildArtifactOutputMarkdown(
  result: SubagentExecutionResult,
): string {
  return [
    "# Subagent Output",
    "",
    `- status: ${result.details.status}`,
    `- stop reason: ${result.details.stopReason}`,
    `- exit code: ${result.details.exitCode ?? "-"}`,
    `- model: ${result.details.model || "-"}`,
    "",
    "## Output",
    "",
    result.content || "(no output)",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

export function writeExecutionArtifacts(
  paths: ResolvedPaths,
  artifactInput: ArtifactWriteInput,
  result: SubagentExecutionResult,
): ArtifactPaths {
  const artifactPaths = getArtifactPaths(
    paths,
    artifactInput.cwd,
    artifactInput.runId,
    artifactInput.resolvedAgentName ?? artifactInput.requestedAgent,
    0,
    artifactInput.parentSessionFile,
    artifactInput.parentSessionDir,
  );

  writeArtifact(artifactPaths.input, buildArtifactInputMarkdown(artifactInput));
  writeArtifact(artifactPaths.output, buildArtifactOutputMarkdown(result));
  writeMetadata(artifactPaths.meta, {
    runId: artifactInput.runId,
    agent: artifactInput.resolvedAgentName ?? artifactInput.requestedAgent,
    requestedAgent: artifactInput.requestedAgent,
    task: artifactInput.task,
    status: result.details.status,
    error: result.isError ? result.content : undefined,
    model: result.details.model,
    durationMs: result.details.durationMs,
    maxTurns: result.details.maxTurns,
    usage: result.details.usage,
    exitCode: result.details.exitCode,
    stopReason: result.details.stopReason,
    cwd: result.details.cwd,
    sourcePath: result.details.sourcePath,
    childSessionDir: result.details.childSessionDir,
    childSessionPath: result.details.childSessionPath,
    stderr: result.details.stderr,
    timestamp: new Date().toISOString(),
  });

  return artifactPaths;
}
