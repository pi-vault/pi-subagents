import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ChainOutputValidationError,
  type ChainOutputValidationContext,
  validateChainOutputBindingsWithContext,
} from "./chain-outputs.js";
import { validateToolBudget } from "./tool-budget.js";
import type { ChainConfig, ChainStep, ChainStepConfig, JsonSchemaObject } from "../shared/types.js";

export class ChainDefinitionError extends Error {
  readonly name = "ChainDefinitionError";

  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
  }
}

type DefinitionMode = "saved" | "executable";
type UnknownRecord = Record<string, unknown>;

const DYNAMIC_STEP_FIELDS = new Set([
  "expand",
  "parallel",
  "collect",
  "concurrency",
  "failFast",
  "phase",
  "label",
  "acceptance",
]);
const DYNAMIC_EXPAND_FIELDS = new Set(["from", "item", "key", "maxItems", "onEmpty"]);
const DYNAMIC_FROM_FIELDS = new Set(["output", "path"]);
const DYNAMIC_TEMPLATE_FIELDS = new Set([
  "agent",
  "task",
  "phase",
  "label",
  "outputSchema",
  "output",
  "outputMode",
  "reads",
  "model",
  "skills",
  "progress",
  "cwd",
  "acceptance",
  "toolBudget",
]);
const DYNAMIC_COLLECT_FIELDS = new Set(["as", "outputSchema"]);

function definitionError(source: string, message: string): never {
  throw new ChainDefinitionError(source, message);
}

function asRecord(value: unknown, source: string, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    definitionError(source, `${label} must be an object`);
  }
  return value as UnknownRecord;
}

function rejectUnknownFields(
  value: UnknownRecord,
  allowed: Set<string>,
  source: string,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      definitionError(source, `${label} does not support field '${key}'`);
    }
  }
}

function validateOptionalString(
  value: UnknownRecord,
  key: string,
  source: string,
  label: string,
  nonBlank = false,
): void {
  if (value[key] === undefined) return;
  if (typeof value[key] !== "string" || (nonBlank && !(value[key] as string).trim())) {
    definitionError(source, `${label}.${key} must be a ${nonBlank ? "non-blank " : ""}string`);
  }
}

function validatePositiveInteger(
  value: UnknownRecord,
  key: string,
  source: string,
  label: string,
): void {
  if (value[key] === undefined) return;
  if (typeof value[key] !== "number" || !Number.isInteger(value[key]) || value[key] < 1) {
    definitionError(source, `${label}.${key} must be an integer >= 1`);
  }
}

function validateBoolean(value: UnknownRecord, key: string, source: string, label: string): void {
  if (value[key] !== undefined && typeof value[key] !== "boolean") {
    definitionError(source, `${label}.${key} must be a boolean`);
  }
}

function validateStringArrayOrFalse(
  value: UnknownRecord,
  key: string,
  source: string,
  label: string,
): void {
  const field = value[key];
  if (field === undefined || field === false) return;
  if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || !item.trim())) {
    definitionError(source, `${label}.${key} must be false or an array of non-blank strings`);
  }
}

function validateAcceptance(value: unknown, source: string, label: string): void {
  if (value === undefined) return;
  const acceptance = asRecord(value, source, label);
  validateOptionalString(acceptance, "description", source, label);
  if (typeof acceptance.description !== "string") {
    definitionError(source, `${label}.description must be a string`);
  }
  validateOptionalString(acceptance, "command", source, label);
}

function validateOutputSchema(
  value: unknown,
  mode: DefinitionMode,
  source: string,
  label: string,
): void {
  if (value === undefined) return;
  if (mode === "saved" && typeof value === "string" && value.trim()) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    definitionError(
      source,
      `${label} must be ${mode === "saved" ? "a non-blank path or " : ""}a JSON object`,
    );
  }
}

