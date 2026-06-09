export interface SubagentsConfig {
  maxConcurrency: number;
  maxRecursiveLevel: number;
  defaultTimeoutMs: number;
}

export interface ResolvedPaths {
  agentDir: string;
  configPath: string;
  userAgentsDir: string;
  bundledAgentsDir: string;
  sessionsDir: string;
}

export interface RuntimeArtifactsPaths {
  rootDir: string;
  nestedEventsDir: string;
  nestedRunsDir: string;
}

export interface ArtifactPaths {
  input: string;
  output: string;
  meta: string;
}

export interface LoadedConfig {
  config: SubagentsConfig;
  exists: boolean;
}

export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: string;
  subagentAgents: string[];
  timeoutMs?: number;
  disabled?: boolean;
  systemPrompt: string;
  sourcePath: string;
}

export interface AgentDiscoveryDiagnostic {
  path: string;
  reason: string;
}

export interface AgentDiscoveryResult {
  agents: AgentDefinition[];
  diagnostics: AgentDiscoveryDiagnostic[];
}

export interface AgentCreationInput {
  name?: string;
  filenameSlug?: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: string;
  subagentAgents: string[];
  timeoutMs?: number;
  systemPrompt: string;
}

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
}

export interface SubagentToolInput {
  agent: string;
  task: string;
  cwd?: string;
}

export interface SlashAgentBridgeRequest {
  agent: string;
  task: string;
  cwd?: string;
  requestId?: string;
}

export interface SubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  contextTokens: number;
  cost: number;
  turns: number;
}

export interface SubagentToolActivity {
  label: string;
  preview: string;
}

export interface SubagentExecutionDetails {
  status: "success" | "error" | "timeout" | "aborted";
  agent: string;
  task: string;
  sourcePath: string;
  cwd: string;
  timeoutMs: number;
  durationMs: number;
  childSessionDir: string;
  childSessionPath: string;
  artifactPaths?: ArtifactPaths;
  model?: string;
  stopReason: string;
  exitCode: number | null;
  stderr: string;
  usage: SubagentUsage;
  recentToolActivity: SubagentToolActivity[];
}

export interface SlashLiveDetails {
  kind: "slash-live";
  requestId: string;
  status: "running" | "error";
  agent: string;
  task: string;
  cwd: string;
  durationMs: number;
  startedAt: number;
  recentToolActivity: SubagentToolActivity[];
  childSessionPath?: string;
  model?: string;
  stderr?: string;
}

export type SubagentMessageDetails =
  | SubagentExecutionDetails
  | SlashLiveDetails;

export interface SubagentExecutionResult {
  content: string;
  isError: boolean;
  details: SubagentExecutionDetails;
}

export interface SubagentCommandMessage {
  customType: string;
  content: string;
  display: boolean;
  details?: SubagentMessageDetails;
}

// Event channel names for the slash-agent event bus
export const SLASH_SUBAGENT_REQUEST_EVENT  = "subagent:slash:request"  as const;
export const SLASH_SUBAGENT_STARTED_EVENT  = "subagent:slash:started"  as const;
export const SLASH_SUBAGENT_RESPONSE_EVENT = "subagent:slash:response" as const;
export const SLASH_SUBAGENT_UPDATE_EVENT   = "subagent:slash:update"   as const;
export const SLASH_SUBAGENT_CANCEL_EVENT   = "subagent:slash:cancel"   as const;
export const SLASH_RESULT_TYPE             = "pi-subagent-result"      as const;

// Payload sent via pi.events for the slash-agent bridge.
// Carries all ctx-derived values (signal, session paths, model)
// and TUI render/cleanup callbacks — because pi.events handlers
// do NOT receive ctx themselves.
export interface SlashSubagentRequestPayload {
  requestId: string;
  agent: string;
  task: string;
  cwd: string;
  parentSessionFile: string | undefined;
  parentSessionDir: string | undefined;
  parentModel: string | undefined;
  signal: AbortSignal | undefined;
  /** Calls tui.requestRender() — captured via setWidget factory in command handler */
  requestRender: (() => void) | undefined;
  /** Removes the ticker widget set up in command handler */
  cleanup: (() => void) | undefined;
}

export const DEFERRED_SLASH_REQUEST_ENTRY = "pi-subagents:deferred-request" as const;
export const DEFERRED_SLASH_REQUEST_CONSUMED_ENTRY =
  "pi-subagents:deferred-request-consumed" as const;

export interface PersistedDeferredSlashRequest {
  requestId: string;
  agent: string;
  task: string;
  cwd: string;
  parentSessionFile?: string;
  parentSessionDir?: string;
  parentModel?: string;
  createdAt: number;
}

export interface DeferredSlashRuntimeState {
  signal?: AbortSignal;
  requestRender?: () => void;
  cleanup?: () => void;
}

// Background agent types
export type BackgroundJobState = "queued" | "running" | "complete" | "failed";

export interface BackgroundJobRecord {
  id: string;
  agent: string;
  task: string;
  cwd: string;
  state: BackgroundJobState;
  pid?: number;
  startedAt: number;
  endedAt?: number;
  resultPath?: string;
  errorMessage?: string;
}

export interface BackgroundJobStatus {
  id: string;
  agent: string;
  task: string;
  state: BackgroundJobState;
  durationMs: number;
  errorMessage?: string;
}
