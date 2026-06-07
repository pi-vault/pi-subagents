# Epic 1: Minimal Pi Subagents Extension

## Summary

Epic 1 builds a small Pi extension that adds a foreground-only `subagent` tool plus user-facing `/agent` and `/agents` commands. Each subagent runs as an isolated child `pi` process with its own system prompt, tool allowlist, model, thinking level, and recursion-depth guard. The design follows the philosophy in [pi-subagents-design-philosophy.md](pi-subagents-design-philosophy.md): reduce parent context bloat, keep behavior observable, and make the agent loadout trivial to extend through markdown files.

This epic intentionally stops at the minimal shell-out model. It does not attempt to reproduce the richer lifecycle systems from the larger reference projects. The implementation should stay small, explicit, and easy to extend in later epics.

## Design Philosophy

Go with a very minimal approach. No need to over-engineer. Calling the sub-agents tool just creates an isolated Pi process and then returns whatever the final text output is. And this allows you to very easily edit the extension. It's very simple. Makes it easy to try out different ideas and see what works.

- Capability: make the sub-agents as capable as you need them to be
- Observability: have full knowledge of everything going on at all times because it can get kind of messy and confusing when your sub-agents are spawning their own sub-agents. I need to be able to observe their exact behavior, see what they're doing. This is important for two reasons. First, for improving the agents themselves. So, seeing where they go wrong so you can improve their prompts and functionality later on. And secondly, it gives a feeling of control
- Extensibility: First, extensibility of the sub-agent loadout. It should be trivial to add and modify agents. So, each agent is entirely determined by a markdown file. Define name, description, tools, available sub-agents, model, and thinking level in the front matter, and then write the system prompt for the agent, and it gets automatically discovered by the extension. Secondly, extensibility of the extension itself

## Product Decisions

- Architecture baseline: minimal shell-out implementation, not in-process managed child sessions.
- Runtime scope: foreground only for Epic 1. One tool call waits for one child result.
- Agent discovery scope: global agents only, using `$PI_CODING_AGENT_DIR/agents`.
- Tool API: simple parameter shape `{ agent, task, cwd? }`.
- Manual invocation: provide `/agent <agent> <task...>` in addition to the `subagent` tool.
- Automatic invocation: keyword-based routing is implemented as LLM guidance in the `subagent` tool description, not as an extension-side prompt interceptor.
- Recursion control: configure a maximum recursive depth for nested subagent calls, default `2`.
- Default agents: `scout`, `worker`, `researcher`, and `planner` are defined in this extension's bundled `agents/` folder and used as runtime fallbacks when no user-defined agent with the same name exists.
- Tool discovery: merge Pi built-in tools with tools discovered from Pi's runtime registry.
- Result shape: the parent-visible tool result is the child agent's final assistant text; structured metadata exists for rendering and debugging only.
- Operational settings: use global config defaults with optional per-agent frontmatter overrides such as `timeout_ms`.
- Source strategy: use ideas from the references, but do not copy code.

## Goals

- Add a Pi extension in this repo that registers a `subagent` tool.
- Add a Pi command in this repo that lets the user manually invoke a subagent with `/agent`.
- Add a Pi command in this repo that lists agents and creates new ones with `/agents`.
- Make agent definitions markdown-driven and globally discoverable.
- Keep subagents isolated from the parent conversation unless context is explicitly embedded in the delegated task.
- Provide enough observability that the parent can see what the child did, what tools it used, how long it ran, and why it failed.
- Preserve a clean path to later epics for background execution, richer UI, project-local agents, and deeper recursion controls.

## Non-Goals

- No background jobs.
- No `get_subagent_result` or `steer_subagent`.
- No resume support.
- No project-local `.pi/agents`.
- No in-process child session management.
- No worktree isolation, scheduling, memory scopes, or service API for other extensions.

## User-Facing Behavior

The extension registers one tool:

```json
{
  "agent": "scout",
  "task": "Find the files responsible for auth token validation",
  "cwd": "/optional/working/directory"
}
```

The extension also registers one command:

```text
/agent scout Find the files responsible for auth token validation
```

