import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ChainDefinitionError,
  materializeSavedChainSteps,
  normalizeChainSteps,
  parseChain,
  parseJsonChain,
  serializeChain,
  serializeJsonChain,
} from "../src/core/chain-serializer.js";

describe("normalizeChainSteps", () => {
  test("accepts each step shape and preserves ordinary extension fields", () => {
    const steps = normalizeChainSteps(
      [
        { agent: "scout", task: "scan", extensionHint: "keep" },
        {
          parallel: [{ agent: "worker", task: "build", count: 2, taskHint: "keep" }],
          groupHint: "keep",
        },
        {
          expand: { from: { output: "targets", path: "/items" } },
          parallel: { agent: "reviewer", task: "review {item}" },
          collect: { as: "reviews" },
        },
      ],
      "tool chain",
      { priorOutputNames: ["targets"] },
    );

    expect(steps[0]).toMatchObject({ extensionHint: "keep" });
    expect(steps[1]).toMatchObject({
      parallel: [{ taskHint: "keep", count: 2 }],
      groupHint: "keep",
    });
  });

  test("rejects sequential fields on a static parallel group", () => {
    expect(() =>
      normalizeChainSteps(
        [{ parallel: [{ agent: "worker" }], task: "misplaced" }],
        "tool chain",
      ),
    ).toThrow(/step 1.*task/);
  });

  test("rejects group fields on a sequential step without rejecting extensions", () => {
    expect(() =>
      normalizeChainSteps([{ agent: "worker", failFast: true }], "tool chain"),
    ).toThrow(/step 1.*failFast/);

    expect(
      normalizeChainSteps(
        [{ agent: "worker", extensionHint: "keep" }],
        "tool chain",
      ),
    ).toEqual([{ agent: "worker", extensionHint: "keep" }]);
  });

  test.each([
    [{ agent: "worker", parallel: [{ agent: "other" }] }, /mix/i],
    [{ agent: " " }, /agent.*non-blank/i],
    [{ parallel: [] }, /non-empty/i],
    [{ agent: "worker", progress: "true" }, /progress.*boolean/i],
    [{ agent: "worker", reads: ["ok", ""] }, /reads.*non-blank/i],
    [{ parallel: [{ agent: "worker", count: 0 }] }, /count.*integer.*1/i],
    [{ agent: "worker", acceptance: { description: 3 } }, /acceptance\.description.*string/i],
    [{ agent: "worker", outputSchema: [] }, /outputSchema.*object/i],
    [{ agent: "worker", toolBudget: { soft: 1 } }, /hard/i],
  ])("rejects invalid recognized fields: %j", (step, message) => {
    expect(() => normalizeChainSteps([step], "tool chain")).toThrow(message);
  });

  test.each([
    [
      {
        expand: { from: { output: "targets", path: "/items" } },
        parallel: { agent: "worker", task: "review", maxItem: 3 },
        collect: { as: "reviews" },
      },
      /dynamic parallel template.*maxItem/i,
    ],
    [
      {
        expand: {
          from: { output: "targets", path: "/items", fallback: [] },
        },
        parallel: { agent: "worker", task: "review" },
        collect: { as: "reviews" },
      },
      /expand\.from.*fallback/i,
    ],
    [
      {
        expand: { from: { output: "targets", path: "/items" } },
        parallel: { agent: "worker", task: "review", count: 2 },
        collect: { as: "reviews" },
      },
      /dynamic parallel template.*count/i,
    ],
  ])("rejects strict dynamic fanout fields", (step, message) => {
    expect(() =>
      normalizeChainSteps([step], "tool chain", {
        priorOutputNames: ["targets"],
      }),
    ).toThrow(message);
  });
});

