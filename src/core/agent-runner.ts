import { execSync } from "node:child_process";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
  AgentDefinition,
  EnvInfo,
  RunOptions,
  RunResult,
} from "../shared/types.js";
import { preloadSkills } from "./skill-loader.js";

interface SkillBlock {
  name: string;
  content: string;
}

/**
 * Detect environment info for prompt construction.
 */
export function detectEnv(cwd: string): EnvInfo {
  let isGitRepo = false;
  let branch = "";
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    isGitRepo = true;
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {
    // Not a git repo or git not available
  }
  return { isGitRepo, branch, platform: process.platform };
}

/**
 * Build the system prompt for an agent session.
 *
 * - `"replace"` (default): Agent owns its entire system prompt.
 * - `"append"`: Agent inherits parent prompt and layers specialization.
 */
export function buildAgentPrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  skillBlocks?: SkillBlock[],
): string {
  if (agentDef.promptMode === "append") {
    return buildAppendPrompt(agentDef, cwd, env, parentSystemPrompt, skillBlocks);
  }
  return buildReplacePrompt(agentDef, cwd, env, skillBlocks);
}

function buildReplacePrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  skillBlocks?: SkillBlock[],
): string {
  const envLine = `Environment: cwd=${cwd}${env.isGitRepo ? `, git branch=${env.branch}` : ""}, platform=${env.platform}`;
  const parts: string[] = [
    `<active_agent name="${agentDef.name}"/>`,
    "",
    envLine,
  ];

  if (agentDef.systemPrompt.trim()) {
    parts.push("", agentDef.systemPrompt.trim());
  }

  appendSkillBlocks(parts, skillBlocks);

  return parts.join("\n");
}

function buildAppendPrompt(
  agentDef: AgentDefinition,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  skillBlocks?: SkillBlock[],
): string {
  const base =
    parentSystemPrompt?.trim() || "You are a general-purpose coding agent.";
  const envLine = `Environment: cwd=${cwd}${env.isGitRepo ? `, git branch=${env.branch}` : ""}, platform=${env.platform}`;

  const parts: string[] = [
    base,
    "",
    "<sub_agent_context>",
    "You are operating as a specialized sub-agent. Your parent session has",
    "delegated a specific task to you. Focus on completing the delegated",
    "task efficiently.",
    "</sub_agent_context>",
    "",
    `<active_agent name="${agentDef.name}"/>`,
    envLine,
  ];

  if (agentDef.systemPrompt.trim()) {
    parts.push(
      "",
      "<agent_instructions>",
      agentDef.systemPrompt.trim(),
      "</agent_instructions>",
    );
  }

  appendSkillBlocks(parts, skillBlocks);

  return parts.join("\n");
}

function appendSkillBlocks(parts: string[], skillBlocks?: SkillBlock[]): void {
  if (skillBlocks && skillBlocks.length > 0) {
    for (const skill of skillBlocks) {
      parts.push("", `<skill name="${skill.name}">\n${skill.content}\n</skill>`);
    }
  }
}

/**
 * Build a formatted string of the parent conversation history for context forking.
 */
export function buildParentContext(entries: unknown[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const e = entry as {
      type?: string;
      role?: string;
      content?: Array<{ type: string; text?: string }>;
      summary?: string;
    };
    if (e.type === "message" && e.role === "user") {
      const text =
        e.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("") ?? "";
      if (text) lines.push(`[User]: ${text}`);
    } else if (e.type === "message" && e.role === "assistant") {
      const text =
        e.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("") ?? "";
      if (text) lines.push(`[Assistant]: ${text}`);
    } else if (e.type === "compaction") {
      if (e.summary) lines.push(`[Summary]: ${e.summary}`);
    }
    // Skip toolResult entries and anything else
  }

  return [
    "<parent_conversation>",
    "The following is the conversation history from the parent session that",
    "delegated this task to you. Use it for context but focus on your",
    "assigned task.",
    "",
    ...lines,
    "</parent_conversation>",
  ].join("\n");
}

/**
 * Stateless session execution. Creates an AgentSession, subscribes to events,
 * executes the prompt, and returns the result.
 */