And one management command:

```text
/agents
```

Behavior:

- `agent` selects a discovered markdown-defined subagent.
- `task` must be self-contained. The child has no parent conversation context.
- `cwd` defaults to the parent session working directory when omitted.
- The call runs one child `pi` process and returns the child agent's final assistant text as the parent-visible result.
- Structured metadata such as usage, tool activity, child session location, and exit details is for rendering and debugging; it does not become first-class LLM-visible output unless the child includes it in final text. In Phase 4, details expose `childSessionDir` and required `childSessionPath`.
- `/agent` uses the same execution path as the tool and remains foreground-only in Epic 1, but emits a visible custom message rather than a model-visible tool result.
- `/agents` opens a minimal interactive menu that lists discovered agents and creates new markdown-defined agents.
- `/agents` does not edit agents in place; users modify markdown files directly after creation.

Tool description guidance must explicitly tell the parent agent:

- Use `subagent` for delegated reasoning or exploration, not simple direct I/O.
- Put all required context in `task`.
- Prefer multiple `subagent` tool calls in the same turn when parallel delegation is needed later through the parent orchestrator, even though Epic 1 itself only implements one child per call.
- Use `scout` for read-only repo exploration, `planner` for planning work, `researcher` for web work, and `worker` for implementation tasks.
- Use keyword heuristics when choosing a subagent automatically:
  `find`, `map`, `trace`, `where` -> `scout`
  `plan`, `design`, `architecture`, `migration` -> `planner`
  `search`, `docs`, `latest`, `source` -> `researcher`
  `implement`, `fix`, `edit`, `refactor` -> `worker`

## Agent Model

Epic 1 uses markdown files in `$PI_CODING_AGENT_DIR/agents/*.md` at runtime. The extension also ships bundled default-agent markdown files in its own `agents/` folder as fallback definitions.

Frontmatter schema:

- `name`: optional agent name. When omitted or empty, inherit from the markdown filename stem.
- `description`: required human-readable summary.
- `tools`: comma-separated tool names.
- `model`: optional model identifier.
- `thinking`: optional thinking level.
- `subagent_agents`: optional comma-separated allowlist of child agents this agent may spawn.
- `timeout_ms`: optional hard timeout override for the child process, overriding the global default when present.

The markdown body is the system prompt.
Markdown filenames are lowercase slugs such as `scout.md`. Frontmatter `name` may preserve user casing when present.

Epic 1 starter agents:

- `scout`
  - Purpose: fast read-only codebase reconnaissance.
  - Default tools: `read`, `grep`, `find`, `ls`.
  - Default model: cheap/fast model such as Haiku.
  - Output: compact findings with file paths, line ranges, architecture notes, and suggested next file.
- `planner`
  - Purpose: read-only planning, sequencing, and risk analysis.
  - Default tools: `read`, `grep`, `find`, `ls`, optional `bash` for non-mutating inspection only.
  - Default model: balanced planning model such as Sonnet.
  - Output: implementation steps, tradeoffs, risks, and targeted verification.
- `researcher`
  - Purpose: web research and synthesis.
  - Default tools: `web_search`, `web_fetch`.
  - Default model: stronger synthesis model such as Sonnet.
  - Output: short sourced brief with kept sources and gaps.
- `worker`
  - Purpose: focused code changes and verification.
  - Default tools: `read`, `write`, `edit`, `safe_bash`, optional web tools, and `subagent`.
  - Child allowlist: `scout`, `researcher`.
  - Output: changes made, verification performed, remaining caveats.

## Extension Architecture

### Package layout

Add the minimal package structure:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `biome.json`
- `vitest.config.ts`
- `.github/workflows/quality.yml`
- `.github/workflows/release.yml`
- `agents/scout.md`
- `agents/worker.md`
- `agents/researcher.md`
- `agents/planner.md`
- `src/index.ts`
- `src/config.ts`
- `src/agents.ts`
- `src/spawn.ts`
- `src/commands.ts`
- `src/tools.ts`
- `src/render.ts`
- `src/types.ts`
- `tests/`

