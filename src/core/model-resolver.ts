import type { Api, Model } from "@earendil-works/pi-ai";

export interface ModelInfo {
  id: string;
  provider: string;
  name?: string;
}

export interface ResolvedModel {
  id: string;
  provider: string;
}

export interface ModelRegistryLike {
  getAll(): ModelInfo[];
  getAvailable(): ModelInfo[];
  find(provider: string, id: string): Model<Api> | undefined;
}

export interface ResolvedModelSelection {
  requested: string;
  canonical: string;
  model: Model<Api>;
}

interface ModelCandidate extends ModelInfo {
  key: string;
}

function modelKey(model: ModelInfo): string {
  return `${model.provider.toLowerCase()}/${model.id.toLowerCase()}`;
}

function normalizeFuzzy(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, "-");
}

export function resolveModelSelection(
  requested: string,
  registry: ModelRegistryLike,
): ResolvedModelSelection {
  const query = requested.trim().toLowerCase();
  if (!query) throw new Error("Model request must be non-empty");

  const candidates: ModelCandidate[] = [];
  const candidateKeys = new Set<string>();
  for (const model of registry.getAll()) {
    const key = modelKey(model);
    if (!candidateKeys.has(key)) {
      candidateKeys.add(key);
      candidates.push({ ...model, key });
    }
  }

  const slashIndex = query.indexOf("/");
  const provider = slashIndex === -1 ? undefined : query.slice(0, slashIndex);
  const providerIsRegistered = candidates.some(
    (candidate) => candidate.provider.toLowerCase() === provider,
  );
  const scopedCandidates = providerIsRegistered
    ? candidates.filter((candidate) => candidate.provider.toLowerCase() === provider)
    : candidates;
  const modelQuery = providerIsRegistered ? query.slice(slashIndex + 1) : query;

  const choose = (matches: ModelCandidate[]): ModelCandidate | undefined => {
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous model "${requested.trim()}": ${matches
          .map((candidate) => `${candidate.provider}/${candidate.id}`)
          .join(", ")}`,
      );
    }
    return matches[0];
  };

  let selected = providerIsRegistered
    ? choose(
        scopedCandidates.filter(
          (candidate) => candidate.id.toLowerCase() === modelQuery,
        ),
      )
    : undefined;
  selected ??= choose(
    scopedCandidates.filter((candidate) => candidate.id.toLowerCase() === modelQuery),
  );
  selected ??= choose(
    scopedCandidates.filter((candidate) => {
      const fuzzyQuery = normalizeFuzzy(modelQuery);
      return (
        normalizeFuzzy(candidate.id).includes(fuzzyQuery) ||
        normalizeFuzzy(candidate.name ?? "").includes(fuzzyQuery)
      );
    }),
  );

  if (!selected) throw new Error(`Unknown model: ${requested.trim()}`);

  const availableKeys = new Set(registry.getAvailable().map(modelKey));
  const canonical = `${selected.provider}/${selected.id}`;
  if (!availableKeys.has(selected.key)) {
    throw new Error(`Model unavailable: ${canonical}`);
  }

  const model = registry.find(selected.provider, selected.id);
  if (!model) throw new Error(`Configured model not found: ${canonical}`);

  return { requested: requested.trim(), canonical, model };
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
