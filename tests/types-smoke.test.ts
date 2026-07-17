import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AgentInvocation,
  AgentRecord,
  RunResult,
  SpawnOptions,
  WidgetMode,
} from "../src/shared/types.js";

describe("new execution model types", () => {
  it("AgentRecord can be constructed", () => {
    const record: AgentRecord = {
      id: "test-1",
      type: "scout",
      status: "running",
      toolUses: 0,
      turnCount: 0,
      live: { activeTools: [], responseText: "" },
      startedAt: Date.now(),
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      description: "smoke test agent",
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

describe("Task 5.1: description fields and WidgetMode", () => {
  it("WidgetMode accepts all valid values", () => {
    const modes: WidgetMode[] = ["all", "background", "off"];
    expect(modes).toHaveLength(3);
  });

  it("AgentRecord requires a description field", () => {
    const record: AgentRecord = {
      id: "r1",
      type: "scout",
      status: "queued",
      toolUses: 0,
      turnCount: 0,
      live: { activeTools: [], responseText: "" },
      startedAt: 0,
      lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
      description: "doing a task",
    };
    // description is required (string, not optional)
    const desc: string = record.description;
    expect(desc).toBe("doing a task");
  });

  it("AgentInvocation has an optional description field", () => {
    const withDesc: AgentInvocation = {
      agent: "scout",
      task: "do something",
      description: "a label",
    };
    const withoutDesc: AgentInvocation = {
      agent: "scout",
      task: "do something",
    };
    expect(withDesc.description).toBe("a label");
    expect(withoutDesc.description).toBeUndefined();
  });

  it("SpawnOptions has an optional description field", () => {
    const withDesc: SpawnOptions = {
      prompt: "do something",
      cwd: "/tmp",
      description: "a label",
    };
    const withoutDesc: SpawnOptions = {
      prompt: "do something",
      cwd: "/tmp",
    };
    expect(withDesc.description).toBe("a label");
    expect(withoutDesc.description).toBeUndefined();
  });

  it("SpawnOptions exposes only the record and session callbacks", () => {
    expectTypeOf<Extract<keyof SpawnOptions, `on${string}`>>()
      .toEqualTypeOf<"onActivity" | "onSessionCreated">();
  });
});
