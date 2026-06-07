# @pi-vault/pi-subagents

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-subagents)](https://www.npmjs.com/package/@pi-vault/pi-subagents)
[![Quality](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-subagents/actions/workflows/quality.yml)
[![Node >=22.19.0](https://img.shields.io/badge/node-%3E%3D22.19.0-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/pi-vault/pi-subagents/blob/master/README.md#license)

Delegate work to specialized Pi subagents without leaving your current session.

> Early adopter release: `v0.1.0` is a small, focused first version built around a ready-to-use set of bundled agents.

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

- `/agents` — see all discovered agents
- `/agents:add` — create a new user agent markdown file
- `/agent <agent> <task...>` — delegate a task to a specific agent

## Bundled Agents

- `scout` — quickly finds relevant files, entry points, and code paths
- `planner` — turns a task into a short, verifiable plan
- `researcher` — gathers evidence, tradeoffs, and implementation context
- `worker` — handles focused implementation work
- `reviewer` — reviews changes and looks for defects

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
