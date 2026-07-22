import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { buildConversationSystemPrompt } from "../../src/agent/conversation/context-builder.js";
import type {
  ConversationClipContext,
  ConversationTurnInput,
} from "../../src/agent/conversation/types.js";

function createInput(clips: ConversationClipContext[] = []): ConversationTurnInput {
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
      chapterClips: clips,
      transcript: "Transcript preview",
      detailedTranscripts: [],
      videoAnalysisAssets: [{ assetId: 1, proxyPath: "/tmp/chapter.mp4" }],
      suggestionSummary: "- none",
    },
  };
}

function buildClip(
  overrides: Partial<ConversationClipContext> & { id: number }
): ConversationClipContext {
  return {
    assetId: 1,
    trackIndex: 0,
    inPoint: 0,
    outPoint: 10,
    role: "setup",
    description: null,
    isEssential: false,
    ...overrides,
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
    expect(prompt).toContain("delete_clip for committed clip removal, and split_clip for an atomic division");
    expect(prompt).toContain("prefer drafting at least one concrete proposal instead of asking for clarification");
    expect(prompt).toContain("cut dead air, repeated explanation, reset loops, stalled tangents");
    expect(prompt).toContain("range_suggestion and update_clip can be grounded by transcript context");
  });

  it("keeps the existing 18-line clip preview", () => {
    const clips = Array.from({ length: 25 }, (_, index) =>
      buildClip({
        id: index + 1,
        inPoint: index * 10,
        outPoint: index * 10 + 5,
        description: `Clip ${index + 1}`,
      })
    );
    const prompt = buildConversationSystemPrompt(createInput(clips));

    expect(prompt).toContain("Existing chapter clips (preview, first 18):");
    expect(prompt).toContain("clip#1 source=0.00-5.00");
    expect(prompt).toContain("clip#18 source=170.00-175.00");
    expect(prompt).not.toContain("clip#19 source=180.00-185.00");
  });

  it("includes the compact chapter cut summary with total/essential/retained/per-asset counts", () => {
    const clips = [
      buildClip({ id: 1, assetId: 2, inPoint: 0, outPoint: 50, isEssential: true }),
      buildClip({ id: 2, assetId: 2, inPoint: 60, outPoint: 100, isEssential: false }),
      buildClip({ id: 3, assetId: 5, inPoint: 110, outPoint: 160, isEssential: true }),
    ];
    const prompt = buildConversationSystemPrompt(createInput(clips));

    expect(prompt).toContain("Chapter cut summary:");
    expect(prompt).toContain("- totalClips=3");
    expect(prompt).toContain("- essentialClips=2");
    expect(prompt).toContain("- retainedDuration=140.00s");
    expect(prompt).toContain("assetId=2 clips=2 retained=90.00s");
    expect(prompt).toContain("assetId=5 clips=1 retained=50.00s");
  });

  it("reports a - none per-asset line when the cut map is empty", () => {
    const prompt = buildConversationSystemPrompt(createInput([]));

    expect(prompt).toContain("- totalClips=0");
    expect(prompt).toContain("- essentialClips=0");
    expect(prompt).toContain("- retainedDuration=0.00s");
    expect(prompt).toContain("- perAsset=- none");
  });

  it("adds prompt rules requiring loadChapterCutMap for whole-chapter requests beyond the preview", () => {
    const prompt = buildConversationSystemPrompt(createInput());

    expect(prompt).toContain(
      'The "Existing chapter clips" preview above only shows the first 18 clips. For whole-chapter requests that need more than that preview'
    );
    expect(prompt).toContain("call loadChapterCutMap before drafting proposals");
    expect(prompt).toContain(
      "Use loadChapterCutMap to fetch a bounded, paginated, filterable view of the current chapter cut map"
    );
  });
});
