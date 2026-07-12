import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  encodePiCwd,
  getArtifactPaths,
  resolvePiEncodedSessionDir,
} from "../src/shared/artifacts.js";
import type { ResolvedPaths } from "../src/shared/types.js";

function createPaths(rootDir = "/tmp/pi-agent"): ResolvedPaths {
  return {
    agentDir: join(rootDir, "agent"),
    configPath: join(rootDir, "agent", "extensions", "subagents.json"),
    userAgentsDir: join(rootDir, "agent", "agents"),
    bundledAgentsDir: join(rootDir, "bundled-agents"),
    sessionsDir: join(rootDir, "agent", "sessions"),
    userChainsDir: join(rootDir, "agent", "chains"),
    bundledChainsDir: join(rootDir, "bundled-chains"),
    userPromptsDir: join(rootDir, "agent", "prompts"),
    bundledPromptsDir: join(rootDir, "bundled-prompts"),
  };
}

describe("artifact helpers", () => {
  test("encodes cwd using the verified pi session directory format", () => {
    expect(encodePiCwd("/Users/lanh/Developer/pi-vault/pi-subagents")).toBe(
      "--Users-lanh-Developer-pi-vault-pi-subagents--",
    );
  });

  test("resolves no-parent session root under the encoded cwd session dir", () => {
    const paths = createPaths();
    const cwd = "/repo/worktree";

    expect(resolvePiEncodedSessionDir(paths, cwd)).toBe(
      join(paths.sessionsDir, "--repo-worktree--"),
    );
  });

  test("uses the parent session dir for artifacts when a parent session exists", () => {
    const paths = createPaths();
    const parentSessionDir = "/tmp/pi-agent/agent/sessions/--repo--";
    const parentSessionFile = join(parentSessionDir, "session.jsonl");

    expect(
      getArtifactPaths(
        paths,
        "/repo",
        "run-123",
        "Scout Agent",
        0,
        parentSessionFile,
        parentSessionDir,
      ),
    ).toEqual({
      input: join(
        parentSessionDir,
        "subagent-artifacts",
        "run-123_Scout_Agent_0_input.md",
      ),
      output: join(
        parentSessionDir,
        "subagent-artifacts",
        "run-123_Scout_Agent_0_output.md",
      ),
      meta: join(
        parentSessionDir,
        "subagent-artifacts",
        "run-123_Scout_Agent_0_meta.json",
      ),
    });
  });
});
