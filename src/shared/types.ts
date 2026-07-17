export type JoinMode = "async" | "group" | "smart";

export interface ToolBudgetConfig {
  soft?: number;
  hard: number;
  block?: string[] | "*";
}

export interface ResolvedToolBudget {
  soft?: number;
  hard: number;
  block: string[] | "*";
}

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

export interface ResolvedPaths {
  agentDir: string;
  configPath: string;
  userAgentsDir: string;
  bundledAgentsDir: string;
  sessionsDir: string;
  // Chain directories
  userChainsDir: string;
  bundledChainsDir: string;
  // Prompt workflow directories
  userPromptsDir: string;
  bundledPromptsDir: string;
}

export interface ArtifactPaths {
  input: string;
  output: string;
  meta: string;
}

export type MemoryScope = "user" | "project" | "local";

export interface AgentMemoryConfig {
  scope: MemoryScope;
  path: string;
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
  // Phase 2: new frontmatter fields
  promptMode?: "replace" | "append";
  maxTurns?: number;
  maxDepth?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
  isolated?: boolean;
  isolation?: "worktree";
  extensions?: true | string[] | false;
  disallowedTools?: string[];
  toolBudget?: ToolBudgetConfig;
  // Phase 3: memory
  memory?: AgentMemoryConfig;
  // Phase 4: intercom
  intercom?: boolean;
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
  promptMode?: "replace" | "append";
  maxTurns?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
  isolated?: boolean;
  isolation?: "worktree";
  extensions?: true | string[] | false;
  disallowedTools?: string[];
  toolBudget?: ToolBudgetConfig;
}

export interface SubagentToolInput {
  agent?: string;
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
  tool_budget?: ToolBudgetConfig;
  // Chain mode fields (unknown[] because the schema uses optional fields for LLM; cast to ChainStep[] at dispatch)
  chain?: unknown[];
  chain_append?: {
    chain_id: string;
    steps: unknown[];
  };
  clarify?: boolean;
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

export interface AgentLiveState {
  activeTools: string[];
  responseText: string;
  maxTurns?: number;
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
  live: AgentLiveState;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  session?: unknown; // AgentSession - typed as unknown to avoid import dependency
  abortController?: AbortController;
  lifetimeUsage: LifetimeUsage;
  invocation?: AgentInvocation;
  cwd?: string;
  // Phase 3: background execution fields
  isBackground?: boolean;
  promise?: Promise<string>;
  groupId?: string;
  joinMode?: JoinMode;
  resultConsumed?: boolean;
  pendingSteers?: string[];
  worktree?: {
    path: string;
    branch: string;
    baseSha: string;
    workPath: string;
    syntheticPaths?: string[];
  };
  worktreeResult?: { hasChanges: boolean; branch?: string };
  toolCallId?: string;
  outputFile?: string;
  outputCleanup?: () => void;
  compactionCount?: number;
  spawnedBy?: string;
  chainSteps?: Array<{
    label: string;
    status: WorkflowNodeStatus;
    error?: string;
  }>;
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
  onUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
  onSessionCreated?: (session: unknown) => void;
  onSettled?: () => void;
  toolBudget?: ResolvedToolBudget;
  customTools?: unknown[];
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
  thinking?: string;
  maxTurns?: number;
  graceTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  parentSystemPrompt?: string;
  parentSignal?: AbortSignal;
  currentDepth?: number;
  allowedAgents?: string[];
  isolation?: string;
  model?: unknown;
  onSessionCreated?: (session: unknown) => void;
  onActivity?: (record: AgentRecord) => void;
  toolBudget?: ResolvedToolBudget;
  spawnedBy?: string;
  _deps?: unknown;
}

export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}

// ---------------------------------------------------------------------------
// Chain execution types (spec section 2)
// ---------------------------------------------------------------------------

export interface AcceptanceInput {
  description: string;
  command?: string;
}

export type JsonSchemaObject = Record<string, unknown>;

export interface SequentialStep {
  agent: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: JsonSchemaObject;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
}

export interface ParallelTaskItem {
  agent: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: JsonSchemaObject;
  count?: number;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
}

export interface ParallelStep {
  parallel: ParallelTaskItem[];
  concurrency?: number;
  failFast?: boolean;
  worktree?: boolean;
  cwd?: string;
}

export interface DynamicParallelStep {
  expand: {
    from: { output: string; path: string };
    item?: string;
    key?: string;
    maxItems?: number;
    onEmpty?: "skip" | "fail";
  };
  parallel: DynamicParallelTemplate;
  collect: { as: string; outputSchema?: JsonSchemaObject };
  concurrency?: number;
  failFast?: boolean;
  phase?: string;
  label?: string;
  acceptance?: AcceptanceInput;
}

export type DynamicParallelTemplate = Omit<ParallelTaskItem, "as" | "count">;

export type ChainStep = SequentialStep | ParallelStep | DynamicParallelStep;

export interface ChainOutputMapEntry {
  text: string;
  structured?: unknown;
  agent: string;
  stepIndex: number;
}

export type ChainOutputMap = Record<string, ChainOutputMapEntry>;

export interface ChainConfig {
  name: string;
  localName?: string;
  packageName?: string;
  description: string;
  filePath: string;
  steps: ChainStepConfig[];
  extraFields?: Record<string, string>;
}

export interface ChainStepConfig {
  agent?: string;
  task?: string;
  phase?: string;
  label?: string;
  as?: string;
  outputSchema?: string | JsonSchemaObject;
  output?: string | false;
  outputMode?: "inline" | "file-only";
  reads?: string[] | false;
  model?: string;
  skills?: string[] | false;
  progress?: boolean;
  cwd?: string;
  acceptance?: AcceptanceInput;
  toolBudget?: ToolBudgetConfig;
  parallel?: ChainStepConfig[];
  concurrency?: number;
  failFast?: boolean;
  worktree?: boolean;
  expand?: DynamicParallelStep["expand"];
  collect?: DynamicParallelStep["collect"];
}

export type WorkflowNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "paused"
  | "stopped";

export interface WorkflowGraphNode {
  id: string;
  kind: "step" | "parallel-group" | "dynamic-parallel-group" | "agent";
  agent?: string;
  phase?: string;
  label: string;
  status: WorkflowNodeStatus;
  flatIndex?: number;
  stepIndex?: number;
  children?: WorkflowGraphNode[];
  dynamic?: {
    sourceOutput: string;
    sourcePath: string;
    itemName: string;
    maxItems?: number;
    collectAs?: string;
  };
  itemKey?: string;
  outputName?: string;
  structured?: boolean;
  error?: string;
}

export interface WorkflowGraphSnapshot {
  runId: string;
  mode: SubagentRunMode;
  phases: Array<{ title: string; nodeIds: string[] }>;
  nodes: WorkflowGraphNode[];
  currentNodeId?: string;
}

export type SubagentRunMode = "single" | "parallel" | "chain";

export interface ChainDiscoveryDiagnostic {
  filePath: string;
  error: string;
}

export interface ChainDiscoveryResult {
  chains: ChainConfig[];
  diagnostics: ChainDiscoveryDiagnostic[];
}