function validateTaskFields(
  task: UnknownRecord,
  mode: DefinitionMode,
  source: string,
  label: string,
  allowCount: boolean,
): void {
  validateOptionalString(task, "agent", source, label, true);
  if (task.agent === undefined) {
    definitionError(source, `${label}.agent must be a non-blank string`);
  }
  for (const key of ["task", "phase", "label", "as", "model", "cwd"]) {
    validateOptionalString(task, key, source, label);
  }
  if (task.output !== undefined && task.output !== false && typeof task.output !== "string") {
    definitionError(source, `${label}.output must be a string or false`);
  }
  if (
    task.outputMode !== undefined &&
    task.outputMode !== "inline" &&
    task.outputMode !== "file-only"
  ) {
    definitionError(source, `${label}.outputMode must be 'inline' or 'file-only'`);
  }
  validateStringArrayOrFalse(task, "reads", source, label);
  validateStringArrayOrFalse(task, "skills", source, label);
  validateBoolean(task, "progress", source, label);
  validateAcceptance(task.acceptance, source, `${label}.acceptance`);
  validateOutputSchema(task.outputSchema, mode, source, `${label}.outputSchema`);
  if (task.toolBudget !== undefined) {
    const result = validateToolBudget(task.toolBudget, `${label}.toolBudget`);
    if (result.error) definitionError(source, result.error);
  }
  if (task.count !== undefined) {
    if (!allowCount) {
      definitionError(source, `${label} does not support field 'count'`);
    }
    validatePositiveInteger(task, "count", source, label);
  }
}

function normalizeDefinitions(
  value: unknown,
  source: string,
  mode: DefinitionMode,
  context: ChainOutputValidationContext,
): ChainStep[] {
  if (!Array.isArray(value)) {
    definitionError(source, "chain steps must be an array");
  }

  const steps = value.map((rawStep, index) => {
    const label = `step ${(context.startStepIndex ?? 0) + index + 1}`;
    const step = asRecord(rawStep, source, label);
    const hasExpand = Object.hasOwn(step, "expand");
    const hasCollect = Object.hasOwn(step, "collect");
    const hasParallel = Object.hasOwn(step, "parallel");

    if (hasExpand || hasCollect || (hasParallel && !Array.isArray(step.parallel))) {
      rejectUnknownFields(step, DYNAMIC_STEP_FIELDS, source, label);
      if (!hasExpand || !hasCollect || !hasParallel) {
        definitionError(
          source,
          `${label} must define expand, an object parallel template, and collect together`,
        );
      }
      const expand = asRecord(step.expand, source, `${label}.expand`);
      rejectUnknownFields(expand, DYNAMIC_EXPAND_FIELDS, source, `${label}.expand`);
      const from = asRecord(expand.from, source, `${label}.expand.from`);
      rejectUnknownFields(from, DYNAMIC_FROM_FIELDS, source, `${label}.expand.from`);
      validateOptionalString(from, "output", source, `${label}.expand.from`, true);
      validateOptionalString(from, "path", source, `${label}.expand.from`);
      if (from.output === undefined || from.path === undefined) {
        definitionError(source, `${label}.expand.from must define string output and path fields`);
      }
      validateOptionalString(expand, "item", source, `${label}.expand`);
      validateOptionalString(expand, "key", source, `${label}.expand`);
      validatePositiveInteger(expand, "maxItems", source, `${label}.expand`);
      if (expand.onEmpty !== undefined && expand.onEmpty !== "skip" && expand.onEmpty !== "fail") {
        definitionError(source, `${label}.expand.onEmpty must be 'skip' or 'fail'`);
      }

      const template = asRecord(step.parallel, source, `${label} dynamic parallel template`);
      rejectUnknownFields(
        template,
        DYNAMIC_TEMPLATE_FIELDS,
        source,
        `${label} dynamic parallel template`,
      );
      validateTaskFields(template, mode, source, `${label} dynamic parallel template`, false);

      const collect = asRecord(step.collect, source, `${label}.collect`);
      rejectUnknownFields(collect, DYNAMIC_COLLECT_FIELDS, source, `${label}.collect`);
      validateOptionalString(collect, "as", source, `${label}.collect`, true);
      if (collect.as === undefined) {
        definitionError(source, `${label}.collect.as must be a non-blank string`);
      }
      validateOutputSchema(collect.outputSchema, mode, source, `${label}.collect.outputSchema`);
      validatePositiveInteger(step, "concurrency", source, label);
      validateBoolean(step, "failFast", source, label);
      validateOptionalString(step, "phase", source, label);
      validateOptionalString(step, "label", source, label);
      validateAcceptance(step.acceptance, source, `${label}.acceptance`);
      return step;
    }

    if (hasParallel) {
      const parallel = step.parallel;
      if (!Array.isArray(parallel)) {
        definitionError(source, `${label}.parallel must be an array`);
      }
      if (step.agent !== undefined || hasExpand || hasCollect) {
        definitionError(source, `${label} mixes sequential and parallel fields`);
      }
      if (parallel.length === 0) {
        definitionError(source, `${label}.parallel must be a non-empty array`);
      }
      parallel.forEach((rawTask: unknown, taskIndex: number) => {
        const task = asRecord(rawTask, source, `${label}.parallel task ${taskIndex + 1}`);
        validateTaskFields(task, mode, source, `${label}.parallel task ${taskIndex + 1}`, true);
      });
      validatePositiveInteger(step, "concurrency", source, label);
      validateBoolean(step, "failFast", source, label);
      validateBoolean(step, "worktree", source, label);
      validateOptionalString(step, "cwd", source, label);
      return step;
    }

    validateTaskFields(step, mode, source, label, false);
    validateBoolean(step, "failFast", source, label);
    return step;
  });

  try {
    validateChainOutputBindingsWithContext(steps as unknown as ChainStep[], context);
  } catch (error) {
    if (error instanceof ChainOutputValidationError) {
      definitionError(source, error.message);
    }
    throw error;
  }
  return steps as unknown as ChainStep[];
}

