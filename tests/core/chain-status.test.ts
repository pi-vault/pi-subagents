import { describe, expect, it } from "vitest";
import { formatChainStatus } from "../../src/core/chain-status.js";
import type { AgentRecord } from "../../src/shared/types.js";

function makeRecord(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: "chain-1",
    type: "(chain)",
    description: "Chain: test",
    status: "running",
    startedAt: Date.now() - 60_000,
    toolUses: 0,
    turnCount: 0,
    live: { activeTools: [], responseText: "" },
    lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    ...overrides,
  } as AgentRecord;
}

describe("formatChainStatus", () => {
  it("formats a running chain with step statuses", () => {
    const record = makeRecord({
      chainSteps: [
        { label: "scout", status: "completed" },
        { label: "planner", status: "running" },
        { label: "worker", status: "pending" },
      ],
    });
    const output = formatChainStatus(record);
    expect(output).toContain("chain-1");
    expect(output).toContain("scout");
    expect(output).toContain("completed");
    expect(output).toContain("planner");
    expect(output).toContain("running");
    expect(output).toContain("worker");
    expect(output).toContain("pending");
  });

  it("shows elapsed time for running chain", () => {
    const record = makeRecord({
      id: "chain-2",
      startedAt: Date.now() - 120_000,
      chainSteps: [{ label: "step1", status: "running" }],
    });
    const output = formatChainStatus(record);
    expect(output).toMatch(/2m/);
  });

  it("shows elapsed for completed chain", () => {
    const now = Date.now();
    const record = makeRecord({
      id: "chain-3",
      status: "completed",
      startedAt: now - 30_000,
      completedAt: now,
      chainSteps: [{ label: "step1", status: "completed" }],
    });
    const output = formatChainStatus(record);
    expect(output).toContain("completed");
    expect(output).toContain("30s");
  });

  it("handles chain with no chainSteps gracefully", () => {
    const record = makeRecord({});
    const output = formatChainStatus(record);
    expect(output).toContain("chain-1");
    expect(output).not.toContain("Steps:");
  });

  it("shows error on failed step", () => {
    const record = makeRecord({
      chainSteps: [{ label: "worker", status: "failed", error: "Build failed" }],
    });
    const output = formatChainStatus(record);
    expect(output).toContain("failed");
    expect(output).toContain("Build failed");
  });
});
