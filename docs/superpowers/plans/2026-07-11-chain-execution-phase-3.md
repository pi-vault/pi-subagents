# Chain Execution — Phase 3: Chain Serializer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/core/chain-serializer.ts` to parse and serialize `.chain.md` and `.chain.json` files.

**Architecture:** Parser for two chain file formats — Markdown (frontmatter + `## agent` sections) and JSON (structured object with `chain` array). Bidirectional: parse and serialize for both formats.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents` (source project to port from)

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 complete (chain types in `src/shared/types.ts`), Phase 2 complete (`chain-outputs.ts` for `validateChainOutputBindings`).

---

### Task 4: Create `src/core/chain-serializer.ts`

**Files:**

- Create: `src/core/chain-serializer.ts`
- Test: `tests/chain-serializer.test.ts`

Port from: reference `src/agents/chain-serializer.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/chain-serializer.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  parseChain,
  parseJsonChain,
  serializeChain,
  serializeJsonChain,
} from "../src/core/chain-serializer.js";
import type { ChainConfig } from "../src/shared/types.js";

describe("parseChain (.chain.md)", () => {
  test("parses a simple 2-step chain", () => {
    const content = [
      "---",
      "name: scout-plan",
      "description: Scout then plan",
      "---",
      "",
      "## scout",
      "phase: Context",
      "label: Map codebase",
      "as: context",
      "",
      "Analyze {task}",
      "",
      "## planner",
      "phase: Planning",
      "reads: context.md",
      "",
      "Plan from {outputs.context}",
    ].join("\n");

    const config = parseChain("/tmp/scout-plan.chain.md", content);
    expect(config.name).toBe("scout-plan");
    expect(config.description).toBe("Scout then plan");
    expect(config.steps).toHaveLength(2);
    expect(config.steps[0]!.agent).toBe("scout");
    expect(config.steps[0]!.phase).toBe("Context");
    expect(config.steps[0]!.label).toBe("Map codebase");
    expect(config.steps[0]!.as).toBe("context");
    expect(config.steps[0]!.task).toBe("Analyze {task}");
    expect(config.steps[1]!.agent).toBe("planner");
    expect(config.steps[1]!.reads).toEqual(["context.md"]);
    expect(config.steps[1]!.task).toBe("Plan from {outputs.context}");
  });

  test("parses step with output and model", () => {
    const content = [
      "---",
      "name: test",
      "description: test chain",
      "---",
      "",
      "## worker",
      "output: result.md",
      "model: anthropic/claude-sonnet-4-5",
      "progress: true",
      "",
      "Do the work",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.output).toBe("result.md");
    expect(config.steps[0]!.model).toBe("anthropic/claude-sonnet-4-5");
    expect(config.steps[0]!.progress).toBe(true);
  });

  test("handles reads: false", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "reads: false",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.reads).toBe(false);
  });

  test("handles comma-separated reads", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "reads: file1.md, file2.md",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.reads).toEqual(["file1.md", "file2.md"]);
  });

  test("throws on missing frontmatter name", () => {
    const content = [
      "---",
      "description: no name",
      "---",
      "",
      "## a",
      "task text",
    ].join("\n");

    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow();
  });
});

describe("parseJsonChain (.chain.json)", () => {
  test("parses a simple sequential chain", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test chain",
      chain: [
        { agent: "scout", task: "scan", as: "ctx" },
        { agent: "worker", task: "build from {outputs.ctx}" },
      ],
    });

    const config = parseJsonChain("/tmp/test.chain.json", content);
    expect(config.name).toBe("test");
    expect(config.steps).toHaveLength(2);
    expect(config.steps[0]!.agent).toBe("scout");
    expect(config.steps[0]!.as).toBe("ctx");
  });

  test("parses chain with dynamic fanout", () => {
    const content = JSON.stringify({
      name: "dynamic",
      description: "dynamic chain",
      chain: [
        { agent: "scout", task: "find", as: "targets" },
        {
          expand: {
            from: { output: "targets", path: "/items" },
            item: "target",
            maxItems: 10,
          },
          parallel: { agent: "reviewer", task: "review {target.path}" },
          collect: { as: "reviews" },
          concurrency: 4,
        },
      ],
    });

    const config = parseJsonChain("/tmp/dynamic.chain.json", content);
    expect(config.steps).toHaveLength(2);
    expect(config.steps[1]!.expand).toBeDefined();
    expect(config.steps[1]!.collect).toEqual({ as: "reviews" });
  });

  test("throws on invalid JSON", () => {
    expect(() => parseJsonChain("/tmp/bad.chain.json", "not json")).toThrow();
  });

  test("throws on missing name", () => {
    expect(() =>
      parseJsonChain(
        "/tmp/bad.chain.json",
        JSON.stringify({ description: "no name", chain: [] }),
      ),
    ).toThrow();
  });
});

