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
  it("enriches status messages with renderer stream context", () => {
    const message: AgentOutputMessage = {
      type: "status",
      requestId: "worker-1",
      status: "processing_chat",
      progress: 25,
      nodeName: "conversation_runner",
      stepIndex: 3,
      message: "Thinking...",
    };

    expect(enrichAgentStreamEvent(message, context)).toEqual({
      type: "status",
      ...context,
      status: "processing_chat",
      progress: 25,
      nodeName: "conversation_runner",
      stepIndex: 3,
      message: "Thinking...",
    });
  });

  it("enriches assistant text deltas with renderer stream context", () => {
    const message: AgentOutputMessage = {
      type: "assistant_text_delta",
      requestId: "worker-2",
      delta: "hello",
      role: "assistant",
    };

    expect(enrichAgentStreamEvent(message, context)).toEqual({
      type: "assistant_text_delta",
      ...context,
      delta: "hello",
      role: "assistant",
    });
  });

  it("enriches tool state messages with renderer stream context", () => {
    const message: AgentOutputMessage = {
      type: "tool_state",
      requestId: "worker-3",
      toolCallId: "tool-1",
      toolName: "draftRoughCutProposals",
      state: "completed",
      stepIndex: 4,
      message: "saved",
      output: '{"acceptedCount":1}',
    };

    expect(enrichAgentStreamEvent(message, context)).toEqual({
      type: "tool_state",
      ...context,
      toolCallId: "tool-1",
      toolName: "draftRoughCutProposals",
      state: "completed",
      stepIndex: 4,
      message: "saved",
      output: '{"acceptedCount":1}',
      input: undefined,
      error: undefined,
    });
  });

  it("returns null for turn-complete messages", () => {
    const message: AgentOutputMessage = {
      type: "turn_complete",
      requestId: "worker-4",
      result: {},
      threadId: "thread-1",
    };

    expect(enrichAgentStreamEvent(message, context)).toBeNull();
  });

  it("returns null for error messages", () => {
    const message: AgentOutputMessage = {
      type: "error",
      requestId: "worker-5",
      error: "boom",
    };

    expect(enrichAgentStreamEvent(message, context)).toBeNull();
  });
});
