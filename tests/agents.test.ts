import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { discoverAgents, parseAgentFile } from "../src/agents.js";
import type { ResolvedPaths } from "../src/types.js";

function createPaths(rootDir: string): ResolvedPaths {
  return {
    agentDir: join(rootDir, "agent"),
    configPath: join(rootDir, "agent", "extensions", "subagents.json"),
    userAgentsDir: join(rootDir, "agent", "agents"),
    bundledAgentsDir: join(rootDir, "bundled-agents"),
    transcriptCacheDir: join(rootDir, "agent", "cache", "pi-subagents"),
  };
}

describe("agent discovery", () => {
  test("bundled default agent files exist in the extension agents directory", () => {
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const bundledAgentsDir = join(repoRoot, "agents");
    const expectedFiles = [
      "planner.md",
      "researcher.md",
      "scout.md",
      "worker.md",
    ];

    for (const fileName of expectedFiles) {
      const filePath = join(bundledAgentsDir, fileName);
      expect(existsSync(filePath)).toBe(true);
      const parsed = parseAgentFile(filePath, readFileSync(filePath, "utf8"));
      expect(parsed.ok).toBe(true);
    }
  });

  test("parses the markdown body as systemPrompt", () => {
    const parsed = parseAgentFile(
      "/tmp/scout.md",
      [
        "---",
        "name: scout",
        "description: Scout files",
        "tools: bash, read",
        "---",
        "# System prompt",
        "Use the body unchanged.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: {
        name: "scout",
        description: "Scout files",
        tools: ["bash", "read"],
        systemPrompt: "# System prompt\nUse the body unchanged.",
      },
    });
  });

  test("discovers bundled agents without copying them into the user directory", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });
    writeFileSync(
      join(paths.bundledAgentsDir, "planner.md"),
      [
        "---",
        "name: planner",
        "description: Plans work",
        'tools: ["read", "bash"]',
        "subagent_agents:",
        "  - worker",
        "timeout_ms: 180000",
        "---",
        "Plan the work.",
      ].join("\n"),
    );

    const result = discoverAgents(paths);

    expect(result.diagnostics).toEqual([]);
    expect(result.agents).toEqual([
      expect.objectContaining({
        name: "planner",
        description: "Plans work",
        tools: ["read", "bash"],
        subagentAgents: ["worker"],
        timeoutMs: 180000,
        sourcePath: join(paths.bundledAgentsDir, "planner.md"),
      }),
    ]);
  });

  test("prefers user agents over bundled duplicates and keeps deterministic ordering", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.userAgentsDir, "b-user.md"),
      "---\nname: alpha\ndescription: User alpha\ntools: read\n---\nUser version\n",
    );
    writeFileSync(
      join(paths.userAgentsDir, "c-user.md"),
      "---\nname: zeta\ndescription: User zeta\ntools: bash\n---\nUser zeta\n",
    );
    writeFileSync(
      join(paths.bundledAgentsDir, "a-bundled.md"),
      "---\nname: alpha\ndescription: Bundled alpha\ntools: read, bash\n---\nBundled version\n",
    );
    writeFileSync(
      join(paths.bundledAgentsDir, "b-bundled.md"),
      "---\nname: beta\ndescription: Bundled beta\ntools: bash\n---\nBundled beta\n",
    );

    const result = discoverAgents(paths);

    expect(result.agents.map((agent) => agent.name)).toEqual(["alpha", "zeta", "beta"]);
    expect(result.diagnostics).toEqual([
      {
        path: join(paths.bundledAgentsDir, "a-bundled.md"),
        reason: 'duplicate agent name "alpha" skipped; user agent wins',
      },
    ]);
    expect(result.agents[0]).toMatchObject({
      description: "User alpha",
      sourcePath: join(paths.userAgentsDir, "b-user.md"),
    });
  });

  test("keeps the first user duplicate and reports later duplicates", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.userAgentsDir, "a-first.md"),
      "---\nname: scout\ndescription: First scout\ntools: read\n---\nFirst\n",
    );
    writeFileSync(
      join(paths.userAgentsDir, "b-second.md"),
      "---\nname: scout\ndescription: Second scout\ntools: bash\n---\nSecond\n",
    );

    const result = discoverAgents(paths);

    expect(result.agents).toEqual([
      expect.objectContaining({
        name: "scout",
        description: "First scout",
        sourcePath: join(paths.userAgentsDir, "a-first.md"),
      }),
    ]);
    expect(result.diagnostics).toEqual([
      {
        path: join(paths.userAgentsDir, "b-second.md"),
        reason: 'duplicate agent name "scout" skipped; first definition wins',
      },
    ]);
  });

  test("does not fail when the user agent directory is missing", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });
    writeFileSync(
      join(paths.bundledAgentsDir, "worker.md"),
      "---\nname: worker\ndescription: Does work\ntools: edit\n---\nDo work\n",
    );

    expect(() => discoverAgents(paths)).not.toThrow();
    expect(discoverAgents(paths).agents).toHaveLength(1);
  });

  test("skips malformed files with clear diagnostics", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.userAgentsDir, "01-missing-name.md"),
      "---\ndescription: Missing name\ntools: read\n---\nBody\n",
    );
    writeFileSync(
      join(paths.userAgentsDir, "02-invalid-tools.md"),
      "---\nname: bad-tools\ndescription: Invalid tools\ntools: [1, 2]\n---\nBody\n",
    );
    writeFileSync(
      join(paths.bundledAgentsDir, "03-invalid-timeout.md"),
      "---\nname: bad-timeout\ndescription: Invalid timeout\ntimeout_ms: 0\n---\nBody\n",
    );
    writeFileSync(
      join(paths.bundledAgentsDir, "04-malformed-frontmatter.md"),
      "---\nname bad\ndescription: Missing colon\n---\nBody\n",
    );

    const result = discoverAgents(paths);

    expect(result.agents).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        path: join(paths.userAgentsDir, "01-missing-name.md"),
        reason: "missing required non-empty name",
      },
      {
        path: join(paths.userAgentsDir, "02-invalid-tools.md"),
        reason: "tools must be a comma-separated string or string array",
      },
      {
        path: join(paths.bundledAgentsDir, "03-invalid-timeout.md"),
        reason: "timeout_ms must be a positive finite number",
      },
      {
        path: join(paths.bundledAgentsDir, "04-malformed-frontmatter.md"),
        reason: "malformed frontmatter line: name bad",
      },
    ]);
  });
});
