# @pi-vault/pi-subagents

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-subagents)](https://www.npmjs.com/package/@pi-vault/pi-subagents)
[![Quality](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Delegate focused work to bundled Pi subagents — synchronously in the foreground, asynchronously in the background, or in parallel batches — without leaving your session.

## Install

```bash
pi install npm:@pi-vault/pi-subagents
```

Reload Pi after install or upgrade:

```text
/reload
```

## Quick Start

Run a bundled agent in the foreground:

```text
/agent scout trace where auth state is loaded
```

Run the same agent in the background and continue working:

```text
/agent worker refactor auth flow  --run_in_background
```

Open the interactive agent manager:

```text
/agents
```

`/agents` lets you:

- browse, create, edit, export, disable, or delete bundled agents and user overrides
- tune runtime settings: `maxConcurrency`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`, `widgetMode`, `fleetView`

## Bundled Agents

| Agent        | Use it for                                                       |
| ------------ | ---------------------------------------------------------------- |
| `scout`      | Map a workspace, locate entry points, surface change surfaces.   |
| `researcher` | Read code and docs to gather evidence, constraints, tradeoffs.   |
| `planner`    | Turn a task into a short, verifiable plan before implementation. |
| `worker`     | Make focused, contained code changes and verify them.            |
| `reviewer`   | Review a diff for defects, regressions, and missing tests.       |

## Foreground, Background, And Parallel

**Foreground** runs block the slash command until the agent finishes; its result is delivered as a slash card.

```text
/agent scout find the rate limiter
/agent planner plan caching for the API client
/agent worker add retry with exponential backoff
/agent reviewer review the staged diff
```

**Background** runs return immediately with an agent ID, stream live progress into the widget/fleet, and notify you on completion:

```text
/agent worker refactor auth flow --run_in_background
```

Use `get_subagent_result` and `steer_subagent` from any agent (or in chat) to interact with a running background agent.

**Parallel batches** are detected automatically. Fire several background agents from the same turn and, with `defaultJoinMode: smart` (the default), one grouped completion notification arrives instead of N nudges.

## Subagent Tool

Agents and the slash command both invoke the same `subagent` tool. All parameters are optional except `agent` and `task`:

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

## Background Tools

These tools are registered when the extension loads and can be called from any agent or from chat:

- `get_subagent_result(agent_id, wait?, verbose?)` — fetch status and result for a background agent; pass `wait: true` to block until it finishes.
- `steer_subagent(agent_id, message)` — redirect a running or queued background agent without restarting it.

Background completion notifications are deduplicated against `get_subagent_result` calls, so retrieving a result suppresses the queued nudge for that agent.

## `/agents` Menu

`/agents` opens an interactive menu with three top-level sections:

**Agents**

- list bundled agents and user overrides
- create a new agent (writes a markdown override file)
- edit, export to global scope, disable, or delete a user override

**Settings**

| Setting           | Default      | Purpose                                                                  |
| ----------------- | ------------ | ------------------------------------------------------------------------ |
| `maxConcurrency`  | `3`          | Max background agents running at once.                                   |
| `defaultMaxTurns` | —            | Default per-run turn cap when an agent does not set `max_turns`.         |
| `graceTurns`      | —            | Extra turns allowed after `max_turns` to let an agent wrap up cleanly.   |
| `defaultJoinMode` | `smart`      | `async`, `group`, or `smart` (default; batched for parallel agents).     |
| `widgetMode`      | `background` | `all`, `background`, or `off` — controls the activity widget visibility. |
| `fleetView`       | on           | Show the below-editor fleet list of in-flight agents.                    |

**Back** returns to the parent menu.

## User Agent Overrides

User overrides live in `~/.pi/agent/agents/<slug>.md` (or your global agent dir). Each file has frontmatter plus a prompt body. Example:

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
disallowed_tools:
skills:
---

You are My Worker.

Make the smallest safe change that completes the task, then verify the narrowest meaningful checks.
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
| `inherit_context`   | boolean                   | If `true`, fork the parent conversation into the agent.                          |
| `run_in_background` | boolean                   | If `true`, return immediately and run in background.                             |
| `isolated`          | boolean                   | If `true`, the agent gets no extension/MCP tools, only built-ins.                |
| `isolation`         | `worktree`                | Run the agent in a temporary git worktree.                                       |
| `extensions`        | `true` \| `false` \| list | `true` keeps all, `false`/`none` drops all, list is an allowlist.                |
| `disallowed_tools`  | list                      | Tools to remove from the agent's allowlist after extension filtering.            |
| `enabled`           | boolean                   | `false` keeps the agent registered but suppresses invocation.                    |

> `timeout_ms` is no longer supported. Use `max_turns`.

## UI: Widget, Fleet, And Conversation Viewer

When the extension is loaded, three optional TUI surfaces stay in sync with running agents:

- **AgentWidget** — activity sidebar above the editor; respects `widgetMode`.
- **FleetList** — below-editor navigator listing every in-flight agent; toggle with `fleetView`.
- **ConversationViewer** — overlay (Ctrl/Cmd+O) for reading the full transcript of any agent.

All three are wired to live tool activity, turn count, and steered status.

## Settings File

Settings persist under both locations, with project overriding global:

- Global: `~/.pi/agent/subagents.json`
- Project: `.pi/subagents.json`

Example project file:

```json
{
  "maxConcurrent": 5,
  "defaultJoinMode": "smart",
  "widgetMode": "all",
  "fleetView": true
}
```

## Common Examples

Find the file to change before opening an editor:

```text
/agent scout trace where the cache TTL is computed
```

Plan before touching code:

```text
/agent planner design a retry policy for outbound HTTP
```

Implement behind a worker, then review before shipping:

```text
/agent worker add retry with exponential backoff
/agent reviewer review the staged diff
```

Fan out three investigations in parallel:

```text
/agent scout map the auth surface  --run_in_background
/agent researcher document the OAuth scopes  --run_in_background
/agent reviewer check the open PR for regressions  --run_in_background
```

The extension detects the parallel batch and emits one grouped completion notification.

## Development And Verification

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
