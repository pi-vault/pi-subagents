/**
 * Glob pattern matching where only * is special (matches any sequence of chars).
 * Case-insensitive comparison.
 */
export function matchesPattern(model: string, pattern: string): boolean {
  if (!pattern) return false;
  const m = model.toLowerCase();
  const p = pattern.toLowerCase();

  // Convert glob pattern to regex: escape regex chars, replace * with .*
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(m);
}