Exact filenames can vary slightly if the implementation stays equally small and the responsibilities remain clear.

Phase 1 repo baseline:

- keep the same package/tooling structure as `pi-status`
- keep this repo's selected versions and ranges rather than forcing exact parity with `pi-status`
- package/runtime baseline:
  `node >=22.19.0`,
  `@earendil-works/pi-coding-agent ^0.78.1`,
  `@earendil-works/pi-tui ^0.78.1`,
  `@biomejs/biome ^2.4.16`,
  `typescript ^6.0.3`,
  `vitest ^4.1.7`
- keep `pnpm-workspace.yaml` with the current dependency-graph allowances:
  `@google/genai`, `esbuild`, and `protobufjs`
- keep `biome.json` at schema `2.4.16` with the repo's explicit JavaScript formatter settings and file includes
- keep the GitHub workflow split used by `pi-status`:
  `quality.yml` for pushes and pull requests to `master`, and `release.yml` for `v*` tags
- keep workflow runtime/tooling aligned with the current `pi-status` setup:
  `pnpm/action-setup@v4` on pnpm `11.3.0`, `actions/setup-node@v4` on Node `22`, frozen-lockfile installs, separate `lint`/`typecheck`/`test` quality steps, and release checks for `pnpm check`, `pnpm run pack:dry-run`, and tag-to-package-version parity before npm publish

### Runtime flow

1. Extension loads.
2. Extension resolves Pi-owned paths through `getAgentDir()`.
3. Extension reads config from `<agentDir>/extensions/subagents.json`.
4. Extension discovers agents from `<agentDir>/agents` and the package-bundled `agents/` directory, with user agents taking precedence on name collisions.
5. Extension discovers available tool names from Pi's runtime registry and merges them with built-in Pi tool names.
6. Extension registers the `subagent` tool plus `/agent` and `/agents` commands.
7. On execution:
   - validate `agent` and `task`
   - resolve target agent config
   - compute the explicit child tool allowlist and effective operational settings
   - write a temporary system prompt file
   - derive the parent project session location from the current session when available, otherwise create a unique temp child session root
   - spawn child `pi` with `--mode json -p --no-extensions --session <child-session-path>`
   - persist the child run as a native Pi session JSONL at the exact child session path
   - parse stdout assistant `message_end` events into final output and metadata
   - collect final assistant text, usage when available, duration, stderr, child session dir/path, stop reason, model, and exit status
   - clean up temporary files
   - return final assistant text plus structured details for rendering and debugging

### Child process invocation

The implementation should follow the minimal shell-out pattern proven in the small reference:

- resolve the effective Pi binary from the current process when possible, otherwise fall back to `pi`
- use JSON mode and non-interactive prompt execution
- allowlist tools explicitly
- append the agent system prompt from a temp file
- pass model and thinking flags explicitly
- keep child runs non-recursive in Phase 4 by not loading this extension into the child
- add recursion/runtime context files only in Phase 5, not Phase 4

Target child invocation shape:

```text
pi --mode json -p --no-extensions --session <child-session-path> --name <agent> --tools ... --model ... --thinking ... --append-system-prompt <prompt-file> "Task: ..."
```

Phase 4 child-session layout:

```text
<parent-session-dir>/<parent-session-stem>/<run-id>/run-0/session.jsonl
```

When the parent session is not persisted, use:

```text
$TMPDIR/pi-subagent-session-XXXXXX/<run-id>/run-0/session.jsonl
```

Use raw stdout JSON only as the live parsing stream. The persisted inspectable artifact is the native child Pi session file.
Structured details expose:

- `childSessionDir`: the concrete child run directory, either parent-relative under `<run-id>/run-0` or the temp fallback
- `childSessionPath`: the exact child session JSONL file passed through `--session`

For nested delegation in Phase 5, the runtime uses temp-root runtime state under:

```text
$TMPDIR/pi-subagents-<scope>/nested-subagent-events/...
$TMPDIR/pi-subagents-<scope>/nested-subagent-runs/...
```

That runtime state carries:

