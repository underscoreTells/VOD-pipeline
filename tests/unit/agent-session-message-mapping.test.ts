import { describe, expect, it } from "vitest";
import { mapConversationMessages } from "../../src/renderer/lib/state/agent-session.svelte.js";

describe("agent session message mapping", () => {
  it("rehydrates stored traces and sanitizes legacy assistant content without trace data", () => {
    const mapped = mapConversationMessages([
      {
        id: 1,
        conversation_id: 42,
        role: "assistant",
        content: `Keep the intro.\n\nSUGGESTION: {"in_point": 10, "out_point": 20, "description": "Hook"}`,
        trace_json: null,
        created_at: "2026-04-18T12:00:00.000Z",
      },
      {
        id: 2,
        conversation_id: 42,
        role: "assistant",
        content: "Final answer",
        thinking_markdown: "## Reasoning\n\nBecause it lands better this way.",
        trace_json: JSON.stringify([
          {
            id: "trace-1",
            status: "processing_chat",
            label: "Thinking...",
            nodeName: "chat_node",
            passIndex: 1,
            createdAt: "2026-04-18T12:00:01.000Z",
          },
        ]),
        created_at: "2026-04-18T12:01:00.000Z",
      },
    ]);

    expect(mapped[0]?.content).toBe("Keep the intro.");
    expect(mapped[0]?.thinkingMarkdown).toBeNull();
    expect(mapped[0]?.trace).toEqual([]);
    expect(mapped[1]?.thinkingMarkdown).toBe("## Reasoning\n\nBecause it lands better this way.");
    expect(mapped[1]?.trace).toHaveLength(1);
    expect(mapped[1]?.trace[0]?.nodeName).toBe("chat_node");
  });
});
