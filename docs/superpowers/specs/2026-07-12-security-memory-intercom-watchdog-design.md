# Security, Model Scope, Memory, Intercom, and Watchdog

Five features ordered from simplest to most complex. Each phase is atomic and delivers a usable result independently.

---

## Phase 1: Security Hardening

### Purpose

Protect agent/chain/skill discovery from path traversal and symlink attacks. Establishes reusable safe filesystem helpers consumed by later phases.

### New file

`src/core/safe-fs.ts`

### API

```typescript
/** Returns true if the path is a symlink (via lstatSync) */
export function isSymlink(filePath: string): boolean;

/** Reads a file, rejecting symlinks. Returns undefined if unsafe or missing. */
export function safeReadFile(filePath: string): string | undefined;

/** Returns true if name is unsafe for path construction */
export function isUnsafeName(name: string): boolean;

/** Resolves path segments within root. Returns undefined if result escapes root. */
export function resolveContained(
  root: string,
  ...segments: string[]
): string | undefined;
```

### Behavior

**`isSymlink(path)`:**

- Calls `lstatSync(path).isSymbolicLink()`
- Returns `false` on any error (ENOENT, EACCES)

**`safeReadFile(path)`:**

- If `!existsSync(path)` → return undefined
- If `isSymlink(path)` → return undefined
- Try `readFileSync(path, "utf-8")`, catch → undefined

**`isUnsafeName(name)`:**

- Returns true (unsafe) if:
  - Empty, or length > 128
  - Contains NUL byte
  - Fails regex: `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`
  - Equals `.` or `..`
- Returns false (safe) otherwise

**`resolveContained(root, ...segments)`:**

- Rejects segments containing `..`, absolute paths, `:` on any platform
- Resolves `path.resolve(root, ...segments)`
- If resolved path does not start with `path.resolve(root)` → return undefined
- If any intermediate segment exists and is a symlink → return undefined
- Returns the resolved absolute path

### Integration

- `discoverAgents()`: replace `readFileSync` with `safeReadFile`, validate agent filenames with `isUnsafeName`
- `discoverChains()`: same treatment for chain files
- Skill loading in `agent-runner.ts`: use `safeReadFile` for skill content

### Tests

- Unit tests for each helper with: normal files, symlinks, traversal attempts, edge cases (empty, long names, unicode)
- Integration test: agent discovery ignores symlinked `.md` files

---

## Phase 2: Model Scope Enforcement

### Purpose

Validate that resolved agent models are within allowed scope. Prevents cost overruns from unauthorized model use and enforces organizational policies.

### New file

`src/core/model-scope.ts`

### Types

```typescript
export interface ModelScopeConfig {
  enforce: boolean;
  allow: string[]; // glob patterns: "anthropic/*", "openai/gpt-5-*"
}

export type ModelSource = "explicit" | "inherited";

export interface ModelScopeViolation {
  model: string;
  severity: "error" | "warn";
  allowedPatterns: string[];
  message: string;
}
```

### API

```typescript
/** Pure check: does model pass scope? */
export function checkModelScope(
  model: string,
  scope: ModelScopeConfig | undefined,
  piEnabledModels: Set<string> | undefined,
  source: ModelSource,
): ModelScopeViolation | undefined;

/** Parse modelScope from settings JSON */
export function parseModelScopeConfig(
  raw: unknown,
): ModelScopeConfig | undefined;

/** Read pi's enabledModels via SettingsManager (preferred) or raw file fallback */
export function readPiEnabledModels(
  settingsManager: SettingsManager | undefined,
  cwd: string,
): Set<string> | undefined;

/** Glob pattern matching (only * is special, case-insensitive) */
export function matchesPattern(model: string, pattern: string): boolean;
```

### Enforcement Logic

1. If `scope` is undefined or `scope.enforce === false` → pass (return undefined)
2. Normalize model: lowercase, strip `:thinking` suffix
3. Check union of two sources:
   - Our `scope.allow` patterns (glob: `*` matches any chars, case-insensitive)
   - Pi's `enabledModels` set (exact `provider/modelId` entries, lowercased)
