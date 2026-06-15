import { describe, expect, test } from "vitest";
import {
  buildChildEnv,
  readContext,
  stripNestedEnv,
  validateDelegation,
} from "../src/core/nested-context.js";
import type {
  BuildChildEnvParams,
  NestedContextRuntimeDeps,
  NestedRuntimeContext,
} from "../src/core/nested-context.js";
import type {
  AgentDefinition,
  AgentDiscoveryResult,
  LoadedConfig,
  ResolvedPaths,
} from "../src/shared/types.js";

function createAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    name: "scout",
    description: "A scout agent",
    tools: ["bash", "read"],
    subagentAgents: [],
    systemPrompt: "",
    sourcePath: "/agents/scout.md",
    ...overrides,
  };
}

function createDiscovery(
  agents: AgentDefinition[] = [createAgent()],
): AgentDiscoveryResult {
  return { agents, diagnostics: [] };
}

function createContext(
  overrides: Partial<NestedRuntimeContext> = {},
): NestedRuntimeContext {
  return {
    isNestedChild: true,
    depth: 0,
    maxDepth: 3,
    parentPath: "",
    ...overrides,
  };
}

function createLoadedConfig(maxRecursiveLevel = 3): LoadedConfig {
  return {
    config: {
      maxConcurrency: 3,
      maxRecursiveLevel,
      defaultTimeoutMs: 600000,
    },
    exists: true,
  };
}

describe("readContext", () => {
  test("returns default context when no env vars are set", () => {
    const context = readContext(createLoadedConfig(), {});
    expect(context).toEqual({
      isNestedChild: false,
      currentRunId: undefined,
      depth: 0,
      maxDepth: 3,
      rootRunId: undefined,
      allowedAgents: undefined,
      parentPath: "",
    });
  });

  test("reads all env vars correctly when PI_SUBAGENT_CHILD=1 plus full env set", () => {
    const env = {
      PI_SUBAGENT_CHILD: "1",
      PI_SUBAGENT_RUN_ID: "run-abc",
      PI_SUBAGENT_DEPTH: "2",
      PI_SUBAGENT_MAX_DEPTH: "5",
      PI_SUBAGENT_ALLOWED_AGENTS: "scout,worker",
      PI_SUBAGENT_PARENT_ROOT_RUN_ID: "root-xyz",
      PI_SUBAGENT_PARENT_PATH: "root/child1",
    };
    const context = readContext(createLoadedConfig(), env);
    expect(context).toEqual({
      isNestedChild: true,
      currentRunId: "run-abc",
      depth: 2,
      maxDepth: 5,
      rootRunId: "root-xyz",
      allowedAgents: ["scout", "worker"],
      parentPath: "root/child1",
    });
  });

  test("handles malformed depth gracefully via fallback", () => {
    const env = { PI_SUBAGENT_DEPTH: "not-a-number" };
    const context = readContext(createLoadedConfig(), env);
    expect(context.depth).toBe(0);
  });

  test("parses allowed agents comma-separated list with trimming", () => {
    const env = { PI_SUBAGENT_ALLOWED_AGENTS: " scout , worker , reviewer " };
    const context = readContext(createLoadedConfig(), env);
    expect(context.allowedAgents).toEqual(["scout", "worker", "reviewer"]);
  });

  test("returns undefined for allowedAgents when env var is absent", () => {
    const context = readContext(createLoadedConfig(), {});
    expect(context.allowedAgents).toBeUndefined();
  });

  test("returns empty array for allowedAgents when env var is empty string", () => {
    const env = { PI_SUBAGENT_ALLOWED_AGENTS: "" };
    const context = readContext(createLoadedConfig(), env);
    expect(context.allowedAgents).toEqual([]);
  });

  test("uses loadedConfig.config.maxRecursiveLevel as fallback for max depth", () => {
    const context = readContext(createLoadedConfig(7), {});
    expect(context.maxDepth).toBe(7);
  });
});

describe("validateDelegation", () => {
  test("no-op when context.isNestedChild is false", () => {
    const context = createContext({ isNestedChild: false });
    expect(() =>
      validateDelegation(createDiscovery(), { agent: "scout", task: "go" }, context),
    ).not.toThrow();
  });

  test("throws when depth >= maxDepth", () => {
    const context = createContext({ depth: 3, maxDepth: 3 });
    expect(() =>
      validateDelegation(createDiscovery(), { agent: "scout", task: "go" }, context),
    ).toThrow(/depth 3.*maxRecursiveLevel=3/);
  });

  test("throws when allowedAgents is empty array", () => {
    const context = createContext({ allowedAgents: [] });
    expect(() =>
      validateDelegation(createDiscovery(), { agent: "scout", task: "go" }, context),
    ).toThrow(/disabled.*Allowed child agents: none/);
  });

  test("throws when requested agent is not in allowlist", () => {
    const context = createContext({ allowedAgents: ["worker"] });
    expect(() =>
      validateDelegation(createDiscovery(), { agent: "scout", task: "go" }, context),
    ).toThrow(/scout.*not allowed.*worker/i);
  });

  test("passes when requested agent matches allowlist entry (case-insensitive)", () => {
    const context = createContext({ allowedAgents: ["Scout"] });
    expect(() =>
      validateDelegation(createDiscovery(), { agent: "scout", task: "go" }, context),
    ).not.toThrow();
  });

  test("error messages include requested agent name and available agents list", () => {
    const agents = [createAgent({ name: "scout" }), createAgent({ name: "worker" })];
    const context = createContext({ allowedAgents: ["reviewer"] });
    expect(() =>
      validateDelegation(createDiscovery(agents), { agent: "planner", task: "go" }, context),
    ).toThrow(/planner.*scout, worker/);
  });
});

