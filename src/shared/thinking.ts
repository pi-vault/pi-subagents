export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type ChainThinkingLevel = (typeof THINKING_LEVELS)[number];

export class ChainThinkingLevelError extends Error {
	readonly name = "ChainThinkingLevelError";

	constructor(source: string, message: string) {
		super(`${source}: ${message}`);
	}
}

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

export function normalizeThinkingLevel(
	value: unknown,
	source?: string,
): ChainThinkingLevel {
	const label = source ?? "thinking";
	if (typeof value !== "string") {
		throw new ChainThinkingLevelError(
			label,
			`thinking must be a string (one of: ${THINKING_LEVELS.join(", ")})`,
		);
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw new ChainThinkingLevelError(
			label,
			`thinking must be a non-empty string (one of: ${THINKING_LEVELS.join(", ")})`,
		);
	}
	const lower = trimmed.toLowerCase();
	if (!THINKING_LEVEL_SET.has(lower)) {
		throw new ChainThinkingLevelError(
			label,
			`thinking value '${value}' is not supported; accepted levels: ${THINKING_LEVELS.join(", ")}`,
		);
	}
	return lower as ChainThinkingLevel;
}
