import { describe, expect, it } from "vitest";
import type {
  AgentRecord,
  RunResult,
} from "../src/shared/types.js";

describe("new execution model types", () => {
  it("AgentRecord can be constructed", () => {
    const record: AgentRecord = {
      id: "test-1",
      type: "scout",
      status: "running",
      toolUses: 0,
      turnCount: 0,
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    };
    expect(record.status).toBe("running");
  });

  it("RunResult has required fields", () => {
    const result: RunResult = {
      responseText: "done",
      session: {} as never,
      aborted: false,
      steered: false,
    };
    expect(result.aborted).toBe(false);
    expect(result.steered).toBe(false);
  });
});
