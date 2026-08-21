import type { Api, Model } from "@earendil-works/pi-ai";
import { getStepAgents } from "./chain-settings.js";
import { resolveModelSelection, validateModelThinking } from "./model-resolver.js";
import type { ModelRegistryLike } from "./model-resolver.js";
import { checkModelScope } from "./model-scope.js";
import type { ModelScopeConfig, ModelScopeViolation } from "./model-scope.js";
import type { AgentDefinition, ChainStep } from "../shared/types.js";

export interface ChainPreflightOptions {
  registry?: ModelRegistryLike;
  parentModel?: Model<Api>;
  modelScope?: ModelScopeConfig;
  onScopeWarning?: (warning: ModelScopeViolation) => void;
}

type ChainTask = {
  agent: string;
  model?: string;
  thinking?: unknown;
};

function withLocation(location: string, error: unknown): Error {
  return new Error(`${location}: ${error instanceof Error ? error.message : String(error)}`);
}

export function validateChainAgents(
  steps: ChainStep[],
  findAgent: (name: string) => AgentDefinition,
): void {
  for (const [index, step] of steps.entries()) {
    for (const [itemIndex, agent] of getStepAgents(step).entries()) {
      const location = "agent" in step
        ? `step ${index + 1} (${agent})`
        : Array.isArray(step.parallel)
          ? `step ${index + 1} parallel item ${itemIndex + 1} (${agent})`
          : `step ${index + 1} dynamic template (${agent})`;
      try {
        findAgent(agent);
      } catch (error) {
        throw withLocation(location, error);
      }
    }
  }
}

function preflightTask(
  task: ChainTask,
  location: string,
  findAgent: (name: string) => AgentDefinition,
  options: ChainPreflightOptions,
): void {
  let agentDef: AgentDefinition;
  try {
    agentDef = findAgent(task.agent);
  } catch (error) {
    throw withLocation(location, error);
  }

  const rawModel = task.model !== undefined ? task.model : agentDef.model;
  let selectedModel = options.parentModel;
  let canonical = selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : undefined;

  if (rawModel !== undefined) {
    if (!options.registry) {
      throw new Error(
        `${location}: Cannot resolve model "${rawModel}": model registry unavailable`,
      );
    }
    try {
      const selection = resolveModelSelection(rawModel, options.registry);
      selectedModel = selection.model;
      canonical = selection.canonical;
    } catch (error) {
      throw withLocation(location, error);
    }
  }

  const thinking = task.thinking ?? agentDef.thinking;
  if (thinking !== undefined) {
    if (!selectedModel || !canonical) {
      throw new Error(`${location}: Cannot validate thinking without an active model`);
    }
    try {
      validateModelThinking(selectedModel, canonical, thinking);
    } catch (error) {
      throw withLocation(location, error);
    }
  }

  if (rawModel !== undefined && canonical) {
    const source = task.model !== undefined ? "explicit" : "inherited";
    const violation = checkModelScope(canonical, options.modelScope, source);
    if (violation?.severity === "error") {
      throw new Error(`${location}: ${violation.message}`);
    }
    if (violation?.severity === "warn") {
      options.onScopeWarning?.({
        ...violation,
        message: `${location}: ${violation.message}`,
      });
    }
  }
}

export function preflightChainModels(
  steps: ChainStep[],
  findAgent: (name: string) => AgentDefinition,
  options: ChainPreflightOptions,
): void {
  for (const [index, step] of steps.entries()) {
    const stepNumber = index + 1;
    if ("agent" in step) {
      preflightTask(step, `step ${stepNumber} (${step.agent})`, findAgent, options);
    } else if (Array.isArray(step.parallel)) {
      for (const [itemIndex, item] of step.parallel.entries()) {
        preflightTask(
          item,
          `step ${stepNumber} parallel item ${itemIndex + 1} (${item.agent})`,
          findAgent,
          options,
        );
      }
    } else {
      const template = step.parallel;
      preflightTask(
        template,
        `step ${stepNumber} dynamic template (${template.agent})`,
        findAgent,
        options,
      );
    }
  }
}
