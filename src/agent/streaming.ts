export function getLangGraphTokenNodeName(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") {
    return "unknown";
  }

  const record = metadata as Record<string, unknown>;

  if (typeof record.langgraph_node === "string" && record.langgraph_node.trim().length > 0) {
    return record.langgraph_node;
  }

  if (typeof record.nodeName === "string" && record.nodeName.trim().length > 0) {
    return record.nodeName;
  }

  return "unknown";
}

const HIDDEN_TOKEN_NODES = new Set(["chat_node", "visual_analysis", "timeline_edit"]);

export function getLangGraphTokenVisibility(nodeName: string): "chat" | "hidden" {
  return HIDDEN_TOKEN_NODES.has(nodeName) ? "hidden" : "chat";
}
