export const DEFAULT_MAX_SPAWNS_PER_SESSION = 40;

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
    return n;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0)
      return undefined;
    return value;
  }
  return undefined;
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