- current depth, where the parent call is depth `1`
- configured recursion ceiling
- optional child-agent allowlist derived from `subagent_agents`
- run identifier metadata needed to reconnect nested calls to the right parent context

### Tool resolution

Pi tools fall into two categories, but the extension treats them through one merged runtime registry.

Built-in Pi tools are supported directly:

- `read`
- `write`
- `edit`
- `bash`
- `grep`
- `find`
- `ls`

Extension-registered tools are any non-built-in tools exposed by Pi extensions, including this extension's own `subagent` tool. These are not configured in `subagents.json`; the extension discovers them from Pi's runtime registry, for example through `pi.getAllTools()`, and uses those discovered names alongside the built-in tool list:

```json
{
  "maxConcurrency": 4,
  "maxRecursiveLevel": 2,
  "defaultTimeoutMs": 600000
}
```

Rules:

- If an agent requests a tool name not present in the merged runtime registry, fail before spawning with a clear unknown-tool error.
- If an agent requests an extension-registered tool and the child run did not load the providing extension, surface the child-process failure clearly with stderr, exit status, and child session location.
- In Phase 4, `subagent` is not exposed to the child.
- In Phase 5, `subagent` is exposed to the child only when the child run loads this extension in a nested-safe mode.
- In Phase 5, if `subagent_agents` is present, apply that allowlist through the per-run runtime context so the child only exposes those agents.
- In Phase 5, if current depth equals `maxRecursiveLevel`, do not expose `subagent` to the child even if the agent frontmatter lists it.

### Bundled-agent behavior

The package ships starter agent markdown files in its own `agents/` folder.

Rules:

- user-created agents live under `<agentDir>/agents`
- bundled `scout.md`, `worker.md`, `researcher.md`, and `planner.md` are loaded as fallback definitions
- if a bundled agent name conflicts with a user agent, the user agent wins
- `/agents` must show whether an agent came from the user directory or the bundled package

### `/agents` command

`/agents` provides a minimal interactive management flow for Epic 1:

- list all discovered agents with name, description, tools, model, thinking level, child allowlist, and source path
- create a new agent markdown file under `<agentDir>/agents` through `/agents:add`

Create flow fields:

- optional `name`
- `description`
- `tools`, chosen from the merged built-in plus runtime-discovered tool list
- optional `model`
- optional `thinking`
- optional `subagent_agents`
- optional `timeout_ms`
- markdown body for the system prompt

Rules:

- `/agents` with no arguments remains the listing command
- `/agents:add` uses interactive prompts for scalar fields and a multi-line editor for the markdown body
- merge built-in Pi tools with `pi.getAllTools()` results, dedupe them, and sort them before presenting or validating tool names
- reject duplicate agent names unless the user intentionally edits the file outside the command
- preserve frontmatter `name` casing when provided, but derive the markdown filename from a lowercase slug
- if frontmatter `name` is omitted, inherit the agent name from the lowercase markdown filename stem
- reject provided names that do not match `^[A-Za-z0-9_-]+$`
- reject unknown tool names during creation
- reject `subagent_agents` values that do not reference currently discovered agents
- reject empty `description` or markdown body
- reject invalid `timeout_ms` values unless omitted
- serialize created agent files deterministically as `<lowercase-name>.md` with comma-separated arrays and a trailing newline
- create `<agentDir>/agents` if missing, and never overwrite an existing file
- do not provide edit or delete actions in Epic 1
- after creation, the new file becomes discoverable through the normal agent directory scan

### Observability and rendering

Epic 1 should remain minimal, but observability is a hard requirement:

- status: pending, running, completed, failed
- persisted native child Pi session file for every run
- child session directory and, when available, child session path for later inspection
- current or recent tool activity reconstructed from the persisted event stream
- latest prose/thinking line when available from the persisted event stream
- duration
- token usage summary when available
- model name if known
- exit code
- stderr or timeout reason when failing
- final assistant text

Rendering requirements:

- compact call line in collapsed mode
- structured result block with status, usage, and child session reference
- expandable final markdown output
- explicit error messages for unknown agent, invalid config, missing child extension availability, timeout, abort, spawn failure, and non-zero child exit

