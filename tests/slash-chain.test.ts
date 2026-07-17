import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { AgentManager } from "../src/core/agent-manager.js";
import {
  executeSlashChain,
  parseSingleTaskToken,
  parseGroupSegment,
  parseChainExpression,
  stripExecutionFlags,
  SlashParseError,
  registerChainCommands,
} from "../src/core/slash-chain.js";
import { createAgent, createDeps, createDiscovery } from "./_test-helpers.js";

describe("stripExecutionFlags", () => {
  test("strips --bg flag and reports bg=true", () => {
    const { args, bg } = stripExecutionFlags('scout "task" --bg');
    expect(args).toBe('scout "task"');
    expect(bg).toBe(true);
  });

  test("strips --fork flag and reports bg=false", () => {
    const { args, bg } = stripExecutionFlags('scout "task" --fork');
    expect(args).toBe('scout "task"');
    expect(bg).toBe(false);
  });

  test("strips both flags, bg=true", () => {
    const { args, bg } = stripExecutionFlags('scout "task" --bg --fork');
    expect(args).toBe('scout "task"');
    expect(bg).toBe(true);
  });

  test("returns bg=false when no flags", () => {
    const { args, bg } = stripExecutionFlags('scout "task"');
    expect(args).toBe('scout "task"');
    expect(bg).toBe(false);
  });

  test("handles lone --bg", () => {
    const { args, bg } = stripExecutionFlags("--bg");
    expect(args).toBe("");
    expect(bg).toBe(true);
  });
});

