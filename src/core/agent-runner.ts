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
  RunOptions,
  RunResult,
} from "../shared/types.js";
import { preloadSkills } from "./skill-loader.js";

/**
 * Stateless session execution. Creates an AgentSession, subscribes to events,
 * executes the prompt, and returns the result.
 *
 * Follows the pattern established by @tintinweb/pi-subagents:
 * - DefaultResourceLoader with systemPromptOverride for custom system prompt
 * - SessionManager.inMemory() for ephemeral child sessions
 * - session.subscribe() for unified event handling
 * - forwardAbortSignal pattern for cancellation
 */
export async function runAgent(
  agentDef: AgentDefinition,
  options: RunOptions,
  ctx: { model?: unknown; modelRegistry?: unknown },
): Promise<RunResult> {
  // 1. Resolve tools — exclude "subagent" unless recursion is allowed
  const allowedTools = options.allowRecursion
    ? agentDef.tools
    : agentDef.tools.filter((t) => t !== "subagent");

  // 2. Build system prompt
  const systemPrompt = buildSystemPrompt(agentDef, options.cwd);

  // 3. Create ResourceLoader with overrides
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    noExtensions: true,
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

  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir,
    sessionManager,
    settingsManager,
    model,
    tools: allowedTools,
    resourceLoader: loader,
    ...(agentDef.thinking ? { thinkingLevel: agentDef.thinking as never } : {}),
  });

  // 6. Bind extensions (required even when empty)
  await session.bindExtensions({});
  options.onSessionCreated?.(session);

  // 7. Subscribe to events
  let responseText = "";
  let turnCount = 0;
  let aborted = false;

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

  // 10. Execute prompt
  try {
    await session.prompt(options.prompt);
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

  return { responseText, session: session as unknown, aborted, steered: false };
}

function buildSystemPrompt(agentDef: AgentDefinition, cwd: string): string {
  const parts: string[] = [
    `<active_agent name="${agentDef.name}"/>`,
    "",
    `Environment: cwd=${cwd}, platform=${process.platform}`,
  ];

  if (agentDef.systemPrompt.trim()) {
    parts.push("", agentDef.systemPrompt.trim());
  }

  // Preload skills into prompt if configured
  if (Array.isArray(agentDef.skills) && agentDef.skills.length > 0) {
    const preloaded = preloadSkills(agentDef.skills, cwd);
    for (const skill of preloaded) {
      parts.push("", `<skill name="${skill.name}">\n${skill.content}\n</skill>`);
    }
  }

  return parts.join("\n");
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
  const onAbort = () => { session.abort(); };
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
