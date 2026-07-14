import type { AgentManager } from "../core/agent-manager.js";
import type { WatchdogRuntime } from "../core/watchdog.js";
import type { IntercomManager } from "../core/intercom.js";
import type { GroupJoinManager } from "../core/group-join-manager.js";
import type { AgentActivity } from "../tui/activity.js";
import type { AgentWidget } from "../tui/agent-widget.js";
import type { ChainWidget } from "../tui/chain-widget.js";
import type { FleetList } from "../tui/fleet-list.js";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryResult,
  JoinMode,
  LoadedConfig,
  ResolvedPaths,
  SubagentsConfig,
  WidgetMode,
} from "./types.js";

export interface RuntimeDeps {
  resolvePaths: () => ResolvedPaths;
  loadConfig: (paths: ResolvedPaths) => LoadedConfig;
  discoverAgents: (paths: ResolvedPaths) => AgentDiscoveryResult;
  discoverToolNames: () => string[];
  createAgentFile: (
    paths: ResolvedPaths,
    input: AgentCreationInput,
    discovery: AgentDiscoveryResult,
    toolNames: string[],
  ) => AgentDefinition;
  exportAgentToUserScope: (
    paths: ResolvedPaths,
    discovery: AgentDiscoveryResult,
    agentName: string,
  ) => AgentDefinition;
  disableAgentInUserScope: (
    paths: ResolvedPaths,
    discovery: AgentDiscoveryResult,
    agentName: string,
  ) => AgentDefinition;
  deleteUserAgentOverride: (paths: ResolvedPaths, agentName: string) => void;
  saveConfig: (paths: ResolvedPaths, config: SubagentsConfig) => void;
  manager: AgentManager;
  groupJoin?: GroupJoinManager;
  pendingNudges?: Map<string, ReturnType<typeof setTimeout>>;
  defaultJoinMode?: JoinMode;
  widgetMode?: WidgetMode;
  fleetView?: boolean;
  setWidgetMode?: (mode: WidgetMode) => void;
  setFleetView?: (enabled: boolean) => void;
  registerBatchAgent?: (id: string) => void;
  disposeBatchTracker?: () => void;
  /** Live sidebar widget — present when TUI is active. */
  widget?: AgentWidget;
  /** Fleet list below the editor — present when TUI is active. */
  fleet?: FleetList;
  /** Per-agent live activity state map — shared between index.ts and subagent.ts. */
  agentActivity?: Map<string, AgentActivity>;
  /** Ensure widget and fleet timers are running (call after any agent spawn). */
  ensureTimers?: () => void;
  /** Chain progress widget — present when TUI is active. */
  chainWidget?: ChainWidget;
  intercom?: IntercomManager;
  watchdog?: WatchdogRuntime;
}