describe("/run-chain definition materialization", () => {
  test("reports an invalid saved schema path before execution", async () => {
    const dir = join("/tmp", `slash-chain-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "saved.chain.json"), JSON.stringify({
      name: "saved",
      description: "saved",
      chain: [{ agent: "Scout", outputSchema: "missing.json" }],
    }));
    const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
    const pi = {
      registerCommand: (name: string, command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => commands.set(name, command),
      sendMessage: vi.fn(),
    } as unknown as ExtensionAPI;
    const notify = vi.fn();
    const deps = createDeps({
      resolvePaths: () => ({
        agentDir: dir,
        configPath: join(dir, "config.json"),
        userAgentsDir: join(dir, "agents"),
        bundledAgentsDir: join(dir, "bundled-agents"),
        sessionsDir: join(dir, "sessions"),
        userChainsDir: dir,
        bundledChainsDir: join(dir, "bundled-chains"),
        userPromptsDir: join(dir, "prompts"),
        bundledPromptsDir: join(dir, "bundled-prompts"),
      }),
    });
    registerChainCommands(pi, deps);
    const command = commands.get("run-chain");
    if (!command) throw new Error("run-chain was not registered");

    try {
      await command.handler("saved -- task", {
        cwd: dir,
        ui: { notify },
      } as unknown as ExtensionCommandContext);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("unable to read schema"), "error");
      expect(pi.sendMessage).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("executeSlashChain validation", () => {
  test("rejects an unknown Agent without spawning", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(123456789);
    const manager = new AgentManager();
    const spawn = vi.spyOn(manager, "spawnAndWait");
    const messages: Array<{ content: string }> = [];
    const pi = { sendMessage: (message: { content: string }) => messages.push(message) };
    const deps = createDeps({
      discoverAgents: () => createDiscovery([createAgent()]),
      manager,
    });

    await executeSlashChain(
      pi as unknown as ExtensionAPI,
      { cwd: "/tmp" } as ExtensionCommandContext,
      deps,
      [{ agent: "Missing", task: "work" }],
      "work",
      false,
      true,
    );

    expect(messages[0]?.content).toContain('Unknown agent: "Missing"');
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(join(tmpdir(), "pi-subagents-chain-runs", "chain-21i3v9"))).toBe(false);
    now.mockRestore();
  });
});

describe("parseSingleTaskToken", () => {
  test("parses a quoted task", () => {
    const parsed = parseSingleTaskToken('reviewer "review auth module"');
    expect(parsed.kind).toBe("step");
    expect(parsed.name).toBe("reviewer");
    expect(parsed.task).toBe("review auth module");
  });

  test("parses single-quoted task", () => {
    const parsed = parseSingleTaskToken("reviewer 'review auth module'");
    expect(parsed.name).toBe("reviewer");
    expect(parsed.task).toBe("review auth module");
  });

  test("parses an agent with inline config and no task", () => {
    const parsed = parseSingleTaskToken(
      "scout[output=ctx.md,outputMode=file-only]",
    );
    expect(parsed.name).toBe("scout");
    expect(parsed.config.output).toBe("ctx.md");
    expect(parsed.config.outputMode).toBe("file-only");
    expect(parsed.task).toBeUndefined();
  });

  test("parses a task via -- delimiter", () => {
    const parsed = parseSingleTaskToken("reviewer -- Review {previous}");
    expect(parsed.name).toBe("reviewer");
    expect(parsed.task).toBe("Review {previous}");
  });

  test("parses agent with no task", () => {
    const parsed = parseSingleTaskToken("scout");
    expect(parsed.name).toBe("scout");
    expect(parsed.task).toBeUndefined();
  });

  test("parses extended metadata in inline config", () => {
    const parsed = parseSingleTaskToken(
      'reviewer[as=rev,label=Review,phase=p1,cwd=sub,count=3] "task"',
    );
    expect(parsed.config.as).toBe("rev");
    expect(parsed.config.label).toBe("Review");
    expect(parsed.config.phase).toBe("p1");
    expect(parsed.config.cwd).toBe("sub");
    expect(parsed.config.count).toBe(3);
    expect(parsed.task).toBe("task");
  });

  test("parses progress boolean flag", () => {
    const parsed = parseSingleTaskToken("scout[progress]");
    expect(parsed.config.progress).toBe(true);
  });

  test("parses reads config", () => {
    const parsed = parseSingleTaskToken("scout[reads=a.md+b.md]");
    expect(parsed.config.reads).toEqual(["a.md", "b.md"]);
  });

  test("parses reads=false", () => {
    const parsed = parseSingleTaskToken("scout[reads=false]");
    expect(parsed.config.reads).toBe(false);
  });

  test("parses skills config", () => {
    const parsed = parseSingleTaskToken("scout[skills=lint+test]");
    expect(parsed.config.skills).toEqual(["lint", "test"]);
  });

  test("parses skills=false", () => {
    const parsed = parseSingleTaskToken("scout[skills=false]");
    expect(parsed.config.skills).toBe(false);
  });

  test("ignores a non-positive count", () => {
    expect(parseSingleTaskToken("scout[count=0]").config.count).toBeUndefined();
    expect(parseSingleTaskToken("scout[count=x]").config.count).toBeUndefined();
  });
});

describe("parseGroupSegment", () => {
  test("parses a parallel group with two quoted tasks", () => {
    const parsed = parseGroupSegment('(reviewer "A" | reviewer "B")');
    expect(parsed.kind).toBe("group");
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0]!.name).toBe("reviewer");
    expect(parsed.tasks[0]!.task).toBe("A");
    expect(parsed.tasks[1]!.task).toBe("B");
  });

  test("rejects groups with a single task", () => {
    expect(() => parseGroupSegment('(reviewer "A")')).toThrow(SlashParseError);
  });

  test("rejects groups with unbalanced parentheses", () => {
    expect(() => parseGroupSegment('(reviewer "A"')).toThrow(SlashParseError);
  });

  test("parses a trailing group-options suffix", () => {
    const parsed = parseGroupSegment(
      '(reviewer "A" | reviewer "B")[concurrency=2,failFast,worktree]',
    );
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.config.concurrency).toBe(2);
    expect(parsed.config.failFast).toBe(true);
    expect(parsed.config.worktree).toBe(true);
  });

  test("defaults to empty group config without a suffix", () => {
    expect(parseGroupSegment('(a "x" | b "y")').config).toEqual({});
  });

  test("rejects a non-bracketed group suffix", () => {
    expect(() =>
      parseGroupSegment('(a "x" | b "y") concurrency=2'),
    ).toThrow(SlashParseError);
  });
});

describe("parseChainExpression", () => {
  test("parses sequential + group + sequential", () => {
    const expression = parseChainExpression(
      'scout "scan" -> (reviewer "A" | reviewer "B") -> writer "fix"',
    );
    expect(expression.steps).toHaveLength(3);
    expect(expression.steps[0]!.kind).toBe("step");
    expect(expression.steps[1]!.kind).toBe("group");
    if (expression.steps[1]!.kind === "group") {
      expect(expression.steps[1]!.tasks).toHaveLength(2);
    }
    if (expression.steps[0]!.kind === "step") {
      expect(expression.steps[0]!.name).toBe("scout");
    }
    if (expression.steps[2]!.kind === "step") {
      expect(expression.steps[2]!.name).toBe("writer");
    }
  });

  test("rejects expression without arrows", () => {
    expect(() =>
      parseChainExpression('(reviewer "A" | reviewer "B")'),
    ).toThrow(SlashParseError);
  });

  test("rejects groups with one task", () => {
    expect(() =>
      parseChainExpression('scout "scan" -> (reviewer "A")'),
    ).toThrow(SlashParseError);
  });

  test("respects quotes when splitting on arrows", () => {
    const expression = parseChainExpression(
      'scout "scan -> quick" -> reviewer "Review"',
    );
    expect(expression.steps).toHaveLength(2);
    if (expression.steps[0]!.kind === "step") {
      expect(expression.steps[0]!.task).toBe("scan -> quick");
    }
  });

  test("allows balanced parens in a -- task after a group", () => {
    const expression = parseChainExpression(
      'scout "scan" -> (reviewer "A" | reviewer "B") -> writer -- fix (backend)',
    );
    expect(expression.steps).toHaveLength(3);
  });

  test("rejects truly unmatched parens", () => {
    expect(() =>
      parseChainExpression(
        'scout "scan" -> (reviewer "A" | reviewer "B") -> writer -- fix (backend',
      ),
    ).toThrow(SlashParseError);
  });
});

import { buildChainSteps } from "../src/core/slash-chain.js";
import type { AgentDefinition } from "../src/shared/types.js";

// Minimal agent stubs for testing
const stubAgent = (name: string): AgentDefinition =>
  ({
    name,
    description: name,
    sourcePath: `/fake/${name}.md`,
    scope: "project" as const,
    systemPrompt: "",
  }) as unknown as AgentDefinition;

const AGENTS = [stubAgent("scout"), stubAgent("reviewer"), stubAgent("writer")];

describe("buildChainSteps", () => {
  test("builds a linear chain with per-step tasks", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> reviewer "review"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    expect(result!.chain).toHaveLength(2);
    expect(result!.chain[0]).toHaveProperty("agent", "scout");
    expect(result!.chain[1]).toHaveProperty("agent", "reviewer");
    expect(result!.task).toBe("scan");
  });

  test("builds a chain with a parallel group", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer "A" | reviewer "B") -> writer "fix"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    expect(result!.chain).toHaveLength(3);
    const group = result!.chain[1]!;
    expect(group).toHaveProperty("parallel");
    if ("parallel" in group) {
      expect(group.parallel).toHaveLength(2);
    }
  });

  test("rejects unknown agent", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'ghost "scan" -> reviewer "review"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatch(/ghost/i);
  });

  test("rejects chain where first step has no task", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      "scout -> reviewer",
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications.some((m) => /task/i.test(m))).toBe(true);
  });

  test("rejects parallel group tasks without individual tasks", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer | writer)',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications).toHaveLength(1);
  });

  test("propagates inline metadata onto chain steps", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout[as=ctx,label=Scan,phase=recon] "scan" -> reviewer "review"',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    const first = result!.chain[0] as unknown as Record<string, unknown>;
    expect(first.as).toBe("ctx");
    expect(first.label).toBe("Scan");
    expect(first.phase).toBe("recon");
  });

  test("applies count only inside a parallel group", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout[count=2] "scan" -> (reviewer[count=3] "A" | writer "B")',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    // sequential first step: count not applied
    expect((result!.chain[0] as unknown as Record<string, unknown>).count).toBeUndefined();
    const parallel = (result!.chain[1] as unknown as { parallel: Array<Record<string, unknown>> }).parallel;
    expect(parallel[0]?.count).toBe(3);
    expect(parallel[1]?.count).toBeUndefined();
  });

  test("propagates group-level options onto the parallel step", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer "A" | writer "B")[concurrency=2,failFast]',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).not.toBeNull();
    expect(notifications).toEqual([]);
    const group = result!.chain[1] as unknown as Record<string, unknown>;
    expect(group.concurrency).toBe(2);
    expect(group.failFast).toBe(true);
    expect(group.worktree).toBeUndefined();
  });

  test("handles single-step parse error gracefully", () => {
    const notifications: string[] = [];
    const result = buildChainSteps(
      'scout "scan" -> (reviewer "A")',
      AGENTS,
      (msg) => notifications.push(msg),
    );
    expect(result).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatch(/at least two/i);
  });
});
