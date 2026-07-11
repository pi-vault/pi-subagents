import {
  ChainOutputValidationError,
  validateChainOutputBindings,
} from "./chain-outputs.js";
import { validateToolBudget } from "./tool-budget.js";
import type {
  ChainConfig,
  ChainStep,
  ChainStepConfig,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

interface Frontmatter {
  [key: string]: string;
}

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
  const task = (
    blankIndex === -1 ? "" : lines.slice(blankIndex + 1).join("\n")
  ).trim();

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
        if (val === "inline" || val === "file-only") step.outputMode = val;
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
        break;
      case "toolbudget": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(val);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Invalid toolBudget in .chain.md step '${agent}': ${msg}`,
          );
        }
        const validation = validateToolBudget(
          parsed,
          `toolBudget for step '${agent}'`,
        );
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

  if (Object.keys(fm).length === 0) {
    throw new Error(`${filePath}: missing frontmatter (expected --- block)`);
  }

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
    const lineEndOffset =
      body[match.index! + match[0].length] === "\n" ? 1 : 0;
    const sectionStart = match.index! + match[0].length + lineEndOffset;
    const sectionEnd =
      i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    const sectionBody = body.slice(sectionStart, sectionEnd).trimEnd();
    steps.push(parseStepBody(agent, sectionBody));
  }

  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (key === "name" || key === "package" || key === "description") continue;
    extraFields[key] = value;
  }

  return {
    name: fm.name,
    description: fm.description,
    packageName: fm.package || undefined,
    filePath,
    steps,
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// .chain.json parsing
// ---------------------------------------------------------------------------

function validateJsonStepToolBudget(value: unknown, label: string): void {
  const result = validateToolBudget(value, label);
  if (result.error) throw new Error(result.error);
}

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

  // Per-step validation
  for (let i = 0; i < input.chain.length; i++) {
    const step = input.chain[i];
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`${filePath}: step ${i + 1} must be an object`);
    }
    const rec = step as Record<string, unknown>;

    // Validate toolBudget at step level
    if (rec.toolBudget !== undefined) {
      validateJsonStepToolBudget(rec.toolBudget, `step ${i + 1} toolBudget`);
    }

    // Validate toolBudget in parallel tasks
    const parallel = rec.parallel;
    if (Array.isArray(parallel)) {
      for (let j = 0; j < parallel.length; j++) {
        const task = parallel[j];
        if (!task || typeof task !== "object" || Array.isArray(task)) continue;
        const taskRec = task as Record<string, unknown>;
        if (taskRec.toolBudget !== undefined) {
          validateJsonStepToolBudget(
            taskRec.toolBudget,
            `step ${i + 1} parallel task ${j + 1} toolBudget`,
          );
        }
      }
    } else if (parallel && typeof parallel === "object") {
      // Dynamic parallel template
      const tmpl = parallel as Record<string, unknown>;
      if (tmpl.toolBudget !== undefined) {
        validateJsonStepToolBudget(
          tmpl.toolBudget,
          `step ${i + 1} dynamic template toolBudget`,
        );
      }
    }
  }

  // Validate output bindings
  try {
    validateChainOutputBindings(input.chain as unknown as ChainStep[]);
  } catch (error) {
    if (error instanceof ChainOutputValidationError) {
      throw new Error(`${filePath}: ${error.message}`);
    }
    throw error;
  }

  // Preserve extra string fields
  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      key === "name" ||
      key === "description" ||
      key === "package" ||
      key === "chain"
    )
      continue;
    if (typeof value === "string") extraFields[key] = value;
  }

  return {
    name: (input.name as string).trim(),
    description: (input.description as string).trim(),
    packageName:
      typeof input.package === "string" ? input.package : undefined,
    filePath,
    steps: input.chain as ChainStepConfig[],
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeChain(config: ChainConfig): string {
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

  for (let i = 0; i < config.steps.length; i++) {
    const step = config.steps[i]!;
    lines.push(`## ${step.agent}`);
    if (step.output === false) lines.push("output: false");
    else if (step.output) lines.push(`output: ${step.output}`);
    if (step.phase) lines.push(`phase: ${step.phase}`);
    if (step.label) lines.push(`label: ${step.label}`);
    if (step.as) lines.push(`as: ${step.as}`);
    if (step.outputSchema) lines.push(`outputSchema: ${step.outputSchema}`);
    if (step.outputMode) lines.push(`outputMode: ${step.outputMode}`);
    if (step.reads === false) lines.push("reads: false");
    else if (Array.isArray(step.reads) && step.reads.length > 0)
      lines.push(`reads: ${step.reads.join(", ")}`);
    if (step.model) lines.push(`model: ${step.model}`);
    if (step.skills === false) lines.push("skills: false");
    else if (Array.isArray(step.skills) && step.skills.length > 0)
      lines.push(`skills: ${step.skills.join(", ")}`);
    if (step.progress !== undefined)
      lines.push(`progress: ${step.progress ? "true" : "false"}`);
    if (step.toolBudget !== undefined)
      lines.push(`toolBudget: ${JSON.stringify(step.toolBudget)}`);
    lines.push("");
    lines.push(step.task ?? "");
    if (i < config.steps.length - 1) lines.push("");
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
  if (config.extraFields) {
    for (const [key, value] of Object.entries(config.extraFields)) {
      if (
        key !== "name" &&
        key !== "description" &&
        key !== "package" &&
        key !== "chain"
      )
        root[key] = value;
    }
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}
