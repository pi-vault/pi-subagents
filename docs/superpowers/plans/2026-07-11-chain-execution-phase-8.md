# Chain Execution — Phase 8: Slash Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/chain` and `/run-chain` slash commands with an inline chain expression parser (`src/core/slash-chain.ts`).

**Architecture:** `/chain` parses an inline expression (`scout "task" -> planner`) into steps and executes. `/run-chain` looks up a saved chain by name from discovery and executes it with a provided task. Both support `--bg` and `--fork` flags.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 5 (discoverChains), Phase 6 (executeChain).

---

### Task 9: Add `/chain` and `/run-chain` commands

**Files:**

- Modify: `src/index.ts`
- Create: `src/core/slash-chain.ts` (chain expression parser)
- Test: `tests/slash-chain.test.ts`

- [ ] **Step 1: Write failing tests for chain expression parser**

Create `tests/slash-chain.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { parseChainExpression } from "../src/core/slash-chain.js";

describe("parseChainExpression", () => {
  test("parses simple sequential chain", () => {
    const result = parseChainExpression(
      'scout "scan code" -> planner "make plan"',
    );
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toEqual({ agent: "scout", task: "scan code" });
    expect(result.steps[1]).toEqual({ agent: "planner", task: "make plan" });
  });

  test("parses parallel group", () => {
    const result = parseChainExpression(
      'scout "scan" -> (reviewer "auth" | reviewer "db") -> worker "fix"',
    );
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1]).toHaveProperty("parallel");
    const parallel = (result.steps[1] as { parallel: unknown[] }).parallel;
    expect(parallel).toHaveLength(2);
  });

  test("parses agent without quoted task", () => {
    const result = parseChainExpression("scout scan -> planner");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toEqual({ agent: "scout", task: "scan" });
  });

  test("handles single step (no arrow)", () => {
    const result = parseChainExpression('scout "just one step"');
    expect(result.steps).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `slash-chain.ts`**

Create `src/core/slash-chain.ts`:

```typescript
import type {
  ChainStep,
  SequentialStep,
  ParallelStep,
} from "../shared/types.js";

interface ParsedTask {
  agent: string;
  task?: string;
}

function parseTask(raw: string): ParsedTask {
  const trimmed = raw.trim();
  // Match: agent "task" or agent 'task' or agent task
  const quotedMatch = trimmed.match(/^(\S+)\s+["'](.+?)["']$/);
  if (quotedMatch) {
    return { agent: quotedMatch[1]!, task: quotedMatch[2]! };
  }
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { agent: trimmed };
  return {
    agent: trimmed.slice(0, spaceIdx),
    task: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export function parseChainExpression(input: string): {
  steps: ChainStep[];
  task?: string;
} {
  const segments = input.split(" -> ").map((s) => s.trim());
  const steps: ChainStep[] = [];

  for (const segment of segments) {
    // Check for parallel group: (agent1 "task" | agent2 "task")
    if (segment.startsWith("(") && segment.endsWith(")")) {
      const inner = segment.slice(1, -1);
      const items = inner.split(" | ").map((s) => parseTask(s.trim()));
      const parallel: ParallelStep = {
        parallel: items.map((item) => ({
          agent: item.agent,
          ...(item.task ? { task: item.task } : {}),
        })),
      };
      steps.push(parallel);
    } else {
      const parsed = parseTask(segment);
      const step: SequentialStep = {
        agent: parsed.agent,
        ...(parsed.task ? { task: parsed.task } : {}),
      };
      steps.push(step);
    }
  }

  // Extract task from first step for the chain's {task} variable
  const firstStep = steps[0] as SequentialStep | undefined;
  return { steps, task: firstStep?.task };
}

export function extractExecutionFlags(args: string): {
  args: string;
  bg: boolean;
  fork: boolean;
} {
  let bg = false;
  let fork = false;
  let cleaned = args;
  if (cleaned.includes("--bg")) {
    bg = true;
    cleaned = cleaned.replace(/--bg/g, "").trim();
  }
  if (cleaned.includes("--fork")) {
    fork = true;
    cleaned = cleaned.replace(/--fork/g, "").trim();
  }
  return { args: cleaned, bg, fork };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/slash-chain.test.ts`
Expected: PASS

- [ ] **Step 5: Register `/chain` and `/run-chain` commands in `src/index.ts`**

Add imports and command registrations in `registerSubagentsExtension()`:

```typescript
import {
  parseChainExpression,
  extractExecutionFlags,
} from "./core/slash-chain.js";
import { discoverChains } from "./core/agents.js";
import { executeChain } from "./core/chain-execution.js";

// Inside registerSubagentsExtension(), after the agents command registration:
pi.registerCommand("chain", {
  description:
    'Run agents in sequence: /chain scout "task" -> planner [--bg] [--fork]',
  handler: async (args, ctx) => {
    const { args: cleanedArgs, bg } = extractExecutionFlags(args);
    const parsed = parseChainExpression(cleanedArgs);
    if (parsed.steps.length === 0) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: "No steps parsed.",
        display: true,
      });
      return;
    }
    // Execute via the subagent tool's chain mode
    const paths = deps.resolvePaths();
    const discovery = deps.discoverAgents(paths);
    const result = await executeChain({
      steps: parsed.steps,
      task: parsed.task ?? "",
      spawnAndWait: async (agentDef, prompt, stepCwd) => {
        return deps.manager.spawnAndWait(ctx, agentDef, {
          prompt,
          cwd: stepCwd || ctx.cwd,
          maxTurns: deps.loadConfig(paths).config.defaultMaxTurns,
        });
      },
      findAgent: (name) => {
        const agent = discovery.agents.find(
          (a) => a.name.toLowerCase() === name.toLowerCase(),
        );
        if (!agent) throw new Error(`Unknown agent: "${name}"`);
        return agent;
      },
      cwd: ctx.cwd,
      runId: `chain-${Date.now().toString(36)}`,
    });
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: result.content,
      display: true,
    });
  },
});

