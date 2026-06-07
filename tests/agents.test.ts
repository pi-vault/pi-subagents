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
import {
  createAgentFile,
  createAgentMarkdown,
  discoverAgents,
  discoverToolNames,
  parseAgentFile,
} from "../src/agents.js";
import type { AgentCreationInput, ResolvedPaths } from "../src/types.js";

function createPaths(rootDir: string): ResolvedPaths {
  return {
    agentDir: join(rootDir, "agent"),
    configPath: join(rootDir, "agent", "extensions", "subagents.json"),
    userAgentsDir: join(rootDir, "agent", "agents"),
    bundledAgentsDir: join(rootDir, "bundled-agents"),
    sessionsDir: join(rootDir, "agent", "sessions"),
    runtimeCacheDir: join(rootDir, "agent", "cache", "pi-subagents"),
  };
}

function createValidInput(
  overrides: Partial<AgentCreationInput> = {},
): AgentCreationInput {
  return {
    name: "Scout",
    description: "Scout files",
    tools: ["bash", "read"],
    model: "default",
    thinking: "medium",
    subagentAgents: ["worker"],
    timeoutMs: 180000,
    systemPrompt: "# System prompt\nInspect the repo.",
    ...overrides,
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

  test("inherits the agent name from the lowercase filename stem when frontmatter name is missing", () => {
    const parsed = parseAgentFile(
      "/tmp/Planner.md",
      [
        "---",
        "description: Plans work",
        "tools: read, bash",
        "---",
        "Plan the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: {
        name: "planner",
        description: "Plans work",
        tools: ["read", "bash"],
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

    expect(result.agents.map((agent) => agent.name)).toEqual([
      "alpha",
      "zeta",
      "beta",
    ]);
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

  test("treats casing-only user duplicates as the same agent name", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.userAgentsDir, "a-first.md"),
      "---\nname: Scout\ndescription: First scout\ntools: read\n---\nFirst\n",
    );
    writeFileSync(
      join(paths.userAgentsDir, "b-second.md"),
      "---\nname: scout\ndescription: Second scout\ntools: bash\n---\nSecond\n",
    );

    const result = discoverAgents(paths);

    expect(result.agents).toEqual([
      expect.objectContaining({
        name: "Scout",
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

  test("treats casing-only bundled duplicates as matching user agents", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.userAgentsDir, "a-user.md"),
      "---\nname: Scout\ndescription: User scout\ntools: read\n---\nUser\n",
    );
    writeFileSync(
      join(paths.bundledAgentsDir, "a-bundled.md"),
      "---\nname: scout\ndescription: Bundled scout\ntools: bash\n---\nBundled\n",
    );

    const result = discoverAgents(paths);

    expect(result.agents).toEqual([
      expect.objectContaining({
        name: "Scout",
        description: "User scout",
        sourcePath: join(paths.userAgentsDir, "a-user.md"),
      }),
    ]);
    expect(result.diagnostics).toEqual([
      {
        path: join(paths.bundledAgentsDir, "a-bundled.md"),
        reason: 'duplicate agent name "scout" skipped; user agent wins',
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
      join(paths.userAgentsDir, "01-missing-description.md"),
      "---\nname: missing-description\ntools: read\n---\nBody\n",
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
        path: join(paths.userAgentsDir, "01-missing-description.md"),
        reason: "missing required non-empty description",
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

describe("tool discovery and agent creation", () => {
  test("merges built-ins with runtime tools, deduplicates, and sorts deterministically", () => {
    expect(
      discoverToolNames(["zeta", "bash", "alpha", "read", "alpha"]),
    ).toEqual([
      "alpha",
      "bash",
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
      "zeta",
    ]);
  });

  test("serializes created agents deterministically", () => {
    expect(createAgentMarkdown(createValidInput())).toBe(
      [
        "---",
        "name: Scout",
        "description: Scout files",
        "tools: bash, read",
        "model: default",
        "thinking: medium",
        "subagent_agents: worker",
        "timeout_ms: 180000",
        "---",
        "# System prompt",
        "Inspect the repo.",
        "",
      ].join("\n"),
    );
  });

  test("writes a valid markdown file and preserves capitalized frontmatter name with lowercase filename", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [
        {
          name: "worker",
          description: "Does work",
          tools: ["read"],
          subagentAgents: [],
          systemPrompt: "Do work",
          sourcePath: "/repo/agents/worker.md",
        },
      ],
      diagnostics: [],
    };

    const created = createAgentFile(
      paths,
      createValidInput(),
      discovery,
      discoverToolNames(["custom_tool"]),
    );

    expect(created).toMatchObject({
      name: "Scout",
      sourcePath: join(paths.userAgentsDir, "scout.md"),
    });
    expect(readFileSync(join(paths.userAgentsDir, "scout.md"), "utf8")).toBe(
      createAgentMarkdown(createValidInput()),
    );
  });

  test("inherits the created agent name from the filename slug when frontmatter name is omitted", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [], diagnostics: [] };

    const created = createAgentFile(
      paths,
      createValidInput({
        name: undefined,
        filenameSlug: "planner",
        subagentAgents: [],
        model: undefined,
        thinking: undefined,
        timeoutMs: undefined,
      }),
      discovery,
      discoverToolNames([]),
    );

    expect(created.name).toBe("planner");
    expect(readFileSync(join(paths.userAgentsDir, "planner.md"), "utf8")).toBe(
      [
        "---",
        "description: Scout files",
        "tools: bash, read",
        "---",
        "# System prompt",
        "Inspect the repo.",
        "",
      ].join("\n"),
    );
  });

  test("rejects invalid creation inputs", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [
        {
          name: "worker",
          description: "Does work",
          tools: ["read"],
          subagentAgents: [],
          systemPrompt: "Do work",
          sourcePath: "/repo/agents/worker.md",
        },
      ],
      diagnostics: [],
    };
    const toolNames = discoverToolNames([]);

    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ name: "bad name" }),
        discovery,
        toolNames,
      ),
    ).toThrow("name must match ^[A-Za-z0-9_-]+$");
    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ name: undefined, filenameSlug: "BadSlug" }),
        discovery,
        toolNames,
      ),
    ).toThrow("filename slug must match ^[a-z0-9_-]+$");
    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ description: "   " }),
        discovery,
        toolNames,
      ),
    ).toThrow("description must be non-empty");
    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ systemPrompt: "   " }),
        discovery,
        toolNames,
      ),
    ).toThrow("markdown body must be non-empty");
    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ tools: ["unknown-tool"] }),
        discovery,
        toolNames,
      ),
    ).toThrow("unknown tools: unknown-tool");
    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ subagentAgents: ["unknown-agent"] }),
        discovery,
        toolNames,
      ),
    ).toThrow("unknown subagent_agents: unknown-agent");
    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ timeoutMs: 0 }),
        discovery,
        toolNames,
      ),
    ).toThrow("timeout_ms must be a positive finite number");
  });

  test("rejects duplicate names cleanly", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    const discovery = {
      agents: [
        {
          name: "planner",
          description: "Plans work",
          tools: ["read"],
          subagentAgents: [],
          systemPrompt: "Plan",
          sourcePath: "/repo/agents/planner.md",
        },
      ],
      diagnostics: [],
    };

    expect(() =>
      createAgentFile(
        paths,
        createValidInput({ name: "Planner", subagentAgents: [] }),
        discovery,
        discoverToolNames([]),
      ),
    ).toThrow("duplicate agent name: Planner");
  });

  test("created agents are discoverable immediately without restart", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });
    writeFileSync(
      join(paths.bundledAgentsDir, "worker.md"),
      "---\nname: worker\ndescription: Does work\ntools: read\n---\nDo work\n",
    );

    const before = discoverAgents(paths);
    expect(before.agents.map((agent) => agent.name)).toEqual(["worker"]);

    createAgentFile(
      paths,
      createValidInput({ name: "Scout", subagentAgents: ["worker"] }),
      before,
      discoverToolNames([]),
    );

    const after = discoverAgents(paths);
    expect(after.agents.map((agent) => agent.name)).toEqual([
      "Scout",
      "worker",
    ]);
  });
});