4. If model matches **either** source → pass
5. If model matches **neither**:
   - `source === "explicit"` → violation with `severity: "error"`
   - `source === "inherited"` → violation with `severity: "warn"`

### Pi EnabledModels Reading

**Preferred path (SettingsManager available):**

- Calls `settingsManager.getEnabledModels()` — respects pi's trust model and merge semantics
- Returns the result as a `Set<string>` (lowercased, `:thinking` suffixes stripped)

**Fallback path (no SettingsManager, e.g. testing):**

- Reads `<cwd>/.pi/settings.json` (project-level)
- Reads `~/.pi/agent/settings.json` (user-level)
- Extracts `enabledModels: string[]` field
- Project overrides user (first non-undefined wins)

**Common post-processing:**

- Keeps only exact `provider/modelId` entries (drops glob patterns and `:thinking` suffixes)
- Caches result keyed on file mtime + size (invalidates on change, fallback path only)

### Settings Schema

In `subagents.json` (global or project):

```json
{
  "modelScope": {
    "enforce": true,
    "allow": ["anthropic/*", "openai/gpt-5-*", "deepseek/*"]
  }
}
```

### Integration

- Called in `subagent.ts` after `resolveModel()` succeeds, before `manager.spawn()`
- `source` determined by: if model came from tool params → `"explicit"`, if from agent frontmatter or config defaults → `"inherited"`
- On `"error"` violation: return error tool result (blocks spawn), include allowed patterns list
- On `"warn"` violation: emit `pi.sendMessage()` notification, proceed with spawn

### Tests

- Unit tests for `checkModelScope`: pass cases, error cases, warn cases, empty config, no pi models
- Unit tests for `matchesPattern`: exact, wildcard, case sensitivity
- Unit tests for `parseModelScopeConfig`: valid, invalid, missing fields
- Integration test: tool call with out-of-scope model returns error

---

## Phase 3: Agent Memory

### Purpose

Persistent per-agent memory that survives across sessions. Agents accumulate role-specific knowledge (threat models, gotchas, verified commands, decisions) in a scoped MEMORY.md file.

### New file

`src/core/memory.ts`

### Types

```typescript
export type MemoryScope = "user" | "project" | "local";

export interface AgentMemoryConfig {
  scope: MemoryScope;
  path: string; // relative path under memory root, e.g. "security-reviewer"
}

export type MemoryFileResult =
  | { contents: string; truncated: boolean }
  | "unsafe"
  | null;
```

### API

```typescript
/** Parse memory config from agent frontmatter */
export function parseMemoryConfig(raw: unknown): AgentMemoryConfig | undefined;

/** Resolve memory directory with security checks */
export function resolveMemoryDir(
  scope: MemoryScope,
  scopedPath: string,
  cwd: string,
): { dir: string } | { error: string };

/** Read MEMORY.md safely (symlink rejection, line limit) */
export function readMemoryFile(memoryDir: string): MemoryFileResult;

/** Build prompt injection block */
export function buildMemoryInjection(
  agentName: string,
  config: AgentMemoryConfig,
  cwd: string,
  hasWriteTools: boolean,
): string;
```

### Memory Scopes

| Scope     | Directory                        | Git-tracked     | Use case                            |
| --------- | -------------------------------- | --------------- | ----------------------------------- |
| `user`    | `~/.pi/agent-memory/{path}/`     | N/A             | Cross-project role knowledge        |
| `project` | `.pi/agent-memory/{path}/`       | Yes             | Project-specific agent notes        |
| `local`   | `.pi/agent-memory-local/{path}/` | No (.gitignore) | Machine-specific, sensitive context |

### Security (uses Phase 1)

`resolveMemoryDir`:

1. Validate each segment of `scopedPath` with `isUnsafeName`
2. Reject absolute paths, `..`, leading dots, `:`
3. Resolve full path with `resolveContained(rootDir, ...segments)`
4. If resolution fails → return `{ error: "..." }`
5. If root exists and is symlink → return `{ error: "..." }`

`readMemoryFile`:

