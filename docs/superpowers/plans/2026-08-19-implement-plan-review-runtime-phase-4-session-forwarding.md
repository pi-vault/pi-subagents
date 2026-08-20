# Implement Plan Review Runtime — Phase 4: Session Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure single-agent and chain dispatch paths pass actual Pi model objects and strictly normalized thinking values into agent sessions.

**Architecture:** Phase 3 already propagates raw effective model and thinking strings through `StepSpawnOptions`; this phase resolves them only at the chain and single-agent runtime boundaries. Reuse phase 2's `resolveModelSelection()` and `validateModelThinking()` primitives, pass the selected `Model` object through `SpawnOptions.model`, and keep `runAgent()` able to resolve configured definition strings for callers that bypass the main subagent tool path.

The runner uses the precedence established by the reference implementations: an explicit runtime model object wins, then a configured agent-definition model is resolved through Pi's registry, then the parent context model is inherited. The phase does not add a resolver abstraction, migrate legacy RPC lookup, pass Pi's private `modelRuntime`, or move chain validation ahead of execution; those choices keep this change aligned with phase 2 and phase 5.

**Tech Stack:** TypeScript, Pi Coding Agent SDK, Pi AI, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-18-implement-plan-review-chain-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-19-implement-plan-review-runtime.md`

**Reference implementations:**

- `tintinweb-pi-subagents/src/agent-runner.ts` — explicit runtime model, configured model, then parent-model precedence.
- `nicobailon-pi-subagents/src/runs/shared/model-fallback.ts` — explicit versus inherited provenance and strict failure for unresolved explicit models.
- `packages/coding-agent/src/core/model-registry.ts` and `packages/coding-agent/src/core/sdk.ts` — `getAll()`, `getAvailable()`, `find()`, actual `Model` objects, and `thinkingLevel` session input.

## Global Constraints

- `createAgentSession({ model })` receives a real `Model<Api>` object or `undefined`; never pass a configured model string to the session.
- Use the existing `ModelRegistryLike` contract: `getAll()`, `getAvailable()`, and `find(provider, id)`. Do not probe for the nonexistent `listModels()` method.
- A configured raw model must resolve through `resolveModelSelection()`. If the registry is unavailable, the model is unknown, ambiguous, unavailable, or has no runtime object, return the existing error path; never replace it with `ctx.model`.
- If no raw model is configured, preserve the parent `ctx.model` fallback. If both are absent and no thinking value is requested, omit `SpawnOptions.model` and preserve Pi's existing default-model behavior.
- If thinking is configured, validate it with `validateModelThinking()` against the selected model. If no selected model exists, fail rather than allow Pi to clamp against an implicit default. Omitted thinking remains omitted.
- Preserve `resolveInvocationConfig()` precedence: agent definition/frontmatter model and thinking take priority over tool parameters, followed by defaults.
- Preserve the raw `AgentDefinition.model` on temporary effective definitions for custom-tool creation and diagnostics. Session selection must come from the resolved `SpawnOptions.model` object.
- Keep `modelSource` and the existing raw-string `checkModelScope()` behavior at the `subagent` chain boundary. Canonical scope preflight remains phase 5.
- Do not modify the phase-3 raw propagation in `src/core/chain-execution.ts` or `src/core/chain-settings.ts`.
- Do not migrate `src/core/rpc.ts` or `src/index.ts`; phase 2 intentionally retains legacy metadata-only RPC lookup. Runner fallback covers RPC/child callers that provide an agent-definition model string.
- Do not add dependencies, a new shared runtime resolver, or a cast to Pi's private `modelRuntime` property.

### Runtime selection matrix

| Boundary          | Configured value                                           | Selected runtime model                                        | Thinking source                           |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| Chain wrapper     | `options.model ?? agentDef.model`                          | Registry result when configured; otherwise parent `ctx.model` | Effective `options.thinking` from phase 3 |
| Single-agent tool | `resolved.model` from `resolveInvocationConfig()`          | Registry result when configured; otherwise parent `ctx.model` | `resolved.thinking`                       |
| `runAgent()`      | `options.model` object, then `agentDef.model`, then parent | Explicit object; registry result; then `ctx.model`            | `options.thinking ?? agentDef.thinking`   |

---

### Task 1: Forward Resolved Models from Chain Wrappers

**Files:**

- Modify: `src/core/slash-chain.ts` — resolve the effective raw step model before `/chain` and saved-chain dispatch calls `spawnAndWait`.
- Modify: `src/core/subagent.ts` — resolve the effective raw step model in the inline `chain` tool path while retaining model-scope provenance.
- Test: `tests/slash-chain.test.ts` — verify the slash-chain wrapper forwards a runtime model object and normalized thinking.
- Test: `tests/subagent-chain.test.ts` — verify the subagent chain wrapper forwards the same runtime model object and normalized thinking.

**Interfaces:**

- Consumes `StepSpawnOptions.model?: string`, `StepSpawnOptions.modelSource?: "explicit" | "inherited"`, `StepSpawnOptions.thinking?: string`, and the Pi context's `modelRegistry`/`model` values.
- Produces `SpawnOptions.model?: unknown` containing the `Model<Api>` returned by `resolveModelSelection()` and `SpawnOptions.thinking?: string` containing the result of `validateModelThinking()`.

- [ ] **Step 1: Add failing slash-chain forwarding assertions.**

  Extend the existing `executeSlashChain` test fixture with a registry whose metadata contains `test/model` and whose `find()` returns a reasoning-capable sentinel object. Supply a separate parent model on the command context so accidental parent fallback is observable. Execute a step with `model: "test/model"` and `thinking: "HIGH"`, spy on `manager.spawnAndWait`, and assert identity and normalization:

  ```ts
  expect(spawn.mock.calls[0]?.[2]).toMatchObject({
    model: sentinelModel,
    thinking: "high",
  });
  expect(spawn.mock.calls[0]?.[2]?.model).toBe(sentinelModel);
  ```

  Keep the existing custom-tool assertion and continue asserting that the effective definition passed to `createAgentCustomToolsFactory()` contains the raw `model: "test/model"` string.

- [ ] **Step 2: Add failing subagent-chain forwarding assertions.**

  Invoke the registered subagent tool with a context containing the same registry and a different parent sentinel. Use a sequential chain step with `model: "test/model"` and `thinking: "HIGH"`, spy on `manager.spawnAndWait`, and assert `options.model` is the registry sentinel by identity and `options.thinking` is `"high"`. Add one failure assertion with an unknown configured model and a parent sentinel; verify the tool returns an error and `spawnAndWait` is not called.

- [ ] **Step 3: Run the wrapper tests and confirm they fail.**

  ```bash
  pnpm vitest run tests/slash-chain.test.ts tests/subagent-chain.test.ts
  ```

  Expected: the current wrappers omit `model` and `thinking`; the new identity assertions fail before implementation.

- [ ] **Step 4: Resolve and pass the model object in both wrappers.**

  Import `resolveModelSelection` and `validateModelThinking`. At each wrapper, use the phase-3 raw contract:

  ```ts
  const rawModel = options?.model ?? agentDef.model;
  if (rawModel !== undefined && !ctx.modelRegistry) {
    throw new Error(
      `Cannot resolve model "${rawModel}": model registry unavailable`,
    );
  }
  const selection = rawModel
    ? resolveModelSelection(rawModel, ctx.modelRegistry)
    : undefined;
  const selectedModel = selection?.model ?? ctx.model;
  const canonical =
    selection?.canonical ??
    (selectedModel
      ? `${selectedModel.provider}/${selectedModel.id}`
      : undefined);
  const thinking =
    options?.thinking === undefined
      ? undefined
      : selectedModel && canonical
        ? validateModelThinking(selectedModel, canonical, options.thinking)
        : (() => {
            throw new Error("Cannot validate thinking without an active model");
          })();
  ```

  Pass `selection?.model` as `SpawnOptions.model` only when a raw model was configured; otherwise leave the field absent so `runAgent()` owns parent fallback. Pass the validated thinking value when defined. Preserve the current temporary `effectiveAgentDef` mutation for raw model metadata and custom-tool creation. In `src/core/subagent.ts`, run the existing raw `checkModelScope()` check before registry resolution and keep its `modelSource` classification unchanged.

- [ ] **Step 5: Run the wrapper tests and verify the forwarding contract.**

  ```bash
  pnpm vitest run tests/slash-chain.test.ts tests/subagent-chain.test.ts
  ```

  Expected: both wrappers pass the same registry sentinel object and `"high"`; unknown configured models fail before spawning; custom-tool definitions still contain raw model strings.

### Task 2: Resolve and Forward Single-Agent Invocation Settings

**Files:**

- Modify: `src/core/subagent.ts` — replace the dead `listModels()` validation with strict registry selection and add model/thinking to single-agent spawn options.
- Test: `tests/subagent.test.ts` — verify manager forwarding, parent fallback preservation, and explicit-model failure.

**Interfaces:**

- Consumes `ResolvedInvocationConfig.model?: string` and `.thinking?: string`, the Pi `ExtensionContext.modelRegistry`, and the existing model-scope source calculation.
- Produces `SpawnOptions.model?: unknown` containing the selected runtime model and `SpawnOptions.thinking?: string` containing the validated normalized level.

- [ ] **Step 1: Add failing single-agent forwarding tests.**

  Add an inline registry fixture with a reasoning-capable sentinel model and a different parent model. Execute the single-agent tool with an agent definition model and uppercase thinking, then assert the manager receives the registry sentinel by identity and `thinking: "high"`:

  ```ts
  expect(spawnAndWait.mock.calls[0]?.[2]).toMatchObject({
    model: sentinelModel,
    thinking: "high",
  });
  expect(spawnAndWait.mock.calls[0]?.[2]?.model).toBe(sentinelModel);
  ```

  Add a no-model/no-thinking case with a parent model and assert the tool does not invent `SpawnOptions.model`; the runner must receive the context for parent fallback. Add an unknown-model case with a parent sentinel and assert the result is an error and no spawn occurs, proving an explicit model cannot silently fall back to the parent.

- [ ] **Step 2: Run the single-agent tests and confirm they fail.**

  ```bash
  pnpm vitest run tests/subagent.test.ts
  ```

  Expected: the current path either skips registry validation because it looks for `listModels()` or omits model/thinking from the spawn options.

- [ ] **Step 3: Replace legacy single-agent model handling.**

  Replace the `resolveModel()`/`listModels()` block with the existing registry contract:

  ```ts
  if (resolved.model !== undefined && !ctx.modelRegistry) {
    throw new Error(
      `Cannot resolve model "${resolved.model}": model registry unavailable`,
    );
  }
  const selection = resolved.model
    ? resolveModelSelection(resolved.model, ctx.modelRegistry)
    : undefined;
  const selectedModel = selection?.model ?? ctx.model;
  const canonical =
    selection?.canonical ??
    (selectedModel
      ? `${selectedModel.provider}/${selectedModel.id}`
      : undefined);
  const thinking =
    resolved.thinking === undefined
      ? undefined
      : selectedModel && canonical
        ? validateModelThinking(selectedModel, canonical, resolved.thinking)
        : (() => {
            throw new Error("Cannot validate thinking without an active model");
          })();
  ```

  Require `ctx.modelRegistry` whenever `resolved.model` is defined; let the existing tool error handling report resolver failures. Feed `selection?.canonical` into the existing scope check while preserving the current source calculation (`agentDef.model` is inherited, otherwise `params.model` is explicit). Add `selection?.model` and the normalized thinking value to the `spawnOptions` object, omitting both fields when they are undefined. Do not change `resolveInvocationConfig()` or tool-budget precedence.

- [ ] **Step 4: Run focused single-agent verification.**

  ```bash
  pnpm vitest run tests/subagent.test.ts tests/invocation-config.test.ts
  ```

  Expected: sentinel identity, normalized thinking, omitted-model behavior, explicit-model errors, and existing invocation precedence all pass.

### Task 3: Resolve Configured Models in the Session Runner

**Files:**

- Modify: `src/core/agent-runner.ts` — resolve configured definition strings and normalize thinking immediately before session creation.
- Test: `tests/agent-runner.test.ts` — assert session model identity and fallback/error precedence.
- Test: `tests/agent-manager.test.ts` — assert manager preserves model object identity while forwarding to `runAgent()`.

**Interfaces:**

- Consumes `RunOptions.model?: unknown`, `RunOptions.thinking?: string`, `AgentDefinition.model?: string`, `AgentDefinition.thinking?: string`, and the runtime context's actual `model` and `modelRegistry`.
- Produces `createAgentSession({ model?: Model<Api>, thinkingLevel?: ChainThinkingLevel })` input with no raw model string.

- [ ] **Step 1: Add failing runner identity and precedence tests.**

  Extend the existing mocked `createAgentSession` tests with a registry sentinel and a different parent sentinel. Cover these cases:

  ```ts
  await runAgent(
    agentDef,
    { ...options, model: explicitModel, thinking: "HIGH" },
    {
      model: parentModel,
      modelRegistry,
    },
  );
  expect(createAgentSession).toHaveBeenCalledWith(
    expect.objectContaining({ model: explicitModel, thinkingLevel: "high" }),
  );

  await runAgent(
    { ...agentDef, model: "test/model", thinking: "high" },
    options,
    { model: parentModel, modelRegistry },
  );
  expect(createAgentSession).toHaveBeenCalledWith(
    expect.objectContaining({ model: sentinelModel, thinkingLevel: "high" }),
  );
  ```

  Also assert that an agent with no configured model uses `parentModel` by identity, while a configured model with no registry rejects and never calls `createAgentSession`. Keep the existing session/tool assertions unchanged.

- [ ] **Step 2: Add the manager model pass-through assertion.**

  Extend the existing thinking pass-through test in `tests/agent-manager.test.ts` with a sentinel `SpawnOptions.model`. Spy on `runAgent()` and assert the exact same object is present in the forwarded `RunOptions`:

  ```ts
  expect(spy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ model: sentinelModel, thinking: "high" }),
    expect.anything(),
  );
  ```

- [ ] **Step 3: Run runner and manager tests and confirm they fail.**

  ```bash
  pnpm vitest run tests/agent-runner.test.ts tests/agent-manager.test.ts
  ```

  Expected: `runAgent()` currently chooses `options.model ?? ctx.model`, ignores `agentDef.model`, and passes raw thinking strings without the required model-aware validation.

- [ ] **Step 4: Implement the runner fallback and strict session input.**

  Import `Api`/`Model` from `@earendil-works/pi-ai`, plus `resolveModelSelection`, `validateModelThinking`, and the existing `ModelRegistryLike` type. Narrow the incoming context once before selection:

  ```ts
  const runtimeCtx = ctx as {
    model?: Model<Api>;
    modelRegistry?: ModelRegistryLike;
    sessionManager?: { getBranch?: () => unknown[] };
  };
  ```

  Resolve the effective model in this order, requiring a registry before either configured string is resolved:

  ```ts
  let selectedModel = options.model;
  let canonical: string | undefined;

  if (typeof selectedModel === "string") {
    if (!runtimeCtx.modelRegistry) {
      throw new Error(
        `Cannot resolve model "${selectedModel}": model registry unavailable`,
      );
    }
    const selection = resolveModelSelection(
      selectedModel,
      runtimeCtx.modelRegistry,
    );
    selectedModel = selection.model;
    canonical = selection.canonical;
  } else if (selectedModel === undefined && agentDef.model !== undefined) {
    if (!runtimeCtx.modelRegistry) {
      throw new Error(
        `Cannot resolve model "${agentDef.model}": model registry unavailable`,
      );
    }
    const selection = resolveModelSelection(
      agentDef.model,
      runtimeCtx.modelRegistry,
    );
    selectedModel = selection.model;
    canonical = selection.canonical;
  } else if (selectedModel === undefined) {
    selectedModel = runtimeCtx.model;
  }
  ```

  Require a registry for either configured string branch; do not use the parent model in those error cases. For an object selected from options or inherited from the parent, derive `canonical` as `${provider}/${id}`. Normalize and validate `options.thinking ?? agentDef.thinking` against the selected model, or throw when thinking is requested without a selected model. Pass only the resolved object and normalized `thinkingLevel` to `createAgentSession`; preserve the existing omitted-field behavior for undefined values.

- [ ] **Step 5: Run runner and manager verification.**

  ```bash
  pnpm vitest run tests/agent-runner.test.ts tests/agent-manager.test.ts
  ```

  Expected: explicit runtime objects beat parent models, configured definition strings resolve through the registry, unconfigured agents inherit the parent object, and raw strings never reach `createAgentSession`.

### Task 4: Run the Phase-4 Regression Matrix

**Files:**

- No new source files. Do not modify `chain-execution.ts`, `chain-settings.ts`, `model-resolver.ts`, `invocation-config.ts`, `rpc.ts`, or `index.ts` as part of this phase.

**Interfaces:**

- Verifies the phase-2 resolver, phase-3 raw chain propagation, both chain wrappers, the single-agent tool, the manager pass-through, and the session runner as one runtime contract.

- [ ] **Step 1: Run the focused forwarding suite.**

  ```bash
  pnpm vitest run \
    tests/model-resolver.test.ts \
    tests/chain-execution.test.ts \
    tests/slash-chain.test.ts \
    tests/subagent-chain.test.ts \
    tests/subagent.test.ts \
    tests/invocation-config.test.ts \
    tests/agent-manager.test.ts \
    tests/agent-runner.test.ts
  ```

  Expected: all focused forwarding and existing precedence tests pass.

- [ ] **Step 2: Check for obsolete single-agent lookup code.**

  ```bash
  rg -n "listModels|resolveModel\(" src/core/subagent.ts
  ```

  Expected: no matches. `src/core/rpc.ts` may continue using legacy `resolveModel()` by phase-2 design.

- [ ] **Step 3: Run the repository checks.**

  ```bash
  GIT_CONFIG_GLOBAL=/private/tmp/pi-subagents-empty-gitconfig pnpm check
  pnpm typecheck
  git diff --check
  ```

  Expected: the full test suite passes. Biome may continue reporting the repository's existing warnings, and the Node engine warning may remain under Node 23; neither is part of this phase.

- [ ] **Step 4: Review the diff for scope.**

  ```bash
  git status --short
  git diff -- src/core/slash-chain.ts src/core/subagent.ts src/core/agent-runner.ts \
    tests/slash-chain.test.ts tests/subagent-chain.test.ts tests/subagent.test.ts \
    tests/agent-runner.test.ts tests/agent-manager.test.ts
  ```

  Confirm that the diff contains only runtime forwarding, strict model/thinking selection, and its tests; no phase-3 propagation or phase-5 preflight changes.

- [ ] **Step 5: Commit the phase.**

  ```bash
  git add src/core/slash-chain.ts src/core/subagent.ts src/core/agent-runner.ts \
    tests/slash-chain.test.ts tests/subagent-chain.test.ts tests/subagent.test.ts \
    tests/agent-runner.test.ts tests/agent-manager.test.ts
  git commit -m "fix: forward resolved models to agent sessions"
  ```

## Phase Result

Single-agent, `/chain`, saved-chain, and inline `subagent` dispatches pass actual Pi model objects and strictly validated thinking levels into sessions. Configured model failures remain errors instead of silently inheriting the parent model, while invocations without overrides preserve parent/default behavior. Chain-wide preflight and canonical model-scope enforcement remain deferred to phase 5.
