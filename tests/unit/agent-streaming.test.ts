import { describe, expect, it } from "vitest";
import {
  getLangGraphTokenNodeName,
  getLangGraphTokenVisibility,
} from "../../src/agent/streaming.js";

describe("agent streaming helpers", () => {
  it("prefers langgraph_node when present", () => {
    expect(
      getLangGraphTokenNodeName({
        langgraph_node: "chat_node",
        nodeName: "fallback_node",
      })
    ).toBe("chat_node");
  });

  it("falls back to nodeName when langgraph_node is missing", () => {
    expect(
      getLangGraphTokenNodeName({
        nodeName: "chat_node",
      })
    ).toBe("chat_node");
  });

  it("returns unknown when no node metadata is present", () => {
    expect(getLangGraphTokenNodeName({})).toBe("unknown");
  });

  it("hides streamed tokens for structured-output nodes", () => {
    expect(getLangGraphTokenVisibility("visual_analysis")).toBe("hidden");
    expect(getLangGraphTokenVisibility("timeline_edit")).toBe("hidden");
    expect(getLangGraphTokenVisibility("chat_node")).toBe("chat");
  });
});
