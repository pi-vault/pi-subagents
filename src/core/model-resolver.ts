export interface ModelInfo {
  id: string;
  provider: string;
  name?: string;
}

export interface ResolvedModel {
  id: string;
  provider: string;
}

export function resolveModel(
  query: string,
  models: ModelInfo[],
): ResolvedModel | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  // Try exact provider/id match
  if (q.includes("/")) {
    const slashIndex = q.indexOf("/");
    const provider = q.slice(0, slashIndex);
    const id = q.slice(slashIndex + 1);
    const match = models.find(
      (m) => m.provider.toLowerCase() === provider && m.id.toLowerCase() === id,
    );
    if (match) return { id: match.id, provider: match.provider };
  }

  // Try exact id match
  const exactId = models.find((m) => m.id.toLowerCase() === q);
  if (exactId) return { id: exactId.id, provider: exactId.provider };

  // Fuzzy: id or name contains query
  const containsMatch = models.find(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      (m.name?.toLowerCase().includes(q)),
  );
  if (containsMatch)
    return { id: containsMatch.id, provider: containsMatch.provider };

  // Fuzzy: all query parts present in id or name
  const parts = q.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length > 1) {
    const partsMatch = models.find((m) => {
      const haystack = `${m.id} ${m.name ?? ""}`.toLowerCase();
      return parts.every((p) => haystack.includes(p));
    });
    if (partsMatch)
      return { id: partsMatch.id, provider: partsMatch.provider };
  }

  return undefined;
}
