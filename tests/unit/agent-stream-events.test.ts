import { describe, expect, it } from "vitest";
import { enrichAgentStreamEvent } from "../../src/electron/agent-stream-events.js";
import type {
  AgentOutputMessage,
  AgentStreamContext,
} from "../../src/shared/types/agent-ipc.js";

const context: AgentStreamContext = {
  clientRequestId: "client-1",
  projectId: "12",
  chapterId: "34",
  conversationId: 56,
  passIndex: 2,
};

describe("agent stream event enrichment", () => {
  it("enriches progress messages with renderer stream context", () => {
    const message: AgentOutputMessage = {
      type: "progress",
      requestId: "worker-1",
      status: "processing_chat",
      progress: 25,
      nodeName: "chat_node",
      message: "Thinking...",
    };

    expect(enrichAgentStreamEvent(message, context)).toEqual({
      type: "progress",
      ...context,
      status: "processing_chat",
      progress: 25,
      nodeName: "chat_node",
      message: "Thinking...",
    });
  });

  it("enriches token messages with renderer stream context", () => {
    const message: AgentOutputMessage = {
      type: "token",
      requestId: "worker-2",
      content: "hello",
      role: "assistant",
      nodeName: "chat_node",
      visibility: "hidden",
    };

    expect(enrichAgentStreamEvent(message, context)).toEqual({
      type: "token",
      ...context,
      content: "hello",
      role: "assistant",
      nodeName: "chat_node",
      visibility: "hidden",
    });
  });

  it("returns null for graph-complete messages", () => {
    const message: AgentOutputMessage = {
      type: "graph-complete",
      requestId: "worker-3",
      result: {},
      threadId: "thread-1",
    };

    expect(enrichAgentStreamEvent(message, context)).toBeNull();
  });

  it("returns null for error messages", () => {
    const message: AgentOutputMessage = {
      type: "error",
      requestId: "worker-4",
      error: "boom",
    };

    expect(enrichAgentStreamEvent(message, context)).toBeNull();
  });
});
