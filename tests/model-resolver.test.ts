import { describe, expect, it } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  resolveModel,
  resolveModelSelection,
  validateModelThinking,
} from "../src/core/model-resolver.js";
import type { ModelInfo } from "../src/core/model-resolver.js";

const mockModels: ModelInfo[] = [
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    name: "Claude Sonnet 4",
  },
  {
    id: "claude-haiku-4-5-20250514",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
  },
  { id: "gpt-4o", provider: "openai", name: "GPT-4o" },
];

const sentinelModel = {
  id: "gpt-5.6-luna",
  provider: "openai-codex",
} as Model<Api>;

const reasoningModelWithMax = {
  reasoning: true,
  thinkingLevelMap: { max: "max" },
} as Model<Api>;

const reasoningModelWithoutMax = { reasoning: true } as Model<Api>;
const nonReasoningModel = { reasoning: false } as Model<Api>;

function createRegistry(models: ModelInfo[], available = models) {
  return {
    getAll: () => models,
    getAvailable: () => available,
    find: (provider: string, id: string) =>
      models.some((model) => model.provider === provider && model.id === id)
        ? sentinelModel
        : undefined,
  };
}

const registry = createRegistry(
  [
    {
      id: "gpt-5.6-luna",
      provider: "openai-codex",
      name: "GPT 5.6 Luna",
    },
    { id: "gpt-5.6-luna", provider: "openai", name: "GPT 5.6 Luna" },
    { id: "unavailable", provider: "test", name: "Unavailable" },
  ],
  [{ id: "gpt-5.6-luna", provider: "openai-codex" }],
);

const uniqueIdRegistry = createRegistry([
  { id: "gpt-5.6-luna", provider: "openai-codex" },
]);

const namedRegistry = createRegistry([
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    name: "Claude Sonnet",
  },
]);

describe("resolveModel", () => {
  it("exact provider/id match", () => {
    const result = resolveModel(
      "anthropic/claude-sonnet-4-20250514",
      mockModels,
    );
    expect(result).toEqual({
      id: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });
  });

  it("exact id match without provider prefix", () => {
    const result = resolveModel("gpt-4o", mockModels);
    expect(result).toEqual({ id: "gpt-4o", provider: "openai" });
  });

  it("fuzzy match on 'sonnet'", () => {
    const result = resolveModel("sonnet", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-sonnet-4-20250514");
    expect(result?.provider).toBe("anthropic");
  });

  it("fuzzy match on 'haiku'", () => {
    const result = resolveModel("haiku", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-haiku-4-5-20250514");
    expect(result?.provider).toBe("anthropic");
  });

  it("returns undefined for no match", () => {
    const result = resolveModel("nonexistent-model", mockModels);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty query", () => {
    const result = resolveModel("", mockModels);
    expect(result).toBeUndefined();
  });

  it("returns undefined for whitespace-only query", () => {
    const result = resolveModel("   ", mockModels);
    expect(result).toBeUndefined();
  });

  it("case-insensitive matching", () => {
    const result = resolveModel("ANTHROPIC/GPT-4O", mockModels);
    // provider doesn't match (anthropic != openai), so should be undefined
    expect(result).toBeUndefined();

    const result2 = resolveModel("OPENAI/GPT-4O", mockModels);
    expect(result2).toEqual({ id: "gpt-4o", provider: "openai" });
  });

  it("multi-part fuzzy match on 'claude sonnet'", () => {
    const result = resolveModel("claude sonnet", mockModels);
    expect(result).toBeTruthy();
    expect(result?.id).toBe("claude-sonnet-4-20250514");
  });
});

describe("validateModelThinking", () => {
  it("preserves an omitted request", () => {
    expect(
      validateModelThinking(reasoningModelWithMax, "test/reasoning-max", undefined),
    ).toBeUndefined();
  });

  it("normalizes supported requested levels", () => {
    expect(
      validateModelThinking(reasoningModelWithMax, "test/reasoning-max", " HIGH "),
    ).toBe("high");
    expect(
      validateModelThinking(nonReasoningModel, "test/non-reasoning", "off"),
    ).toBe("off");
  });

  it("accepts max only when Pi reports it as supported", () => {
    expect(
      validateModelThinking(reasoningModelWithMax, "test/reasoning-max", "max"),
    ).toBe("max");
    expect(() =>
      validateModelThinking(reasoningModelWithoutMax, "test/reasoning", "max"),
    ).toThrow(/max.*test\/reasoning.*off, minimal, low, medium, high/i);
  });

  it("rejects unsupported levels without fallback", () => {
    expect(() =>
      validateModelThinking(reasoningModelWithoutMax, "test/reasoning", "xhigh"),
    ).toThrow(/xhigh.*test\/reasoning.*off, minimal, low, medium, high/i);
  });

  it("keeps normalizeThinkingLevel's lexical validation", () => {
    expect(() =>
      validateModelThinking(reasoningModelWithMax, "test/reasoning-max", "extra"),
    ).toThrow(/accepted levels: off, minimal, low, medium, high, xhigh, max/i);
  });
});

describe("resolveModelSelection", () => {
  it("returns the registry runtime model for an exact qualified match", () => {
    expect(
      resolveModelSelection("openai-codex/gpt-5.6-luna", registry),
    ).toEqual({
      requested: "openai-codex/gpt-5.6-luna",
      canonical: "openai-codex/gpt-5.6-luna",
      model: sentinelModel,
    });
  });

  it("selects a unique exact ID", () => {
    expect(resolveModelSelection("gpt-5.6-luna", uniqueIdRegistry).model).toBe(
      sentinelModel,
    );
  });

  it("matches normalized display names", () => {
    expect(resolveModelSelection("Claude Sonnet", namedRegistry).canonical).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });

  it("rejects ambiguous matches before checking availability", () => {
    expect(() => resolveModelSelection("luna", registry)).toThrow(/ambiguous/i);
  });

  it("rejects configured but unavailable models", () => {
    expect(() => resolveModelSelection("unavailable", registry)).toThrow(
      /unavailable/i,
    );
  });

  it("rejects an available metadata entry without a runtime model", () => {
    const registryWithoutRuntimeModel = {
      ...uniqueIdRegistry,
      find: () => undefined,
    };

    expect(() =>
      resolveModelSelection("gpt-5.6-luna", registryWithoutRuntimeModel),
    ).toThrow(/configured model not found/i);
  });

  it("rejects a known provider with an empty model ID", () => {
    expect(() => resolveModelSelection("openai/", registry)).toThrow(
      /non-empty/i,
    );
  });

  it("rejects unknown and blank requests", () => {
    expect(() => resolveModelSelection("missing", registry)).toThrow(/unknown/i);
    expect(() => resolveModelSelection("   ", registry)).toThrow(/non-empty/i);
  });
});
