import { describe, expect, test } from "vitest";
import { buildWorkflowGraphSnapshot } from "../src/core/workflow-graph.js";
import type {
  ChainStep,
  SequentialStep,
  ParallelStep,
  DynamicParallelStep,
  WorkflowNodeStatus,
} from "../src/shared/types.js";

describe("buildWorkflowGraphSnapshot", () => {
  test("builds snapshot for sequential steps", () => {
    const steps: ChainStep[] = [
      { agent: "scout", task: "scan", label: "Scan files" },
      { agent: "planner", task: "plan" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "test-run",
      steps,
    });

    expect(snapshot.runId).toBe("test-run");
    expect(snapshot.mode).toBe("chain");
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0]).toMatchObject({
      id: "step-0",
      kind: "step",
      agent: "scout",
      label: "Scan files",
      status: "pending",
      flatIndex: 0,
      stepIndex: 0,
    });
    expect(snapshot.nodes[1]).toMatchObject({
      id: "step-1",
      kind: "step",
      agent: "planner",
      label: "planner",
      status: "pending",
      flatIndex: 1,
      stepIndex: 1,
    });
  });

  test("marks current step as running", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t" },
      { agent: "b", task: "t" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      currentStepIndex: 1,
      currentFlatIndex: 1,
    });

    expect(snapshot.nodes[0]!.status).toBe("pending");
    expect(snapshot.nodes[1]!.status).toBe("running");
    expect(snapshot.currentNodeId).toBe("step-1");
  });

  test("uses stepStatuses when provided", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t" },
      { agent: "b", task: "t" },
      { agent: "c", task: "t" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      currentFlatIndex: 2,
      stepStatuses: [
        { status: "completed" },
        { status: "completed" },
        { status: "running" },
      ],
    });

    expect(snapshot.nodes[0]!.status).toBe("completed");
    expect(snapshot.nodes[1]!.status).toBe("completed");
    expect(snapshot.nodes[2]!.status).toBe("running");
  });

  test("builds snapshot for parallel step", () => {
    const steps: ChainStep[] = [
      { agent: "first", task: "t" },
      {
        parallel: [
          { agent: "worker-a", task: "t", label: "Worker A" },
          { agent: "worker-b", task: "t" },
        ],
      },
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      stepStatuses: [
        { status: "completed" },
        { status: "running" },
        { status: "pending" },
      ],
    });

    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0]!.status).toBe("completed");
    const group = snapshot.nodes[1]!;
    expect(group.kind).toBe("parallel-group");
    expect(group.status).toBe("running");
    expect(group.children).toHaveLength(2);
    expect(group.children![0]).toMatchObject({
      kind: "agent",
      agent: "worker-a",
      label: "Worker A",
      status: "running",
      flatIndex: 1,
    });
    expect(group.children![1]).toMatchObject({
      kind: "agent",
      agent: "worker-b",
      label: "worker-b",
      status: "pending",
      flatIndex: 2,
    });
  });

  test("builds snapshot for dynamic parallel step", () => {
    const steps: ChainStep[] = [
      {
        expand: { from: { output: "items", path: "/list" } },
        parallel: { agent: "processor", task: "handle {item}" },
        collect: { as: "results" },
      } as DynamicParallelStep,
    ];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
    });

    expect(snapshot.nodes).toHaveLength(1);
    const group = snapshot.nodes[0]!;
    expect(group.kind).toBe("dynamic-parallel-group");
    expect(group.label).toBe("Dynamic fanout (results)");
    expect(group.status).toBe("pending");
    expect(group.dynamic).toMatchObject({
      sourceOutput: "items",
      sourcePath: "/list",
      collectAs: "results",
    });
  });

  test("groups nodes by phase", () => {
    const steps: ChainStep[] = [
      { agent: "a", task: "t", phase: "Setup" },
      { agent: "b", task: "t", phase: "Setup" },
      { agent: "c", task: "t", phase: "Execute" },
    ];
    const snapshot = buildWorkflowGraphSnapshot({ runId: "r1", steps });

    expect(snapshot.phases).toHaveLength(2);
    expect(snapshot.phases[0]).toEqual({
      title: "Setup",
      nodeIds: ["step-0", "step-1"],
    });
    expect(snapshot.phases[1]).toEqual({
      title: "Execute",
      nodeIds: ["step-2"],
    });
  });

  test("records error on failed step", () => {
    const steps: ChainStep[] = [{ agent: "a", task: "t" }];
    const snapshot = buildWorkflowGraphSnapshot({
      runId: "r1",
      steps,
      stepStatuses: [{ status: "failed", error: "timeout" }],
    });

    expect(snapshot.nodes[0]!.status).toBe("failed");
    expect(snapshot.nodes[0]!.error).toBe("timeout");
  });
});