1. Construct path: `join(memoryDir, "MEMORY.md")`
2. Use `safeReadFile` (rejects symlinks)
3. If null → return null
4. Truncate to 200 lines / 16KB (whichever is hit first)
5. Return `{ contents, truncated }`

### Limits

- Max lines injected: 200 (truncated with `"... (truncated at 200 lines)"`)
- Max bytes read: 16,384 (prevents huge files from consuming context)
- MEMORY.md is an index file; detailed content goes in separate files

### Read-Write vs Read-Only

**Has write/edit tools** (read-write mode):

- Creates memory directory if it doesn't exist
- Injects full instructions: read at start, append when discovering reusable knowledge
- Mentions: Read, Write, Edit tools available

**Lacks write/edit tools** (read-only mode):

- Does NOT create directory
- Injects: "read-only access, cannot create or modify memory"
- If no MEMORY.md exists → no injection at all

### Prompt Injection Format

Read-write:

```
# Persistent agent memory

You have a durable, role-specific memory at: {memoryDir}/MEMORY.md
Memory scope: {scope}

Read this file at the start of a task to recall accumulated role notes.
When you produce durable, reusable role knowledge, append a concise dated entry.
Only persist generally reusable knowledge, not one-off task details or secrets.
Keep MEMORY.md under 200 lines — store detailed content in separate files and link from the index.

## Current MEMORY.md
---
{contents or "No MEMORY.md exists yet. You may create it to begin accumulating notes."}
---
```

Read-only:

```
# Persistent agent memory (read-only)

Memory scope: {scope}
You have read-only access to memory. You can reference existing memories but cannot create or modify them.

## Current MEMORY.md
---
{contents}
---
```

### Frontmatter Format

```yaml
---
memory: { scope: "project", path: "security-reviewer" }
---
```

Or expanded:

```yaml
---
memory:
  scope: project
  path: security-reviewer
---
```

### Integration

- `agent-runner.ts`: after resolving agent config, call `buildMemoryInjection()` and append to system prompt (after env block and custom instructions)
- Detect write tools: check if agent's resolved `tools` list includes `write` or `edit` AND that tool is not in `disallowedTools` (i.e., `effectivelyHas = inResolved && !inDenied`)
- Memory directory for `local` scope: on first creation, emit a one-time `pi.sendMessage()` notification advising the user to add `.pi/agent-memory-local/` to `.gitignore` (do NOT auto-modify project files)

### Tests

- Unit tests for `resolveMemoryDir`: valid paths, traversal attempts, symlinks, all 3 scopes
- Unit tests for `readMemoryFile`: normal, symlink, missing, truncation at 200 lines, truncation at 16KB
- Unit tests for `buildMemoryInjection`: read-write mode, read-only mode, no-file mode
- Unit tests for `parseMemoryConfig`: valid YAML, invalid, missing fields

---

## Phase 4: Intercom / Supervisor Channel

### Purpose

Enable child agents to request decisions, send progress updates, or conduct structured interviews with the parent session. Uses in-process promise-based communication.

### New file

`src/core/intercom.ts`

### Types

```typescript
export type IntercomReason =
  | "need_decision"
  | "progress_update"
  | "interview_request";

export interface IntercomRequest {
  id: string;
  agentId: string;
  agentName: string;
  reason: IntercomReason;
  message: string;
  expectsReply: boolean;
  createdAt: number;
  interview?: unknown;
}

export interface IntercomReply {
  requestId: string;
  message: string;
  createdAt: number;
}

export interface IntercomManager {
  /** Child calls this - blocks until parent replies (or timeout) */
  sendRequest(
    request: Omit<IntercomRequest, "id" | "createdAt">,
    signal?: AbortSignal,
  ): Promise<IntercomReply | null>;

  /** Parent lists pending requests needing replies */
  listPending(): IntercomRequest[];

  /** Parent replies to a pending request */
  reply(requestId: string, message: string): void;

  /** Cancel all pending for a specific agent (on abort/completion) */
  cancelForAgent(agentId: string): void;

  /** Cleanup everything (session shutdown) */
  dispose(): void;
}

export function createIntercomManager(options?: {
  timeoutMs?: number; // default: 300_000 (5 min)
}): IntercomManager;
```

