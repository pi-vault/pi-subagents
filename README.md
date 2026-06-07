# pi-subagents

Pi extension for delegating tasks to isolated, specialized subagents.

## Bundled agents

This package ships these starter agents in `agents/`:

- `scout` — fast file and code-path discovery
- `planner` — small, verifiable execution plans
- `researcher` — evidence gathering and tradeoff analysis
- `worker` — focused implementation
- `reviewer` — read-only review and defect finding

User agents in `~/.pi/agent/agents` override bundled agents with the same name.

## Model behavior

Agents inherit the parent session model by default.

- Omit `model` frontmatter to inherit.
- Explicit `model` overrides the parent model.
- Legacy `model: default` is still accepted as an alias for inheritance.
- Newly created and bundled agents omit `model` unless they need a specific override.

## Config defaults

Default config values:

- `maxConcurrency=3`
- `maxRecursiveLevel=3`
- `defaultTimeoutMs=600000`

## Runtime artifacts

Nested runtime artifacts are stored in a deterministic `subagent-artifacts` layout:

- persisted sessions: `<session-dir>/subagent-artifacts`
- no parent session: `$PI_CODING_AGENT_DIR/sessions/<pi-encoded-cwd>/subagent-artifacts`

Per-run artifact files are written as:

- `{runId}_{agent}_{index}_input.md`
- `{runId}_{agent}_{index}_output.md`
- `{runId}_{agent}_{index}_meta.json`

Within either root, nested runtime files live under:

- `nested-subagent-events/`
- `nested-subagent-runs/`

## Commands

- `/agents` — list discovered bundled and user agents
- `/agents:add` — create a new user agent markdown file
- `/agent <agent> <task...>` — run a discovered agent through the active runtime bridge
