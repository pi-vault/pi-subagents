import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  ChainOutputMap,
  ResolvedToolBudget,
  SequentialStep,
  WorkflowGraphSnapshot,
} from "../shared/types.js";
import {
  isParallelStep,
  isDynamicParallelStep,
  resolveChainTemplates,
  createChainDir,
  removeChainDir,
  resolveStepBehavior,
  buildChainInstructions,
  type AgentBehaviorDefaults,
} from "./chain-settings.js";
import {
  validateChainOutputBindings,
  resolveOutputReferences,
  outputEntryFromResult,
} from "./chain-outputs.js";
import { consumeChainAppendRequests } from "./chain-append.js";
import { buildWorkflowGraphSnapshot } from "./workflow-graph.js";
import { validateToolBudget } from "./tool-budget.js";

export interface StepSpawnOptions {
  toolBudget?: ResolvedToolBudget;
  isolation?: "worktree";
  skills?: string[];
}

export interface ChainExecutionParams {
  steps: ChainStep[];
  task: string;
  spawnAndWait: (
    agentDef: AgentDefinition,
    prompt: string,
    cwd: string,
    options?: StepSpawnOptions,
  ) => Promise<{ id: string; record: AgentRecord }>;
  findAgent: (name: string) => AgentDefinition;
  cwd: string;
  runId: string;
  chainDir?: string;
  signal?: AbortSignal;
  onGraphUpdate?: (snapshot: WorkflowGraphSnapshot) => void;
  isAsync?: boolean;
}

export interface ChainExecutionResult {
  content: string;
  isError: boolean;
  workflowGraph?: WorkflowGraphSnapshot;
}

function agentDefaults(agentDef: AgentDefinition): AgentBehaviorDefaults {
  return {
    skills: Array.isArray(agentDef.skills) ? agentDef.skills : undefined,
  };
}

