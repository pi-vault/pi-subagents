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
  enabled?: boolean;
  skills?: string[] | boolean;
  systemPrompt: string;
  sourcePath: string;
  timeoutMs?: number;
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
  skills?: string[] | boolean;
  systemPrompt: string;
  timeoutMs?: number;
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

export const DEFERRED_SLASH_REQUEST_ENTRY =
  "pi-subagents:deferred-request" as const;
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

export type SlashSnapshot = {
  live: SlashLiveDetails;
  final?: SubagentExecutionResult;
  version: number;
};

export interface SubagentCommandMessage {
  customType: string;
  content: string;
  display: boolean;
  details?: SubagentMessageDetails;
}

// ---------------------------------------------------------------------------
// Session execution model types (Spec 1a)
// ---------------------------------------------------------------------------

export interface LifetimeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
}

export interface ToolActivity {
  type: "start" | "end";
  toolName: string;
}

export interface AgentInvocation {
  agent: string;
  task: string;
  cwd?: string;
}

export interface AgentRecord {
  id: string;
  type: string;
  status: "running" | "completed" | "aborted" | "error";
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  session?: unknown; // AgentSession - typed as unknown to avoid import dependency
  abortController?: AbortController;
  lifetimeUsage: LifetimeUsage;
  invocation?: AgentInvocation;
}

export interface RunOptions {
  prompt: string;
  cwd: string;
  agentId: string;
  model?: unknown; // Model from pi-ai
  thinking?: string;
  timeoutMs?: number;
  allowRecursion?: boolean;
  signal?: AbortSignal;
  onToolActivity?: (activity: ToolActivity) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsage?: (usage: {
    input: number;
    output: number;
    cacheWrite: number;
  }) => void;
  onSessionCreated?: (session: unknown) => void;
}

export interface RunResult {
  responseText: string;
  session: unknown; // AgentSession
  aborted: boolean;
}

export interface SpawnOptions {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  parentSignal?: AbortSignal;
  currentDepth?: number;
  allowedAgents?: string[];
  onToolActivity?: (activity: ToolActivity) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsage?: (usage: {
    input: number;
    output: number;
    cacheWrite: number;
  }) => void;
  onSessionCreated?: (session: unknown) => void;
}
