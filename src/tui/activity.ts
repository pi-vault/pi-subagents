import type { ToolActivity } from "../shared/types.js";

/** UI-layer lifetime token usage. Field names match tintinweb (input/output/cacheWrite),
 *  distinct from shared/types.ts LifetimeUsage which uses inputTokens/outputTokens/cacheWriteTokens. */
export interface LifetimeUsage {
  input: number;
  output: number;
  cacheWrite: number;
}

export interface AgentActivity {
  activeTools: Map<string, string>;
  toolUses: number;
  responseText: string;
  turnCount: number;
  maxTurns?: number;
  lifetimeUsage: LifetimeUsage;
}

/** Sum of lifetime usage components. */
export function getLifetimeTotal(u?: LifetimeUsage): number {
  return u ? u.input + u.output + u.cacheWrite : 0;
}

/**
 * Create an AgentActivity state and spawn callbacks for tracking.
 * Used by both foreground and background agent paths.
 */
export function createActivityTracker(maxTurns?: number, onStreamUpdate?: () => void) {
  let toolSeq = 0;
  const state: AgentActivity = {
    activeTools: new Map(),
    toolUses: 0,
    turnCount: 1,
    maxTurns,
    responseText: "",
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
  };

  const callbacks = {
    onToolActivity: (activity: ToolActivity) => {
      if (activity.type === "start") {
        state.activeTools.set(`${activity.toolName}_${++toolSeq}`, activity.toolName);
      } else {
        for (const [key, name] of state.activeTools) {
          if (name === activity.toolName) {
            state.activeTools.delete(key);
            break;
          }
        }
        state.toolUses++;
      }
      onStreamUpdate?.();
    },
    onTextDelta: (_delta: string, fullText: string) => {
      state.responseText = fullText;
      onStreamUpdate?.();
    },
    onTurnEnd: (turnCount: number) => {
      state.turnCount = turnCount;
      onStreamUpdate?.();
    },
    onUsage: (usage: LifetimeUsage) => {
      state.lifetimeUsage.input += usage.input;
      state.lifetimeUsage.output += usage.output;
      state.lifetimeUsage.cacheWrite += usage.cacheWrite;
      onStreamUpdate?.();
    },
  };

  return { state, callbacks };
}
