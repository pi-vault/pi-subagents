export type JoinMode = "async" | "group" | "smart";

export type WidgetMode = "all" | "background" | "off";

export interface NotificationDetails {
  id: string;
  description: string;
  status: string;
  toolUses: number;
  turnCount: number;
  maxTurns?: number;
  totalTokens: number;
  durationMs: number;
  outputFile?: string;
  error?: string;
  resultPreview: string;
  others?: NotificationDetails[];
}

export interface SubagentsConfig {
  maxConcurrency: number;
  maxRecursiveLevel: number;
  defaultMaxTurns: number;
  graceTurns: number;
  defaultJoinMode: JoinMode;
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
  // Phase 2: new frontmatter fields
  promptMode?: "replace" | "append";
  maxTurns?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
  isolated?: boolean;
  isolation?: "worktree";
  extensions?: true | string[] | false;
  disallowedTools?: string[];
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
  model?: string;
  thinking?: string;
  max_turns?: number;
  isolated?: boolean;
  inherit_context?: boolean;
  run_in_background?: boolean;
  resume?: string;
  isolation?: string;
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
  status: "success" | "error" | "timeout" | "aborted" | "steered" | "background";
  agentId?: string;
  agent: string;
  task: string;
  sourcePath: string;
  cwd: string;
  maxTurns: number;
  durationMs: number;
  childSessionDir: string;
  childSessionPath: string;
  artifactPaths?: ArtifactPaths;
  model?: string;
  thinking?: string;
  stopReason: string;
  exitCode: number | null;
  stderr: string;
  usage: SubagentUsage;
  recentToolActivity: SubagentToolActivity[];
}

export interface SubagentExecutionResult {
  content: string;
  isError: boolean;
  details: SubagentExecutionDetails;
}

export interface SubagentCommandMessage {
  customType: string;
  content: string;
  display: boolean;
  details?: SubagentExecutionDetails;
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
  description?: string;
  cwd?: string;
  model?: string;
  thinking?: string;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
}

export interface AgentRecord {
  id: string;
  type: string;
  description: string;
  status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
  result?: string;
  error?: string;
  toolUses: number;
  turnCount: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  session?: unknown; // AgentSession - typed as unknown to avoid import dependency
  abortController?: AbortController;
  lifetimeUsage: LifetimeUsage;
  invocation?: AgentInvocation;
  // Phase 3: background execution fields
  isBackground?: boolean;
  promise?: Promise<string>;
  groupId?: string;
  joinMode?: JoinMode;
  resultConsumed?: boolean;
  pendingSteers?: string[];
  worktree?: { path: string; branch: string; baseSha: string; workPath: string };
  worktreeResult?: { hasChanges: boolean; branch?: string };
  toolCallId?: string;
  outputFile?: string;
  outputCleanup?: () => void;
  compactionCount?: number;
}

export interface RunOptions {
  prompt: string;
  cwd: string;
  agentId: string;
  model?: unknown; // Model from pi-ai
  thinking?: string;
  maxTurns?: number;
  graceTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  parentSystemPrompt?: string;
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
  steered: boolean;
}

export interface SpawnOptions {
  prompt: string;
  cwd: string;
  description?: string;
  maxTurns?: number;
  graceTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  parentSystemPrompt?: string;
  parentSignal?: AbortSignal;
  currentDepth?: number;
  allowedAgents?: string[];
  isolation?: string;
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

export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}
