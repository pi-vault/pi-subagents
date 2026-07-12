import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverPromptWorkflows,
  substituteArgs,
  shellWords,
  parseRuntimeOptions,
} from "../src/core/prompt-workflows.js";
import type { ResolvedPaths } from "../src/shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;
function makeTmpDir(): string {
  const dir = join(tmpdir(), `pi-pw-test-${Date.now()}-${_seq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makePaths(userPromptsDir: string, bundledPromptsDir: string): ResolvedPaths {
  return {
    agentDir: "/fake",
    configPath: "/fake/config.json",
    userAgentsDir: "/fake/agents",
    bundledAgentsDir: "/fake/bundled-agents",
    sessionsDir: "/fake/sessions",
    userChainsDir: "/fake/chains",
    bundledChainsDir: "/fake/bundled-chains",
    userPromptsDir,
    bundledPromptsDir,
  };
}

// ---------------------------------------------------------------------------
// discoverPromptWorkflows
// ---------------------------------------------------------------------------

describe("discoverPromptWorkflows", () => {
  test("discovers .md files from directory", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "analyze.md"), "---\ndescription: Analyze the code\n---\nAnalyze this.");
      const paths = makePaths("/nonexistent", dir);
      const workflows = discoverPromptWorkflows(paths);
      expect(workflows).toHaveLength(1);
      expect(workflows[0]?.name).toBe("analyze");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("parses frontmatter fields correctly", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        join(dir, "fix.md"),
        "---\ndescription: Fix the bug\nsubagent: delegate\nmodel: anthropic/claude-sonnet-4-5\n---\nFix it.",
      );
      const paths = makePaths("/nonexistent", dir);
      const [wf] = discoverPromptWorkflows(paths);
      expect(wf?.description).toBe("Fix the bug");
      expect(wf?.agent).toBe("delegate");
      expect(wf?.model).toBe("anthropic/claude-sonnet-4-5");
      expect(wf?.body).toBe("Fix it.");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("user workflows override bundled workflows by name", () => {
    const bundled = makeTmpDir();
    const user = makeTmpDir();
    try {
      writeFileSync(join(bundled, "analyze.md"), "---\ndescription: Bundled\n---\nBundled body.");
      writeFileSync(join(user, "analyze.md"), "---\ndescription: User\n---\nUser body.");
      const paths = makePaths(user, bundled);
      const workflows = discoverPromptWorkflows(paths);
      expect(workflows).toHaveLength(1);
      expect(workflows[0]?.description).toBe("User");
    } finally {
      rmSync(bundled, { recursive: true });
      rmSync(user, { recursive: true });
    }
  });

  test("returns empty array for nonexistent directories", () => {
    const paths = makePaths("/nonexistent-user", "/nonexistent-bundled");
    expect(discoverPromptWorkflows(paths)).toEqual([]);
  });

  test("filters out reserved command names", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "chain-prompts.md"), "---\ndescription: Reserved\n---\nBody.");
      writeFileSync(join(dir, "prompt-workflow.md"), "---\ndescription: Reserved\n---\nBody.");
      writeFileSync(join(dir, "legit.md"), "---\ndescription: Legit\n---\nBody.");
      const paths = makePaths("/nonexistent", dir);
      const workflows = discoverPromptWorkflows(paths);
      expect(workflows).toHaveLength(1);
      expect(workflows[0]?.name).toBe("legit");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("uses first non-empty body line as description when frontmatter has none", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "nodesc.md"), "---\nsubagent: delegate\n---\nFix the thing.");
      const paths = makePaths("/nonexistent", dir);
      const [wf] = discoverPromptWorkflows(paths);
      expect(wf?.description).toBe("Fix the thing.");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// substituteArgs
// ---------------------------------------------------------------------------

describe("substituteArgs", () => {
  test("replaces $1 with first arg", () => {
    expect(substituteArgs("Fix $1", ["auth-module"])).toBe("Fix auth-module");
  });

  test("replaces $ARGUMENTS with all args joined", () => {
    expect(substituteArgs("Analyze $ARGUMENTS", ["foo", "bar"])).toBe("Analyze foo bar");
  });

  test("replaces $@ with all args joined", () => {
    expect(substituteArgs("Run $@", ["a", "b", "c"])).toBe("Run a b c");
  });

  test("replaces ${N:-fallback} with arg when present", () => {
    expect(substituteArgs("Fix ${1:-default}", ["actual"])).toBe("Fix actual");
  });

  test("uses fallback when arg is absent", () => {
    expect(substituteArgs("Fix ${1:-default}", [])).toBe("Fix default");
  });

  test("leaves unmatched $N as empty string", () => {
    expect(substituteArgs("Fix $3", ["a"])).toBe("Fix ");
  });

  test("handles body with no substitutions", () => {
    expect(substituteArgs("No substitutions here", [])).toBe("No substitutions here");
  });
});

// ---------------------------------------------------------------------------
// shellWords
// ---------------------------------------------------------------------------

describe("shellWords", () => {
  test("splits simple words", () => {
    expect(shellWords("hello world")).toEqual(["hello", "world"]);
  });

  test("preserves double-quoted strings", () => {
    expect(shellWords('fix "the bug" now')).toEqual(["fix", "the bug", "now"]);
  });

  test("preserves single-quoted strings", () => {
    expect(shellWords("run 'my task' done")).toEqual(["run", "my task", "done"]);
  });

  test("handles empty input", () => {
    expect(shellWords("")).toEqual([]);
  });

  test("collapses multiple spaces", () => {
    expect(shellWords("a   b    c")).toEqual(["a", "b", "c"]);
  });

  test("handles mixed quotes", () => {
    expect(shellWords(`"hello world" 'foo bar'`)).toEqual(["hello world", "foo bar"]);
  });
});

// ---------------------------------------------------------------------------
// parseRuntimeOptions
// ---------------------------------------------------------------------------

describe("parseRuntimeOptions", () => {
  test("extracts --bg flag", () => {
    const { args, bg } = parseRuntimeOptions(["task", "--bg"]);
    expect(args).toEqual(["task"]);
    expect(bg).toBe(true);
  });

  test("extracts --async flag", () => {
    const { bg } = parseRuntimeOptions(["--async"]);
    expect(bg).toBe(true);
  });

  test("extracts --subagent override with space", () => {
    const { args, agentOverride } = parseRuntimeOptions(["task", "--subagent", "myagent"]);
    expect(args).toEqual(["task"]);
    expect(agentOverride).toBe("myagent");
  });

  test("extracts --subagent= override", () => {
    const { agentOverride } = parseRuntimeOptions(["--subagent=myagent"]);
    expect(agentOverride).toBe("myagent");
  });

  test("extracts --subagent: override", () => {
    const { agentOverride } = parseRuntimeOptions(["--subagent:myagent"]);
    expect(agentOverride).toBe("myagent");
  });

  test("passes through remaining args", () => {
    const { args } = parseRuntimeOptions(["a", "b", "c"]);
    expect(args).toEqual(["a", "b", "c"]);
  });

  test("returns defaults when no flags", () => {
    const result = parseRuntimeOptions([]);
    expect(result).toEqual({ args: [], agentOverride: undefined, bg: false });
  });
});
