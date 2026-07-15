import { describe, expect, it } from "vitest";
import { stripExecutionFlags } from "../../src/core/slash-chain.js";

describe("stripExecutionFlags --yes support", () => {
  it("strips --yes flag", () => {
    const result = stripExecutionFlags('scout "task" -> planner --yes');
    expect(result.yes).toBe(true);
    expect(result.bg).toBe(false);
    expect(result.args).toBe('scout "task" -> planner');
  });

  it("strips --yes and --bg together", () => {
    const result = stripExecutionFlags('scout "task" --bg --yes');
    expect(result.yes).toBe(true);
    expect(result.bg).toBe(true);
    expect(result.args).toBe('scout "task"');
  });

  it("strips --yes alone", () => {
    const result = stripExecutionFlags("--yes");
    expect(result.yes).toBe(true);
    expect(result.args).toBe("");
  });

  it("does not set yes when flag absent", () => {
    const result = stripExecutionFlags('scout "task"');
    expect(result.yes).toBe(false);
  });

  it("strips --bg --yes in either order", () => {
    const result = stripExecutionFlags('scout "task" --yes --bg');
    expect(result.yes).toBe(true);
    expect(result.bg).toBe(true);
    expect(result.args).toBe('scout "task"');
  });
});