### Mechanics

**Request flow:**

1. Child agent's `contact_supervisor` tool calls `intercomManager.sendRequest()`
2. A `PendingRequest` entry is created in an internal Map with a Promise resolver
3. For `need_decision` and `interview_request` (`expectsReply: true`):
   - Parent is notified via `pi.sendMessage({ customType: "intercom_request" })`
   - Child awaits the Promise (blocks tool execution)
   - Promise resolves when parent calls `reply()`, or rejects on timeout/abort
4. For `progress_update` (`expectsReply: false`):
   - Parent is notified via `pi.sendMessage()`
   - Returns `null` immediately (no blocking)

**Reply flow:**

1. Parent LLM sees the intercom notification in conversation
2. Parent calls `intercom({ action: "reply", replyTo: "<id>", message: "..." })`
3. `intercomManager.reply(id, message)` resolves the child's pending Promise
4. Child tool returns with the reply message

**Timeout/abort:**

- Default timeout: 5 minutes (configurable)
- On timeout: Promise resolves with a timeout message (not rejection - child can handle gracefully)
- On agent abort (`cancelForAgent`): all pending for that agent reject with "agent cancelled"
- On session shutdown (`dispose`): all pending reject with "session ended"

### Child Tool: `contact_supervisor`

Injected into child agents that opt in (via `intercom: true` frontmatter or `contact_supervisor` in tools list):

```typescript
{
  name: "contact_supervisor",
  description: "Contact the parent session for a blocking decision, progress update, or structured interview.",
  parameters: Type.Object({
    reason: Type.Union([
      Type.Literal("need_decision"),
      Type.Literal("progress_update"),
      Type.Literal("interview_request"),
    ]),
    message: Type.String({ description: "What you need from the parent" }),
    interview: Type.Optional(Type.Unknown({
      description: "Structured data for interview_request"
    })),
  }),
}
```

**Return values:**

- `need_decision`: `{ content: "Parent replied: {message}" }` or `{ content: "Timeout: no reply after 5 minutes. Proceed with your best judgment." }`
- `progress_update`: `{ content: "Progress update delivered." }`
- `interview_request`: `{ content: "Parent replied: {message}" }`

### Parent Tool: `intercom`

Registered on parent session when any child has intercom enabled:

```typescript
{
  name: "intercom",
  description: "Reply to child agent requests. Use 'list' to see pending, 'reply' to respond.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("reply"),
      Type.Literal("list"),
      Type.Literal("status"),
    ]),
    replyTo: Type.Optional(Type.String({
      description: "Request ID to reply to (prefix match)"
    })),
    message: Type.Optional(Type.String({
      description: "Reply message content"
    })),
  }),
}
```

**Actions:**

- `list`: returns formatted list of pending requests (id, agent, reason, message, age)
- `reply`: resolves specified request. If `replyTo` omitted and only one pending → auto-resolve that one
- `status`: returns "Intercom active. Pending: N requests."

### Frontmatter Opt-In

```yaml
---
intercom: true
---
```

Or explicitly in tools:

```yaml
---
tools: [read, grep, edit, write, contact_supervisor]
---
```

When `intercom: true`, the `contact_supervisor` tool is injected regardless of the `tools` list.

### Integration

- `createIntercomManager()` called during extension init, stored on `RuntimeDeps`
- In `agent-runner.ts`: if agent config has `intercom: true` or tools includes `contact_supervisor`, inject child tool bound to the manager
- Parent `intercom` tool registered lazily: on first child intercom opt-in during the session
- `manager.onComplete`/`manager.onAbort` callbacks call `intercomManager.cancelForAgent(agentId)`
- `session_shutdown` event calls `intercomManager.dispose()`
- Custom message renderer for `intercom_request` type (shows agent name, reason, message with visual distinction)

### Tests

