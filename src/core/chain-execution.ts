import type {
  AgentDefinition,
  AgentRecord,
  ChainStep,
  ChainOutputMap,
  SequentialStep,
  WorkflowGraphSnapshot,
} from "../shared/types.js";
import {
  isParallelStep,
  isDynamicParallelStep,
  resolveChainTemplates,
  createChainDir,
} from "./chain-settings.js";
import {
  validateChainOutputBindings,
  resolveOutputReferences,
  outputEntryFromResult,
} from "./chain-outputs.js";
import { consumeChainAppendRequests } from "./chain-append.js";

export interface ChainExecutionParams {
  steps: ChainStep[];
  task: string;
  spawnAndWait: (
    agentDef: AgentDefinition,
    prompt: string,
    cwd: string,
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

export async function executeChain(
  params: ChainExecutionParams,
): Promise<ChainExecutionResult> {
  const { steps, task, spawnAndWait, findAgent, cwd, runId, signal } = params;

  // 1. Validate output bindings
  validateChainOutputBindings(steps);

  // 2. Resolve templates
  const templates = resolveChainTemplates(steps);

  // 3. Create chain directory
  const chainDir = params.chainDir ?? createChainDir(runId);

  // 4. Step loop
  const outputs: ChainOutputMap = {};
  let prev = "";
  const results: Array<{ agent: string; output: string; status: string }> = [];
  const chainSteps = [...steps];

  let aborted = false;
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

      // Execute parallel items concurrently
      const promises = step.parallel.map(async (item, i) => {
        const agentDef = findAgent(item.agent);
        let taskStr = taskTemplates[i] ?? "{previous}";
        taskStr = taskStr
          .replace(/\{task\}/g, task)
          .replace(/\{previous\}/g, prev)
          .replace(/\{chain_dir\}/g, chainDir);
        taskStr = resolveOutputReferences(taskStr, outputs);

        const { record } = await spawnAndWait(agentDef, taskStr, cwd);
        const output = record.result ?? "";
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
          content: `Chain failed at parallel step ${stepIndex + 1}: ${failed[0]!.output}`,
          isError: true,
        };
      }

      prev = parallelResults.map((r) => r.output).join("\n---\n");
      for (const r of parallelResults) {
        results.push({ agent: r.agent, output: r.output, status: r.status });
      }
    } else if (isDynamicParallelStep(step)) {
      // --- Dynamic parallel step ---
      const sourceEntry = outputs[step.expand.from.output];
      if (!sourceEntry?.structured) {
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: no structured output from '${step.expand.from.output}'`,
          isError: true,
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
          prev = "";
          continue;
        }
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: expanded items is not an array`,
          isError: true,
        };
      }
      if (items.length === 0 && step.expand.onEmpty === "skip") {
        prev = "";
        continue;
      }
      if (step.expand.maxItems && items.length > step.expand.maxItems) {
        items = items.slice(0, step.expand.maxItems);
      }

      const dynamicResults = await Promise.all(
        (items as unknown[]).map(async (item) => {
          const agentDef = findAgent(step.parallel.agent);
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

          const { record } = await spawnAndWait(agentDef, taskStr, cwd);
          return { output: record.result ?? "", status: record.status };
        }),
      );

      // Check for failures (failFast)
      const failed = dynamicResults.filter((r) => r.status === "error");
      if (step.failFast && failed.length > 0) {
        return {
          content: `Chain failed at dynamic step ${stepIndex + 1}: ${failed[0]?.output}`,
          isError: true,
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
      for (const r of dynamicResults) {
        results.push({ agent: step.parallel.agent, output: r.output, status: r.status });
      }
    } else {
      // --- Sequential step ---
      const seqStep = step as SequentialStep;
      const agentDef = findAgent(seqStep.agent);

      let taskStr = (template as string) ?? "{task}";
      taskStr = taskStr
        .replace(/\{task\}/g, task)
        .replace(/\{previous\}/g, prev)
        .replace(/\{chain_dir\}/g, chainDir);
      taskStr = resolveOutputReferences(taskStr, outputs);

      const { record } = await spawnAndWait(agentDef, taskStr, cwd);
      const output = record.result ?? "";

      if (record.status === "error") {
        return {
          content: `Chain failed at step ${stepIndex + 1} (${seqStep.agent}): ${record.error ?? output}`,
          isError: true,
        };
      }

      if (seqStep.as) {
        outputs[seqStep.as] = outputEntryFromResult(
          seqStep.agent,
          output,
          stepIndex,
        );
      }
      prev = output;
      results.push({ agent: seqStep.agent, output, status: record.status });
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
    };
  }

  return {
    content: prev || summary,
    isError: false,
  };
}
