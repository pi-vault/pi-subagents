import type { ToolBudgetConfig } from "../shared/types.js";

export interface AgentFrontmatterConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  toolBudget?: ToolBudgetConfig;
}

export interface ToolParamConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  toolBudget?: ToolBudgetConfig;
}

export interface ParentDefaults {
  model?: string;
  thinking?: string;
  defaultMaxTurns?: number;
  toolBudget?: ToolBudgetConfig;
}

export interface ResolvedInvocationConfig {
  model?: string;
  thinking?: string;
  maxTurns: number;
  isolated: boolean;
  inheritContext: boolean;
  toolBudget?: ToolBudgetConfig;
}

export function resolveInvocationConfig(
  frontmatter: AgentFrontmatterConfig,
  toolParams: ToolParamConfig,
  defaults: ParentDefaults,
): ResolvedInvocationConfig {
  return {
    model: frontmatter.model ?? toolParams.model ?? defaults.model,
    thinking: frontmatter.thinking ?? toolParams.thinking ?? defaults.thinking,
    maxTurns:
      frontmatter.maxTurns ??
      toolParams.maxTurns ??
      defaults.defaultMaxTurns ??
      0,
    isolated: frontmatter.isolated ?? toolParams.isolated ?? false,
    inheritContext:
      frontmatter.inheritContext ?? toolParams.inheritContext ?? false,
    // Tool budgets: inverted priority (tool params > frontmatter > config).
    // The parent orchestrator can restrict a child's budget per-call.
    toolBudget: toolParams.toolBudget ?? frontmatter.toolBudget ?? defaults.toolBudget,
  };
}
