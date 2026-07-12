import { describe, expect, test } from "vitest";
import {
  parseSingleTaskToken,
  parseGroupSegment,
  hasGroupSyntax,
  parseChainExpression,
  extractExecutionFlags,
  SlashParseError,
} from "../src/core/slash-chain.js";

describe("extractExecutionFlags", () => {
  test("extracts --bg flag", () => {
    const result = extractExecutionFlags('scout "task" --bg');
    expect(result.bg).toBe(true);
    expect(result.fork).toBe(false);
    expect(result.args).toBe('scout "task"');
  });

  test("extracts --fork flag", () => {
    const result = extractExecutionFlags('scout "task" --fork');
    expect(result.fork).toBe(true);
    expect(result.bg).toBe(false);
    expect(result.args).toBe('scout "task"');
  });

  test("extracts both flags", () => {
    const result = extractExecutionFlags('scout "task" --bg --fork');
    expect(result.bg).toBe(true);
    expect(result.fork).toBe(true);
    expect(result.args).toBe('scout "task"');
  });

  test("returns clean args when no flags", () => {
    const result = extractExecutionFlags('scout "task"');
    expect(result.bg).toBe(false);
    expect(result.fork).toBe(false);
    expect(result.args).toBe('scout "task"');
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

describe("hasGroupSyntax", () => {
  test("detects parentheses in a step position", () => {
    expect(hasGroupSyntax("a -> (b | c)")).toBe(true);
  });

  test("does not treat a bare pipe as group syntax", () => {
    expect(hasGroupSyntax("a -> b | c")).toBe(false);
  });

  test("ignores parens inside quotes", () => {
    expect(hasGroupSyntax('a -> b "with (paren) inside"')).toBe(false);
  });

  test("returns false for plain chain input", () => {
    expect(hasGroupSyntax("scout -> reviewer")).toBe(false);
  });

  test("still detects a group that opens a step", () => {
    expect(hasGroupSyntax('scout "x" -> (a "y" | b "z")')).toBe(true);
    expect(hasGroupSyntax('(a "y" | b "z") -> writer')).toBe(true);
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
