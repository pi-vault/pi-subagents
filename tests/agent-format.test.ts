import { describe, expect, test } from "vitest";
import {
  parseAgentContent,
  serializeAgent,
} from "../src/core/agent-format.js";
import type { AgentCreationInput } from "../src/shared/types.js";

describe("parseAgentContent", () => {
  test("parses minimal valid agent (name, description, tools, body)", () => {
    const result = parseAgentContent(
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

    expect(result).toMatchObject({
      ok: true,
      agent: {
        name: "scout",
        description: "Scout files",
        tools: ["bash", "read"],
        systemPrompt: "# System prompt\nUse the body unchanged.",
        sourcePath: "/tmp/scout.md",
      },
    });
  });

  test("infers agent name from filePath stem when frontmatter name is absent", () => {
    const result = parseAgentContent(
      "/tmp/Planner.md",
      [
        "---",
        "description: Plans work",
        "tools: read, bash",
        "---",
        "Plan the work.",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      ok: true,
      agent: {
        name: "planner",
        description: "Plans work",
        tools: ["read", "bash"],
      },
    });
  });

  test("parses tools as comma-separated string: tools: bash, read", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: d\ntools: bash, read\n---\nbody\n",
    );

    expect(result).toMatchObject({
      ok: true,
      agent: { tools: ["bash", "read"] },
    });
  });

  test('parses tools as JSON array: tools: ["bash", "read"]', () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      '---\nname: a\ndescription: d\ntools: ["bash", "read"]\n---\nbody\n',
    );

    expect(result).toMatchObject({
      ok: true,
      agent: { tools: ["bash", "read"] },
    });
  });

  test("parses tools as YAML-style list (indented - item lines)", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      [
        "---",
        "name: a",
        "description: d",
        "tools:",
        "  - bash",
        "  - read",
        "---",
        "body",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      ok: true,
      agent: { tools: ["bash", "read"] },
    });
  });

  test("parses subagent_agents field", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: d\ntools: read\nsubagent_agents: worker, researcher\n---\nbody\n",
    );

    expect(result).toMatchObject({
      ok: true,
      agent: { subagentAgents: ["worker", "researcher"] },
    });
  });

  test("parses timeout_ms as positive number", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: d\ntools: read\ntimeout_ms: 180000\n---\nbody\n",
    );

    expect(result).toMatchObject({
      ok: true,
      agent: { timeoutMs: 180000 },
    });
  });

  test('parses model field, normalizes "default" to undefined', () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: d\ntools: read\nmodel: default\n---\nbody\n",
    );

    expect(result).toMatchObject({
      ok: true,
      agent: { model: undefined },
    });

    const result2 = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: d\ntools: read\nmodel: claude-sonnet\n---\nbody\n",
    );

    expect(result2).toMatchObject({
      ok: true,
      agent: { model: "claude-sonnet" },
    });
  });

  test("parses thinking field", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: d\ntools: read\nthinking: medium\n---\nbody\n",
    );

    expect(result).toMatchObject({
      ok: true,
      agent: { thinking: "medium" },
    });
  });

  test("parses enabled: true, enabled: false, disabled: true (legacy)", () => {
    const enabledTrue = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\ntools: read\nenabled: true\n---\nbody\n",
    );
    expect(enabledTrue).toMatchObject({ ok: true, agent: { enabled: true } });

    const enabledFalse = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\ntools: read\nenabled: false\n---\nbody\n",
    );
    expect(enabledFalse).toMatchObject({
      ok: true,
      agent: { enabled: false },
    });

    const disabledTrue = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\ntools: read\ndisabled: true\n---\nbody\n",
    );
    expect(disabledTrue).toMatchObject({
      ok: true,
      agent: { enabled: false },
    });
  });

  test("parses skills: none -> false, skills: all -> true, skills: a, b -> [a, b]", () => {
    const none = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\ntools: read\nskills: none\n---\nbody\n",
    );
    expect(none).toMatchObject({ ok: true, agent: { skills: false } });

    const all = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\ntools: read\nskills: all\n---\nbody\n",
    );
    expect(all).toMatchObject({ ok: true, agent: { skills: true } });

    const list = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\ntools: read\nskills: tdd, writing-go\n---\nbody\n",
    );
    expect(list).toMatchObject({
      ok: true,
      agent: { skills: ["tdd", "writing-go"] },
    });
  });

  test("returns error for missing frontmatter delimiter", () => {
    const result = parseAgentContent("/tmp/a.md", "no frontmatter here");
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        path: "/tmp/a.md",
        reason: "missing leading frontmatter delimiter",
      },
    });
  });

  test("returns error for missing closing frontmatter delimiter", () => {
    const result = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\n",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        path: "/tmp/a.md",
        reason: "missing closing frontmatter delimiter",
      },
    });
  });

  test("returns error for malformed frontmatter line (no colon)", () => {
    const result = parseAgentContent(
      "/tmp/a.md",
      "---\nname bad\ndescription: d\n---\nbody\n",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        path: "/tmp/a.md",
        reason: "malformed frontmatter line: name bad",
      },
    });
  });

  test("returns error for missing description", () => {
    const result = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ntools: read\n---\nbody\n",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        path: "/tmp/a.md",
        reason: "missing required non-empty description",
      },
    });
  });

  test("returns error for empty name with no filename fallback", () => {
    // path.parse("").name is "" — triggers the empty-name error
    const result = parseAgentContent(
      "",
      "---\nname:  \ndescription: d\ntools: read\n---\nbody\n",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        path: "",
        reason: "missing required non-empty name",
      },
    });
  });

  test("returns error for non-string array in tools (tools: [1, 2])", () => {
    const result = parseAgentContent(
      "/tmp/a.md",
      "---\nname: a\ndescription: d\ntools: [1, 2]\n---\nbody\n",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        path: "/tmp/a.md",
        reason: "tools must be a comma-separated string or string array",
      },
    });
  });

  test("returns error for timeout_ms: 0 and timeout_ms: -1 and timeout_ms: NaN", () => {
    for (const bad of ["0", "-1", "NaN"]) {
      const result = parseAgentContent(
        "/tmp/a.md",
        `---\nname: a\ndescription: d\ntools: read\ntimeout_ms: ${bad}\n---\nbody\n`,
      );
      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          path: "/tmp/a.md",
          reason: "timeout_ms must be a positive finite number",
        },
      });
    }
  });

  test("handles unicode in description and body", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: Scouté les fichiers 🔍\ntools: read\n---\nCorps du système 日本語\n",
    );
    expect(result).toMatchObject({
      ok: true,
      agent: {
        description: "Scouté les fichiers 🔍",
        systemPrompt: "Corps du système 日本語\n",
      },
    });
  });

  test("handles CRLF line endings (normalized to LF)", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\r\nname: a\r\ndescription: d\r\ntools: read\r\n---\r\nbody text\r\n",
    );
    expect(result).toMatchObject({
      ok: true,
      agent: {
        name: "a",
        description: "d",
        tools: ["read"],
        systemPrompt: "body text\n",
      },
    });
  });

  test("handles empty body (trailing newline only after closing ---)", () => {
    const result = parseAgentContent(
      "/tmp/agent.md",
      "---\nname: a\ndescription: d\ntools: read\n---\n",
    );
    expect(result).toMatchObject({
      ok: true,
      agent: { systemPrompt: "" },
    });
  });
});

