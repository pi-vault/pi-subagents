import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  createAgentFile,
  deleteUserAgentOverride,
  disableAgentInUserScope,
  discoverAgentCatalog,
  discoverAgents,
  discoverToolNames,
  exportAgentToUserScope,
  readUserAgentOverride,
  updateUserAgentOverride,
} from "../src/core/agents.js";
import { parseAgentContent, serializeAgent } from "../src/core/agent-format.js";
import type { AgentCreationInput, ResolvedPaths } from "../src/shared/types.js";

function createPaths(rootDir: string): ResolvedPaths {
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
    systemPrompt: "# System prompt\nInspect the repo.",
    ...overrides,
  };
}

function agentMarkdown(
  name: string,
  description: string,
  enabled?: boolean,
): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "tools: read",
    ...(enabled === undefined ? [] : [`enabled: ${enabled}`]),
    "---",
    `${name} prompt`,
    "",
  ].join("\n");
}

describe("agent discovery", () => {
  test("bundled default agent files exist in the extension agents directory", () => {
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const bundledAgentsDir = join(repoRoot, "agents");
    const expectedFiles = [
      "planner.md",
      "researcher.md",
      "reviewer.md",
      "scout.md",
      "worker.md",
    ];

    for (const fileName of expectedFiles) {
      const filePath = join(bundledAgentsDir, fileName);
      expect(existsSync(filePath)).toBe(true);
      const parsed = parseAgentContent(filePath, readFileSync(filePath, "utf8"));
      expect(parsed.ok).toBe(true);
    }
  });

  test("parses the markdown body as systemPrompt", () => {
    const parsed = parseAgentContent(
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
    const parsed = parseAgentContent(
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
      join(paths.bundledAgentsDir, "03-malformed-frontmatter.md"),
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
        path: join(paths.bundledAgentsDir, "03-malformed-frontmatter.md"),
        reason: "malformed frontmatter line: name bad",
      },
    ]);
  });
});