pi.registerCommand("run-chain", {
  description:
    "Run a saved chain: /run-chain chainName -- task [--bg] [--fork]",
  handler: async (args, ctx) => {
    const { args: cleanedArgs, bg } = extractExecutionFlags(args);
    const delimiterIndex = cleanedArgs.indexOf(" -- ");
    if (delimiterIndex === -1) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: "Usage: /run-chain <chainName> -- <task>",
        display: true,
      });
      return;
    }
    const chainName = cleanedArgs.slice(0, delimiterIndex).trim();
    const task = cleanedArgs.slice(delimiterIndex + 4).trim();
    if (!chainName || !task) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: "Usage: /run-chain <chainName> -- <task>",
        display: true,
      });
      return;
    }
    const paths = deps.resolvePaths();
    const chainDiscovery = discoverChains(paths, ctx.cwd);
    const chain = chainDiscovery.chains.find((c) => c.name === chainName);
    if (!chain) {
      pi.sendMessage({
        customType: "pi-subagent-result",
        content: `Unknown chain: "${chainName}". Available: ${chainDiscovery.chains.map((c) => c.name).join(", ") || "(none)"}`,
        display: true,
      });
      return;
    }
    const discovery = deps.discoverAgents(paths);
    const result = await executeChain({
      steps: chain.steps as ChainStep[],
      task,
      spawnAndWait: async (agentDef, prompt, stepCwd) => {
        return deps.manager.spawnAndWait(ctx, agentDef, {
          prompt,
          cwd: stepCwd || ctx.cwd,
          maxTurns: deps.loadConfig(paths).config.defaultMaxTurns,
        });
      },
      findAgent: (name) => {
        const agent = discovery.agents.find(
          (a) => a.name.toLowerCase() === name.toLowerCase(),
        );
        if (!agent) throw new Error(`Unknown agent: "${name}"`);
        return agent;
      },
      cwd: ctx.cwd,
      runId: `chain-${Date.now().toString(36)}`,
    });
    pi.sendMessage({
      customType: "pi-subagent-result",
      content: result.content,
      display: true,
    });
  },
});
```

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/slash-chain.ts tests/slash-chain.test.ts src/index.ts
git commit -m "feat(slash): add /chain and /run-chain commands with expression parser"
```