export function normalizeChainSteps(
  value: unknown,
  source: string,
  context: ChainOutputValidationContext = {},
): ChainStep[] {
  return normalizeDefinitions(value, source, "executable", context);
}

function normalizeSavedChainSteps(value: unknown, source: string): ChainStepConfig[] {
  return normalizeDefinitions(value, source, "saved", {}) as unknown as ChainStepConfig[];
}

function loadSavedSchema(
  value: string | JsonSchemaObject | undefined,
  baseDir: string,
  source: string,
  label: string,
): JsonSchemaObject | undefined {
  if (value === undefined || typeof value !== "string") return value;
  const schemaPath = resolve(baseDir, value);
  let content: string;
  try {
    content = readFileSync(schemaPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    definitionError(source, `${label}: unable to read schema '${value}': ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    definitionError(source, `${label}: schema '${value}' is invalid JSON: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    definitionError(source, `${label}: schema '${value}' must contain a JSON object`);
  }
  return parsed as JsonSchemaObject;
}

export function materializeSavedChainSteps(config: ChainConfig): ChainStep[] {
  const saved = normalizeSavedChainSteps(config.steps, config.filePath);
  const baseDir = dirname(config.filePath);
  const materialized = saved.map((step, stepIndex) => {
    if (Array.isArray(step.parallel)) {
      return {
        ...step,
        parallel: step.parallel.map((task, taskIndex) => ({
          ...task,
          outputSchema: loadSavedSchema(
            task.outputSchema,
            baseDir,
            config.filePath,
            `step ${stepIndex + 1} parallel task ${taskIndex + 1}.outputSchema`,
          ),
        })),
      };
    }
    if (step.parallel && !Array.isArray(step.parallel)) {
      return {
        ...step,
        parallel: {
          ...step.parallel,
          outputSchema: loadSavedSchema(
            step.parallel.outputSchema,
            baseDir,
            config.filePath,
            `step ${stepIndex + 1} dynamic parallel template.outputSchema`,
          ),
        },
        collect: step.collect
          ? {
              ...step.collect,
              outputSchema: loadSavedSchema(
                step.collect.outputSchema,
                baseDir,
                config.filePath,
                `step ${stepIndex + 1}.collect.outputSchema`,
              ),
            }
          : step.collect,
      };
    }
    return {
      ...step,
      outputSchema: loadSavedSchema(
        step.outputSchema,
        baseDir,
        config.filePath,
        `step ${stepIndex + 1}.outputSchema`,
      ),
    };
  });
  return normalizeChainSteps(materialized, config.filePath);
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

type Frontmatter = Record<string, string>;

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const fm: Frontmatter = {};
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) fm[kv[1]!] = kv[2]!.trim();
  }
  return { frontmatter: fm, body: content.slice(match[0].length) };
}

