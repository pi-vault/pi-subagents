import type { AgentManager } from "../core/agent-manager.js";
import type { AgentCatalog } from "../core/agents.js";
import type {
  EditableSettingKey,
  SettingsScope,
  SubagentsSettings,
} from "../core/settings.js";
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
  ResolvedPaths,
} from "./types.js";

export interface RuntimeDeps {
  resolvePaths: () => ResolvedPaths;
  settings: SubagentsSettings;
  loadSettings: (
    cwd?: string,
    scope?: SettingsScope,
  ) => SubagentsSettings;
  saveSetting: (
    cwd: string,
    scope: SettingsScope,
    key: EditableSettingKey,
    value: unknown,
  ) => Promise<boolean>;
  refreshSettings: (cwd: string, projectTrusted: boolean) => void;
  discoverAgents: (paths: ResolvedPaths) => AgentDiscoveryResult;
  discoverAgentCatalog: (paths: ResolvedPaths) => AgentCatalog;
  readUserAgentOverride: (paths: ResolvedPaths, sourcePath: string) => string;
  updateUserAgentOverride: (
    paths: ResolvedPaths,
    sourcePath: string,
    markdown: string,
  ) => AgentDefinition;
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
  manager: AgentManager;
  groupJoin?: GroupJoinManager;
  pendingNudges?: Map<string, ReturnType<typeof setTimeout>>;
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
