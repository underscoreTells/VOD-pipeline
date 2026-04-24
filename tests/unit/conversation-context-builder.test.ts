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
  it("explains timeline placement semantics for startTime and source windows", () => {
    const prompt = buildConversationSystemPrompt(createInput());

    expect(prompt).toContain("inPoint/outPoint describe the source window");
    expect(prompt).toContain("startTime describes timeline placement");
    expect(prompt).toContain("Clips do not need to be adjacent");
    expect(prompt).toContain("Set startTime intentionally whenever timeline placement matters");
    expect(prompt).toContain("Only change update_clip.startTime when you intend to move that clip");
  });
});
