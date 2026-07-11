import type {
  ChainStep,
  ChainOutputMap,
  ChainOutputMapEntry,
  ParallelStep,
  DynamicParallelStep,
  SequentialStep,
} from "../shared/types.js";

const OUTPUT_REF_PATTERN = /\{outputs\.([^}]*)\}/g;
const SAFE_OUTPUT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ChainOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainOutputValidationError";
  }
}

function isParallelStep(step: ChainStep): step is ParallelStep {
  return "parallel" in step && Array.isArray((step as ParallelStep).parallel);
}

function isDynamicParallelStep(step: ChainStep): step is DynamicParallelStep {
  return (
    "expand" in step &&
    "collect" in step &&
    "parallel" in step &&
    !Array.isArray((step as { parallel?: unknown }).parallel)
  );
}

function getOutputNames(step: ChainStep): string[] {
  if (isParallelStep(step)) {
    return step.parallel.map((t) => t.as).filter((n): n is string => !!n);
  }
  if (isDynamicParallelStep(step)) {
    return step.collect?.as ? [step.collect.as] : [];
  }
  const name = (step as SequentialStep).as;
  return name ? [name] : [];
}

function getTemplateStrings(step: ChainStep): string[] {
  if (isParallelStep(step)) {
    return step.parallel.map((t) => t.task).filter((t): t is string => !!t);
  }
  if (isDynamicParallelStep(step)) {
    return step.parallel.task ? [step.parallel.task] : [];
  }
  const task = (step as SequentialStep).task;
  return task ? [task] : [];
}

export function validateChainOutputBindings(steps: ChainStep[]): void {
  const available = new Set<string>();
  const seen = new Set<string>();

  for (const step of steps) {
    // Validate references in task templates
    for (const template of getTemplateStrings(step)) {
      for (const match of template.matchAll(OUTPUT_REF_PATTERN)) {
        const name = match[1] ?? "";
        if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
          throw new ChainOutputValidationError(
            `Invalid chain output reference '{outputs.${name}}': name must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
          );
        }
        if (!available.has(name)) {
          throw new ChainOutputValidationError(
            `Unknown chain output reference '{outputs.${name}}'. Available: ${[...available].join(", ") || "(none)"}`,
          );
        }
      }
    }

    // Validate and register output names from this step
    for (const name of getOutputNames(step)) {
      if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
        throw new ChainOutputValidationError(
          `Invalid chain output name '${name}': must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
        );
      }
      if (seen.has(name)) {
        throw new ChainOutputValidationError(
          `Duplicate chain output name '${name}'.`,
        );
      }
      seen.add(name);
      available.add(name);
    }
  }
}

export function resolveOutputReferences(
  template: string,
  outputs: ChainOutputMap,
): string {
  return template.replace(OUTPUT_REF_PATTERN, (raw, name: string) => {
    if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
      throw new ChainOutputValidationError(
        `Invalid chain output reference '${raw}'.`,
      );
    }
    const entry = outputs[name];
    if (!entry) {
      throw new ChainOutputValidationError(
        `Unknown chain output reference '${raw}'.`,
      );
    }
    return entry.text;
  });
}

export function outputEntryFromResult(
  agent: string,
  text: string,
  stepIndex: number,
  structured?: unknown,
): ChainOutputMapEntry {
  return { text, structured, agent, stepIndex };
}
