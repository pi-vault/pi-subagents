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

export interface IntercomReply {
  requestId: string;
  message: string;
  createdAt: number;
}

export interface IntercomManager {
  sendRequest(
    request: Omit<IntercomRequest, "id" | "createdAt">,
    signal?: AbortSignal,
  ): Promise<IntercomReply | null>;
  listPending(): IntercomRequest[];
  reply(requestId: string, message: string): void;
  cancelForAgent(agentId: string): void;
  dispose(): void;
}

interface PendingEntry {
  request: IntercomRequest;
  resolve: (reply: IntercomReply | null) => void;
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
  ): Promise<IntercomReply | null> {
    // Non-blocking progress updates
    if (!input.expectsReply) {
      return Promise.resolve(null);
    }

    const request: IntercomRequest = {
      ...input,
      id: randomUUID().slice(0, 8),
      createdAt: Date.now(),
    };

    return new Promise<IntercomReply | null>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(request.id);
        resolve({
          requestId: request.id,
          message:
            "Supervisor reply timeout — no reply received. Proceed with your best judgment.",
          createdAt: Date.now(),
        });
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
          resolve({
            requestId: request.id,
            message: "Request cancelled.",
            createdAt: Date.now(),
          });
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
    entry.resolve({
      requestId,
      message,
      createdAt: Date.now(),
    });
  }

  function cancelForAgent(agentId: string): void {
    for (const [id, entry] of pending) {
      if (entry.request.agentId === agentId) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve({
          requestId: id,
          message: "Agent cancelled — supervisor request abandoned.",
          createdAt: Date.now(),
        });
      }
    }
  }

  function dispose(): void {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({
        requestId: id,
        message: "Session ended — supervisor request abandoned.",
        createdAt: Date.now(),
      });
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
    params: { reason: IntercomReason; message: string; interview?: unknown },
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
      const expectsReply = params.reason !== "progress_update";

      const reply = await manager.sendRequest(
        {
          agentId,
          agentName,
          reason: params.reason,
          message: params.message,
          expectsReply,
          interview: params.interview,
        },
        signal ?? undefined,
      );

      if (!expectsReply) {
        return {
          content: [{ type: "text", text: "Progress update delivered." }],
        };
      }

      if (reply) {
        if (reply.message.includes("timeout")) {
          return {
            content: [
              {
                type: "text",
                text: `Supervisor reply timeout — no reply received. Proceed with your best judgment.`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: `Parent replied: ${reply.message}` }],
        };
      }

      return { content: [{ type: "text", text: "No reply received." }] };
    },
  };
}


