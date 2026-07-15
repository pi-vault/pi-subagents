// ─── Child Watchdog Config Resolution ────────────────────────────────────────

import type { WatchdogConfig } from "./watchdog.js";

export interface ChildWatchdogConfig {
  model?: string;
  thinking?: string;
}

/**
 * Resolve child watchdog configuration for a given agent type.
 * Returns undefined if child watchdog should NOT run for this agent.
 *
 * Priority order for model/thinking: per-agent override > children default > parent config
 */
export function resolveChildWatchdogConfig(
  config: WatchdogConfig,
  agentType: string,
): ChildWatchdogConfig | undefined {
  if (!config.enabled || !config.children.enabled) return undefined;

  const override = config.children.overrides[agentType];
  if (override?.enabled === false) return undefined;

  return {
    model: override?.model ?? config.children.model ?? config.model,
    thinking: override?.thinking ?? config.children.thinking ?? config.thinking,
  };
}