export async function runAgent(
  agentDef: AgentDefinition,
  options: RunOptions,
  ctx: {
    model?: unknown;
    modelRegistry?: unknown;
    sessionManager?: { getBranch?: () => unknown[] };
  },
): Promise<RunResult> {
  // 1. Resolve tools — exclude "subagent" unless recursion is allowed, then filter disallowed
  const allowedTools = (
    options.allowRecursion
      ? agentDef.tools
      : agentDef.tools.filter((t) => t !== "subagent")
  ).filter((t) => !(agentDef.disallowedTools ?? []).includes(t));

  // 2. Build system prompt
  const env = detectEnv(options.cwd);
  const preloaded =
    Array.isArray(agentDef.skills) && agentDef.skills.length > 0
      ? preloadSkills(agentDef.skills, options.cwd)
      : [];
  const skillBlocks = preloaded.length > 0 ? preloaded : undefined;
  const systemPrompt = buildAgentPrompt(
    agentDef,
    options.cwd,
    env,
    options.parentSystemPrompt,
    skillBlocks,
  );

  // 2b. If inheritContext, prepend parent conversation to prompt
  let fullPrompt = options.prompt;
  if (options.inheritContext) {
    const ctxWithSession = ctx as {
      sessionManager?: { getBranch?: () => unknown[] };
    };
    if (ctxWithSession.sessionManager?.getBranch) {
      const parentContext = buildParentContext(
        ctxWithSession.sessionManager.getBranch(),
      );
      fullPrompt = `${parentContext}\n\n${options.prompt}`;
    }
  }

  // 3. Create ResourceLoader with policy-driven extension loading.
  //    Extensions disabled when agent is isolated, or explicitly disables them.
  //    A string[] list (selective) or true (all) means extensions are enabled.
  const agentDir = getAgentDir();
  const noExtensions = agentDef.isolated === true || agentDef.extensions === false;
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    noExtensions,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  // 4. Resolve model
  const model = (options.model ?? ctx.model) as never;

  // 5. Create session
  const settingsManager = SettingsManager.create(options.cwd, agentDir);
  const sessionManager = SessionManager.inMemory(options.cwd);

  const thinkingLevel = options.thinking ?? agentDef.thinking;

  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir,
    sessionManager,
    settingsManager,
    model,
    tools: allowedTools,
    resourceLoader: loader,
    ...(thinkingLevel ? { thinkingLevel: thinkingLevel as never } : {}),
  });

  // 6. Bind extensions (required even when empty)
  await session.bindExtensions({});
  options.onSessionCreated?.(session);

  // 7. Subscribe to events + turn-based limits
  let responseText = "";
  let turnCount = 0;
  let aborted = false;
  let steered = false;

  const maxTurns = options.maxTurns ?? 0;
  const graceTurns = options.graceTurns ?? 5;

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_start") {
      responseText = "";
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      responseText += event.assistantMessageEvent.delta;
      options.onTextDelta?.(event.assistantMessageEvent.delta, responseText);
    }
    if (event.type === "tool_execution_start") {
      options.onToolActivity?.({ type: "start", toolName: event.toolName });
    }
    if (event.type === "tool_execution_end") {
      options.onToolActivity?.({ type: "end", toolName: event.toolName });
    }
    if (event.type === "turn_end") {
      turnCount++;
      options.onTurnEnd?.(turnCount);

      // Soft limit: steer the agent to wrap up
      if (maxTurns > 0 && turnCount === maxTurns && !steered) {
        session.steer(
          "You have reached the turn limit. Wrap up your work immediately and return your final result.",
        );
        steered = true;
      }

      // Hard limit: abort after grace period
      if (maxTurns > 0 && turnCount >= maxTurns + graceTurns) {
        aborted = true;
        session.abort();
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = (
        event.message as {
          usage?: { input?: number; output?: number; cacheWrite?: number };
        }
      ).usage;
      if (usage) {
        options.onUsage?.({
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
        });
      }
    }
  });

  // 8. Set up timeout
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs) {
    timeoutHandle = setTimeout(() => {
      aborted = true;
      session.abort();
    }, options.timeoutMs);
  }

  // 9. Wire parent abort signal
  const cleanupAbort = forwardAbortSignal(session, options.signal);

  // 10. Execute prompt (use fullPrompt which may include parent context)
  try {
    await session.prompt(fullPrompt);
  } catch (error) {
    if (!aborted && !options.signal?.aborted) throw error;
    aborted = true;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    unsubscribe();
    cleanupAbort();
  }

  // 11. Fallback: get text from session messages if streaming didn't capture it
  if (!responseText.trim()) {
    responseText = getLastAssistantText(session);
  }

  return { responseText, session: session as unknown, aborted, steered };
}

/** Wire an AbortSignal to abort a session. Returns cleanup function. */
function forwardAbortSignal(
  session: AgentSession,
  signal?: AbortSignal,
): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    session.abort();
    return () => {};
  }
  const onAbort = () => {
    session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

/** Get last assistant text from session transcript (fallback when streaming missed it). */
function getLastAssistantText(session: AgentSession): string {
  const messages = session.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = (
      msg as { content?: Array<{ type: string; text?: string }> }
    ).content;
    if (!content) continue;
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (text.trim()) return text.trim();
  }
  return "";
}
