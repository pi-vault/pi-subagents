export interface ModelScopeConfig {
  enforce: boolean;
  allow: string[];
}

export type ModelSource = "explicit" | "inherited";

export interface ModelScopeViolation {
  model: string;
  severity: "error" | "warn";
  allowedPatterns: string[];
  message: string;
}

/**
 * Glob pattern matching where only * is special (matches any sequence of chars).
 * Case-insensitive comparison.
 */
export function matchesPattern(model: string, pattern: string): boolean {
  if (!pattern) return false;
  const m = model.toLowerCase();
  const p = pattern.toLowerCase();

  // Convert glob pattern to regex: escape regex chars, replace * with .*
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(m);
}

/**
 * Pure check: does model pass scope? Returns undefined if allowed,
 * or a ModelScopeViolation if blocked.
 */
export function checkModelScope(
  model: string,
  scope: ModelScopeConfig | undefined,
  source: ModelSource,
): ModelScopeViolation | undefined {
  if (!scope?.enforce) return undefined;

  // Normalize: lowercase, strip :thinking suffix
  const normalized = model.toLowerCase().replace(/:thinking$/, "");

  for (const pattern of scope.allow) {
    if (matchesPattern(normalized, pattern)) return undefined;
  }

  const severity = source === "explicit" ? "error" : "warn";
  return {
    model,
    severity,
    allowedPatterns: scope.allow,
    message: `Model "${model}" is not in the allowed scope. Allowed: ${scope.allow.join(", ") || "(none)"}`,
  };
}

/**
 * Parse modelScope from settings JSON. Returns undefined if invalid.
 */
export function parseModelScopeConfig(
  raw: unknown,
): ModelScopeConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  if (r.enforce !== undefined && typeof r.enforce !== "boolean")
    return undefined;
  const enforce = typeof r.enforce === "boolean" ? r.enforce : false;

  if (r.allow !== undefined && !Array.isArray(r.allow)) return undefined;
  const allowRaw = Array.isArray(r.allow) ? r.allow : [];
  const allow = allowRaw.filter(
    (item): item is string => typeof item === "string",
  );

  return { enforce, allow };
}
