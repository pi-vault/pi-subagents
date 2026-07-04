# @pi-vault/pi-subagents

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-subagents)](https://www.npmjs.com/package/@pi-vault/pi-subagents)
[![Quality](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/pi-vault/pi-subagents/blob/master/README.md#license)

Delegate focused work to bundled Pi subagents without leaving your current session.

## Install

```sh
pi install npm:@pi-vault/pi-subagents
```

Reload Pi after install:

```text
/reload
```

## Quick Start

Run a bundled agent directly:

```text
/agent scout trace where auth state is loaded
```

Open the interactive agent manager:

```text
/agents
```

Use `/agents` when you want to:

- create or edit a user agent override
- export a bundled agent into your global Pi agent directory
- disable an agent with a global override
- delete an existing global override
- change subagent settings such as `maxConcurrency`, `maxRecursiveLevel`, and `defaultTimeoutMs`

## Bundled Agents

- `scout` finds relevant files, entry points, and code paths
- `planner` turns a task into a short, verifiable plan
- `researcher` gathers evidence, tradeoffs, and implementation context
- `worker` handles focused implementation work
- `reviewer` reviews changes and looks for defects

## Typical Usage

- Use `/agent scout ...` to find where a feature or bug lives.
- Use `/agent planner ...` before a non-trivial change.
- Use `/agent worker ...` for a scoped implementation task.
- Use `/agent reviewer ...` before shipping a diff.

Foreground runs are the supported execution mode in this release.

## User Agent Overrides

User overrides are markdown files with frontmatter plus a prompt body. A minimal example:

```md
---
name: my-worker
description: Focused implementation helper.
tools: read, write, bash
model: default
thinking: medium
subagent_agents: scout, reviewer
skills: tdd, verification-before-completion
timeout_ms: 180000
---

You are My Worker.

Make the smallest safe change that completes the task.
```

Supported frontmatter fields:

- `name` optional display name; otherwise the filename slug is used
- `description` required short summary
- `tools` comma-separated tool allowlist
- `model` optional model override; `default` falls back to the host session
- `thinking` optional thinking level
- `subagent_agents` optional allowlist of child agents this agent may invoke
- `skills` optional skill policy: comma-separated names, `all`, or `none`
- `timeout_ms` optional per-agent timeout in milliseconds

If you create an agent from `/agents`, you can edit the generated markdown later to refine its prompt or `skills`.

## Development and verification

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
