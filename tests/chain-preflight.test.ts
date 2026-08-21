import { describe, expect, it } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai";
import { preflightChainModels } from "../src/core/chain-preflight.js";
import type { ModelRegistryLike } from "../src/core/model-resolver.js";
import type { AgentDefinition, ChainStep } from "../src/shared/types.js";

const runtimeModels = {
  alpha: { provider: "vendor", id: "alpha", reasoning: true } as Model<Api>,
  beta: { provider: "vendor", id: "beta", reasoning: false } as Model<Api>,
  blocked: { provider: "vendor", id: "blocked-real", reasoning: true } as Model<Api>,
};

const modelInfo = [
  { provider: "vendor", id: "alpha", name: "Alpha" },
  { provider: "vendor", id: "beta", name: "Beta" },
  { provider: "vendor", id: "blocked-real", name: "Blocked Model" },
  { provider: "vendor", id: "unavailable", name: "Unavailable" },
];

function registry(available = modelInfo.filter((model) => model.id !== "unavailable")) {
  const finds: string[] = [];
  const value: ModelRegistryLike = {
    getAll: () => modelInfo,
    getAvailable: () => available,
    find: (provider, id) => {
      finds.push(`${provider}/${id}`);
      return runtimeModels[(id === "blocked-real" ? "blocked" : id) as keyof typeof runtimeModels];
    },
  };
  return { value, finds };
}

function agent(name: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name,
    description: name,
    tools: [],
    subagentAgents: [],
    systemPrompt: "test",
    sourcePath: "/test.md",
    ...overrides,
  };
}

function findAgent(agents: AgentDefinition[]) {
  return (name: string) => {
    const definition = agents.find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`Unknown agent: ${name}`);
    return definition;
  };
}

describe("preflightChainModels", () => {
  it("traverses sequential, static parallel, and dynamic templates using task, agent, then parent precedence", () => {
    const { value, finds } = registry();
    const steps: ChainStep[] = [
      { agent: "override", model: "alpha", thinking: "high" },
      { parallel: [{ agent: "defined" }] },
      {
        expand: { from: { output: "items", path: "$.items" } },
        parallel: { agent: "parent", thinking: "off" },
        collect: { as: "results" },
      },
    ];

    preflightChainModels(
      steps,
      findAgent([
        agent("override", { model: "beta", thinking: "off" }),
        agent("defined", { model: "alpha", thinking: "high" }),
        agent("parent"),
      ]),
      { registry: value, parentModel: runtimeModels.beta },
    );

    expect(finds).toEqual(["vendor/alpha", "vendor/alpha"]);
  });

  it("preserves pure parent and default paths without registry access or mutation", () => {
    const steps: ChainStep[] = [{ agent: "parent" }, { parallel: [{ agent: "default" }] }];
    const agents = [agent("parent"), agent("default")];
    const originalSteps = structuredClone(steps);
    const originalAgents = structuredClone(agents);
    let registryAccessed = false;

    preflightChainModels(steps, findAgent(agents), {
      parentModel: runtimeModels.alpha,
      registry: {
        getAll: () => {
          registryAccessed = true;
          return [];
        },
        getAvailable: () => {
          registryAccessed = true;
          return [];
        },
        find: () => {
          registryAccessed = true;
          return undefined;
        },
      },
    });
    preflightChainModels([{ agent: "default" }], findAgent(agents), {});

    expect(registryAccessed).toBe(false);
    expect(steps).toEqual(originalSteps);
    expect(agents).toEqual(originalAgents);
  });

  it("validates requested thinking against a parent model", () => {
    preflightChainModels([{ agent: "worker", thinking: "off" }], findAgent([agent("worker")]), {
      parentModel: runtimeModels.beta,
    });
  });

  it.each([
    [
      "unknown",
      [{ agent: "worker", model: "missing" }],
      [agent("worker")],
      { registry: registry().value },
      /step 1 \(worker\).*unknown model/i,
    ],
    [
      "ambiguous",
      [{ parallel: [{ agent: "worker", model: "a" }] }],
      [agent("worker")],
      {
        registry: {
          getAll: () => [
            { provider: "one", id: "a" },
            { provider: "two", id: "a" },
          ],
          getAvailable: () => [
            { provider: "one", id: "a" },
            { provider: "two", id: "a" },
          ],
          find: () => runtimeModels.alpha,
        },
      },
      /step 1 parallel item 1 \(worker\).*ambiguous/i,
    ],
    [
      "unavailable",
      [{ agent: "worker", model: "unavailable" }],
      [agent("worker")],
      { registry: registry().value },
      /step 1 \(worker\).*unavailable/i,
    ],
    [
      "missing registry",
      [{ agent: "worker", model: "alpha" }],
      [agent("worker")],
      {},
      /step 1 \(worker\).*registry unavailable/i,
    ],
    [
      "unsupported thinking",
      [{ agent: "worker", thinking: "high" }],
      [agent("worker")],
      {
        parentModel: runtimeModels.beta,
      },
      /step 1 \(worker\).*not supported/i,
    ],
    [
      "explicit scope",
      [{ agent: "worker", model: "blocked" }],
      [agent("worker")],
      {
        registry: registry().value,
        modelScope: { enforce: true, allow: ["vendor/alpha"] },
      },
      /step 1 \(worker\).*vendor\/blocked-real.*not in the allowed scope/i,
    ],
    [
      "dynamic unknown agent",
      [
        {
          expand: { from: { output: "items", path: "$.items" } },
          parallel: { agent: "missing" },
          collect: { as: "results" },
        },
      ],
      [],
      {},
      /step 1 dynamic template \(missing\).*unknown agent/i,
    ],
  ])("throws before spawning for %s", (_name, steps, agents, options, error) => {
    let spawned = false;

    expect(() =>
      preflightChainModels(
        steps as ChainStep[],
        findAgent(agents as AgentDefinition[]),
        options as Parameters<typeof preflightChainModels>[2],
      ),
    ).toThrow(error as RegExp);
    expect(spawned).toBe(false);
  });

  it("warns for inherited out-of-scope canonical models without throwing", () => {
    const warnings: string[] = [];

    preflightChainModels(
      [{ agent: "worker" }],
      findAgent([agent("worker", { model: "blocked" })]),
      {
        registry: registry().value,
        modelScope: { enforce: true, allow: ["vendor/alpha"] },
        onScopeWarning: (warning) => warnings.push(warning.message),
      },
    );

    expect(warnings).toEqual([
      expect.stringMatching(/step 1 \(worker\).*vendor\/blocked-real.*not in the allowed scope/i),
    ]);
    expect(warnings[0]).not.toContain('"blocked"');
  });
});
