export interface AgentFrontmatterConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
}

export interface ToolParamConfig {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
}

export interface ParentDefaults {
  model?: string;
  thinking?: string;
  defaultMaxTurns?: number;
}

export interface ResolvedInvocationConfig {
  model?: string;
  thinking?: string;
  maxTurns: number;
  isolated: boolean;
  inheritContext: boolean;
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
  };
}