describe("agent catalog and override persistence", () => {
  test("reports an unreadable agent directory instead of throwing", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-catalog-"));
    const paths = createPaths(rootDir);
    mkdirSync(dirname(paths.userAgentsDir), { recursive: true });
    writeFileSync(paths.userAgentsDir, "not a directory");

    const catalog = discoverAgentCatalog(paths);

    expect(catalog.entries).toEqual([]);
    expect(catalog.userDiagnostics).toEqual([
      { path: paths.userAgentsDir, reason: "unreadable directory" },
    ]);
  });

  test("returns sorted catalog entries using first-definition precedence", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-catalog-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.bundledAgentsDir, "planner.md"),
      agentMarkdown("planner", "Bundled planner"),
    );
    writeFileSync(
      join(paths.bundledAgentsDir, "scout.md"),
      agentMarkdown("scout", "Bundled scout"),
    );
    writeFileSync(
      join(paths.userAgentsDir, "a-scout.md"),
      agentMarkdown("Scout", "User scout"),
    );
    writeFileSync(
      join(paths.userAgentsDir, "b-planner.md"),
      agentMarkdown("planner", "Disabled planner", false),
    );
    writeFileSync(
      join(paths.userAgentsDir, "c-custom.md"),
      agentMarkdown("custom", "User only"),
    );
    writeFileSync(
      join(paths.userAgentsDir, "z-scout.md"),
      agentMarkdown("scout", "Later duplicate"),
    );

    const catalog = discoverAgentCatalog(paths);

    expect(catalog.entries).toMatchObject([
      {
        name: "custom",
        state: "override",
        override: { description: "User only" },
      },
      {
        name: "planner",
        state: "disabled",
        bundled: { description: "Bundled planner" },
        override: { description: "Disabled planner", enabled: false },
      },
      {
        name: "Scout",
        state: "override",
        bundled: { description: "Bundled scout" },
        override: { description: "User scout" },
      },
    ]);
    expect(catalog.userDiagnostics).toEqual([
      {
        path: join(paths.userAgentsDir, "z-scout.md"),
        reason: 'duplicate agent name "scout" skipped; first definition wins',
      },
    ]);
  });

  test("separates user and bundled discovery diagnostics", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-catalog-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    mkdirSync(paths.bundledAgentsDir, { recursive: true });

    writeFileSync(
      join(paths.userAgentsDir, "bad name.md"),
      agentMarkdown("bad", "Unsafe filename"),
    );
    mkdirSync(join(paths.userAgentsDir, "broken.md"));
    const outside = join(rootDir, "outside.md");
    writeFileSync(outside, agentMarkdown("outside", "Outside"));
    symlinkSync(outside, join(paths.userAgentsDir, "linked.md"));
    writeFileSync(
      join(paths.bundledAgentsDir, "malformed.md"),
      "---\nname: malformed\ntools: read\n---\nBody\n",
    );

    const catalog = discoverAgentCatalog(paths);

    expect(catalog.entries).toEqual([]);
    expect(catalog.userDiagnostics).toEqual([
      {
        path: join(paths.userAgentsDir, "bad name.md"),
        reason: "unsafe filename",
      },
      {
        path: join(paths.userAgentsDir, "broken.md"),
        reason: "unreadable or symlink",
      },
      {
        path: join(paths.userAgentsDir, "linked.md"),
        reason: "unreadable or symlink",
      },
    ]);
    expect(catalog.bundledDiagnostics).toEqual([
      {
        path: join(paths.bundledAgentsDir, "malformed.md"),
        reason: "missing required non-empty description",
      },
    ]);
  });

  test("reads override Markdown byte-for-byte", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-override-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    const sourcePath = join(paths.userAgentsDir, "scout.md");
    const original = `${agentMarkdown("scout", "Original scout")}\n`;
    writeFileSync(sourcePath, original);

    expect(readUserAgentOverride(paths, sourcePath)).toBe(original);
  });

  test("rejects paths that are not safe direct user overrides", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-override-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    const original = agentMarkdown("scout", "Original scout");
    const nestedDir = join(paths.userAgentsDir, "nested");
    mkdirSync(nestedDir);
    const nestedPath = join(nestedDir, "scout.md");
    writeFileSync(nestedPath, original);
    const outsidePath = join(rootDir, "outside.md");
    writeFileSync(outsidePath, original);
    const linkedPath = join(paths.userAgentsDir, "linked.md");
    symlinkSync(outsidePath, linkedPath);

    expect(() => readUserAgentOverride(paths, nestedPath)).toThrow(
      "invalid user agent override path",
    );
    expect(() => readUserAgentOverride(paths, outsidePath)).toThrow(
      "invalid user agent override path",
    );
    expect(() =>
      updateUserAgentOverride(
        paths,
        outsidePath,
        agentMarkdown("scout", "Changed scout"),
      ),
    ).toThrow("invalid user agent override path");
    expect(readFileSync(outsidePath, "utf8")).toBe(original);
    expect(() => readUserAgentOverride(paths, linkedPath)).toThrow(
      "user agent override is missing, unreadable, or symlinked",
    );
    expect(() =>
      readUserAgentOverride(paths, join(paths.userAgentsDir, "missing.md")),
    ).toThrow("user agent override is missing, unreadable, or symlinked");
  });

  test("leaves an override unchanged when edited Markdown is invalid", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-override-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    const sourcePath = join(paths.userAgentsDir, "scout.md");
    const original = agentMarkdown("scout", "Original scout");
    writeFileSync(sourcePath, original);

    expect(() =>
      updateUserAgentOverride(
        paths,
        sourcePath,
        "---\nname: scout\ntools: read\n---\nInvalid\n",
      ),
    ).toThrow("missing required non-empty description");
    expect(readFileSync(sourcePath, "utf8")).toBe(original);
  });

  test("writes valid edited Markdown and returns the saved agent", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-override-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.userAgentsDir, { recursive: true });
    const sourcePath = join(paths.userAgentsDir, "scout.md");
    writeFileSync(sourcePath, agentMarkdown("scout", "Original scout"));
    const edited = agentMarkdown("RenamedScout", "Edited scout");

    const saved = updateUserAgentOverride(paths, sourcePath, edited);

    expect(saved).toMatchObject({
      name: "RenamedScout",
      description: "Edited scout",
      sourcePath,
    });
    expect(readFileSync(sourcePath, "utf8")).toBe(edited);
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
    expect(serializeAgent(createValidInput())).toBe(
      [
        "---",
        "name: Scout",
        "description: Scout files",
        "tools: bash, read",
        "thinking: medium",
        "subagent_agents: worker",
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
      serializeAgent(createValidInput()),
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

  test("exports bundled agent markdown to userAgentsDir and creates the directory if missing", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });
    writeFileSync(
      join(paths.bundledAgentsDir, "scout.md"),
      [
        "---",
        "name: Scout",
        "description: Scout files",
        "tools: read, bash",
        "---",
        "You are Scout.",
        "",
      ].join("\n"),
      "utf8",
    );

    const discovery = discoverAgents(paths);
    const exported = exportAgentToUserScope(paths, discovery, "Scout");

    expect(existsSync(paths.userAgentsDir)).toBe(true);
    expect(exported.sourcePath).toBe(join(paths.userAgentsDir, "scout.md"));
    expect(readFileSync(exported.sourcePath, "utf8")).toContain("You are Scout.");
  });

  test("disables an agent via a user-scope override and hides it from discovered agents", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });
    writeFileSync(
      join(paths.bundledAgentsDir, "scout.md"),
      [
        "---",
        "name: Scout",
        "description: Scout files",
        "tools: read, bash",
        "---",
        "You are Scout.",
        "",
      ].join("\n"),
      "utf8",
    );

    const before = discoverAgents(paths);
    expect(before.agents.map((agent) => agent.name)).toEqual(["Scout"]);

    const disabled = disableAgentInUserScope(paths, before, "Scout");
    expect(disabled.enabled).toBe(false);

    const after = discoverAgents(paths);
    expect(after.agents).toEqual([]);
  });

  test("deleting a user override restores the bundled agent", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    mkdirSync(paths.bundledAgentsDir, { recursive: true });
    writeFileSync(
      join(paths.bundledAgentsDir, "scout.md"),
      [
        "---",
        "name: Scout",
        "description: Scout files",
        "tools: read, bash",
        "---",
        "You are Scout.",
        "",
      ].join("\n"),
      "utf8",
    );

    disableAgentInUserScope(paths, discoverAgents(paths), "Scout");
    expect(discoverAgents(paths).agents).toEqual([]);

    deleteUserAgentOverride(paths, "Scout");
    expect(discoverAgents(paths).agents.map((agent) => agent.name)).toEqual(["Scout"]);
  });

  test("parses enabled: true", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "enabled: true",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { enabled: true },
    });
  });

  test("parses enabled: false", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "enabled: false",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { enabled: false },
    });
  });

  test("supports legacy disabled: true (backward compat)", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "disabled: true",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { enabled: false },
    });
  });

  test("omitting both enabled and disabled leaves enabled undefined", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { enabled: undefined },
    });
  });

  test("parses skills as comma-separated list", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "skills: tdd, writing-go",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { skills: ["tdd", "writing-go"] },
    });
  });

  test("parses skills: none as false", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "skills: none",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { skills: false },
    });
  });

  test("parses skills: all as true", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "skills: all",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { skills: true },
    });
  });

  test("parses empty skills as undefined (inherit all)", () => {
    const parsed = parseAgentContent(
      "/tmp/worker.md",
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools: read",
        "skills:",
        "---",
        "Do the work.",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      agent: { skills: undefined },
    });
  });

  test("serializeAgent serializes skills as comma-separated list", () => {
    const markdown = serializeAgent({
      description: "Does work",
      tools: ["read"],
      subagentAgents: [],
      skills: ["tdd", "writing-go"],
      systemPrompt: "Do work.",
    });

    expect(markdown).toContain("skills: tdd, writing-go");
  });

  test("serializeAgent serializes skills: none for false", () => {
    const markdown = serializeAgent({
      description: "Does work",
      tools: ["read"],
      subagentAgents: [],
      skills: false,
      systemPrompt: "Do work.",
    });

    expect(markdown).toContain("skills: none");
  });

  test("serializeAgent omits skills when undefined", () => {
    const markdown = serializeAgent({
      description: "Does work",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "Do work.",
    });

    expect(markdown).not.toContain("skills");
  });

  test("createAgentFile preserves skills field in the created agent", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pi-subagents-create-"));
    const paths = createPaths(rootDir);
    const discovery = { agents: [], diagnostics: [] };
    const toolNames = discoverToolNames([]);

    const created = createAgentFile(
      paths,
      createValidInput({
        name: "Planner",
        subagentAgents: [],
        skills: ["tdd", "writing-go"],
      }),
      discovery,
      toolNames,
    );

    expect(created.skills).toEqual(["tdd", "writing-go"]);
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
