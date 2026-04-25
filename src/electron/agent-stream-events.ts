import type {
  AgentOutputMessage,
  AgentStreamContext,
  AgentStreamEvent,
} from "../shared/types/agent-ipc.js";

export function enrichAgentStreamEvent(
  message: AgentOutputMessage,
  context?: AgentStreamContext
): AgentStreamEvent | null {
  if (!context) {
    return null;
  }

  if (message.type === "status") {
    return {
      type: "status",
      ...context,
      status: message.status,
      progress: message.progress,
      nodeName: message.nodeName,
      stepIndex: message.stepIndex,
      message: message.message,
    };
  }

  if (message.type === "assistant_text_delta") {
    return {
      type: "assistant_text_delta",
      ...context,
      delta: message.delta,
      role: message.role,
    };
  }

  if (message.type === "tool_state") {
    return {
      type: "tool_state",
      ...context,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      state: message.state,
      stepIndex: message.stepIndex,
      message: message.message,
      input: message.input,
      output: message.output,
      error: message.error,
    };
  }

  return null;
}
