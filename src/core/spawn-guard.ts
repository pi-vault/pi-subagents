export const DEFAULT_MAX_SPAWNS_PER_SESSION = 40;

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const n =
    typeof value === "string"
      ? value.trim()
        ? Number(value)
        : NaN
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Resolve effective spawn limit.
 * Priority: env var PI_SUBAGENT_MAX_SPAWNS_PER_SESSION > config > default.
 */
export function resolveMaxSpawns(configValue?: number): number {
  return (
    normalizeNonNegativeInteger(
      process.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION,
    ) ??
    normalizeNonNegativeInteger(configValue) ??
    DEFAULT_MAX_SPAWNS_PER_SESSION
  );
}

/**
 * Check whether `requested` spawns are within budget.
 * Returns an error message string if blocked, undefined if allowed.
 */
export function checkSpawnLimit(
  currentCount: number,
  requested: number,
  max: number,
): string | undefined {
  if (requested <= 0) return undefined;
  if (currentCount + requested > max) {
    return (
      `Subagent spawn limit reached for this session (${currentCount}/${max} used, ` +
      `${requested} requested). Complete the work directly or start a new session.`
    );
  }
  return undefined;
}
