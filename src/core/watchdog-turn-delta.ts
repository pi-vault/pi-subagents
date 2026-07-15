// ─── Watchdog Turn-Delta Formatter ───────────────────────────────────────────

// Tool names whose string inputs should be redacted (they contain large code blobs)
const REDACT_TOOL_NAMES = new Set(["edit_file", "write_file", "edit", "write"]);

// Input object keys whose string values should be redacted for the above tools
const REDACT_KEYS = new Set(["oldText", "newText", "content", "old_string", "new_string"]);

/**
 * Format the last N messages from an agent session as a turn-delta string
 * suitable for watchdog review when git diffs are unavailable or unhelpful.
 *
 * Redacts large string values in edit/write tool inputs to save tokens.
 */
export function formatWatchdogTurnDelta(messages: unknown[], lastN: number): string {
  if (messages.length === 0) return "";

  const recent = messages.slice(-lastN);
  const parts: string[] = [];

  for (const msg of recent) {
    const m = msg as { role?: string; content?: unknown };
    if (!m.role || m.content === undefined) continue;

    // String content (e.g. plain user or assistant messages)
    if (typeof m.content === "string") {
      const text = m.content.slice(0, 500);
      if (text) parts.push(`[${m.role}] ${text}`);
      continue;
    }

    if (!Array.isArray(m.content)) continue;

    for (const block of m.content) {
      const b = block as {
        type?: string;
        name?: string;
        text?: string;
        input?: unknown;
        content?: unknown;
      };

      if (b.type === "tool_use") {
        const redacted = redactToolInput(b.name ?? "", b.input);
        const inputStr = JSON.stringify(redacted).slice(0, 500);
        parts.push(`[tool_use] ${b.name}: ${inputStr}`);
      } else if (b.type === "tool_result") {
        const text = typeof b.content === "string"
          ? b.content.slice(0, 300)
          : JSON.stringify(b.content).slice(0, 300);
        parts.push(`[tool_result] ${text}`);
      } else if (b.type === "text") {
        const text = b.text ?? (typeof b.content === "string" ? b.content : "");
        if (text) parts.push(`[${m.role}] ${text.slice(0, 500)}`);
      }
    }
  }

  return parts.join("\n\n");
}

function redactToolInput(toolName: string, input: unknown): unknown {
  if (!REDACT_TOOL_NAMES.has(toolName)) return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key) && typeof value === "string") {
      sanitized[key] = `[omitted ${value.length} chars]`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