// ---------------------------------------------------------------------------
// .chain.md step body parsing
// ---------------------------------------------------------------------------

function parseStepBody(agent: string, sectionBody: string): ChainStepConfig {
  const lines = sectionBody.split("\n");
  const blankIndex = lines.findIndex((line) => line.trim() === "");
  const configLines = blankIndex === -1 ? lines : lines.slice(0, blankIndex);
  const task = (blankIndex === -1 ? "" : lines.slice(blankIndex + 1).join("\n")).trim();

  const step: ChainStepConfig = { agent, task };
  for (const line of configLines) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.trim().toLowerCase();
    const val = match[2]!.trim();

    switch (key) {
      case "output":
        if (val === "false") step.output = false;
        else if (val) step.output = val;
        break;
      case "phase":
        if (val) step.phase = val;
        break;
      case "label":
        if (val) step.label = val;
        break;
      case "as":
        if (val) step.as = val;
        break;
      case "outputschema":
        if (val.startsWith("{") || val.startsWith("[")) {
          throw new Error(
            `Inline outputSchema values are not supported in .chain.md files; use a schema file path.`,
          );
        }
        if (val) step.outputSchema = val;
        break;
      case "outputmode":
        if (val !== "inline" && val !== "file-only") {
          throw new Error(
            `Invalid outputMode in .chain.md step '${agent}': expected 'inline' or 'file-only'`,
          );
        }
        step.outputMode = val;
        break;
      case "reads":
        if (val === "false") {
          step.reads = false;
        } else {
          const reads = val
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          step.reads = reads.length > 0 ? reads : false;
        }
        break;
      case "model":
        if (val) step.model = val;
        break;
      case "skills":
        if (val === "false") {
          step.skills = false;
        } else {
          const skills = val
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          step.skills = skills.length > 0 ? skills : false;
        }
        break;
      case "progress":
        if (val === "true") step.progress = true;
        else if (val === "false") step.progress = false;
        else {
          throw new Error(`Invalid progress in .chain.md step '${agent}': expected true or false`);
        }
        break;
      case "toolbudget": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(val);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid toolBudget in .chain.md step '${agent}': ${msg}`);
        }
        const validation = validateToolBudget(parsed, `toolBudget for step '${agent}'`);
        if (validation.error) throw new Error(validation.error);
        step.toolBudget = parsed as ChainStepConfig["toolBudget"];
        break;
      }
    }
  }

  return step;
}

// ---------------------------------------------------------------------------
// .chain.md parsing
// ---------------------------------------------------------------------------

export function parseChain(filePath: string, content: string): ChainConfig {
  const { frontmatter: fm, body } = parseFrontmatter(content);

  if (!fm.name) {
    throw new Error(`${filePath}: frontmatter missing 'name'`);
  }
  if (!fm.description) {
    throw new Error(`${filePath}: frontmatter missing 'description'`);
  }

  const matches = [...body.matchAll(/^##\s+(.+)[^\S\n]*$/gm)];
  if (matches.length === 0) {
    throw new Error(`${filePath}: no step headings (## agent-name) found`);
  }

  const steps: ChainStepConfig[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const agent = match[1]!.trim();
    const lineEndOffset = body[match.index! + match[0].length] === "\n" ? 1 : 0;
    const sectionStart = match.index! + match[0].length + lineEndOffset;
    const sectionEnd = i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    const sectionBody = body.slice(sectionStart, sectionEnd).trimEnd();
    steps.push(parseStepBody(agent, sectionBody));
  }

  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (key === "name" || key === "package" || key === "description") continue;
    extraFields[key] = value;
  }

  const normalizedSteps = normalizeSavedChainSteps(steps, filePath);
  return {
    name: fm.name,
    description: fm.description,
    packageName: fm.package || undefined,
    filePath,
    steps: normalizedSteps,
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// .chain.json parsing
// ---------------------------------------------------------------------------

export function parseJsonChain(filePath: string, content: string): ChainConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: invalid JSON — ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath}: root must be a JSON object`);
  }

  const input = parsed as Record<string, unknown>;
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new Error(`${filePath}: missing required 'name' field`);
  }
  if (typeof input.description !== "string") {
    throw new Error(`${filePath}: missing required 'description' field`);
  }
  if (!Array.isArray(input.chain)) {
    throw new Error(`${filePath}: missing required 'chain' array`);
  }
  const steps = normalizeSavedChainSteps(input.chain, filePath);

  // Preserve extra string fields
  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "name" || key === "description" || key === "package" || key === "chain") continue;
    if (typeof value === "string") extraFields[key] = value;
  }

  return {
    name: (input.name as string).trim(),
    description: (input.description as string).trim(),
    packageName: typeof input.package === "string" ? input.package : undefined,
    filePath,
    steps,
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeChain(config: ChainConfig): string {
  const steps = normalizeSavedChainSteps(config.steps, config.filePath);
  for (const [index, step] of steps.entries()) {
    if (step.parallel !== undefined || step.expand !== undefined || step.collect !== undefined) {
      throw new ChainDefinitionError(
        config.filePath,
        `step ${index + 1}: Markdown serialization only supports sequential steps`,
      );
    }
    if (step.outputSchema !== undefined && typeof step.outputSchema !== "string") {
      throw new ChainDefinitionError(
        config.filePath,
        `step ${index + 1}: Markdown serialization requires outputSchema to be a file path`,
      );
    }
  }
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${config.name}`);
  if (config.packageName) lines.push(`package: ${config.packageName}`);
  lines.push(`description: ${config.description}`);
  if (config.extraFields) {
    for (const [key, value] of Object.entries(config.extraFields)) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push("");

  for (const [i, step] of steps.entries()) {
    lines.push(`## ${step.agent}`);
    if (step.output === false) lines.push("output: false");
    else if (step.output) lines.push(`output: ${step.output}`);
    if (step.phase) lines.push(`phase: ${step.phase}`);
    if (step.label) lines.push(`label: ${step.label}`);
    if (step.as) lines.push(`as: ${step.as}`);
    if (typeof step.outputSchema === "string" && step.outputSchema)
      lines.push(`outputSchema: ${step.outputSchema}`);
    if (step.outputMode) lines.push(`outputMode: ${step.outputMode}`);
    if (step.reads === false) lines.push("reads: false");
    else if (Array.isArray(step.reads) && step.reads.length > 0)
      lines.push(`reads: ${step.reads.join(", ")}`);
    if (step.model) lines.push(`model: ${step.model}`);
    if (step.skills === false) lines.push("skills: false");
    else if (Array.isArray(step.skills) && step.skills.length > 0)
      lines.push(`skills: ${step.skills.join(", ")}`);
    if (step.progress !== undefined) lines.push(`progress: ${step.progress ? "true" : "false"}`);
    if (step.toolBudget !== undefined) lines.push(`toolBudget: ${JSON.stringify(step.toolBudget)}`);
    lines.push("");
    lines.push(step.task ?? "");
    if (i < steps.length - 1) lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function serializeJsonChain(config: ChainConfig): string {
  const root: Record<string, unknown> = {
    name: config.name,
    description: config.description,
    chain: config.steps,
  };
  if (config.packageName) root.package = config.packageName;
  if (config.extraFields) Object.assign(root, config.extraFields);
  return `${JSON.stringify(root, null, 2)}\n`;
}
