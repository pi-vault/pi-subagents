# @pi-vault/pi-subagents

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-subagents)](https://www.npmjs.com/package/@pi-vault/pi-subagents)
[![Quality](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml)
[![Node >=22.19.0](https://img.shields.io/badge/node-%3E%3D22.19.0-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/pi-vault/pi-subagents/blob/master/README.md#license)

Delegate work to specialized Pi subagents without leaving your current session.

> Early adopter release: `v0.2.0` keeps the package small and focused while expanding the built-in agent workflow.

## Install

```sh
pi install npm:@pi-vault/pi-subagents
```

Then reload Pi:

```text
/reload
```

## Use

After install, the bundled agents are available right away.

- `/agents` — open the interactive agents menu
- `/agent <agent> <task...>` — delegate a task to a specific agent with visible foreground progress

From `/agents` you can:

- create a user agent override
- edit a user agent override
- export a bundled agent into Pi global scope
- disable an agent via global override
- delete a global override
- manage `maxConcurrency`, `maxRecursiveLevel`, and `defaultTimeoutMs`

Background runs are not part of this release.

## What's New In v0.2.0

- interactive `/agents` menu for managing bundled and global agents
- improved live foreground progress for `/agent` runs
- skills support for bundled agents and user-configured agents

## Bundled Agents

- `scout` — quickly finds relevant files, entry points, and code paths
- `planner` — turns a task into a short, verifiable plan
- `researcher` — gathers evidence, tradeoffs, and implementation context
- `worker` — handles focused implementation work
- `reviewer` — reviews changes and looks for defects

## Agent Files

User overrides live in Pi's user agent directory and use markdown frontmatter plus a prompt body.

```md
---
name: my-worker
description: Focused implementation helper.
tools: read, write, bash
model: provider/model
thinking: low
subagent_agents: scout, reviewer
skills: tdd, verification-before-completion
timeout_ms: 180000
---

You are My Worker.

Make the smallest safe change that completes the task.
```

Supported frontmatter fields:

- `name` — optional display name; if omitted, the filename slug is used
- `description` — required short summary
- `tools` — comma-separated tool allowlist
- `model` — optional model override; `default` falls back to the host/session default
- `thinking` — optional thinking level
- `subagent_agents` — optional allowlist of child agents this agent may invoke
- `skills` — optional skill policy: comma-separated names, `all`, or `none`
- `timeout_ms` — optional per-agent timeout in milliseconds

The interactive create flow currently asks for `name`, `description`, `tools`, `model`, `thinking`, `subagent_agents`, `timeout_ms`, and the markdown body. To add or change `skills`, edit the agent markdown after creation or export a bundled agent and modify the file.

## Skill Resolution

When an agent specifies `skills`, pi-subagents resolves them from the first matching location in:

- `.pi/skills/` in the current workspace
- `.agents/skills/` in the current workspace
- the global Pi agent skills directory
- `~/.agents/skills/`
- `~/.pi/skills/`

Skill names must be simple names without path separators or whitespace.

## Settings

Global subagent settings are stored in Pi's `subagents.json` file. The current defaults are:

- `maxConcurrency: 3`
- `maxRecursiveLevel: 3`
- `defaultTimeoutMs: 600000`

## Typical Flow

- Use `/agent scout trace where auth state is loaded` when you need fast codebase discovery.
- Use `/agent planner outline a safe migration for the config format` before a non-trivial change.
- Use `/agent reviewer inspect this diff for regressions` before shipping.

## Compatibility

- Node `>=22.19.0`
- Peer deps: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`
- Intended for use from a Pi host session with package/extension support

## Development Setup

```sh
pnpm install
pnpm check
pnpm pack --dry-run
pi -e .
```

## License

MIT
