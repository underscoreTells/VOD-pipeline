import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import type { LLMProviderType } from "../../src/agent/providers/index.js";
import type {
  DetailedTranscriptWindow,
  TranscriptDetailRequest,
} from "../../src/shared/types/agent-ipc.js";
import { runConversationTurn } from "../../src/agent/conversation/runner.js";
import type { ConversationTurnInput } from "../../src/agent/conversation/types.js";

class ScriptedToolModel {
  private readonly responses: AIMessage[];
  private readonly onBind?: (tools: unknown[]) => void;

  constructor(responses: AIMessage[], onBind?: (tools: unknown[]) => void) {
    this.responses = [...responses];
    this.onBind = onBind;
  }

  bindTools(tools: unknown[]) {
    this.onBind?.(tools);
    return this;
  }

  async invoke() {
    const next = this.responses.shift();
    if (!next) {
      throw new Error("No scripted response remaining");
    }
    return next;
  }
}

function createInput(overrides: Partial<ConversationTurnInput> = {}): ConversationTurnInput {
  return {
    messages: [new HumanMessage("What should we cut here?")],
    selectedProvider: "openai",
    selectedClipIds: [],
    playheadTime: 42,
    context: {
      chapter: {
        id: "12",
        title: "Boss fight",
        startTime: 0,
        endTime: 600,
      },
      chapterAssetIds: [2],
      chapterClips: [],
      transcript: "[0.00-15.00] Setup lands cleanly. [15.00-45.00] Middle drifts.",
      detailedTranscripts: [{
        assetId: 2,
        windowStart: 0,
        windowEnd: 600,
        reason: 'Existing precise chapter transcript',
        text: 'Precise chapter transcript context',
        segments: [],
      }],
      videoAnalysisAssets: [{ assetId: 2, proxyPath: "/tmp/chapter-proxy.mp4" }],
      suggestionSummary: "- none",
    },
    ...overrides,
  };
}

function createDependencies(
  responses: AIMessage[],
  overrides: {
    onBind?: (tools: unknown[]) => void;
    analyzeChapterVideo?: (
      request: { focus: string; assetId?: number }
    ) => Promise<{
      assetId?: number;
      summary: string;
      observations: Array<{ note: string; in_point?: number; out_point?: number }>;
    }>;
    loadDetailedTranscriptWindows?: (
      requests: TranscriptDetailRequest[]
    ) => Promise<DetailedTranscriptWindow[]>;
  } = {}
) {
  return {
    createModel: async () => new ScriptedToolModel(responses, overrides.onBind),
    analyzeChapterVideo: async (_input: ConversationTurnInput, request: { focus: string; assetId?: number }) =>
      overrides.analyzeChapterVideo
        ? overrides.analyzeChapterVideo(request)
        : {
            assetId: request.assetId ?? 2,
            summary: `Observed video for: ${request.focus}`,
            observations: [{ in_point: 12, out_point: 18, note: "Visual confirmation" }],
          },
    loadDetailedTranscriptWindows: async (
      _input: ConversationTurnInput,
      requests: TranscriptDetailRequest[]
    ) =>
      overrides.loadDetailedTranscriptWindows
        ? overrides.loadDetailedTranscriptWindows(requests)
        : [
            {
              assetId: 2,
              windowStart: requests[0]?.windowStart ?? 10,
              windowEnd: requests[0]?.windowEnd ?? 40,
              reason: requests[0]?.reason,
              text: "Precise transcript window",
              segments: [
                { id: 1, start: 10, end: 14, text: "Precise line one" },
                { id: 2, start: 14, end: 18, text: "Precise line two" },
              ],
            },
          ],
  };
}

