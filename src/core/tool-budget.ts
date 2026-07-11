import type { ResolvedToolBudget, ToolBudgetConfig } from "../shared/types.js";

export type ToolBudgetOutcome =
  | "within-budget"
  | "soft-reached"
  | "hard-blocked";

export const DEFAULT_TOOL_BUDGET_BLOCK: readonly string[] = [
  "read",
  "grep",
  "find",
  "ls",
];

/**
 * Validate raw tool budget config. Returns resolved budget or error string.
 */
export function validateToolBudget(
  raw: unknown,
  label = "toolBudget",
): { budget?: ResolvedToolBudget; error?: string } {
  if (raw === undefined) return {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      error: `${label} must be an object with a required 'hard' field.`,
    };
  }

  const value = raw as ToolBudgetConfig;

  if (
    typeof value.hard !== "number" ||
    !Number.isInteger(value.hard) ||
    value.hard < 1
  ) {
    return { error: `${label}.hard must be an integer >= 1.` };
  }
  if (
    value.soft !== undefined &&
    (typeof value.soft !== "number" ||
      !Number.isInteger(value.soft) ||
      value.soft < 1)
  ) {
    return { error: `${label}.soft must be an integer >= 1 when provided.` };
  }
  if (value.soft !== undefined && value.soft > value.hard) {
    return { error: `${label}.soft must be <= ${label}.hard.` };
  }

  if (value.block !== undefined && value.block !== "*") {
    if (!Array.isArray(value.block)) {
      return { error: `${label}.block must be "*" or an array of tool names.` };
    }
    if (value.block.length === 0) {
      return { error: `${label}.block must contain at least one tool name.` };
    }
    for (const item of value.block) {
      if (typeof item !== "string" || !item.trim()) {
        return {
          error: `${label}.block must contain non-empty string tool names.`,
        };
      }
    }
  }

  const block =
    value.block === "*"
      ? "*"
      : value.block
        ? [...new Set(value.block.map((t) => t.trim()).filter(Boolean))]
        : [...DEFAULT_TOOL_BUDGET_BLOCK];

  return {
    budget: {
      hard: value.hard,
      ...(value.soft !== undefined ? { soft: value.soft } : {}),
      block,
    },
  };
}

/**
 * Format the soft-limit steering nudge.
 */
export function softNudgeMessage(
  budget: ResolvedToolBudget,
  toolCount: number,
): string {
  return (
    `Tool budget soft limit reached after ${toolCount} tool call${toolCount === 1 ? "" : "s"} ` +
    `(soft ${budget.soft}, hard ${budget.hard}). ` +
    "Stop starting new browsing/search work and finalize from the context you already have."
  );
}

/**
 * Format the hard-limit block message.
 */
export function hardBlockMessage(
  budget: ResolvedToolBudget,
  toolName: string,
  toolCount: number,
): string {
  return (
    `Tool budget hard limit reached after ${toolCount} tool call${toolCount === 1 ? "" : "s"} ` +
    `(hard ${budget.hard}). The '${toolName}' tool is blocked so you can finalize ` +
    "from the context you already have."
  );
}

/**
 * Evaluate a tool call against the budget.
 * `toolCount` is the count AFTER incrementing (i.e., this is the Nth tool call).
 * Returns outcome and optional user-facing message.
 */
export function evaluateToolCall(
  budget: ResolvedToolBudget,
  toolCount: number,
  toolName: string,
): { outcome: ToolBudgetOutcome; message?: string } {
  const pastHard = toolCount > budget.hard;

  if (pastHard) {
    const blocked = budget.block === "*" || budget.block.includes(toolName);
    if (blocked) {
      return {
        outcome: "hard-blocked",
        message: hardBlockMessage(budget, toolName, toolCount),
      };
    }
  }

  if (budget.soft !== undefined && toolCount >= budget.soft) {
    return {
      outcome: "soft-reached",
      message: softNudgeMessage(budget, toolCount),
    };
  }

  return { outcome: "within-budget" };
}
