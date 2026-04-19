import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../src/renderer/lib/state/agent-session.svelte.js";
import {
  appendAssistantTextDeltaToDraft,
  appendTraceEventToDraft,
  createDraftAssistantMessage,
  failDraftMessage,
  finalizeDraftMessage,
  getVisibleStreamingStatusLabel,
} from "../../src/renderer/lib/state/agent-streaming-helpers.js";

function createMessages(): ChatMessage[] {
  return [
    {
      role: "user",
      content: "hello",
      thinkingMarkdown: null,
      trace: [],
      id: "user-1",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];
}

describe("agent streaming helpers", () => {
  it("creates a draft assistant message from a client request id", () => {
    const message = createDraftAssistantMessage(
      "request-1",
      new Date("2026-01-01T00:00:01.000Z")
    );

    expect(message).toMatchObject({
      role: "assistant",
      content: "",
      thinkingMarkdown: null,
      id: "draft-request-1",
      requestId: "request-1",
      isStreaming: true,
      trace: [],
    });
  });

  it("appends matching assistant text deltas to an existing draft", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];

    const updated = appendAssistantTextDeltaToDraft(messages, "request-1", "streamed");

    expect(updated[1]?.content).toBe("streamed");
  });

  it("ignores text deltas for unknown request ids", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];

    const updated = appendAssistantTextDeltaToDraft(messages, "request-2", "ignored");

    expect(updated).toBe(messages);
    expect(updated[1]?.content).toBe("");
  });

  it("appends trace entries for status or tool-state events", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];

    const updated = appendTraceEventToDraft(messages, "request-1", {
      status: "tool_completed",
      message: "draftRoughCutProposals completed",
      nodeName: "draftRoughCutProposals",
      passIndex: 1,
    });

    expect(updated[1]?.trace).toHaveLength(1);
    expect(updated[1]?.trace[0]).toMatchObject({
      status: "tool_completed",
      label: "draftRoughCutProposals completed",
      nodeName: "draftRoughCutProposals",
      passIndex: 1,
    });
  });

  it("deduplicates matching trace events", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];
    const event = {
      status: "processing_chat",
      message: "Thinking...",
      nodeName: "conversation_runner",
      passIndex: 1,
    } as const;

    const first = appendTraceEventToDraft(messages, "request-1", event);
    const second = appendTraceEventToDraft(first, "request-1", event);

    expect(second[1]?.trace).toHaveLength(1);
  });

  it("exposes the latest visible streaming status label for a draft", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];
    const updated = appendTraceEventToDraft(messages, "request-1", {
      status: "tool_running",
      message: "Drafting rough-cut proposals...",
      nodeName: "draftRoughCutProposals",
      passIndex: 1,
    });

    expect(getVisibleStreamingStatusLabel(updated[1]!)).toBe("Drafting rough-cut proposals...");
  });

  it("falls back to a generic thinking label before trace events arrive", () => {
    const draft = createDraftAssistantMessage("request-1", new Date());

    expect(getVisibleStreamingStatusLabel(draft)).toBe("Thinking...");
  });

  it("finalizes by overwriting streamed text with the final assistant text", () => {
    const messages = [
      ...createMessages(),
      {
        ...createDraftAssistantMessage("request-1", new Date()),
        content: "partial text",
      },
    ];

    const updated = finalizeDraftMessage(
      messages,
      "request-1",
      "final text",
      null
    );

    expect(updated[1]).toMatchObject({
      content: "final text",
      thinkingMarkdown: null,
      isStreaming: false,
    });
  });

  it("converts a failed request into a single assistant error message", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];

    const updated = failDraftMessage(messages, "request-1", "boom");

    expect(updated).toHaveLength(2);
    expect(updated[1]).toMatchObject({
      content: "Error: boom",
      isStreaming: false,
    });
  });
});
