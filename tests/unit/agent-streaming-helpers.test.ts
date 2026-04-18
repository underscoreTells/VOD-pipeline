import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../src/renderer/lib/state/agent-session.svelte.js";
import {
  appendTraceEventToDraft,
  appendTokenToDraft,
  createDraftAssistantMessage,
  failDraftMessage,
  finalizeDraftMessage,
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

  it("appends matching token content to an existing draft", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];

    const updated = appendTokenToDraft(messages, "request-1", "streamed");

    expect(updated[1]?.content).toBe("streamed");
  });

  it("ignores token updates for unknown request ids", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];

    const updated = appendTokenToDraft(messages, "request-2", "ignored");

    expect(updated).toBe(messages);
    expect(updated[1]?.content).toBe("");
  });

  it("ignores hidden token updates", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];

    const updated = appendTokenToDraft(messages, "request-1", "hidden", "hidden");

    expect(updated).toBe(messages);
    expect(updated[1]?.content).toBe("");
  });

  it("resets the draft body when a progress event requests it and appends trace entries", () => {
    const messages = [
      ...createMessages(),
      {
        ...createDraftAssistantMessage("request-1", new Date()),
        content: "first pass",
      },
    ];

    const updated = appendTraceEventToDraft(
      messages,
      "request-1",
      {
        status: "loading_detailed_transcript_context",
        message: "Fetching detailed transcript for a better answer...",
        nodeName: "timeline_edit",
        passIndex: 2,
        resetDraft: true,
      }
    );

    expect(updated[1]?.content).toBe("");
    expect(updated[1]?.trace).toHaveLength(1);
    expect(updated[1]?.trace[0]).toMatchObject({
      status: "loading_detailed_transcript_context",
      label: "Fetching detailed transcript for a better answer...",
      nodeName: "timeline_edit",
      passIndex: 2,
    });
  });

  it("deduplicates matching trace events", () => {
    const messages = [...createMessages(), createDraftAssistantMessage("request-1", new Date())];
    const event = {
      status: "processing_chat",
      message: "Thinking...",
      nodeName: "chat_node",
      passIndex: 1,
      resetDraft: false,
    } as const;

    const first = appendTraceEventToDraft(messages, "request-1", event);
    const second = appendTraceEventToDraft(first, "request-1", event);

    expect(second[1]?.trace).toHaveLength(1);
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
      "## Reasoning\n\nBecause it works."
    );

    expect(updated[1]).toMatchObject({
      content: "final text",
      thinkingMarkdown: "## Reasoning\n\nBecause it works.",
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