- Unit tests for `IntercomManager`: send/reply flow, timeout, abort, dispose, multiple pending
- Unit tests for child tool: each reason type, timeout behavior
- Unit tests for parent tool: list, reply, auto-resolve single pending
- Integration test: full flow from child send → parent reply → child continues

---

## Phase 5: Watchdog System

### Purpose

Adversarial edit reviewer that detects code changes at agent-end boundaries, runs an LLM review plus LSP diagnostics, and auto-steers agents to fix blockers.

### New files

- `src/core/watchdog.ts` (~400 LOC) - core runtime, change detection, review orchestration, auto-follow
- `src/core/watchdog-lsp.ts` (~200 LOC) - TypeScript/JavaScript LSP diagnostic collection

### Types

```typescript
export type WatchdogSeverity = "blocker" | "concern";

export type WatchdogCategory =
  | "correctness"
  | "missed-constraint"
  | "test-gap"
  | "unsafe-change"
  | "scope-drift"
  | "loop-risk"
  | "other";

export interface WatchdogWarning {
  severity: WatchdogSeverity;
  summary: string;
  evidence: string;
  recommendedAction: string;
  category: WatchdogCategory;
}

export interface ChangeSignature {
  root: string;
  key: string; // SHA256 of git status + file content hashes
  changedPaths: string[];
}

export interface WatchdogConfig {
  enabled: boolean;
  model?: string;
  thinking?: string;
  autoFollow: {
    blockers: boolean;
    concerns: boolean;
    maxAttempts: number;
    stalemateRepeats: number;
  };
  lsp: {
    enabled: boolean;
    timeoutMs: number;
    maxFiles: number;
    maxDiagnostics: number;
  };
  children: {
    enabled: boolean;
    overrides: Record<string, Partial<WatchdogConfig>>;
  };
}

export interface WatchdogRuntime {
  handleAgentEnd(agentId: string, cwd: string): Promise<WatchdogWarning[]>;
  status(): "idle" | "reviewing" | "disabled";
  dispose(): void;
}
```

### Change Detection

```typescript
export function computeChangeSignature(
  cwd: string,
): ChangeSignature | undefined;
```

Implementation:

1. `git rev-parse --show-toplevel` to find repo root (return undefined if not git)
2. `git status --porcelain=v1 -z --untracked-files=all` to get changed files
3. Filter out ignored paths: `.pi/`, `node_modules/`, `.git/`, `tmp/`
4. For each changed file: hash first 8KB of content with SHA256
5. Combine all entries into a single SHA256 signature key
6. Return `{ root, key, changedPaths }`

### LSP Diagnostics

```typescript
export interface LspDiagnostic {
  file: string;
  line: number;
  severity: "error" | "warning";
  message: string;
  code?: string;
}

export interface LspResult {
  status: "ok" | "unavailable" | "timeout" | "failed";
  diagnostics: LspDiagnostic[];
  checkedPaths: string[];
}

export function collectLspDiagnostics(
  cwd: string,
  changedPaths: string[],
  config: WatchdogConfig["lsp"],
  signal?: AbortSignal,
): Promise<LspResult>;
```

Implementation (deliberate simplification — uses `tsc --noEmit` rather than a full LSP client over stdio, which would be ~200 LOC of JSON-RPC handling for marginal benefit; can upgrade later):

1. Filter `changedPaths` to TS/JS extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mts`
2. If no matching files → return `{ status: "ok", diagnostics: [], checkedPaths: [] }`
3. Respect `config.maxFiles` limit (take first N)
4. Find `tsc`: check `node_modules/.bin/tsc`, then `npx tsc`, then PATH
5. If not found → return `{ status: "unavailable", ... }`
6. Run `tsc --noEmit --pretty false` with `config.timeoutMs` timeout via AbortSignal
7. Parse output lines matching: `file(line,col): error|warning TS\d+: message`
8. Limit to `config.maxDiagnostics` entries
9. On timeout → return `{ status: "timeout", ... }`
10. On other error → return `{ status: "failed", ... }`

### Review Execution

The watchdog uses `createAgentSession` to run a focused reviewer LLM with a structured `watchdog_warn` tool:

**Reviewer system prompt:**

```
You are a code watchdog. Review the following changes for defects.

