import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type {
  ChainStep,
  ParallelStep,
  DynamicParallelStep,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isParallelStep(step: ChainStep): step is ParallelStep {
  return "parallel" in step && Array.isArray((step as ParallelStep).parallel);
}

export function isDynamicParallelStep(
  step: ChainStep,
): step is DynamicParallelStep {
  return (
    "expand" in step &&
    "collect" in step &&
    "parallel" in step &&
    !Array.isArray((step as { parallel?: unknown }).parallel)
  );
}

export function getStepAgents(step: ChainStep): string[] {
  if (isParallelStep(step)) return step.parallel.map((t) => t.agent);
  if (isDynamicParallelStep(step)) return [step.parallel.agent];
  return [step.agent];
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export type ResolvedTemplates = (string | string[])[];

export function resolveChainTemplates(steps: ChainStep[]): ResolvedTemplates {
  return steps.map((step, i) => {
    if (isParallelStep(step)) {
      return step.parallel.map((task) => task.task ?? "{previous}");
    }
    if (isDynamicParallelStep(step)) {
      return step.parallel.task ?? "{previous}";
    }
    if (step.task) return step.task;
    return i === 0 ? "{task}" : "{previous}";
  });
}

// ---------------------------------------------------------------------------
// Step behavior resolution
// ---------------------------------------------------------------------------

export type OutputMode = "inline" | "file-only";

export interface StepOverrides {
  output?: string | false;
  outputMode?: OutputMode;
  reads?: string[] | false;
  progress?: boolean;
  skills?: string[] | false;
  model?: string;
}

export interface ResolvedStepBehavior {
  output: string | false;
  outputMode: OutputMode;
  reads: string[] | false;
  progress: boolean;
  skills: string[] | false;
  model?: string;
}

export interface AgentBehaviorDefaults {
  output?: string | false;
  reads?: string[] | false;
  progress?: boolean;
  skills?: string[] | false;
  model?: string;
}

export function resolveStepBehavior(
  agentDefaults: AgentBehaviorDefaults,
  overrides: StepOverrides,
): ResolvedStepBehavior {
  return {
    output:
      overrides.output !== undefined
        ? overrides.output
        : (agentDefaults.output ?? false),
    outputMode: overrides.outputMode ?? "inline",
    reads:
      overrides.reads !== undefined
        ? overrides.reads
        : (agentDefaults.reads ?? false),
    progress:
      overrides.progress !== undefined
        ? overrides.progress
        : (agentDefaults.progress ?? false),
    skills:
      overrides.skills !== undefined
        ? overrides.skills
        : (agentDefaults.skills ?? false),
    model: overrides.model ?? agentDefaults.model,
  };
}

// ---------------------------------------------------------------------------
// Chain instructions builder
// ---------------------------------------------------------------------------

function resolveChainPath(filePath: string, chainDir: string): string {
  return isAbsolute(filePath) ? filePath : join(chainDir, filePath);
}

export function buildChainInstructions(
  behavior: ResolvedStepBehavior,
  chainDir: string,
  isFirstProgressAgent: boolean,
): { prefix: string; suffix: string } {
  const prefixParts: string[] = [];
  const suffixParts: string[] = [];

  if (behavior.reads && behavior.reads.length > 0) {
    const paths = behavior.reads.map((f) => resolveChainPath(f, chainDir));
    prefixParts.push(`[Read from: ${paths.join(", ")}]`);
  }
  if (behavior.output) {
    const path = resolveChainPath(behavior.output, chainDir);
    prefixParts.push(`[Write to: ${path}]`);
  }
  if (behavior.progress) {
    const progressPath = join(chainDir, "progress.md");
    if (isFirstProgressAgent) {
      suffixParts.push(`Create and maintain progress at: ${progressPath}`);
    } else {
      suffixParts.push(`Update progress at: ${progressPath}`);
    }
  }

  return {
    prefix: prefixParts.join("\n"),
    suffix: suffixParts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Chain directory helpers
// ---------------------------------------------------------------------------

export function createChainDir(runId: string, baseDir?: string): string {
  const dir = join(baseDir ?? join(tmpdir(), "pi-subagents-chain-runs"), runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeChainDir(chainDir: string): void {
  try {
    rmSync(chainDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