describe("serializeAgent", () => {
  test("serializes full input with all fields populated", () => {
    const input: AgentCreationInput = {
      name: "Scout",
      description: "Scout files",
      tools: ["bash", "read"],
      model: "claude-sonnet",
      thinking: "medium",
      subagentAgents: ["worker"],
      timeoutMs: 180000,
      skills: ["tdd", "writing-go"],
      systemPrompt: "# System prompt\nInspect the repo.",
    };

    expect(serializeAgent(input)).toBe(
      [
        "---",
        "name: Scout",
        "description: Scout files",
        "tools: bash, read",
        "model: claude-sonnet",
        "thinking: medium",
        "subagent_agents: worker",
        "timeout_ms: 180000",
        "skills: tdd, writing-go",
        "---",
        "# System prompt",
        "Inspect the repo.",
        "",
      ].join("\n"),
    );
  });

  test("omits name field when input.name is undefined", () => {
    const result = serializeAgent({
      description: "Does work",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "Do work.",
    });

    expect(result).not.toContain("name:");
    expect(result).toContain("description: Does work");
  });

  test('omits model when undefined or "default"', () => {
    const noModel = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "body",
    });
    expect(noModel).not.toContain("model:");

    const defaultModel = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      model: "default",
      systemPrompt: "body",
    });
    expect(defaultModel).not.toContain("model:");
  });

  test("omits thinking when undefined", () => {
    const result = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "body",
    });
    expect(result).not.toContain("thinking:");
  });

  test("omits subagent_agents when array is empty", () => {
    const result = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "body",
    });
    expect(result).not.toContain("subagent_agents:");
  });

  test("omits timeout_ms when undefined", () => {
    const result = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "body",
    });
    expect(result).not.toContain("timeout_ms:");
  });

  test("serializes skills: none for false, skills: all for true, comma-separated for array", () => {
    const none = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      skills: false,
      systemPrompt: "body",
    });
    expect(none).toContain("skills: none");

    const all = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      skills: true,
      systemPrompt: "body",
    });
    expect(all).toContain("skills: all");

    const list = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      skills: ["tdd", "writing-go"],
      systemPrompt: "body",
    });
    expect(list).toContain("skills: tdd, writing-go");
  });

  test("omits skills when undefined", () => {
    const result = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "body",
    });
    expect(result).not.toContain("skills");
  });

  test("deduplicates and trims tool names", () => {
    const result = serializeAgent({
      description: "d",
      tools: [" bash ", "read", "bash", " read "],
      subagentAgents: [],
      systemPrompt: "body",
    });
    expect(result).toContain("tools: bash, read");
    // Should not have duplicates
    const toolsLine = result.split("\n").find((l) => l.startsWith("tools:"));
    expect(toolsLine).toBe("tools: bash, read");
  });

  test("deduplicates subagent_agents", () => {
    const result = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: ["worker", "worker", "researcher"],
      systemPrompt: "body",
    });
    expect(result).toContain("subagent_agents: worker, researcher");
  });

  test("trims and normalizes systemPrompt (strips CRLF, trailing whitespace)", () => {
    const result = serializeAgent({
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "# Prompt\r\nDo work.\r\n  \n",
    });
    expect(result).toContain("# Prompt\nDo work.");
    expect(result).not.toContain("\r\n");
  });
});