For each issue found, call the watchdog_warn tool once per issue.
If no issues found, call no tools.

Rules:
- "blocker": likely bug, security issue, or constraint violation that must be fixed
- "concern": style issue, potential problem, or suggestion that can be deferred
- Only report real issues with concrete evidence
```

**Reviewer tool (`watchdog_warn`):**

```typescript
{
  name: "watchdog_warn",
  label: "Watchdog Warning",
  description: "Emit a warning about a code issue found during review.",
  parameters: Type.Object({
    severity: Type.Union([Type.Literal("blocker"), Type.Literal("concern")]),
    summary: Type.String({ description: "One-line description" }),
    evidence: Type.String({ description: "file:line or relevant code snippet" }),
    recommendedAction: Type.String({ description: "Specific fix instruction" }),
    category: Type.Union([
      Type.Literal("correctness"),
      Type.Literal("missed-constraint"),
      Type.Literal("test-gap"),
      Type.Literal("unsafe-change"),
      Type.Literal("scope-drift"),
      Type.Literal("loop-risk"),
      Type.Literal("other"),
    ]),
  }),
  execute(toolCallId, params, signal, onUpdate, ctx) {
    // Collect warning into review results
    return { content: [{ type: "text", text: "Warning recorded." }] };
  },
}
```

**Review input (user message):**

```
## Git Diff
{truncated diff, max 8KB}

## LSP Diagnostics
{formatted diagnostics or "No LSP issues found"}