const ALL_PI_SUBAGENT_KEYS = [
  "PI_SUBAGENT_CHILD",
  "PI_SUBAGENT_FANOUT_CHILD",
  "PI_SUBAGENT_RUN_ID",
  "PI_SUBAGENT_DEPTH",
  "PI_SUBAGENT_MAX_DEPTH",
  "PI_SUBAGENT_ALLOWED_AGENTS",
  "PI_SUBAGENT_RUNTIME_STATE",
  "PI_SUBAGENT_PARENT_EVENT_SINK",
  "PI_SUBAGENT_PARENT_CONTROL_INBOX",
  "PI_SUBAGENT_PARENT_ROOT_RUN_ID",
  "PI_SUBAGENT_PARENT_RUN_ID",
  "PI_SUBAGENT_PARENT_CHILD_INDEX",
  "PI_SUBAGENT_PARENT_DEPTH",
  "PI_SUBAGENT_PARENT_PATH",
  "PI_SUBAGENT_PARENT_CAPABILITY_TOKEN",
] as const;

describe("stripNestedEnv", () => {
  test("removes all 15 PI_SUBAGENT_* keys from env dict", () => {
    const env: NodeJS.ProcessEnv = { HOME: "/home/user" };
    for (const key of ALL_PI_SUBAGENT_KEYS) {
      env[key] = "value";
    }
    const stripped = stripNestedEnv(env);
    for (const key of ALL_PI_SUBAGENT_KEYS) {
      expect(stripped).not.toHaveProperty(key);
    }
  });

  test("preserves all non-PI_SUBAGENT_* keys", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/home/user",
      PATH: "/usr/bin",
      NODE_ENV: "test",
      PI_SUBAGENT_CHILD: "1",
    };
    const stripped = stripNestedEnv(env);
    expect(stripped.HOME).toBe("/home/user");
    expect(stripped.PATH).toBe("/usr/bin");
    expect(stripped.NODE_ENV).toBe("test");
  });

  test("returns a new object (does not mutate input)", () => {
    const env: NodeJS.ProcessEnv = {
      PI_SUBAGENT_CHILD: "1",
      HOME: "/home/user",
    };
    const stripped = stripNestedEnv(env);
    expect(stripped).not.toBe(env);
    expect(env.PI_SUBAGENT_CHILD).toBe("1");
  });

  test("works correctly when none of the keys are present", () => {
    const env: NodeJS.ProcessEnv = { HOME: "/home/user", PATH: "/usr/bin" };
    const stripped = stripNestedEnv(env);
    expect(stripped).toEqual({ HOME: "/home/user", PATH: "/usr/bin" });
  });
});

function createPaths(): ResolvedPaths {
  return {
    agentDir: "/pi/agents",
    configPath: "/pi/config.json",
    userAgentsDir: "/home/user/.pi/agents",
    bundledAgentsDir: "/pi/agents/bundled",
    sessionsDir: "/pi/sessions",
  };
}

function createRuntime(): NestedContextRuntimeDeps & {
  calls: { method: string; args: unknown[] }[];
  capabilityTokens: string[];
} {
  let tokenIndex = 0;
  const calls: { method: string; args: unknown[] }[] = [];
  const capabilityTokens = ["cap-token-1", "cap-token-2"];
  return {
    calls,
    capabilityTokens,
    createRunId: () => {
      const token = capabilityTokens[tokenIndex] ?? `cap-token-${tokenIndex}`;
      tokenIndex++;
      return token;
    },
    writeFile: (path: string, content: string) => {
      calls.push({ method: "writeFile", args: [path, content] });
    },
    mkdirp: (path: string) => {
      calls.push({ method: "mkdirp", args: [path] });
    },
  };
}

function createBuildParams(
  overrides: Partial<BuildChildEnvParams> = {},
): BuildChildEnvParams {
  return {
    agent: createAgent({ subagentAgents: ["scout", "worker"] }),
    context: createContext({ depth: 1, maxDepth: 3, currentRunId: "parent-run" }),
    childRunId: "child-run-1",
    paths: createPaths(),
    cwd: "/repo",
    runtime: createRuntime(),
    baseEnv: { HOME: "/home/user" },
    ...overrides,
  };
}