describe("materializeSavedChainSteps", () => {
  test("loads saved schemas recursively relative to the chain file", () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-definition-"));
    const schema = { type: "object", properties: { value: { type: "string" } } };
    writeFileSync(join(dir, "schema.json"), JSON.stringify(schema));

    const steps = materializeSavedChainSteps({
      name: "saved",
      description: "saved",
      filePath: join(dir, "saved.chain.json"),
      steps: [
        { agent: "scout", as: "targets", outputSchema: "schema.json" },
        {
          parallel: [{ agent: "static", outputSchema: "schema.json" }],
        },
        {
          expand: { from: { output: "targets", path: "/items" } },
          parallel: { agent: "dynamic", outputSchema: "schema.json" },
          collect: { as: "results", outputSchema: "schema.json" },
        },
      ],
    });

    expect(steps[0]).toMatchObject({ outputSchema: schema });
    expect(steps[1]).toMatchObject({ parallel: [{ outputSchema: schema }] });
    expect(steps[2]).toMatchObject({
      parallel: { outputSchema: schema },
      collect: { outputSchema: schema },
    });
  });

  test.each([
    ["missing.json", undefined, /unable to read/i],
    ["invalid.json", "{", /invalid JSON/i],
    ["null.json", "null", /JSON object/i],
    ["array.json", "[]", /JSON object/i],
    ["primitive.json", "true", /JSON object/i],
  ])("rejects unusable schema file %s", (fileName, content, message) => {
    const dir = mkdtempSync(join(tmpdir(), "chain-definition-"));
    if (content !== undefined) writeFileSync(join(dir, fileName), content);

    expect(() =>
      materializeSavedChainSteps({
        name: "saved",
        description: "saved",
        filePath: join(dir, "saved.chain.json"),
        steps: [{ agent: "worker", outputSchema: fileName }],
      }),
    ).toThrow(message);
  });
});

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

    expect(() => parseChain("/tmp/test.chain.md", content)).toThrow(/inline.*outputSchema/i);
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

    expect(() => parseChain("/tmp/test.chain.md", content)).toThrow(/toolBudget/);
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
    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow(/frontmatter/);
  });

  test("throws on missing frontmatter name", () => {
    const content = ["---", "description: no name", "---", "", "## a", "", "task text"].join("\n");

    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow(/name/);
  });

  test("throws on missing frontmatter description", () => {
    const content = ["---", "name: test", "---", "", "## a", "", "task text"].join("\n");

    expect(() => parseChain("/tmp/bad.chain.md", content)).toThrow(/description/);
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

  test("validates saved definitions without loading schema paths", () => {
    const content = JSON.stringify({
      name: "saved",
      description: "saved chain",
      chain: [{ agent: "worker", outputSchema: "not-present.json" }],
    });

    expect(parseJsonChain("/tmp/saved.chain.json", content).steps[0]).toMatchObject({
      outputSchema: "not-present.json",
    });
  });

  test("rejects invalid recognized fields in saved definitions", () => {
    const content = JSON.stringify({
      name: "saved",
      description: "saved chain",
      chain: [{ agent: "worker", failFast: "yes" }],
    });

    expect(() => parseJsonChain("/tmp/saved.chain.json", content)).toThrow(/failFast.*boolean/i);
  });

  test("validates per-step toolBudget", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test",
      chain: [{ agent: "a", task: "t", toolBudget: { soft: 5 } }],
    });

    expect(() => parseJsonChain("/tmp/bad.chain.json", content)).toThrow(/hard/);
  });

  test("validates per-step as object", () => {
    const content = JSON.stringify({
      name: "test",
      description: "test",
      chain: ["not an object"],
    });

    expect(() => parseJsonChain("/tmp/bad.chain.json", content)).toThrow(/must be an object/);
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

    expect(() => parseJsonChain("/tmp/bad.chain.json", content)).toThrow(/hard/);
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
      parseJsonChain("/tmp/bad.chain.json", JSON.stringify({ description: "no name", chain: [] })),
    ).toThrow();
  });

  test("throws on missing description", () => {
    expect(() =>
      parseJsonChain("/tmp/bad.chain.json", JSON.stringify({ name: "test", chain: [] })),
    ).toThrow();
  });

  test("throws on missing chain array", () => {
    expect(() =>
      parseJsonChain("/tmp/bad.chain.json", JSON.stringify({ name: "test", description: "test" })),
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

  test("rejects non-sequential saved definitions", () => {
    expect(() =>
      serializeChain({
        name: "parallel",
        description: "parallel",
        filePath: "/tmp/parallel.chain.md",
        steps: [{ parallel: [{ agent: "worker" }] }],
      }),
    ).toThrow(ChainDefinitionError);
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
