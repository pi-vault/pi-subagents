import type { AgentManager } from "../core/agent-manager.js";
import type { GroupJoinManager } from "../core/group-join-manager.js";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryResult,
  JoinMode,
  LoadedConfig,
  ResolvedPaths,
  SubagentsConfig,
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
}