## Implementation Constraints

- Keep the diff surgical and the architecture small.
- Do not introduce abstractions needed only by later epics.
- Prefer module boundaries around concrete runtime responsibilities: config, agent discovery, spawn, render, and tests.
- Use ASCII unless an existing Pi renderer strongly benefits from a symbol already used by the ecosystem.
- If the child process exits non-zero but still produced a final assistant message, surface both the message and the failure metadata.
- Final assistant text remains the tool result; renderer/debug metadata must stay out of the parent-visible result payload by default.

## Verification Plan

Automated checks:

- typecheck with `tsc --noEmit`
- unit tests with Vitest
- one integration-style test suite using a mock `pi` executable that emits JSON mode events and final text

Required test scenarios:

- parse valid agent frontmatter
- reject or skip malformed agent markdown
- verify bundled default agents exist in the extension `agents/` folder
- discover global agents correctly
- list discovered agents through `/agents`
- create new agents through `/agents`
- filter agents through the per-run runtime context allowlist
- parse and enforce `maxRecursiveLevel`
- persist a native child Pi session for every run
- store child sessions under the relevant project session directory
- discover tool names from Pi runtime registry and merge with built-in tools
- reject unknown tools before spawn
- discover bundled fallback agents without copying them into the user agent directory
- prefer user agents over bundled fallback agents on duplicate names
- build spawn arguments for built-in tools only
- build spawn arguments for mixed built-in and extension-registered tools
- parse child stdout event stream into progress and final output
- verify final assistant text is the only parent-visible result content
- verify renderer/debug metadata does not leak into the result text
- surface stderr and non-zero exit codes
- enforce global timeout defaults and agent-level `timeout_ms` overrides
- clean up temp files after completion or failure
- render collapsed and expanded result views
- parse `/agent <agent> <task...>` and route it through the same execution path as the tool
- emit `/agent` output as a visible custom message
- verify `/agents` create rejects duplicate names and writes valid markdown
- verify `planner` agent loading and read-only tool configuration

Manual verification:

- load the extension into a local Pi environment
- confirm duplicate names prefer user agents over bundled fallback agents
- confirm `subagent` appears in tool descriptions
- confirm `/agent` runs the requested subagent in the foreground
- confirm `/agents` lists discovered agents and creates a new agent file
- run `scout` against this repo and verify the result is returned inline
- run `planner` on a planning task and verify it stays read-only
- inspect the generated child session location under the relevant project session directory

## Later Epic Seams

Epic 1 should leave clear seams for future work without implementing it now:

- background execution and result polling
- richer progress widgets and nested child rendering
- project-local agents and trust prompts
- interactive configuration and agent management
- in-process session runtime
- service API for cross-extension use

These seams should exist as natural module boundaries, not as speculative interfaces added prematurely.

## Acceptance Criteria

- A Pi extension in this repo can be loaded and registers a `subagent` tool.
- A Pi extension in this repo can be loaded and registers an `/agent` command.
- A Pi extension in this repo can be loaded and registers an `/agents` command.
- The tool accepts `{ agent, task, cwd? }`.
- Agents are loaded from `<agentDir>/agents`, with bundled fallbacks from the package `agents/` folder.
- Default `scout`, `planner`, `researcher`, and `worker` agent files are bundled in the extension `agents/` folder and used only when the user directory does not override them.
- Child subagents run as isolated shell-out `pi` processes.
- Only explicitly allowlisted tools are exposed to the child.
- Tool validation uses Pi built-ins plus tools discovered from Pi's runtime registry.
- Recursion depth is capped by configuration and enforced for nested delegation.
- Each run persists an inspectable native child Pi session file.
- Child sessions default to the relevant project session directory under `$PI_CODING_AGENT_DIR/sessions`.
- Foreground execution returns the child agent's final assistant text inline.
- Structured metadata is available for rendering and debugging without becoming the tool's parent-visible result content.
- Operational defaults come from config and may be overridden per agent through frontmatter.
- Tests cover configuration, discovery, spawn assembly, parsing, and failure handling.