## Agent Context
Agent: {agentName}
Task: {first 500 chars of agent task}
```

**Review session config:**

- Model: `config.model` or parent's model
- Thinking: `config.thinking` or "medium"
- Max turns: 1 (single response)
- Tools: `[watchdog_warn]` only (via `noTools: "all"` + `customTools`)
- Isolated: true

**Output collection:**

- Warnings are collected via `watchdog_warn` tool calls (structured by design, no parsing needed)
- Each tool call produces one `WatchdogWarning` entry
- Malformed calls are rejected by TypeBox schema validation before execution

### Auto-Follow Logic (experimental)

> **Note:** No existing implementation has shipped auto-follow in production. This feature is designed conservatively — initial delivery should surface warnings to the parent rather than auto-steering, until confidence is gained through real-world usage.

```typescript
interface AutoFollowState {
  warnings: Map<string, number>; // summary → consecutive count
  attempts: number;
}
```

Per agent, tracked in `WatchdogRuntime`:

1. After review produces warnings:
2. For each warning:
   - If `severity === "blocker"` AND `config.autoFollow.blockers`:
     - Increment `warnings.get(summary)` count
     - If count >= `stalemateRepeats` → surface to parent as "stalemate", stop
     - If `attempts >= maxAttempts` → surface to parent as "max retries", stop
     - Otherwise: steer agent with fix instruction, increment attempts
   - If `severity === "concern"` AND `config.autoFollow.concerns`:
     - Same logic as above
   - Otherwise: surface to parent via notification

3. After successful auto-steer:
   - Agent processes the steer message
   - Next `handleAgentEnd` call re-reviews
   - If same warning persists → increment stalemate counter
   - If warning resolved → clear that entry from state

**Steer message format:**

```
Watchdog {severity}: {summary}
Evidence: {evidence}
Action required: {recommendedAction}
```

### Child Watchdog

When `config.children.enabled`:

- Each child agent spawned gets a per-agent watchdog instance
- Config: merge `config.children.overrides[agentName]` over base config
- Child watchdog calls `handleAgentEnd` with child's agent ID and cwd
- Auto-follow steers the child (not the parent)
- Concerns from children surface to parent via notification
- Child watchdog state cleared on child completion

### Configuration

**Default config (all disabled by default):**

```typescript
const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  model: undefined, // uses parent's model
  thinking: undefined, // uses "medium"
  autoFollow: {
    blockers: true,
    concerns: false,
    maxAttempts: 3,
    stalemateRepeats: 3,
  },
  lsp: {
    enabled: true,
    timeoutMs: 3_000,
    maxFiles: 20,
    maxDiagnostics: 50,
  },
  children: {
    enabled: false,
    overrides: {},
  },
};
```

**Settings (`subagents.json`):**

```json
{
  "watchdog": {
    "enabled": true,
    "model": "anthropic/claude-sonnet-4",
    "thinking": "high",
    "autoFollow": {
      "blockers": true,
      "concerns": false,
      "maxAttempts": 3,
      "stalemateRepeats": 3
    },
    "lsp": {
      "enabled": true,
      "timeoutMs": 3000,
      "maxFiles": 20,
      "maxDiagnostics": 50
    },
    "children": {
      "enabled": false,
      "overrides": {
        "worker": { "enabled": true }
      }
    }
  }
}
```

**Slash command:**

- `/watchdog on` - enable for current session
- `/watchdog off` - disable for current session
- `/watchdog status` - show current state (enabled, reviewing, last review result)

### Trigger Timing

The watchdog reviews at **agent-end boundaries** - when an agent finishes all its work (session completes, aborts, or hits turn limit). It does NOT review after every individual turn. This keeps token cost proportional to agent count, not turn count.

For the parent agent: `handleAgentEnd` is called when the parent's subagent tool returns (i.e., after a foreground subagent completes).

For child agents: `handleAgentEnd` is called when the child session completes.

### Watchdog Sessions

The watchdog's reviewer LLM session is internal infrastructure. It:

- Does NOT count toward `maxSpawnsPerSession`
- Does NOT appear in the fleet list or widget
- Does NOT trigger notifications
- Uses a short-lived session with `max_turns: 1`

### Integration

- `index.ts`: create `WatchdogRuntime` during init (disabled by default), store on RuntimeDeps
- `agent-runner.ts`: after agent session completes (in the completion callback), call `watchdog.handleAgentEnd()` if enabled
- For child watchdogs: create per-agent instance in `agent-runner.ts` lifecycle callbacks when `config.children.enabled` and agent matches overrides
- Notifications: `pi.sendMessage({ customType: "watchdog_warning" })` with custom renderer showing severity icon, summary, evidence
- Auto-follow steering: uses existing `session.steer(message)` for the reviewed agent
- Slash command registered in `index.ts` alongside existing commands

### Tests

- Unit tests for `computeChangeSignature`: with changes, no changes, not a git repo
- Unit tests for `collectLspDiagnostics`: clean output, errors, warnings, timeout, tsc not found
- Unit tests for review parsing: valid JSON, malformed, empty
- Unit tests for auto-follow logic: stalemate detection, max attempts, severity routing
- Unit tests for child watchdog: config merging, per-agent instances, cleanup
- Integration test: full flow from change detection → review → auto-steer → re-review

---

## Summary

| Phase | Feature                 | New Files                                          | ~LOC | Dependencies      |
| ----- | ----------------------- | -------------------------------------------------- | ---- | ----------------- |
| 1     | Security hardening      | `src/core/safe-fs.ts`                              | ~80  | None              |
| 2     | Model scope enforcement | `src/core/model-scope.ts`                          | ~120 | None              |
| 3     | Agent memory            | `src/core/memory.ts`                               | ~200 | Phase 1 (safe-fs) |
| 4     | Intercom / supervisor   | `src/core/intercom.ts`                             | ~250 | None              |
| 5     | Watchdog                | `src/core/watchdog.ts`, `src/core/watchdog-lsp.ts` | ~600 | Phase 1 (safe-fs) |

**Total new code:** ~1,250 LOC across 5 files

**Testing:** Each phase includes unit tests + at least one integration test. Follows existing Vitest + RuntimeDeps DI pattern.

**Settings additions to `subagents.json`:**

```json
{
  "modelScope": { "enforce": false, "allow": [] },
  "watchdog": { "enabled": false, "...": "..." }
}
```

**Frontmatter additions:**

- `memory: { scope, path }` - opt agent into persistent memory
- `intercom: true` - opt agent into supervisor channel
