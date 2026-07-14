import { randomUUID } from "node:crypto";
import { Type } from "typebox";

export type IntercomReason =
  | "need_decision"
  | "progress_update"
  | "interview_request";

export interface IntercomRequest {
  id: string;
  agentId: string;
  agentName: string;
  reason: IntercomReason;
  message: string;
  expectsReply: boolean;
  createdAt: number;
  interview?: unknown;
}

export interface IntercomManager {
  sendRequest(
    request: Omit<IntercomRequest, "id" | "createdAt">,
    signal?: AbortSignal,
  ): Promise<string | null>;
  listPending(): IntercomRequest[];
  reply(requestId: string, message: string): void;
  cancelForAgent(agentId: string): void;
  dispose(): void;
}

interface PendingEntry {
  request: IntercomRequest;
  resolve: (reply: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createIntercomManager(options?: {
  timeoutMs?: number;
  onRequest?: (request: IntercomRequest) => void;
}): IntercomManager {
  const timeoutMs = options?.timeoutMs ?? 300_000; // 5 min default
  const pending = new Map<string, PendingEntry>();

  function sendRequest(
    input: Omit<IntercomRequest, "id" | "createdAt">,
    signal?: AbortSignal,
  ): Promise<string | null> {
    // Non-blocking progress updates
    if (!input.expectsReply) {
      return Promise.resolve(null);
    }

    const request: IntercomRequest = {
      ...input,
      id: randomUUID().slice(0, 8),
      createdAt: Date.now(),
    };

    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(request.id);
        resolve(
          "Supervisor reply timeout — no reply received. Proceed with your best judgment.",
        );
      }, timeoutMs);

      const entry: PendingEntry = { request, resolve, timer };
      pending.set(request.id, entry);

      // Notify listener (e.g., parent session) about the new request
      options?.onRequest?.(request);

      // Wire abort signal
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          pending.delete(request.id);
          resolve("Request cancelled.");
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  function listPending(): IntercomRequest[] {
    return [...pending.values()].map((e) => e.request);
  }

  function reply(requestId: string, message: string): void {
    // Support prefix matching
    let entry: PendingEntry | undefined;
    if (pending.has(requestId)) {
      entry = pending.get(requestId);
    } else {
      // Prefix match
      for (const [id, e] of pending) {
        if (id.startsWith(requestId)) {
          entry = e;
          requestId = id;
          break;
        }
      }
    }
    if (!entry) return;

    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(message);
  }

  function cancelForAgent(agentId: string): void {
    for (const [id, entry] of pending) {
      if (entry.request.agentId === agentId) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve("Agent cancelled — supervisor request abandoned.");
      }
    }
  }

  function dispose(): void {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve("Session ended — supervisor request abandoned.");
    }
    pending.clear();
  }

  return { sendRequest, listPending, reply, cancelForAgent, dispose };
}

export interface IntercomToolDef {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

/**
 * Create the child-side `contact_supervisor` tool bound to a specific agent.
 */
export function createContactSupervisorTool(
  manager: IntercomManager,
  agentId: string,
  agentName: string,
): IntercomToolDef {
  return {
    name: "contact_supervisor",
    label: "Contact Supervisor",
    description:
      "Contact the parent session for a blocking decision, progress update, or structured interview.",
    parameters: Type.Object({
      reason: Type.Union([
        Type.Literal("need_decision"),
        Type.Literal("progress_update"),
        Type.Literal("interview_request"),
      ]),
      message: Type.String({ description: "What you need from the parent" }),
      interview: Type.Optional(
        Type.Unknown({
          description: "Structured data for interview_request",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const p = params as {
        reason: IntercomReason;
        message: string;
        interview?: unknown;
      };
      const expectsReply = p.reason !== "progress_update";

      const reply = await manager.sendRequest(
        {
          agentId,
          agentName,
          reason: p.reason,
          message: p.message,
          expectsReply,
          interview: p.interview,
        },
        signal ?? undefined,
      );

      if (!expectsReply) {
        return {
          content: [{ type: "text", text: "Progress update delivered." }],
        };
      }

      return { content: [{ type: "text", text: reply! }] };
    },
  };
}

/**
 * Create the parent-side `intercom` tool for replying to child requests.
 */
export function createIntercomTool(manager: IntercomManager): IntercomToolDef {
  return {
    name: "intercom",
    label: "Intercom",
    description:
      "Reply to child agent requests. Use 'list' to see pending, 'reply' to respond, 'status' for info.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("reply"),
        Type.Literal("list"),
        Type.Literal("status"),
      ]),
      replyTo: Type.Optional(
        Type.String({
          description:
            "Request ID to reply to (prefix match). Omit if only one pending.",
        }),
      ),
      message: Type.Optional(
        Type.String({
          description: "Reply message content",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const action = (params as { action?: string }).action;
      switch (action) {
        case "list": {
          const pendingList = manager.listPending();
          if (pendingList.length === 0) {
            return {
              content: [
                { type: "text", text: "No pending intercom requests." },
              ],
            };
          }
          const lines = pendingList.map((r) => {
            const age = Math.round((Date.now() - r.createdAt) / 1000);
            return `- [${r.id}] ${r.agentName} (${r.reason}): "${r.message}" (${age}s ago)`;
          });
          return {
            content: [
              { type: "text", text: `Pending requests:\n${lines.join("\n")}` },
            ],
          };
        }

        case "reply": {
          const pendingList = manager.listPending();
          const replyTo = (params as { replyTo?: string }).replyTo;
          const message = (params as { message?: string }).message ?? "";

          if (!replyTo && pendingList.length === 1) {
            // Auto-resolve single pending
            manager.reply(pendingList[0].id, message);
            return {
              content: [
                {
                  type: "text",
                  text: `Replied to ${pendingList[0].agentName}: "${message}"`,
                },
              ],
            };
          }

          if (!replyTo) {
            return {
              content: [
                {
                  type: "text",
                  text: `Multiple pending requests. Specify replyTo ID. Use action "list" to see them.`,
                },
              ],
            };
          }

          manager.reply(replyTo, message);
          return {
            content: [
              { type: "text", text: `Replied to ${replyTo}: "${message}"` },
            ],
          };
        }

        case "status": {
          const count = manager.listPending().length;
          return {
            content: [
              {
                type: "text",
                text: `Intercom active. Pending: ${count} request(s).`,
              },
            ],
          };
        }

        default:
          return { content: [{ type: "text", text: "Unknown action." }] };
      }
    },
  };
}


