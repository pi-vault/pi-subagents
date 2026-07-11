# Chain Execution — Phase 3: Chain Serializer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/core/chain-serializer.ts` to parse and serialize `.chain.md` and `.chain.json` files.

**Architecture:** Parser for two chain file formats — Markdown (frontmatter + `## agent` sections) and JSON (structured object with `chain` array). Bidirectional: parse and serialize for both formats.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-chain-execution-design.md`

**Reference:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-subagents/src/agents/chain-serializer.ts`

**Parent plan:** `docs/superpowers/plans/2026-07-11-chain-execution.md`

**Prerequisites:** Phase 1 complete (chain types in `src/shared/types.ts`), Phase 2 complete (`chain-outputs.ts` for `validateChainOutputBindings`, `tool-budget.ts` for `validateToolBudget`).

**Key dependencies in this project:**

- `validateChainOutputBindings(steps: ChainStep[]): void` from `./chain-outputs.js`
- `validateToolBudget(raw: unknown, label?: string): { budget?: ResolvedToolBudget; error?: string }` from `./tool-budget.js`
- Types: `ChainConfig`, `ChainStepConfig`, `ChainStep`, `ToolBudgetConfig` from `../shared/types.js`

**Differences from reference (nicobailon-pi-subagents):**

- No `AgentSource` type — our `ChainConfig` uses `filePath` only (no `source` field)
- No `parsePackageName` / `buildRuntimeName` / `frontmatterNameForConfig` — store `packageName` from frontmatter `package` field directly; `name` = frontmatter name as-is
- No `validateAcceptanceInput` yet — skip acceptance validation for now (type already allows it on `ChainStepConfig`)
- No `parseFrontmatter` from external module — inline a simple key-value parser (chain frontmatter is flat)
- `validateToolBudget` in our project returns `{ budget?, error? }` vs reference's `validateToolBudgetConfig` — use our version

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

  test("handles output: false", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "output: false",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.output).toBe(false);
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

  test("handles skills: false and comma-separated skills", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "skills: false",
      "",
      "task a",
      "",
      "## b",
      "skills: code-review, testing",
      "",
      "task b",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.skills).toBe(false);
    expect(config.steps[1]!.skills).toEqual(["code-review", "testing"]);
  });

  test("rejects inline JSON outputSchema", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      'outputSchema: {"type":"object"}',
      "",
      "task",
    ].join("\n");

    expect(() => parseChain("/tmp/test.chain.md", content)).toThrow(
      /inline.*outputSchema/i,
    );
  });

  test("parses outputSchema as file path", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "outputSchema: schemas/result.json",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.outputSchema).toBe("schemas/result.json");
  });

  test("throws on invalid toolBudget JSON", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "toolBudget: not-json",
      "",
      "task",
    ].join("\n");

    expect(() => parseChain("/tmp/test.chain.md", content)).toThrow(
      /toolBudget/,
    );
  });

  test("throws on invalid toolBudget structure", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      'toolBudget: {"soft": 5}',
      "",
      "task",
    ].join("\n");

    expect(() => parseChain("/tmp/test.chain.md", content)).toThrow(/hard/);
  });

  test("parses valid toolBudget", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      'toolBudget: {"hard": 10, "soft": 5}',
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.toolBudget).toEqual({ hard: 10, soft: 5 });
  });

  test("preserves extra frontmatter fields", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "version: 2",
      "author: dev",
      "---",
      "",
      "## a",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.extraFields).toEqual({ version: "2", author: "dev" });
  });

  test("parses package field", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "package: @org/tools",
      "---",
      "",
      "## a",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.packageName).toBe("@org/tools");
  });

  test("throws on missing frontmatter", () => {
    const content = "## a\ntask";
    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow(
      /frontmatter/,
    );
  });

  test("throws on missing frontmatter name", () => {
    const content = [
      "---",
      "description: no name",
      "---",
      "",
      "## a",
      "",
      "task text",
    ].join("\n");

    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow(/name/);
  });

  test("throws on missing frontmatter description", () => {
    const content = [
      "---",
      "name: test",
      "---",
      "",
      "## a",
      "",
      "task text",
    ].join("\n");

    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow(
      /description/,
    );
  });

  test("progress: false sets false explicitly", () => {
    const content = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "## a",
      "progress: false",
      "",
      "task",
    ].join("\n");

    const config = parseChain("/tmp/test.chain.md", content);
    expect(config.steps[0]!.progress).toBe(false);
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

  test("validates per-step toolBudget", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test",
      chain: [{ agent: "a", task: "t", toolBudget: { soft: 5 } }],
    });

    expect(() => parseJsonChain("/tmp/bad.chain.json", content)).toThrow(
      /hard/,
    );
  });

  test("validates per-step as object", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test",
      chain: ["not an object"],
    });

    expect(() => parseJsonChain("/tmp/bad.chain.json", content)).toThrow(
      /must be an object/,
    );
  });

  test("validates toolBudget in parallel tasks", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test",
      chain: [
        {
          parallel: [{ agent: "a", task: "t", toolBudget: { hard: -1 } }],
        },
      ],
    });

    expect(() => parseJsonChain("/tmp/bad.chain.json", content)).toThrow(
      /hard/,
    );
  });

  test("preserves extra string fields", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test",
      version: "2",
      chain: [{ agent: "a", task: "t" }],
    });

    const config = parseJsonChain("/tmp/test.chain.json", content);
    expect(config.extraFields).toEqual({ version: "2" });
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

  test("throws on missing description", () => {
    expect(() =>
      parseJsonChain(
        "/tmp/bad.chain.json",
        JSON.stringify({ name: "test", chain: [] }),
      ),
    ).toThrow();
  });

  test("throws on missing chain array", () => {
    expect(() =>
      parseJsonChain(
        "/tmp/bad.chain.json",
        JSON.stringify({ name: "test", description: "test" }),
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
    expect(reparsed.description).toBe(original.description);
    expect(reparsed.steps.length).toBe(original.steps.length);
    expect(reparsed.steps[0]!.agent).toBe(original.steps[0]!.agent);
    expect(reparsed.steps[0]!.as).toBe(original.steps[0]!.as);
    expect(reparsed.steps[0]!.task).toBe(original.steps[0]!.task);
  });

  test("roundtrips all step fields", () => {
    const original = parseChain(
      "/tmp/test.chain.md",
      [
        "---",
        "name: full",
        "description: full test",
        "package: @org/tools",
        "---",
        "",
        "## agent",
        "phase: Build",
        "label: Do stuff",
        "as: result",
        "output: out.md",
        "outputMode: file-only",
        "reads: a.md, b.md",
        "model: openai/gpt-4o",
        "skills: code-review, testing",
        "progress: true",
        "",
        "Build the thing",
      ].join("\n"),
    );

    const serialized = serializeChain(original);
    const reparsed = parseChain("/tmp/test.chain.md", serialized);
    expect(reparsed.packageName).toBe("@org/tools");
    expect(reparsed.steps[0]!.phase).toBe("Build");
    expect(reparsed.steps[0]!.label).toBe("Do stuff");
    expect(reparsed.steps[0]!.output).toBe("out.md");
    expect(reparsed.steps[0]!.outputMode).toBe("file-only");
    expect(reparsed.steps[0]!.reads).toEqual(["a.md", "b.md"]);
    expect(reparsed.steps[0]!.model).toBe("openai/gpt-4o");
    expect(reparsed.steps[0]!.skills).toEqual(["code-review", "testing"]);
    expect(reparsed.steps[0]!.progress).toBe(true);
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

  test("includes package and extraFields", () => {
    const original = parseJsonChain(
      "/tmp/test.chain.json",
      JSON.stringify({
        name: "test",
        description: "test",
        package: "@org/tools",
        version: "2",
        chain: [{ agent: "a", task: "t" }],
      }),
    );

    const serialized = serializeJsonChain(original);
    const parsed = JSON.parse(serialized);
    expect(parsed.package).toBe("@org/tools");
    expect(parsed.version).toBe("2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/chain-serializer.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `chain-serializer.ts`**

Create `src/core/chain-serializer.ts`. Port the parsing logic from reference `src/agents/chain-serializer.ts`, adapting to our types and available utilities.

Key patterns:

- Frontmatter parsed by splitting on `---` delimiters (flat key-value pairs)
- Step sections split by `## agent-name` regex: `/^##\s+(.+)[^\S\n]*$/gm`
- Step body split at first blank line: config lines before, task text after
- Config lines parsed: `/^([\w-]+):\s*(.*)$/`
- `outputSchema`: reject inline JSON (starts with `{` or `[`), only accept file paths
- `toolBudget`: parse as JSON, then validate via `validateToolBudget()` — throw on error
- `progress`: explicit "true" → true, "false" → false (not `val !== "false"`)
- `reads`/`skills`: comma-separated list or "false"; collapse empty result to `false`
- JSON chain: validate each step is object, validate toolBudget recursively (step, parallel tasks, dynamic template)
- JSON chain: call `validateChainOutputBindings` with `steps as unknown as ChainStep[]` (structurally compatible)
- JSON chain: preserve extra string fields (exclude reserved keys: name, description, package, chain)

```typescript
import {
  ChainOutputValidationError,
  validateChainOutputBindings,
} from "./chain-outputs.js";
import { validateToolBudget } from "./tool-budget.js";
import type {
  ChainConfig,
  ChainStep,
  ChainStepConfig,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

interface Frontmatter {
  [key: string]: string;
}

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const fm: Frontmatter = {};
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) fm[kv[1]!] = kv[2]!.trim();
  }
  return { frontmatter: fm, body: content.slice(match[0].length) };
}

// ---------------------------------------------------------------------------
// .chain.md step body parsing
// ---------------------------------------------------------------------------

function parseStepBody(agent: string, sectionBody: string): ChainStepConfig {
  const lines = sectionBody.split("\n");
  const blankIndex = lines.findIndex((line) => line.trim() === "");
  const configLines = blankIndex === -1 ? lines : lines.slice(0, blankIndex);
  const task = (
    blankIndex === -1 ? "" : lines.slice(blankIndex + 1).join("\n")
  ).trim();

  const step: ChainStepConfig = { agent, task };
  for (const line of configLines) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.trim().toLowerCase();
    const val = match[2]!.trim();

    switch (key) {
      case "output":
        if (val === "false") step.output = false;
        else if (val) step.output = val;
        break;
      case "phase":
        if (val) step.phase = val;
        break;
      case "label":
        if (val) step.label = val;
        break;
      case "as":
        if (val) step.as = val;
        break;
      case "outputschema":
        if (val.startsWith("{") || val.startsWith("[")) {
          throw new Error(
            `Inline outputSchema values are not supported in .chain.md files; use a schema file path.`,
          );
        }
        if (val) step.outputSchema = val;
        break;
      case "outputmode":
        if (val === "inline" || val === "file-only") step.outputMode = val;
        break;
      case "reads":
        if (val === "false") {
          step.reads = false;
        } else {
          const reads = val
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          step.reads = reads.length > 0 ? reads : false;
        }
        break;
      case "model":
        if (val) step.model = val;
        break;
      case "skills":
        if (val === "false") {
          step.skills = false;
        } else {
          const skills = val
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          step.skills = skills.length > 0 ? skills : false;
        }
        break;
      case "progress":
        if (val === "true") step.progress = true;
        else if (val === "false") step.progress = false;
        break;
      case "toolbudget": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(val);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Invalid toolBudget in .chain.md step '${agent}': ${msg}`,
          );
        }
        const validation = validateToolBudget(
          parsed,
          `toolBudget for step '${agent}'`,
        );
        if (validation.error) throw new Error(validation.error);
        step.toolBudget = parsed as ChainStepConfig["toolBudget"];
        break;
      }
    }
  }

  return step;
}

// ---------------------------------------------------------------------------
// .chain.md parsing
// ---------------------------------------------------------------------------

export function parseChain(filePath: string, content: string): ChainConfig {
  const { frontmatter: fm, body } = parseFrontmatter(content);

  if (!fm.name) {
    throw new Error(`${filePath}: frontmatter missing 'name'`);
  }
  if (!fm.description) {
    throw new Error(`${filePath}: frontmatter missing 'description'`);
  }

  const matches = [...body.matchAll(/^##\s+(.+)[^\S\n]*$/gm)];
  if (matches.length === 0) {
    throw new Error(`${filePath}: no step headings (## agent-name) found`);
  }

  const steps: ChainStepConfig[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const agent = match[1]!.trim();
    const lineEndOffset = body[match.index! + match[0].length] === "\n" ? 1 : 0;
    const sectionStart = match.index! + match[0].length + lineEndOffset;
    const sectionEnd =
      i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    const sectionBody = body.slice(sectionStart, sectionEnd).trimEnd();
    steps.push(parseStepBody(agent, sectionBody));
  }

  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (key === "name" || key === "package" || key === "description") continue;
    extraFields[key] = value;
  }

  return {
    name: fm.name,
    description: fm.description,
    packageName: fm.package || undefined,
    filePath,
    steps,
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// .chain.json parsing
// ---------------------------------------------------------------------------

function validateJsonStepToolBudget(value: unknown, label: string): void {
  const result = validateToolBudget(value, label);
  if (result.error) throw new Error(result.error);
}

export function parseJsonChain(filePath: string, content: string): ChainConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: invalid JSON — ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath}: root must be a JSON object`);
  }

  const input = parsed as Record<string, unknown>;
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new Error(`${filePath}: missing required 'name' field`);
  }
  if (typeof input.description !== "string") {
    throw new Error(`${filePath}: missing required 'description' field`);
  }
  if (!Array.isArray(input.chain)) {
    throw new Error(`${filePath}: missing required 'chain' array`);
  }

  // Per-step validation
  for (let i = 0; i < input.chain.length; i++) {
    const step = input.chain[i];
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`${filePath}: step ${i + 1} must be an object`);
    }
    const rec = step as Record<string, unknown>;

    // Validate toolBudget at step level
    if (rec.toolBudget !== undefined) {
      validateJsonStepToolBudget(rec.toolBudget, `step ${i + 1} toolBudget`);
    }

    // Validate toolBudget in parallel tasks
    const parallel = rec.parallel;
    if (Array.isArray(parallel)) {
      for (let j = 0; j < parallel.length; j++) {
        const task = parallel[j];
        if (!task || typeof task !== "object" || Array.isArray(task)) continue;
        const taskRec = task as Record<string, unknown>;
        if (taskRec.toolBudget !== undefined) {
          validateJsonStepToolBudget(
            taskRec.toolBudget,
            `step ${i + 1} parallel task ${j + 1} toolBudget`,
          );
        }
      }
    } else if (parallel && typeof parallel === "object") {
      // Dynamic parallel template
      const tmpl = parallel as Record<string, unknown>;
      if (tmpl.toolBudget !== undefined) {
        validateJsonStepToolBudget(
          tmpl.toolBudget,
          `step ${i + 1} dynamic template toolBudget`,
        );
      }
    }
  }

  // Validate output bindings
  try {
    validateChainOutputBindings(input.chain as unknown as ChainStep[]);
  } catch (error) {
    if (error instanceof ChainOutputValidationError) {
      throw new Error(`${filePath}: ${error.message}`);
    }
    throw error;
  }

  // Preserve extra string fields
  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      key === "name" ||
      key === "description" ||
      key === "package" ||
      key === "chain"
    )
      continue;
    if (typeof value === "string") extraFields[key] = value;
  }

  return {
    name: (input.name as string).trim(),
    description: (input.description as string).trim(),
    packageName: typeof input.package === "string" ? input.package : undefined,
    filePath,
    steps: input.chain as ChainStepConfig[],
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeChain(config: ChainConfig): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${config.name}`);
  if (config.packageName) lines.push(`package: ${config.packageName}`);
  lines.push(`description: ${config.description}`);
  if (config.extraFields) {
    for (const [key, value] of Object.entries(config.extraFields)) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push("");

  for (let i = 0; i < config.steps.length; i++) {
    const step = config.steps[i]!;
    lines.push(`## ${step.agent}`);
    if (step.output === false) lines.push("output: false");
    else if (step.output) lines.push(`output: ${step.output}`);
    if (step.phase) lines.push(`phase: ${step.phase}`);
    if (step.label) lines.push(`label: ${step.label}`);
    if (step.as) lines.push(`as: ${step.as}`);
    if (step.outputSchema) lines.push(`outputSchema: ${step.outputSchema}`);
    if (step.outputMode) lines.push(`outputMode: ${step.outputMode}`);
    if (step.reads === false) lines.push("reads: false");
    else if (Array.isArray(step.reads) && step.reads.length > 0)
      lines.push(`reads: ${step.reads.join(", ")}`);
    if (step.model) lines.push(`model: ${step.model}`);
    if (step.skills === false) lines.push("skills: false");
    else if (Array.isArray(step.skills) && step.skills.length > 0)
      lines.push(`skills: ${step.skills.join(", ")}`);
    if (step.progress !== undefined)
      lines.push(`progress: ${step.progress ? "true" : "false"}`);
    if (step.toolBudget !== undefined)
      lines.push(`toolBudget: ${JSON.stringify(step.toolBudget)}`);
    lines.push("");
    lines.push(step.task ?? "");
    if (i < config.steps.length - 1) lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function serializeJsonChain(config: ChainConfig): string {
  const root: Record<string, unknown> = {
    name: config.name,
    description: config.description,
    chain: config.steps,
  };
  if (config.packageName) root.package = config.packageName;
  if (config.extraFields) {
    for (const [key, value] of Object.entries(config.extraFields)) {
      if (
        key !== "name" &&
        key !== "description" &&
        key !== "package" &&
        key !== "chain"
      )
        root[key] = value;
    }
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/chain-serializer.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS (typecheck + lint + all tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/chain-serializer.ts tests/chain-serializer.test.ts
git commit -m "feat(chain-serializer): parse and serialize .chain.md and .chain.json"
```