describe("buildChildEnv", () => {
  test("returned env contains all 15 expected PI_SUBAGENT_* keys", () => {
    const { env } = buildChildEnv(createBuildParams());
    for (const key of ALL_PI_SUBAGENT_KEYS) {
      expect(env).toHaveProperty(key);
    }
  });

  test("returned env includes base env keys", () => {
    const { env } = buildChildEnv(createBuildParams());
    expect(env.HOME).toBe("/home/user");
  });

  test("returned env has correct PI_SUBAGENT_* values", () => {
    const params = createBuildParams();
    const { env } = buildChildEnv(params);
    expect(env.PI_SUBAGENT_CHILD).toBe("1");
    expect(env.PI_SUBAGENT_FANOUT_CHILD).toBe("1");
    expect(env.PI_SUBAGENT_RUN_ID).toBe("child-run-1");
    expect(env.PI_SUBAGENT_DEPTH).toBe("2");
    expect(env.PI_SUBAGENT_MAX_DEPTH).toBe("3");
    expect(env.PI_SUBAGENT_ALLOWED_AGENTS).toBe("scout,worker");
  });

  test("routeDir follows nestedEventsDir/{rootRunId}-{capabilityToken} pattern", () => {
    const params = createBuildParams({
      context: createContext({ depth: 0, rootRunId: "root-abc", currentRunId: "parent-run" }),
    });
    const { routeDir } = buildChildEnv(params);
    expect(routeDir).toMatch(/nested-subagent-events\/root-abc-cap-token-1$/);
  });

  test("calls runtime.mkdirp for route dir and runtime state dir", () => {
    const runtime = createRuntime();
    buildChildEnv(createBuildParams({ runtime }));
    const mkdirpCalls = runtime.calls
      .filter((c) => c.method === "mkdirp")
      .map((c) => c.args[0] as string);
    expect(mkdirpCalls).toHaveLength(2);
    expect(mkdirpCalls[0]).toContain("nested-subagent-events");
    expect(mkdirpCalls[1]).toContain("nested-subagent-runs");
  });

  test("calls runtime.writeFile for route.json and runtime.json", () => {
    const runtime = createRuntime();
    buildChildEnv(createBuildParams({ runtime }));
    const writeFileCalls = runtime.calls
      .filter((c) => c.method === "writeFile")
      .map((c) => c.args[0] as string);
    expect(writeFileCalls).toHaveLength(2);
    expect(writeFileCalls[0]).toContain("route.json");
    expect(writeFileCalls[1]).toContain("runtime.json");
  });

  test("route.json content includes expected fields", () => {
    const runtime = createRuntime();
    buildChildEnv(createBuildParams({ runtime }));
    const routeWrite = runtime.calls.find(
      (c) => c.method === "writeFile" && (c.args[0] as string).includes("route.json"),
    );
    const content = JSON.parse(routeWrite?.args[1] as string);
    expect(content).toHaveProperty("rootRunId");
    expect(content).toHaveProperty("parentRunId");
    expect(content).toHaveProperty("childRunId", "child-run-1");
    expect(content).toHaveProperty("capabilityToken");
  });

  test("runtime.json content includes expected fields", () => {
    const runtime = createRuntime();
    buildChildEnv(createBuildParams({ runtime }));
    const runtimeWrite = runtime.calls.find(
      (c) => c.method === "writeFile" && (c.args[0] as string).includes("runtime.json"),
    );
    const content = JSON.parse(runtimeWrite?.args[1] as string);
    expect(content).toHaveProperty("runId", "child-run-1");
    expect(content).toHaveProperty("depth", 2);
    expect(content).toHaveProperty("maxDepth", 3);
    expect(content).toHaveProperty("allowedAgents", ["scout", "worker"]);
  });

  test("childDepth is context.depth + 1", () => {
    const params = createBuildParams({
      context: createContext({ depth: 4, maxDepth: 10, currentRunId: "p" }),
    });
    const { env } = buildChildEnv(params);
    expect(env.PI_SUBAGENT_DEPTH).toBe("5");
  });

  test("rootRunId uses context.rootRunId when present, falls back to childRunId", () => {
    const withRoot = createBuildParams({
      context: createContext({ rootRunId: "existing-root", currentRunId: "p" }),
    });
    expect(buildChildEnv(withRoot).env.PI_SUBAGENT_PARENT_ROOT_RUN_ID).toBe(
      "existing-root",
    );

    const withoutRoot = createBuildParams({
      context: createContext({ rootRunId: undefined, currentRunId: "p" }),
      childRunId: "new-child",
    });
    expect(buildChildEnv(withoutRoot).env.PI_SUBAGENT_PARENT_ROOT_RUN_ID).toBe(
      "new-child",
    );
  });

  test("parentPath appends context.currentRunId to context.parentPath", () => {
    const params = createBuildParams({
      context: createContext({ parentPath: "a/b", currentRunId: "c" }),
    });
    expect(buildChildEnv(params).env.PI_SUBAGENT_PARENT_PATH).toBe("a/b/c");
  });

  test("parentPath uses context.parentPath when currentRunId is absent", () => {
    const params = createBuildParams({
      context: createContext({ parentPath: "a/b", currentRunId: undefined }),
    });
    expect(buildChildEnv(params).env.PI_SUBAGENT_PARENT_PATH).toBe("a/b");
  });
});
