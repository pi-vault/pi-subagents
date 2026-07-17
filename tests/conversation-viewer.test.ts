import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { ConversationViewer, VIEWPORT_HEIGHT_PCT } from "../src/tui/conversation-viewer.js";
import type { AgentActivity } from "../src/tui/activity.js";
import type { AgentRecord } from "../src/shared/types.js";

// Raw escape sequences for key input (VT100/xterm)
const ESC = "\x1b";
const ENTER = "\r";
const UP = "\x1b[A";

const makeTheme = () => ({
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
});

const makeTui = (rows = 40) => ({
  terminal: { rows, columns: 80 },
  requestRender: vi.fn(),
});

const makeSession = (messages: unknown[] = []) => {
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => unsubscribe);
  return { messages, subscribe, _unsubscribe: unsubscribe };
};

const makeRecord = (overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  type: "coder",
  description: "Fix the bug",
  status: "running",
  toolUses: 0,
  turnCount: 1,
  live: { activeTools: [], responseText: "" },
  startedAt: Date.now() - 5000,
  lifetimeUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
  ...overrides,
});

function makeViewer(opts: {
  rows?: number;
  messages?: unknown[];
  record?: AgentRecord;
  activity?: AgentActivity;
  onStop?: () => void;
  onSteer?: (msg: string) => void;
} = {}) {
  const tui = makeTui(opts.rows);
  const session = makeSession(opts.messages);
  const done = vi.fn();
  const viewer = new ConversationViewer(
    tui as unknown as TUI,
    session as unknown as AgentSession,
    opts.record ?? makeRecord(),
    opts.activity,
    makeTheme(),
    done as unknown as (result: undefined) => void,
    opts.onStop,
    undefined,
    opts.onSteer,
  );
  return { viewer, tui, session, done };
}

describe("VIEWPORT_HEIGHT_PCT", () => {
  it("is 70", () => {
    expect(VIEWPORT_HEIGHT_PCT).toBe(70);
  });
});

describe("ConversationViewer", () => {
  describe("render()", () => {
    it("returns an array of strings", () => {
      const { viewer } = makeViewer();
      const lines = viewer.render(80);
      expect(Array.isArray(lines)).toBe(true);
      for (const line of lines) {
        expect(typeof line).toBe("string");
      }
    });

    it("first line starts with box border ╭", () => {
      const { viewer } = makeViewer();
      const lines = viewer.render(80);
      expect(lines[0].startsWith("╭")).toBe(true);
    });

    it("last line ends with ╯", () => {
      const { viewer } = makeViewer();
      const lines = viewer.render(80);
      expect(lines[lines.length - 1].endsWith("╯")).toBe(true);
    });

    it("header contains record.type and record.description", () => {
      const { viewer } = makeViewer();
      const lines = viewer.render(80);
      // header is the second line (after the top border)
      expect(lines[1]).toContain("coder");
      expect(lines[1]).toContain("Fix the bug");
    });

    it("shows ● for running status", () => {
      const { viewer } = makeViewer({ record: makeRecord({ status: "running" }) });
      const lines = viewer.render(80);
      expect(lines[1]).toContain("●");
    });

    it("shows ✓ for completed status", () => {
      const { viewer } = makeViewer({ record: makeRecord({ status: "completed" }) });
      const lines = viewer.render(80);
      expect(lines[1]).toContain("✓");
    });

    it("shows ✗ for error status", () => {
      const { viewer } = makeViewer({ record: makeRecord({ status: "error" }) });
      const lines = viewer.render(80);
      expect(lines[1]).toContain("✗");
    });

    it("shows (waiting for first message...) with empty session", () => {
      const { viewer } = makeViewer({ messages: [] });
      const all = viewer.render(80).join("\n");
      expect(all).toContain("(waiting for first message...)");
    });

    it("renders [User] for user messages", () => {
      const messages = [{ role: "user", content: "hello", timestamp: Date.now() }];
      const { viewer } = makeViewer({ messages });
      const all = viewer.render(80).join("\n");
      expect(all).toContain("[User]");
    });

    it("renders [Assistant] for assistant messages", () => {
      const messages = [{ role: "assistant", content: [{ type: "text", text: "response" }] }];
      const { viewer } = makeViewer({ messages });
      const all = viewer.render(80).join("\n");
      expect(all).toContain("[Assistant]");
    });

    it("renders [Result] for toolResult messages", () => {
      const messages = [{ role: "toolResult", content: [{ type: "text", text: "some result" }] }];
      const { viewer } = makeViewer({ messages });
      const all = viewer.render(80).join("\n");
      expect(all).toContain("[Result]");
    });

    it("shows ▍ streaming indicator for running agent with activity", () => {
      const activity: AgentActivity = {
        activeTools: new Map(),
        toolUses: 0,
        responseText: "thinking...",
        turnCount: 1,
        lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
      };
      const { viewer } = makeViewer({
        activity,
        record: makeRecord({ status: "running" }),
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      });
      const all = viewer.render(80).join("\n");
      expect(all).toContain("▍");
    });
  });

  describe("session subscription", () => {
    it("calls session.subscribe() in constructor", () => {
      const { session } = makeViewer();
      expect(session.subscribe).toHaveBeenCalledOnce();
    });

    it("dispose() calls the unsubscribe function", () => {
      const { viewer, session } = makeViewer();
      viewer.dispose();
      expect(session._unsubscribe).toHaveBeenCalledOnce();
    });
  });

  describe("handleInput()", () => {
    it("escape closes the viewer (calls done with undefined)", () => {
      const { viewer, done } = makeViewer();
      viewer.handleInput(ESC);
      expect(done).toHaveBeenCalledWith(undefined);
    });

    it("x once arms stop but does not call onStop", () => {
      const onStop = vi.fn();
      const { viewer } = makeViewer({ onStop });
      viewer.handleInput("x");
      expect(onStop).not.toHaveBeenCalled();
      // stopArmed is visible via the footer hint
      const all = viewer.render(80).join("\n");
      expect(all).toContain("x again to STOP");
    });

    it("x twice calls onStop", () => {
      const onStop = vi.fn();
      const { viewer } = makeViewer({ onStop });
      viewer.handleInput("x");
      viewer.handleInput("x");
      expect(onStop).toHaveBeenCalledOnce();
    });

    it("enter opens composer when canSteer is true (running + onSteer provided)", () => {
      const onSteer = vi.fn();
      const { viewer } = makeViewer({
        onSteer,
        record: makeRecord({ status: "running" }),
      });
      viewer.handleInput(ENTER);
      const all = viewer.render(80).join("\n");
      expect(all).toContain("✎ steer");
    });

    it("up arrow decrements scroll offset when not at the top", () => {
      // 10 user messages → 29 content lines, viewportHeight 22 → maxScroll 7
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: "user",
        content: `message ${i}`,
        timestamp: Date.now(),
      }));
      const { viewer } = makeViewer({ messages });

      // Initial render: autoScroll brings us to the bottom (100%)
      const lines1 = viewer.render(80);
      expect(lines1[lines1.length - 2]).toContain("100%");

      // Press up once — scrollOffset should decrease
      viewer.handleInput(UP);

      const lines2 = viewer.render(80);
      expect(lines2[lines2.length - 2]).not.toContain("100%");
    });
  });
});
