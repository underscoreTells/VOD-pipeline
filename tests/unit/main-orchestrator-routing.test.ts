import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { shouldContinueChat } from "../../src/agent/graphs/main-orchestrator.js";

function createState(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    projectId: "1",
    chapters: [],
    chapterSummaries: {},
    chapterBeats: {},
    exports: undefined,
    selectedProvider: undefined,
    currentChapterId: undefined,
    proxyPath: undefined,
    transcript: undefined,
    suggestions: undefined,
    chapterContext: undefined,
    chapterAssetIds: [],
    chapterClips: [],
    selectedClipIds: [],
    playheadTime: undefined,
    detailedTranscripts: [],
    timelineActions: undefined,
    transcriptDetailRequests: undefined,
    assistantResponse: undefined,
    thinkingMarkdown: undefined,
    routingProposalContext: undefined,
    lastProposalContext: undefined,
    lastAnalyzedMessageIndex: undefined,
    ...overrides,
  } as any;
}

describe("main orchestrator routing", () => {
  it("keeps normal chapter discussion in grounded chat", () => {
    const route = shouldContinueChat(
      createState({
        currentChapterId: "12",
        chapterContext: {
          id: "12",
          title: "Boss fight",
          startTime: 0,
          endTime: 600,
        },
        messages: [new HumanMessage("What's the story arc of this chapter?")],
      })
    );

    expect(route).toBe("done");
  });

  it("routes explicit edit requests to timeline edit", () => {
    const route = shouldContinueChat(
      createState({
        currentChapterId: "12",
        chapterContext: {
          id: "12",
          title: "Boss fight",
          startTime: 0,
          endTime: 600,
        },
        messages: [new HumanMessage("Tighten the intro and cut the repeated dead air.")],
      })
    );

    expect(route).toBe("timeline_edit");
  });

  it("routes follow-up refinement requests only when suggestion context exists", () => {
    const route = shouldContinueChat(
      createState({
        currentChapterId: "12",
        chapterContext: {
          id: "12",
          title: "Boss fight",
          startTime: 0,
          endTime: 600,
        },
        routingProposalContext: true,
        messages: [new HumanMessage("Good start, make it more aggressive.")],
      })
    );

    expect(route).toBe("timeline_edit");
  });

  it("keeps follow-up wording in grounded chat when there is no proposal context", () => {
    const route = shouldContinueChat(
      createState({
        currentChapterId: "12",
        chapterContext: {
          id: "12",
          title: "Boss fight",
          startTime: 0,
          endTime: 600,
        },
        messages: [new HumanMessage("Good start, make it more aggressive.")],
      })
    );

    expect(route).toBe("done");
  });

  it("does not route payoff analysis questions to timeline edit just because proposal terms appear", () => {
    const route = shouldContinueChat(
      createState({
        currentChapterId: "12",
        chapterContext: {
          id: "12",
          title: "Boss fight",
          startTime: 0,
          endTime: 600,
        },
        routingProposalContext: true,
        messages: [new HumanMessage("Why does the payoff land in this chapter?")],
      })
    );

    expect(route).toBe("done");
  });
});