describe("conversation turn runner", () => {
  it.each([
    ["openai", "function"],
    ["openrouter", "function"],
    ["kimi", "function"],
    ["anthropic", "input_schema"],
    ["gemini", "functionDeclarations"],
  ] satisfies Array<[LLMProviderType, "function" | "input_schema" | "functionDeclarations"]>)(
    "binds provider-native tool payloads for %s",
    async (provider, expectedShape) => {
      let boundTools: unknown[] = [];

      const result = await runConversationTurn(
        createInput({
          selectedProvider: provider,
          messages: [new HumanMessage("Please provide new clips for this chapter.")],
        }),
        {},
        createDependencies(
          [
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "tool_call",
                  name: "analyzeChapterVideo",
                  args: {
                    focus: "Verify the strongest setup beat before drafting a clip.",
                  },
                },
              ],
            }),
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call_2",
                  type: "tool_call",
                  name: "draftRoughCutProposals",
                  args: {
                    proposals: [
                      {
                        type: "create_clip",
                        inPoint: 18,
                        outPoint: 32,
                        description: "Keep the setup beat",
                      },
                    ],
                  },
                },
              ],
            }),
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call_3",
                  type: "tool_call",
                  name: "finalizeConversationTurn",
                  args: {
                    outcome: "proposal",
                    assistantResponse: "I drafted one clip proposal for the strongest setup beat.",
                  },
                },
              ],
            }),
          ],
          {
            onBind: (tools) => {
              boundTools = tools;
            },
          }
        )
      );

      expect(result.outcome).toBe("proposal");
      expect(result.timelineActions).toHaveLength(1);
      expect(boundTools.length).toBeGreaterThan(0);

      const serialized = JSON.stringify(boundTools);
      if (expectedShape === "function") {
        expect(boundTools[0]).toMatchObject({
          type: "function",
          function: {
            name: "analyzeChapterVideo",
          },
        });
      } else if (expectedShape === "input_schema") {
        expect(boundTools[0]).toMatchObject({
          name: "analyzeChapterVideo",
        });
        expect(boundTools[0]).toHaveProperty("input_schema");
      } else {
        expect(boundTools[0]).toMatchObject({
          functionDeclarations: expect.any(Array),
        });
      }

      if (provider === "gemini") {
        expect(serialized).not.toContain("\"const\"");
        expect(serialized).not.toContain("\"exclusiveMinimum\"");
        expect(serialized).not.toContain("\"oneOf\"");
      }
    }
  );

  it("finalizes discussion turns without drafting proposals", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("What is the story arc of this chapter?")],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "final_discussion",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "discussion",
                assistantResponse:
                  "The setup is clear, the middle loses momentum, and the payoff lands well.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("discussion");
    expect(result.assistantResponse).toContain("setup is clear");
    expect(result.suggestionDrafts).toBeUndefined();
    expect(result.timelineActions).toBeUndefined();
  });

  it("requires draftRoughCutProposals before finalizing a proposal turn", async () => {
    const result = await runConversationTurn(
      createInput(),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "tool_call",
              name: "analyzeChapterVideo",
              args: {
                focus: "Check whether the slow middle section has any visual payoff worth keeping.",
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_2",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "range_suggestion",
                    in_point: 12,
                    out_point: 24,
                    description: "Keep the reaction after the pause",
                    reasoning: "Nothing new happens here.",
                  },
                ],
              },
            },
            {
              id: "call_3",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse: "I drafted one cut proposal for the slow patch in the middle.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.suggestionDrafts).toHaveLength(1);
    expect(result.suggestionDrafts?.[0]).toMatchObject({
      in_point: 12,
      out_point: 24,
      description: "Keep the reaction after the pause",
    });
  });

  it("can gather video evidence before drafting proposals", async () => {
    const analyzeCalls: string[] = [];
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Watch the chapter and tell me what should stay.")],
      }),
      {},
      createDependencies(
        [
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "call_video",
                type: "tool_call",
                name: "analyzeChapterVideo",
                args: { focus: "Verify whether the visual reveal is worth keeping." },
              },
            ],
          }),
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "call_suggestions",
                type: "tool_call",
                name: "draftRoughCutProposals",
                args: {
                  proposals: [
                    {
                      type: "range_suggestion",
                      in_point: 95,
                      out_point: 118,
                      description: "Keep the reveal",
                      reasoning: "It lands both visually and narratively.",
                    },
                  ],
                },
              },
            ],
          }),
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "call_finalize",
                type: "tool_call",
                name: "finalizeConversationTurn",
                args: {
                  outcome: "proposal",
                  assistantResponse:
                    "I checked the visuals and drafted one keep recommendation around the reveal.",
                },
              },
            ],
          }),
        ],
        {
          analyzeChapterVideo: async ({ focus }) => {
            analyzeCalls.push(focus);
            return {
              assetId: 2,
              summary: "The reveal is visually distinct and well-timed.",
              observations: [{ in_point: 95, out_point: 118, note: "Strong visual payoff" }],
            };
          },
        }
      )
    );

    expect(analyzeCalls).toHaveLength(1);
    expect(result.suggestionDrafts).toHaveLength(1);
    expect(result.suggestionDrafts?.[0]?.description).toBe("Keep the reveal");
  });

  it("requires assetId on analyzeChapterVideo when multiple grounded video assets are available", async () => {
    const result = await runConversationTurn(
      createInput({
        context: {
          ...createInput().context,
          chapterAssetIds: [2, 5],
          videoAnalysisAssets: [
            { assetId: 2, proxyPath: "/tmp/chapter-proxy-2.mp4" },
            { assetId: 5, proxyPath: "/tmp/chapter-proxy-5.mp4" },
          ],
        },
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_video",
              type: "tool_call",
              name: "analyzeChapterVideo",
              args: { focus: "Check which camera angle has the stronger reveal." },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_finalize",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "clarification",
                assistantResponse:
                  "I need you to specify which video asset to inspect before I can verify the footage.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("which video asset");
  });

  it("requires multi-asset create_clip proposals to stay on the grounded asset", async () => {
    const result = await runConversationTurn(
      createInput({
        context: {
          ...createInput().context,
          chapterAssetIds: [2, 5],
          videoAnalysisAssets: [
            { assetId: 2, proxyPath: "/tmp/chapter-proxy-2.mp4" },
            { assetId: 5, proxyPath: "/tmp/chapter-proxy-5.mp4" },
          ],
        },
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_video",
              type: "tool_call",
              name: "analyzeChapterVideo",
              args: {
                focus: "Inspect the reaction angle for the payoff.",
                assetId: 5,
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_proposal",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "create_clip",
                    assetId: 2,
                    inPoint: 118,
                    outPoint: 140,
                    description: "Reaction payoff clip",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_finalize",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "clarification",
                assistantResponse:
                  "I only verified asset 5, so I need matching video evidence before drafting a clip from asset 2.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("clarification");
    expect(result.timelineActions).toBeUndefined();
    expect(result.assistantResponse).toContain("verified asset 5");
  });

  it("can load detailed transcript windows before drafting timeline actions without video evidence", async () => {
    let requestedWindows: TranscriptDetailRequest[] = [];

    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Tighten the dialogue, but keep the payoff wording exact.")],
      }),
      {},
      createDependencies(
        [
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "call_transcript",
                type: "tool_call",
                name: "loadDetailedTranscriptWindows",
                args: {
                  requests: [
                    {
                      windowStart: 110,
                      windowEnd: 150,
                      reason: "Need exact payoff wording before trimming the lead-in.",
                    },
                  ],
                },
              },
            ],
          }),
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "call_actions",
                type: "tool_call",
                name: "draftRoughCutProposals",
                args: {
                  proposals: [
                    {
                      type: "create_clip",
                      inPoint: 118,
                      outPoint: 140,
                      description: "Condensed payoff clip",
                      reasoning: "Preserves the exact phrasing while trimming the lead-in.",
                    },
                  ],
                },
              },
            ],
          }),
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "call_finalize",
                type: "tool_call",
                name: "finalizeConversationTurn",
                args: {
                  outcome: "proposal",
                  assistantResponse:
                    "I drafted one timeline proposal after checking a precise transcript window around the payoff.",
                },
              },
            ],
          }),
        ],
        {
          loadDetailedTranscriptWindows: async (requests) => {
            requestedWindows = requests;
            return [
              {
                assetId: 2,
                windowStart: 110,
                windowEnd: 150,
                reason: requests[0]?.reason,
                text: "Exact payoff wording appears here.",
                segments: [{ id: 1, start: 118, end: 125, text: "Exact payoff wording" }],
              },
            ];
          },
        }
      )
    );

    expect(requestedWindows).toHaveLength(1);
    expect(result.timelineActions).toHaveLength(1);
    expect(result.timelineActions?.[0]).toMatchObject({
      type: "create_clip",
      inPoint: 118,
      outPoint: 140,
    });
  });

  it("can draft a grounded trim suggestion for vague pacing requests", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Make it tighter.")],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_trim",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "range_suggestion",
                    in_point: 18,
                    out_point: 36,
                    description: "Keep the escalation after the slow reset",
                    reasoning: "The middle drifts and repeats information before the next escalation.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "final_trim",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse:
                  "I drafted one trim to cut the slow reset and keep the chapter moving.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.suggestionDrafts).toHaveLength(1);
    expect(result.suggestionDrafts?.[0]).toMatchObject({
      in_point: 18,
      out_point: 36,
      description: "Keep the escalation after the slow reset",
    });
  });

  it("allows selected-clip updates without video evidence when local context grounds the edit", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Make it tighter.")],
        selectedClipIds: [4],
        context: {
          ...createInput().context,
          chapterClips: [
            {
              id: 4,
              assetId: 2,
              trackIndex: 0,
              inPoint: 20,
              outPoint: 42,
              role: "setup",
              description: "Slow setup clip",
              isEssential: true,
            },
          ],
        },
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "update_clip",
                    clipId: 4,
                    updates: {
                      inPoint: 22,
                      outPoint: 37,
                    },
                    reasoning: "Tightens the selected beat without losing the setup.",
                  },
                ],
              },
            },
            {
              id: "call_finalize",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse: "I tightened the selected section with one targeted clip update.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.timelineActions).toHaveLength(1);
    expect(result.timelineActions?.[0]).toMatchObject({
      type: "update_clip",
      clipId: 4,
      updates: {
        inPoint: 22,
        outPoint: 37,
      },
    });
  });

  it("can draft a more engaging cut from transcript and playhead context without video evidence", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Make this more engaging.")],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_engagement_cut",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "range_suggestion",
                    in_point: 20,
                    out_point: 42,
                    description: "Keep the beat that resumes after the repeated explanation",
                    reasoning: "It repeats the setup without adding new stakes before the next beat.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "final_engagement_cut",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse:
                  "I drafted one cut to remove the repetitive explanation and sharpen the pacing.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.suggestionDrafts).toHaveLength(1);
    expect(result.suggestionDrafts?.[0]).toMatchObject({
      in_point: 20,
      out_point: 42,
      description: "Keep the beat that resumes after the repeated explanation",
    });
  });

  it("rejects removal-first range_suggestion descriptions and allows one repaired keep-window pass", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Cut the section where I'm just eating.")],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "bad_range_suggestion",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "range_suggestion",
                    in_point: 115,
                    out_point: 123,
                    description: "Cut the eating section",
                    reasoning: "This window skips the silent eating stretch and lands on the reaction.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "repaired_range_suggestion",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "range_suggestion",
                    in_point: 123,
                    out_point: 131,
                    description: "Keep the reaction after the eating beat",
                    reasoning: "This skips the silent eating stretch and lands on the reaction.",
                    supersedesSuggestionId: 17,
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "final_range_suggestion",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse:
                  "I drafted one kept window that skips the eating stretch and lands on the reaction.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.suggestionDrafts).toHaveLength(1);
    expect(result.suggestionDrafts?.[0]).toMatchObject({
      in_point: 123,
      out_point: 131,
      description: "Keep the reaction after the eating beat",
      supersedesSuggestionId: 17,
    });
  });

  it("rejects removal-first create_clip descriptions and accepts repaired kept-window wording", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Pull the payoff into its own clip.")],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "bad_create_clip",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "create_clip",
                    inPoint: 30,
                    outPoint: 48,
                    description: "Remove the pause before the payoff",
                    reasoning: "This clip should skip the pause and land on the payoff beat.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "repaired_create_clip",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "create_clip",
                    inPoint: 48,
                    outPoint: 64,
                    description: "Keep the payoff after the pause",
                    reasoning: "This clip skips the pause and starts on the payoff beat.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "final_create_clip",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse: "I drafted one new clip that starts on the payoff and skips the pause.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.timelineActions).toHaveLength(1);
    expect(result.timelineActions?.[0]).toMatchObject({
      type: "create_clip",
      inPoint: 48,
      outPoint: 64,
      description: "Keep the payoff after the pause",
    });
  });

  it("rejects removal-first update_clip descriptions and accepts repaired kept-window wording", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Tighten the selected setup.")],
        selectedClipIds: [4],
        context: {
          ...createInput().context,
          chapterClips: [
            {
              id: 4,
              assetId: 2,
              trackIndex: 0,
              inPoint: 20,
              outPoint: 42,
              role: "setup",
              description: "Loose setup clip",
              isEssential: true,
            },
          ],
        },
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "bad_update_clip",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "update_clip",
                    clipId: 4,
                    updates: {
                      inPoint: 22,
                      outPoint: 36,
                      description: "Trim the dead air",
                    },
                    reasoning: "This tighter clip skips the dead air before the setup lands.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "repaired_update_clip",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "update_clip",
                    clipId: 4,
                    updates: {
                      inPoint: 22,
                      outPoint: 36,
                      description: "Keep the tighter setup beat",
                    },
                    reasoning: "This skips the dead air before the setup lands.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "final_update_clip",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse: "I tightened the selected setup and removed the dead air before it lands.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.timelineActions).toHaveLength(1);
    expect(result.timelineActions?.[0]).toMatchObject({
      type: "update_clip",
      clipId: 4,
      updates: {
        inPoint: 22,
        outPoint: 36,
        description: "Keep the tighter setup beat",
      },
    });
  });

  it("rejects proposal finalization without drafts and allows one repair pass", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Please provide new clips following your advice.")],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "bad_finalize",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse: "I drafted a few ideas for you.",
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "repaired_finalize",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "clarification",
                assistantResponse:
                  "Do you want new clips, trim ranges, or specific updates to the current selection?",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("new clips");
    expect(result.timelineActions).toBeUndefined();
  });

  it("repairs one plain-text termination attempt, then fails closed if the model still skips the finalizer", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("What is the story arc of this chapter?")],
      }),
      {},
      createDependencies([
        new AIMessage("The setup is clear and the payoff lands."),
        new AIMessage("The middle is still the weakest section."),
      ])
    );

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("did not finalize correctly");
  });

  it("allows one unknown-tool repair before succeeding", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Please provide new clips following your advice.")],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "bad_tool",
              type: "tool_call",
              name: "draftTimelineActions",
              args: {},
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_video",
              type: "tool_call",
              name: "analyzeChapterVideo",
              args: {
                focus: "Verify the recovered setup beat visually before drafting a clip.",
              },
            },
          ],
        }),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_recovered",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "create_clip",
                    inPoint: 30,
                    outPoint: 60,
                    description: "Recovered setup clip",
                  },
                ],
              },
            },
            {
              id: "call_finalize",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "proposal",
                assistantResponse: "I recovered and drafted the clip proposal.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.timelineActions).toHaveLength(1);
    expect(result.assistantResponse).toContain("recovered");
  });

  it("still terminates safely after repeated identical tool calls", async () => {
    const repeatedCall = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call_repeat",
          type: "tool_call",
          name: "loadDetailedTranscriptWindows",
          args: {
            requests: [
              {
                windowStart: 40,
                windowEnd: 60,
              },
            ],
          },
        },
      ],
    });

    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Please provide new clips following your advice.")],
      }),
      {},
      createDependencies([
        repeatedCall,
        repeatedCall,
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "final_after_repeat",
              type: "tool_call",
              name: "finalizeConversationTurn",
              args: {
                outcome: "clarification",
                assistantResponse:
                  "I need a narrower target before I can keep requesting the same transcript window.",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("narrower target");
  });

  it("continues past eight loop iterations when the model keeps making forward progress", async () => {
    const transcriptCalls: TranscriptDetailRequest[] = [];
    const scriptedResponses = Array.from({ length: 9 }, (_, index) =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: `call_transcript_${index + 1}`,
            type: "tool_call",
            name: "loadDetailedTranscriptWindows",
            args: {
              requests: [
                {
                  windowStart: index * 5,
                  windowEnd: index * 5 + 4,
                  reason: `Request ${index + 1}`,
                },
              ],
            },
          },
        ],
      })
    );

    scriptedResponses.push(
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_finalize_many_steps",
            type: "tool_call",
            name: "finalizeConversationTurn",
            args: {
              outcome: "discussion",
              assistantResponse: "I completed the turn after several evidence passes.",
            },
          },
        ],
      })
    );

    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Keep iterating until you've reviewed every exact line.")],
      }),
      {},
      createDependencies(scriptedResponses, {
        loadDetailedTranscriptWindows: async (requests) => {
          transcriptCalls.push(...requests);
          return [
            {
              assetId: 2,
              windowStart: requests[0]?.windowStart ?? 0,
              windowEnd: requests[0]?.windowEnd ?? 1,
              reason: requests[0]?.reason,
              text: "Detailed transcript window",
              segments: [{ id: 1, start: 0, end: 1, text: "line" }],
            },
          ];
        },
      })
    );

    expect(result.outcome).toBe("discussion");
    expect(result.assistantResponse).toContain("several evidence passes");
    expect(transcriptCalls).toHaveLength(9);
  });

  it("fails closed after a generous number of distinct tool steps without finalizing", async () => {
    const transcriptCalls: TranscriptDetailRequest[] = [];
    const scriptedResponses = Array.from({ length: 30 }, (_, index) =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: `call_transcript_limit_${index + 1}`,
            type: "tool_call",
            name: "loadDetailedTranscriptWindows",
            args: {
              requests: [
                {
                  windowStart: index * 3,
                  windowEnd: index * 3 + 2,
                  reason: `Limit request ${index + 1}`,
                },
              ],
            },
          },
        ],
      })
    );

    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Keep iterating until you are completely certain.")],
      }),
      {},
      createDependencies(scriptedResponses, {
        loadDetailedTranscriptWindows: async (requests) => {
          transcriptCalls.push(...requests);
          return [
            {
              assetId: 2,
              windowStart: requests[0]?.windowStart ?? 0,
              windowEnd: requests[0]?.windowEnd ?? 1,
              reason: requests[0]?.reason,
              text: "Detailed transcript window",
              segments: [{ id: 1, start: 0, end: 1, text: "line" }],
            },
          ];
        },
      })
    );

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("internal tool-step limit");
    expect(transcriptCalls.length).toBeGreaterThan(8);
    expect(transcriptCalls.length).toBeLessThan(scriptedResponses.length);
  });
});
