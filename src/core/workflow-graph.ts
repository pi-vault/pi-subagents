import {
  isParallelStep,
  isDynamicParallelStep,
} from "./chain-settings.js";
import type {
  ChainStep,
  DynamicParallelStep,
  SequentialStep,
  SubagentRunMode,
  WorkflowGraphNode,
  WorkflowGraphSnapshot,
  WorkflowNodeStatus,
} from "../shared/types.js";

export interface WorkflowGraphBuildInput {
  runId: string;
  mode?: SubagentRunMode;
  steps: ChainStep[];
  currentStepIndex?: number;
  currentFlatIndex?: number;
  stepStatuses?: Array<{ status?: string; error?: string }>;
}

function normalizeStatus(raw: string | undefined): WorkflowNodeStatus {
  switch (raw) {
    case "complete":
    case "completed":
      return "completed";
    case "running":
      return "running";
    case "failed":
    case "error":
      return "failed";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function nodeStatus(
  input: WorkflowGraphBuildInput,
  flatIndex: number,
): WorkflowNodeStatus {
  const override = input.stepStatuses?.[flatIndex];
  if (override?.status) return normalizeStatus(override.status);
  if (input.currentFlatIndex === flatIndex) return "running";
  return "pending";
}

function summarizeParallelStatuses(
  statuses: WorkflowNodeStatus[],
): WorkflowNodeStatus {
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "paused")) return "paused";
  if (statuses.length > 0 && statuses.every((s) => s === "completed"))
    return "completed";
  if (statuses.some((s) => s === "completed")) return "running";
  return "pending";
}

function pushPhase(
  phases: WorkflowGraphSnapshot["phases"],
  phase: string | undefined,
  nodeId: string,
): void {
  if (!phase) return;
  let group = phases.find((g) => g.title === phase);
  if (!group) {
    group = { title: phase, nodeIds: [] };
    phases.push(group);
  }
  group.nodeIds.push(nodeId);
}

export function buildWorkflowGraphSnapshot(
  input: WorkflowGraphBuildInput,
): WorkflowGraphSnapshot {
  const nodes: WorkflowGraphNode[] = [];
  const phases: WorkflowGraphSnapshot["phases"] = [];
  let flatIndex = 0;
  let currentNodeId: string | undefined;

  for (let stepIndex = 0; stepIndex < input.steps.length; stepIndex++) {
    const step = input.steps[stepIndex]!;

    if (isParallelStep(step)) {
      const groupId = `step-${stepIndex}`;
      const children: WorkflowGraphNode[] = [];
      const childStatuses: WorkflowNodeStatus[] = [];

      for (let i = 0; i < step.parallel.length; i++) {
        const task = step.parallel[i]!;
        const status = nodeStatus(input, flatIndex);
        childStatuses.push(status);
        const childId = `step-${stepIndex}-agent-${i}`;
        children.push({
          id: childId,
          kind: "agent",
          agent: task.agent,
          phase: task.phase,
          label: task.label?.trim() || task.agent,
          status,
          flatIndex,
          stepIndex,
          outputName: task.as,
          structured: Boolean(task.outputSchema),
          error: input.stepStatuses?.[flatIndex]?.error,
        });
        pushPhase(phases, task.phase, childId);
        if (status === "running") currentNodeId = childId;
        flatIndex++;
      }

      const groupStatus = summarizeParallelStatuses(childStatuses);
      if (input.currentStepIndex === stepIndex && !currentNodeId)
        currentNodeId = groupId;
      nodes.push({
        id: groupId,
        kind: "parallel-group",
        label:
          step.parallel.length === 1
            ? "Parallel task"
            : `Parallel group (${step.parallel.length})`,
        status: groupStatus,
        stepIndex,
        children,
      });
      continue;
    }

    if (isDynamicParallelStep(step)) {
      const groupId = `step-${stepIndex}`;
      const groupStatus: WorkflowNodeStatus =
        input.currentStepIndex === stepIndex ? "running" : "pending";
      if (input.currentStepIndex === stepIndex) currentNodeId = groupId;

      nodes.push({
        id: groupId,
        kind: "dynamic-parallel-group",
        label:
          (step as DynamicParallelStep).parallel.label?.trim() ||
          `Dynamic fanout (${step.collect.as})`,
        status: groupStatus,
        stepIndex,
        outputName: step.collect.as,
        structured: Boolean(step.collect.outputSchema),
        dynamic: {
          sourceOutput: step.expand.from.output,
          sourcePath: step.expand.from.path,
          itemName: step.expand.item ?? "item",
          maxItems: step.expand.maxItems,
          collectAs: step.collect.as,
        },
        children: [],
      });
      continue;
    }

    // Sequential step
    const seq = step as SequentialStep;
    const status = nodeStatus(input, flatIndex);
    const id = `step-${stepIndex}`;
    nodes.push({
      id,
      kind: "step",
      agent: seq.agent,
      phase: seq.phase,
      label: seq.label?.trim() || seq.agent,
      status,
      flatIndex,
      stepIndex,
      outputName: seq.as,
      structured: Boolean(seq.outputSchema),
      error: input.stepStatuses?.[flatIndex]?.error,
    });
    pushPhase(phases, seq.phase, id);
    if (
      status === "running" ||
      input.currentFlatIndex === flatIndex ||
      input.currentStepIndex === stepIndex
    )
      currentNodeId = id;
    flatIndex++;
  }

  return {
    runId: input.runId,
    mode: input.mode ?? "chain",
    phases,
    nodes,
    currentNodeId,
  };
}