describe("round-trip", () => {
  test("parseAgentContent(path, serializeAgent(input)) yields same semantic definition", () => {
    const input: AgentCreationInput = {
      name: "Scout",
      description: "Scout files",
      tools: ["bash", "read"],
      model: "claude-sonnet",
      thinking: "medium",
      subagentAgents: ["worker"],
      timeoutMs: 180000,
      skills: ["tdd", "writing-go"],
      systemPrompt: "# System prompt\nInspect the repo.",
    };

    const serialized = serializeAgent(input);
    const parsed = parseAgentContent("/tmp/scout.md", serialized);

    // serializeAgent trims the systemPrompt and appends a trailing \n to the file,
    // so the parsed body gets a trailing newline
    expect(parsed).toMatchObject({
      ok: true,
      agent: {
        name: "Scout",
        description: "Scout files",
        tools: ["bash", "read"],
        model: "claude-sonnet",
        thinking: "medium",
        subagentAgents: ["worker"],
        timeoutMs: 180000,
        skills: ["tdd", "writing-go"],
        systemPrompt: "# System prompt\nInspect the repo.\n",
      },
    });
  });

  test("round-trip preserves skills: false / skills: true / skills: [...]", () => {
    for (const skills of [false, true, ["a", "b"]] as Array<
      boolean | string[]
    >) {
      const input: AgentCreationInput = {
        description: "d",
        tools: ["read"],
        subagentAgents: [],
        skills,
        systemPrompt: "body",
      };

      const serialized = serializeAgent(input);
      const parsed = parseAgentContent("/tmp/agent.md", serialized);
      expect(parsed).toMatchObject({
        ok: true,
        agent: { skills },
      });
    }
  });

  test("round-trip preserves optional fields when present vs absent", () => {
    const withAll: AgentCreationInput = {
      name: "Test",
      description: "d",
      tools: ["read"],
      model: "claude-sonnet",
      thinking: "high",
      subagentAgents: ["worker"],
      timeoutMs: 60000,
      skills: ["tdd"],
      systemPrompt: "body",
    };

    const withNone: AgentCreationInput = {
      description: "d",
      tools: ["read"],
      subagentAgents: [],
      systemPrompt: "body",
    };

    const parsedAll = parseAgentContent(
      "/tmp/test.md",
      serializeAgent(withAll),
    );
    expect(parsedAll).toMatchObject({
      ok: true,
      agent: {
        name: "Test",
        model: "claude-sonnet",
        thinking: "high",
        subagentAgents: ["worker"],
        timeoutMs: 60000,
        skills: ["tdd"],
      },
    });

    const parsedNone = parseAgentContent(
      "/tmp/agent.md",
      serializeAgent(withNone),
    );
    expect(parsedNone).toMatchObject({
      ok: true,
      agent: {
        model: undefined,
        thinking: undefined,
        subagentAgents: [],
        timeoutMs: undefined,
        skills: undefined,
      },
    });
  });
});
