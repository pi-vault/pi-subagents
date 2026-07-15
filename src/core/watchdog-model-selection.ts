// ─── Watchdog Model Recommendation ───────────────────────────────────────────

export type ProviderFamily = "openai" | "anthropic" | "unknown";

export interface ModelRecommendation {
  family: "opus" | "gpt";
  model: string;
  thinking: string;
  reason: string;
}

const STRONG_MODELS = {
  opus: { model: "anthropic/claude-opus-4-8", label: "Opus 4.8" },
  gpt: { model: "openai-codex/gpt-5.5", label: "GPT 5.5" },
} as const;

/**
 * Detect the provider family from a provider name + model ID.
 * Normalizes input to lowercase before matching.
 */
export function detectProviderFamily(
  provider: string | undefined,
  modelId?: string | undefined,
): ProviderFamily {
  const p = (provider ?? "").toLowerCase();
  const m = (modelId ?? "").toLowerCase();
  if (p.includes("openai") || m.includes("gpt")) return "openai";
  if (p.includes("anthropic") || m.includes("claude") || m.includes("opus")) return "anthropic";
  return "unknown";
}

/**
 * Recommend a complementary watchdog model for the given session provider family.
 * Cross-provider review provides independent perspective on issues.
 */
export function recommendWatchdogModel(
  currentFamily: ProviderFamily,
): ModelRecommendation {
  if (currentFamily === "openai") {
    return {
      family: "opus",
      model: STRONG_MODELS.opus.model,
      thinking: "high",
      reason: `Use ${STRONG_MODELS.opus.label} with thinking:high as a cross-provider watchdog. Different model families catch different classes of issues.`,
    };
  }
  if (currentFamily === "anthropic") {
    return {
      family: "gpt",
      model: STRONG_MODELS.gpt.model,
      thinking: "high",
      reason: `Use ${STRONG_MODELS.gpt.label} with thinking:high as a cross-provider watchdog. Different model families catch different classes of issues.`,
    };
  }
  return {
    family: "opus",
    model: STRONG_MODELS.opus.model,
    thinking: "high",
    reason: `Default recommendation: ${STRONG_MODELS.opus.label} with thinking:high for independent code review.`,
  };
}