export async function executeChain(
  params: ChainExecutionParams,
): Promise<ChainExecutionResult> {
  const { steps, task, spawnAndWait, findAgent, cwd, runId, signal, onGraphUpdate } = params;

  // 1. Validate output bindings
  validateChainOutputBindings(steps);

  // 2. Resolve templates
  const templates = resolveChainTemplates(steps);

  // 3. Create chain directory
  const ownedChainDir = !params.chainDir;
  const chainDir = params.chainDir ?? createChainDir(runId);

  // 4. Step loop
  const outputs: ChainOutputMap = {};
  let prev = "";
  const results: Array<{ agent: string; output: string; status: string }> = [];
  const chainSteps = [...steps];

  // --- Snapshot state ---
  const stepStatuses: Array<{ status?: string; error?: string }> = [];
  const finalSnapshot = () =>
    buildWorkflowGraphSnapshot({ runId, steps: chainSteps, stepStatuses });

  function emitSnapshot(currentStepIndex?: number, currentFlatIndex?: number): void {
    if (!onGraphUpdate) return;
    const snapshot = buildWorkflowGraphSnapshot({
      runId,
      steps: chainSteps,
      currentStepIndex,
      currentFlatIndex,
      stepStatuses,
    });
    onGraphUpdate(snapshot);
  }

  // Emit initial snapshot (all pending)
  emitSnapshot(0, 0);

  let aborted = false;
  let flatIndex = 0;
  let progressCreated = false;
  try {
  for (let stepIndex = 0; stepIndex < chainSteps.length; stepIndex++) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    const step = chainSteps[stepIndex]!;
    const template = templates[stepIndex];

    if (isParallelStep(step)) {
      // --- Parallel step ---
      const taskTemplates = template as string[];

      // Mark all parallel items as running
      for (let i = 0; i < step.parallel.length; i++) {
        stepStatuses[flatIndex + i] = { status: "running" };
      }
      emitSnapshot(stepIndex, flatIndex);

      const promises = step.parallel.map(async (item, i) => {
        const agentDef = findAgent(item.agent);

        // Resolve step behavior and build instructions
        const behavior = resolveStepBehavior(agentDefaults(agentDef), {
          output: item.output,
          outputMode: item.outputMode,
          reads: item.reads,
          progress: item.progress,
          skills: item.skills,
          model: item.model,
        });
        const isFirstProgress = behavior.progress && !progressCreated;
        if (isFirstProgress) progressCreated = true;
        const { prefix, suffix } = buildChainInstructions(behavior, chainDir, isFirstProgress);

        let taskStr = taskTemplates[i] ?? "{previous}";
        taskStr = taskStr
          .replace(/\{task\}/g, task)
          .replace(/\{previous\}/g, prev)
          .replace(/\{chain_dir\}/g, chainDir);
        taskStr = resolveOutputReferences(taskStr, outputs);

        const fullPrompt = [prefix, taskStr, suffix].filter(Boolean).join("\n\n");

        // Build spawn options
        const parallelOptions: StepSpawnOptions = {};
        if (item.toolBudget) {
          const validated = validateToolBudget(item.toolBudget);
          if (!validated.error && validated.budget) parallelOptions.toolBudget = validated.budget;
        }
        if (step.worktree) parallelOptions.isolation = "worktree";
        if (behavior.skills && behavior.skills.length > 0) {
          parallelOptions.skills = behavior.skills;
        }

        const { record } = await spawnAndWait(agentDef, fullPrompt, cwd, parallelOptions);
        const output = record.result ?? "";
        const itemFlatIndex = flatIndex + i;

        stepStatuses[itemFlatIndex] = {
          status: record.status === "error" ? "failed" : "completed",
          error: record.error,
        };
        emitSnapshot(stepIndex, itemFlatIndex);

        if (item.as) {
          outputs[item.as] = outputEntryFromResult(
            item.agent,
            output,
            stepIndex,
          );
        }
        return { output, status: record.status, agent: item.agent };
      });

      const parallelResults = await Promise.all(promises);

      // Check for failures
      const failed = parallelResults.filter((r) => r.status === "error");
      if (step.failFast && failed.length > 0) {
        return {
          content: `Chain failed at parallel step ${stepIndex + 1}: ${failed[0]?.output}`,
          isError: true,
          workflowGraph: finalSnapshot(),
        };
      }

      prev = parallelResults.map((r) => r.output).join("\n---\n");
      for (const r of parallelResults) {
        results.push({ agent: r.agent, output: r.output, status: r.status });
      }
      flatIndex += step.parallel.length;
    } else if (isDynamicParallelStep(step)) {
      // --- Dynamic parallel step ---
      stepStatuses[flatIndex] = { status: "running" };
      emitSnapshot(stepIndex, flatIndex);

      const sourceEntry = outputs[step.expand.from.output];
      if (!sourceEntry?.structured) {
        stepStatuses[flatIndex] = {
          status: "failed",
          error: `no structured output from '${step.expand.from.output}'`,
        };
        emitSnapshot(stepIndex, flatIndex);
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: no structured output from '${step.expand.from.output}'`,
          isError: true,
          workflowGraph: finalSnapshot(),
        };
      }

      // JSON pointer resolution
      const pathParts = step.expand.from.path.split("/").filter(Boolean);
      let items: unknown = sourceEntry.structured;
      for (const part of pathParts) {
        if (items && typeof items === "object") {
          items = (items as Record<string, unknown>)[part];
        }
      }
      if (!Array.isArray(items)) {
        if (step.expand.onEmpty === "skip") {
          stepStatuses[flatIndex] = { status: "skipped" };
          emitSnapshot(stepIndex, flatIndex);
          prev = "";
          flatIndex++;
          continue;
        }
        stepStatuses[flatIndex] = {
          status: "failed",
          error: "expanded items is not an array",
        };
        emitSnapshot(stepIndex, flatIndex);
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: expanded items is not an array`,
          isError: true,
          workflowGraph: finalSnapshot(),
        };
      }
      if (items.length === 0 && step.expand.onEmpty === "skip") {
        stepStatuses[flatIndex] = { status: "skipped" };
        emitSnapshot(stepIndex, flatIndex);
        prev = "";
        flatIndex++;
        continue;
      }
      if (step.expand.maxItems && items.length > step.expand.maxItems) {
        items = items.slice(0, step.expand.maxItems);
      }

      // Resolve behavior once (shared across all dynamic items)
      const dynAgentDef = findAgent(step.parallel.agent);
      const dynBehavior = resolveStepBehavior(agentDefaults(dynAgentDef), {
        output: step.parallel.output,
        outputMode: step.parallel.outputMode,
        reads: step.parallel.reads,
        progress: step.parallel.progress,
        skills: step.parallel.skills,
      });
      if (dynBehavior.progress) progressCreated = true;
      const { prefix: dynPrefix, suffix: dynSuffix } = buildChainInstructions(dynBehavior, chainDir, false);

      const dynamicResults = await Promise.all(
        (items as unknown[]).map(async (item) => {
          const agentDef = findAgent(step.parallel.agent);

          const { prefix, suffix } = { prefix: dynPrefix, suffix: dynSuffix };

          let taskStr = step.parallel.task ?? "{previous}";
          // Replace item template variables
          const itemName = step.expand.item ?? "item";
          if (item && typeof item === "object") {
            for (const [k, v] of Object.entries(
              item as Record<string, unknown>,
            )) {
              taskStr = taskStr.replace(
                new RegExp(`\\{${itemName}\\.${k}\\}`, "g"),
                String(v),
              );
            }
          }
          taskStr = taskStr
            .replace(/\{task\}/g, task)
            .replace(/\{previous\}/g, prev)
            .replace(/\{chain_dir\}/g, chainDir);
          taskStr = resolveOutputReferences(taskStr, outputs);

          const fullPrompt = [prefix, taskStr, suffix].filter(Boolean).join("\n\n");

          // Build spawn options
          const dynOptions: StepSpawnOptions = {};
          if (step.parallel.toolBudget) {
            const validated = validateToolBudget(step.parallel.toolBudget);
            if (!validated.error && validated.budget) dynOptions.toolBudget = validated.budget;
          }
          if (dynBehavior.skills && dynBehavior.skills.length > 0) {
            dynOptions.skills = dynBehavior.skills;
          }

          const { record } = await spawnAndWait(agentDef, fullPrompt, cwd, dynOptions);
          return { output: record.result ?? "", status: record.status };
        }),
      );

      // Check for failures (failFast)
      const failed = dynamicResults.filter((r) => r.status === "error");
      if (step.failFast && failed.length > 0) {
        stepStatuses[flatIndex] = { status: "failed", error: failed[0]?.output };
        emitSnapshot(stepIndex, flatIndex);
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: ${failed[0]?.output}`,
          isError: true,
          workflowGraph: finalSnapshot(),
        };
      }

      const collectedOutput = dynamicResults
        .map((r) => r.output)
        .join("\n---\n");
      outputs[step.collect.as] = outputEntryFromResult(
        step.parallel.agent,
        collectedOutput,
        stepIndex,
      );
      prev = collectedOutput;
      stepStatuses[flatIndex] = { status: "completed" };
      emitSnapshot(stepIndex, flatIndex);
      for (const r of dynamicResults) {
        results.push({ agent: step.parallel.agent, output: r.output, status: r.status });
      }
      flatIndex++;
    } else {
      // --- Sequential step ---
      const seqStep = step as SequentialStep;
      const agentDef = findAgent(seqStep.agent);

      stepStatuses[flatIndex] = { status: "running" };
      emitSnapshot(stepIndex, flatIndex);

      // Resolve step behavior and build instructions
      const behavior = resolveStepBehavior(agentDefaults(agentDef), {
        output: seqStep.output,
        outputMode: seqStep.outputMode,
        reads: seqStep.reads,
        progress: seqStep.progress,
        skills: seqStep.skills,
        model: seqStep.model,
      });
      const isFirstProgress = behavior.progress && !progressCreated;
      if (isFirstProgress) progressCreated = true;
      const { prefix, suffix } = buildChainInstructions(behavior, chainDir, isFirstProgress);

      let taskStr = (template as string) ?? "{task}";
      taskStr = taskStr
        .replace(/\{task\}/g, task)
        .replace(/\{previous\}/g, prev)
        .replace(/\{chain_dir\}/g, chainDir);
      taskStr = resolveOutputReferences(taskStr, outputs);

      const fullPrompt = [prefix, taskStr, suffix].filter(Boolean).join("\n\n");

      // Build spawn options
      const seqOptions: StepSpawnOptions = {};
      if (seqStep.toolBudget) {
        const validated = validateToolBudget(seqStep.toolBudget);
        if (!validated.error && validated.budget) seqOptions.toolBudget = validated.budget;
      }
      if (behavior.skills && behavior.skills.length > 0) {
        seqOptions.skills = behavior.skills;
      }

      const { record } = await spawnAndWait(agentDef, fullPrompt, cwd, seqOptions);
      const output = record.result ?? "";

      if (record.status === "error") {
        stepStatuses[flatIndex] = { status: "failed", error: record.error };
        emitSnapshot(stepIndex, flatIndex);
        return {
          content: `Chain failed at step ${stepIndex + 1} (${seqStep.agent}): ${record.error ?? output}`,
          isError: true,
          workflowGraph: finalSnapshot(),
        };
      }

      stepStatuses[flatIndex] = { status: "completed" };
      emitSnapshot(stepIndex, flatIndex);

      if (seqStep.as) {
        outputs[seqStep.as] = outputEntryFromResult(
          seqStep.agent,
          output,
          stepIndex,
        );
      }
      prev = output;
      results.push({ agent: seqStep.agent, output, status: record.status });
      flatIndex++;
    }

    // Check for appended steps (async chains)
    if (params.isAsync) {
      const appended = consumeChainAppendRequests(runId);
      if (appended.length > 0) {
        chainSteps.push(...appended);
        templates.push(...resolveChainTemplates(appended));
      }
    }
  }

  // 5. Build summary
  const summary = results
    .map((r) => `[${r.agent}] ${r.output.slice(0, 200)}`)
    .join("\n\n");

  if (aborted) {
    return {
      content: `Chain aborted after ${results.length} of ${chainSteps.length} steps.\n\n${summary}`,
      isError: true,
      workflowGraph: finalSnapshot(),
    };
  }

  return {
    content: prev || summary,
    isError: false,
    workflowGraph: finalSnapshot(),
  };
  } finally {
    if (ownedChainDir) removeChainDir(chainDir);
  }
}
