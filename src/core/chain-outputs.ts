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
  readonly name = "ChainOutputValidationError";
}

export interface ChainOutputValidationContext {
  priorOutputNames?: Iterable<string>;
  startStepIndex?: number;
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

export function getChainOutputNames(steps: ChainStep[]): string[] {
  return steps.flatMap(getOutputNames);
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

export function validateChainOutputBindingsWithContext(
  steps: ChainStep[],
  context: ChainOutputValidationContext = {},
): void {
  const defined = new Set<string>();
  const claimed = new Set<string>();

  for (const name of context.priorOutputNames ?? []) {
    if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
      throw new ChainOutputValidationError(
        `Invalid prior chain output name '${name}': must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
      );
    }
    if (claimed.has(name)) {
      throw new ChainOutputValidationError(`Duplicate chain output name '${name}'.`);
    }
    defined.add(name);
    claimed.add(name);
  }

  for (const [index, step] of steps.entries()) {
    const stepNumber = (context.startStepIndex ?? 0) + index + 1;
    for (const template of getTemplateStrings(step)) {
      for (const match of template.matchAll(OUTPUT_REF_PATTERN)) {
        const name = match[1] ?? "";
        if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
          throw new ChainOutputValidationError(
            `Invalid chain output reference '{outputs.${name}}': name must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
          );
        }
        if (!defined.has(name)) {
          throw new ChainOutputValidationError(
            `Unknown chain output reference '{outputs.${name}}' at step ${stepNumber}. Available: ${[...defined].join(", ") || "(none)"}`,
          );
        }
      }
    }

    if (isDynamicParallelStep(step)) {
      const source = step.expand.from.output;
      if (!SAFE_OUTPUT_NAME_PATTERN.test(source)) {
        throw new ChainOutputValidationError(
          `Invalid chain output name '${source}' in expand.from.output: must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
        );
      }
      if (!defined.has(source)) {
        throw new ChainOutputValidationError(
          `Unknown chain output '${source}' in expand.from.output at step ${stepNumber}. Available: ${[...defined].join(", ") || "(none)"}`,
        );
      }
    }

    for (const name of getOutputNames(step)) {
      if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
        throw new ChainOutputValidationError(
          `Invalid chain output name '${name}': must match ${SAFE_OUTPUT_NAME_PATTERN.source}`,
        );
      }
      if (claimed.has(name)) {
        throw new ChainOutputValidationError(`Duplicate chain output name '${name}'.`);
      }
      defined.add(name);
      claimed.add(name);
    }
  }
}

export function validateChainOutputBindings(steps: ChainStep[]): void {
  validateChainOutputBindingsWithContext(steps);
}

export function resolveOutputReferences(template: string, outputs: ChainOutputMap): string {
  return template.replace(OUTPUT_REF_PATTERN, (raw, name: string) => {
    if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
      throw new ChainOutputValidationError(`Invalid chain output reference '${raw}'.`);
    }
    const entry = outputs[name];
    if (!entry) {
      throw new ChainOutputValidationError(`Unknown chain output reference '${raw}'.`);
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
  return {
    text,
    ...(structured !== undefined ? { structured } : {}),
    agent,
    stepIndex,
  };
}