describe("serializeChain", () => {
  test("roundtrips a simple chain", () => {
    const original = parseChain(
      "/tmp/test.chain.md",
      [
        "---",
        "name: roundtrip",
        "description: test roundtrip",
        "---",
        "",
        "## scout",
        "as: ctx",
        "",
        "scan the code",
        "",
        "## worker",
        "",
        "do the work",
      ].join("\n"),
    );

    const serialized = serializeChain(original);
    const reparsed = parseChain("/tmp/test.chain.md", serialized);
    expect(reparsed.name).toBe(original.name);
    expect(reparsed.steps.length).toBe(original.steps.length);
    expect(reparsed.steps[0]!.agent).toBe(original.steps[0]!.agent);
    expect(reparsed.steps[0]!.as).toBe(original.steps[0]!.as);
  });
});

describe("serializeJsonChain", () => {
  test("roundtrips a JSON chain", () => {
    const original = parseJsonChain(
      "/tmp/test.chain.json",
      JSON.stringify({
        name: "roundtrip",
        description: "test",
        chain: [{ agent: "a", task: "t", as: "out" }],
      }),
    );

    const serialized = serializeJsonChain(original);
    const reparsed = parseJsonChain("/tmp/test.chain.json", serialized);
    expect(reparsed.name).toBe(original.name);
    expect(reparsed.steps[0]!.agent).toBe("a");
    expect(reparsed.steps[0]!.as).toBe("out");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-serializer.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-serializer.ts`**

Create `src/core/chain-serializer.ts`. Port the parsing logic from reference `src/agents/chain-serializer.ts`, adapting to our types. Key patterns:

- Frontmatter parsed by splitting on `---` delimiters
- Step sections split by `## agent-name` regex: `/^##\s+(.+)[^\S\n]*$/gm`
- Step config lines: `/^([\w-]+):\s*(.*)$/` until first blank line
- Remaining text is the task template
- JSON chain validates structure and calls `validateChainOutputBindings`

```typescript
import { validateChainOutputBindings } from "./chain-outputs.js";
import type {
  ChainConfig,
  ChainStepConfig,
  ToolBudgetConfig,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// .chain.md parsing
// ---------------------------------------------------------------------------

interface Frontmatter {
  name?: string;
  description?: string;
  package?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(raw: string): Frontmatter {
  const result: Frontmatter = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (match) result[match[1]!] = match[2]!.trim();
  }
  return result;
}

function parseStepConfig(lines: string[]): {
  config: Partial<ChainStepConfig>;
  taskStart: number;
} {
  const config: Partial<ChainStepConfig> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") break;
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) break;
    const key = match[1]!.toLowerCase();
    const val = match[2]!.trim();
    switch (key) {
      case "output":
        config.output = val === "false" ? false : val;
        break;
      case "outputmode":
        if (val === "inline" || val === "file-only") config.outputMode = val;
        break;
      case "phase":
        config.phase = val;
        break;
      case "label":
        config.label = val;
        break;
      case "as":
        config.as = val;
        break;
      case "reads":
        config.reads =
          val === "false"
            ? false
            : val
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        break;
      case "model":
        config.model = val || undefined;
        break;
      case "skills":
        config.skills =
          val === "false"
            ? false
            : val
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        break;
      case "progress":
        config.progress = val !== "false";
        break;
      case "toolbudget":
        try {
          config.toolBudget = JSON.parse(val) as ToolBudgetConfig;
        } catch {
          // ignore invalid JSON
        }
        break;
      case "outputschema":
        config.outputSchema = val;
        break;
    }
  }
  return { config, taskStart: i };
}

export function parseChain(filePath: string, content: string): ChainConfig {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error(`${filePath}: missing frontmatter`);

  const fm = parseFrontmatter(fmMatch[1]!);
  if (!fm.name) throw new Error(`${filePath}: frontmatter missing 'name'`);

  const body = content.slice(fmMatch[0].length);
  const stepMatches = [...body.matchAll(/^##\s+(.+)[^\S\n]*$/gm)];
  if (stepMatches.length === 0) {
    throw new Error(`${filePath}: no step headings (## agent-name) found`);
  }

  const steps: ChainStepConfig[] = [];
  for (let i = 0; i < stepMatches.length; i++) {
    const match = stepMatches[i]!;
    const agentName = match[1]!.trim();
    const start = match.index! + match[0].length;
    const end =
      i + 1 < stepMatches.length ? stepMatches[i + 1]!.index! : body.length;
    const sectionText = body.slice(start, end).replace(/^\n+/, "");
    const sectionLines = sectionText.split("\n");

    const { config, taskStart } = parseStepConfig(sectionLines);
    const task = sectionLines.slice(taskStart).join("\n").trim();

    steps.push({
      agent: agentName,
      ...(task ? { task } : {}),
      ...config,
    });
  }

  const { name, description, package: pkg, ...extra } = fm;
  const extraFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) extraFields[k] = v;
  }

  return {
    name: name!,
    description: description ?? "",
    packageName: pkg,
    filePath,
    steps,
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// .chain.json parsing
// ---------------------------------------------------------------------------

export function parseJsonChain(filePath: string, content: string): ChainConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(`${filePath}: invalid JSON — ${(e as Error).message}`);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${filePath}: root must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error(`${filePath}: missing required 'name' field`);
  }
  if (typeof obj.description !== "string") {
    throw new Error(`${filePath}: missing required 'description' field`);
  }
  if (!Array.isArray(obj.chain)) {
    throw new Error(`${filePath}: missing required 'chain' array`);
  }

  const steps = obj.chain as ChainStepConfig[];

  // Validate output bindings across the chain
  validateChainOutputBindings(steps as unknown[]);

  return {
    name: obj.name as string,
    description: obj.description as string,
    packageName: obj.package as string | undefined,
    filePath,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeChain(config: ChainConfig): string {
  const lines: string[] = ["---", `name: ${config.name}`];
  if (config.description) lines.push(`description: ${config.description}`);
  if (config.packageName) lines.push(`package: ${config.packageName}`);
  if (config.extraFields) {
    for (const [k, v] of Object.entries(config.extraFields)) {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");

  for (const step of config.steps) {
    lines.push(`## ${step.agent}`);
    if (step.phase) lines.push(`phase: ${step.phase}`);
    if (step.label) lines.push(`label: ${step.label}`);
    if (step.as) lines.push(`as: ${step.as}`);
    if (step.output !== undefined) {
      lines.push(`output: ${step.output === false ? "false" : step.output}`);
    }
    if (step.outputMode) lines.push(`outputMode: ${step.outputMode}`);
    if (step.reads !== undefined) {
      lines.push(
        `reads: ${step.reads === false ? "false" : (step.reads as string[]).join(", ")}`,
      );
    }
    if (step.model) lines.push(`model: ${step.model}`);
    if (step.skills !== undefined) {
      lines.push(
        `skills: ${step.skills === false ? "false" : (step.skills as string[]).join(", ")}`,
      );
    }
    if (step.progress !== undefined) lines.push(`progress: ${step.progress}`);
    if (step.toolBudget)
      lines.push(`toolBudget: ${JSON.stringify(step.toolBudget)}`);
    lines.push("");
    if (step.task) lines.push(step.task);
    lines.push("");
  }

  return lines.join("\n");
}

export function serializeJsonChain(config: ChainConfig): string {
  return JSON.stringify(
    {
      name: config.name,
      description: config.description,
      ...(config.packageName ? { package: config.packageName } : {}),
      chain: config.steps,
    },
    null,
    2,
  );
}
```

Note: `ChainStepConfig` and `ChainStep` are structurally compatible for the fields `validateChainOutputBindings` inspects (`as`, `task`, `parallel`, `expand`, `collect`). The cast `steps as unknown as ChainStep[]` is safe here. If TypeScript complains, adjust the validation function to accept `ReadonlyArray<{as?: string; task?: string; parallel?: unknown; expand?: unknown; collect?: unknown}>` instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-serializer.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-serializer.ts tests/chain-serializer.test.ts
git commit -m "feat(chain-serializer): parse and serialize .chain.md and .chain.json"
```
