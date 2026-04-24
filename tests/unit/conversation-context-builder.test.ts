import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { buildConversationSystemPrompt } from "../../src/agent/conversation/context-builder.js";
import type { ConversationTurnInput } from "../../src/agent/conversation/types.js";

function createInput(): ConversationTurnInput {
  return {
    messages: [new HumanMessage("Make it flow better.")],
    selectedProvider: "gemini",
    selectedClipIds: [],
    playheadTime: 12,
    context: {
      chapter: {
        id: "7",
        title: "Test chapter",
        startTime: 0,
        endTime: 300,
      },
      chapterAssetIds: [1],
      chapterClips: [],
      transcript: "Transcript preview",
      detailedTranscripts: [],
      videoAnalysisAssets: [{ assetId: 1, proxyPath: "/tmp/chapter.mp4" }],
      suggestionSummary: "- none",
    },
  };
}

describe("conversation system prompt", () => {
  it("explains source-window clip semantics and aggressive edit bias", () => {
    const prompt = buildConversationSystemPrompt(createInput());

    expect(prompt).toContain("inPoint/outPoint describe the kept source window");
    expect(prompt).toContain("range_suggestion is a keep-only shorthand");
    expect(prompt).toContain("Do not label the kept window as the removed material");
    expect(prompt).toContain(
      "description must describe what is inside the kept window or updated clip"
    );
    expect(prompt).toContain("Chapter clip order is inferred from source timing");
    expect(prompt).toContain("Use create_clip and update_clip only to define or revise source windows and metadata");
    expect(prompt).toContain("prefer drafting at least one concrete proposal instead of asking for clarification");
    expect(prompt).toContain("cut dead air, repeated explanation, reset loops, stalled tangents");
    expect(prompt).toContain("range_suggestion and update_clip can be grounded by transcript context");
  });
});
