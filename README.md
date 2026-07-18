# @pi-vault/pi-subagents

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-subagents)](https://www.npmjs.com/package/@pi-vault/pi-subagents)
[![Quality](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Delegate focused work to bundled Pi subagents — singly in the foreground, asynchronously in the background, or as multi-agent chains — without leaving your session.

## Install

```bash
pi install npm:@pi-vault/pi-subagents
```

Reload Pi after install or upgrade:

```text
/reload
```

## Quick Start

| Agent        | Use it for                                                       |
| ------------ | ---------------------------------------------------------------- |
| `scout`      | Map a workspace, locate entry points, surface change surfaces.   |
| `researcher` | Read code and docs to gather evidence, constraints, tradeoffs.   |
| `planner`    | Turn a task into a short, verifiable plan before implementation. |
| `worker`     | Make focused, contained code changes and verify them.            |
| `reviewer`   | Review a diff for defects, regressions, and missing tests.       |

Run one inline to see it work:

```text
/agent scout map the repository structure
```

---

## Single Agent: `/agent`

The slash command runs an agent synchronously in the foreground. The result is delivered as a slash card with live tool activity, turn count, and thinking level while it runs.

```text
/agent planner design a caching strategy for the API client
/agent worker add retry with exponential backoff
/agent reviewer review the staged diff
```

### Background Execution

Pass `--run_in_background` to the `subagent` tool (from chat or from another agent) to launch an agent and continue working:

```text
subagent {
  agent: "worker",
  task: "refactor the auth flow",
  run_in_background: true
}
```

You get an agent ID immediately and are notified on completion. While it runs:

- Use `get_subagent_result(agent_id)` to check status and retrieve the result.
- Use `steer_subagent(agent_id, message)` to redirect a running agent.
- Use `wait({ id: "..." })` to block until a specific agent finishes, `wait({ all: true })` for all, or `wait()` for the next one to complete.

Background completion notifications are deduplicated: retrieving a result with `get_subagent_result` automatically suppresses the queued nudge.

### Parallel Batches

Fire several background agents in the same turn and, with `defaultJoinMode: smart` (the default), one grouped notification replaces N individual nudges:

```text
/agent scout map the auth surface  --run_in_background
/agent researcher document the OAuth scopes  --run_in_background
/agent reviewer check the open PR for regressions  --run_in_background
```

### Subagent Tool Parameters

Agents and chat both invoke the same `subagent` tool:

| Parameter           | Type    | Notes                                                     |
| ------------------- | ------- | --------------------------------------------------------- |
| `agent`             | string  | Agent name (required).                                    |
| `task`              | string  | Task to delegate (required).                              |
| `cwd`               | string  | Override working directory.                               |
| `model`             | string  | `provider/id` or fuzzy name (`haiku`, `sonnet`).          |
| `thinking`          | string  | `off`, `low`, `medium`, `high`.                           |
| `max_turns`         | number  | Per-run turn cap. Overrides the agent default.            |
| `isolated`          | boolean | Drop extension/MCP tools; built-in tools only.            |
| `inherit_context`   | boolean | Fork the parent conversation into the agent.              |
| `run_in_background` | boolean | Return an agent ID and stream progress as the agent runs. |
| `resume`            | string  | Agent ID to resume with new instructions.                 |
| `isolation`         | string  | `worktree` to run in a temporary git worktree.            |
| `tool_budget`       | object  | Soft/hard limits for this invocation.                     |
| `chain`             | array   | Multi-step pipeline (see below).                          |
| `chain_append`      | object  | Append steps to a running chain.                          |
| `clarify`           | boolean | Show step-editor TUI before chain execution.              |

---

## Chains: Multi-Agent Pipelines

Chains let you sequence agents so later steps consume the output of earlier ones.

### Inline `/chain`

```text
/chain scout "find the rate limiter" -> planner -> worker --bg
```

Arrow-separates steps; task text goes in quotes. Trailing flags:

- `--bg` — run in background.
- `--yes` — skip the step-confirmation TUI.

### Parallel Groups

Wrap sibling steps in parentheses separated by `|`:

```text
/chain (scout "audit error handling" | researcher "find error patterns") -> worker --bg
```

Configure concurrency or isolation after the group with `[concurrency=2, worktree]`.

### Saved Chains

Bundled chains ship in the `chains/` directory. Run one with `/run-chain`:

```text
/run-chain implement -- <your task description>
```

Project chains go in `.pi/chains/`; user chains in your global agent dir. Chain files use `.chain.md` or `.chain.json` format.

### Chain Status and Cancellation

```text
/chain status          # list all running chains
/chain status <id>     # detail for one chain
/chain cancel <id>     # stop a running chain
```

### Template Variables

Within a chain step, these variables are expanded automatically:

- `{task}` — the original task passed to the chain.
- `{previous}` — the output of the immediately preceding step.
- `{outputs.<name>}` — the output of a step named with `as:`.
- `{chain_dir}` — the temporary directory of the current chain run.

---

## User Agents

User overrides live in `~/.pi/agent/agents/<slug>.md`. Each file has frontmatter plus a prompt body.

```md
---
name: my-worker
description: Focused implementation helper.
tools:
  - read
  - edit
  - write
  - bash
  - grep
  - find
  - ls
model: default
thinking: medium
prompt_mode: replace
max_turns: 20
enabled: true
inherit_context: false
run_in_background: false
isolated: false
extensions: true
subagent_agents:
  - scout
  - reviewer
memory:
  scope: user
  path: my-worker
tool_budget: { "soft": 15, "hard": 25 }
intercom: true
disallowed_tools:
skills:
---

You are My Worker.

Make the smallest safe change that completes the task, then verify.
```

### Supported Frontmatter Fields

| Field               | Type                      | Notes                                                                            |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `name`              | string                    | Optional display name; otherwise the filename slug is used.                      |
| `description`       | string                    | Required short summary shown in `/agents`.                                       |
| `tools`             | list                      | Comma-separated string or YAML list. Built-in tools and `subagent`.              |
| `model`             | string                    | `default` falls back to the host session; otherwise `provider/id` or fuzzy name. |
| `thinking`          | string                    | `off`, `low`, `medium`, `high`.                                                  |
| `subagent_agents`   | list                      | Allowlist of child agents this agent may invoke.                                 |
| `skills`            | list / `all` / `none`     | `all`, `none`, or a comma-separated/YAML list of skill names.                    |
| `prompt_mode`       | `replace` \| `append`     | Default `replace`. `append` layers the agent prompt on top of the parent prompt. |
| `max_turns`         | integer                   | Maximum turns before the agent is steered to wrap up. `0` means unlimited.       |
| `max_depth`         | integer                   | Maximum recursion depth for child-agent spawning. `0` means unlimited.           |
| `inherit_context`   | boolean                   | If `true`, fork the parent conversation into the agent.                          |
| `run_in_background` | boolean                   | If `true`, return immediately and run in background.                             |
| `isolated`          | boolean                   | If `true`, the agent gets no extension/MCP tools, only built-ins.                |
| `isolation`         | `worktree`                | Run the agent in a temporary git worktree.                                       |
| `extensions`        | `true` \| `false` \| list | `true` keeps all, `false`/`none` drops all, list is an allowlist.                |
| `disallowed_tools`  | list                      | Tools to remove from the agent's allowlist after extension filtering.            |
| `tool_budget`       | JSON object               | `{"soft": N, "hard": M, "block": ["tool1", ...]}`.                               |
| `memory`            | object                    | `{"scope": "user"\|"project"\|"local", "path": "dir-name"}`.                     |
| `intercom`          | boolean                   | If `true`, child agents get the `contact_supervisor` tool.                       |
| `enabled`           | boolean                   | `false` keeps the agent registered but suppresses invocation.                    |

> `timeout_ms` is no longer supported. Use `max_turns`.

---

## `/agents` Menu

`/agents` opens an interactive menu with three sections:

**Agents** — list bundled agents and user overrides; create, edit, export, disable, or delete.

**Settings:**

| Setting               | Default      | Notes                                                                |
| --------------------- | ------------ | -------------------------------------------------------------------- |
| `maxConcurrency`      | `3`          | Max background agents running at once.                               |
| `defaultMaxTurns`     | —            | Default per-run turn cap when an agent does not set `max_turns`.     |
| `graceTurns`          | `5`          | Extra turns after `max_turns` to let the agent wrap up cleanly.      |
| `defaultJoinMode`     | `smart`      | `async`, `group`, or `smart` (default; batched for parallel agents). |
| `widgetMode`          | `background` | `all`, `background`, or `off` — controls the activity widget.        |
| `fleetView`           | on           | Show the below-editor fleet list of in-flight agents.                |
| `maxSpawnsPerSession` | `40`         | Total spawned agents before the session is blocked.                  |

**Back** returns to the parent menu.

---

## UI: Widget, Fleet, And Conversation Viewer

Three optional TUI surfaces sync with running agents:

- **AgentWidget** — activity sidebar above the editor; respects `widgetMode`.
- **FleetList** — below-editor navigator listing every in-flight agent; toggle with `fleetView`.
- **ConversationViewer** — overlay (Ctrl/Cmd+O) for reading the full transcript of any agent.

All three show live tool activity, turn count, and steered status.

---

## Settings File

Settings merge from two locations (project overrides global):

- Global: `~/.pi/agent/subagents.json`
- Project: `.pi/subagents.json`

```json
{
  "maxConcurrent": 5,
  "defaultJoinMode": "smart",
  "widgetMode": "all",
  "fleetView": true,
  "maxSpawnsPerSession": 50,
  "toolBudget": { "soft": 30, "hard": 50 },
  "modelScope": {
    "enforce": true,
    "allow": ["anthropic/claude-sonnet-*", "openai/*"]
  },
  "watchdog": {
    "enabled": true,
    "model": "anthropic/claude-sonnet-4-20250514",
    "thinking": "medium",
    "reviewChangesOnly": true,
    "children": { "enabled": false },
    "autoFollow": { "blockers": true, "concerns": false, "maxAttempts": 2 }
  }
}
```

---

## Watchdog

The watchdog is an optional post-review step that inspects an agent's changes (or its turn-by-turn conversation) after it finishes. Findings are surfaced as severity-categorized warnings in the TUI.

```text
/watchdog                    # show current status
/watchdog off                # disable for this session
/watchdog recommend-model    # suggest a model for watchdog use
```

Configure via the `watchdog` key in settings (see example above). When `autoFollow.blockers` is `true`, the watchdog automatically steers the finished agent to fix issues found during review.

---

## Prompt Workflows

Markdown templates with frontmatter that expand to agent tasks. Place them in `~/.pi/agent/prompts/` or `.pi/prompts/`:

```md
---
description: Summarise the current diff
subagent: worker
---

Analyse the staged git diff and write a concise summary covering the purpose of each change.
```

```text
/prompt-workflow summarize          # run with no arguments
/prompt-workflow review -- --scope auth   # pass arguments ($1, $@)
```

Chain multiple workflows:

```text
/chain-prompts analyze -> fix -- scope auth
```

---

## Intercom (Child↔Parent Communication)

When an agent has `intercom: true` in its frontmatter, it receives a `contact_supervisor` tool. The parent session gets an `intercom` tool to reply:

```text
intercom { action: "list" }
intercom { action: "reply", replyTo: "...", message: "Proceed with your best judgment." }
```

---

## Common Workflows

**Find and fix a bug:**

```text
/agent scout trace where the cache TTL is computed
/agent worker fix the cache expiry bug
/agent reviewer review the staged diff
```

**Chain the same sequence as a pipeline:**

```text
/chain scout "trace where the cache TTL is computed" -> worker -> reviewer
```

**Research, then implement, in background:**

```text
/agent researcher analyse all error boundaries --run_in_background
/agent worker add error boundaries to the API layer --run_in_background
```

**Iterate with a persisted agent override:**

Create a custom agent via `/agents`, then run it with the same refined prompt every time.

---

## Development And Verification

```bash
pnpm install
pnpm check          # lint + typecheck + test
pnpm release:check  # check + pack dry-run
```

## Acknowledgement

`@pi-vault/pi-subagents` was inspired by and builds on ideas from

- [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents)
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)

Thank you for laying the groundwork.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT. see [`LICENSE`](LICENSE).
