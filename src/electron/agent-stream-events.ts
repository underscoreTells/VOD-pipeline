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

  if (message.type === "progress") {
    return {
      type: "progress",
      ...context,
      status: message.status,
      progress: message.progress,
      nodeName: message.nodeName,
      message: message.message,
    };
  }

  if (message.type === "token") {
    return {
      type: "token",
      ...context,
      content: message.content,
      role: message.role,
      nodeName: message.nodeName,
      visibility: message.visibility,
    };
  }

  return null;
}
