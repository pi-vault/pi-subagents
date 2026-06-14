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
  enabled?: boolean;
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

export interface SlashSubagentRequestPayload {
  requestId: string;
  agent: string;
  task: string;
  cwd: string;
  parentSessionFile: string | undefined;
  parentSessionDir: string | undefined;
  parentModel: string | undefined;
  signal: AbortSignal | undefined;
  requestRender: (() => void) | undefined;
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
  signal: AbortSignal | undefined;
  requestRender?: () => void;
  cleanup?: () => void;
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
