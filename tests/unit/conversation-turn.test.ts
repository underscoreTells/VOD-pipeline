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
      detailedTranscripts: [],
      proxyPath: "/tmp/chapter-proxy.mp4",
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
      focus: string
    ) => Promise<{ summary: string; observations: Array<{ note: string; in_point?: number; out_point?: number }> }>;
    loadDetailedTranscriptWindows?: (
      requests: TranscriptDetailRequest[]
    ) => Promise<DetailedTranscriptWindow[]>;
  } = {}
) {
  return {
    createModel: async () => new ScriptedToolModel(responses, overrides.onBind),
    analyzeChapterVideo: async (_input: ConversationTurnInput, focus: string) =>
      overrides.analyzeChapterVideo
        ? overrides.analyzeChapterVideo(focus)
        : {
            summary: `Observed video for: ${focus}`,
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
            new AIMessage("I drafted one clip proposal."),
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

  it("answers discussion requests directly without creating drafts", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("What is the story arc of this chapter?")],
      }),
      {},
      createDependencies([new AIMessage("The setup is clear, the middle loses momentum, and the payoff lands well.")])
    );

    expect(result.outcome).toBe("discussion");
    expect(result.assistantResponse).toContain("setup is clear");
    expect(result.suggestionDrafts).toBeUndefined();
    expect(result.timelineActions).toBeUndefined();
  });

  it("accepts range suggestion drafts from the proposal tool", async () => {
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
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "range_suggestion",
                    in_point: 12,
                    out_point: 24,
                    description: "Trim dead air",
                    reasoning: "Nothing new happens here.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage("I drafted one cut proposal for the slow patch in the middle."),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.suggestionDrafts).toHaveLength(1);
    expect(result.suggestionDrafts?.[0]).toMatchObject({
      in_point: 12,
      out_point: 24,
      description: "Trim dead air",
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
          new AIMessage("I checked the visuals and drafted one keep recommendation around the reveal."),
        ],
        {
          analyzeChapterVideo: async (focus) => {
            analyzeCalls.push(focus);
            return {
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

  it("can load detailed transcript windows before drafting timeline actions", async () => {
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
          new AIMessage("I drafted one timeline proposal after checking a precise transcript window around the payoff."),
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

  it("returns an immediate clarification for ambiguous requests", async () => {
    const result = await runConversationTurn(createInput({
      messages: [new HumanMessage("Make it tighter.")],
    }));

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("trim ranges");
  });

  it("repairs one prose-only proposal turn by forcing a structured draft", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Please provide new clips following your advice.")],
      }),
      {},
      createDependencies([
        new AIMessage("Add a setup clip and a payoff clip around the bug sequence."),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call_repaired",
              type: "tool_call",
              name: "draftRoughCutProposals",
              args: {
                proposals: [
                  {
                    type: "create_clip",
                    inPoint: 30,
                    outPoint: 60,
                    description: "TTS technical troubleshooting",
                    reasoning: "Restores the setup beat before the lag payoff.",
                  },
                ],
              },
            },
          ],
        }),
        new AIMessage("I drafted one new clip proposal for the missing setup beat."),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.timelineActions).toHaveLength(1);
    expect(result.assistantResponse).toContain("drafted one new clip proposal");
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
          ],
        }),
        new AIMessage("I recovered and drafted the clip proposal."),
      ])
    );

    expect(result.outcome).toBe("proposal");
    expect(result.timelineActions).toHaveLength(1);
    expect(result.assistantResponse).toContain("recovered");
  });

  it("fails when identical tool calls repeat without progress", async () => {
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
      createDependencies([repeatedCall, repeatedCall, repeatedCall])
    );

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("repeated tool call");
  });

  it("can end a proposal turn with requestClarification", async () => {
    const result = await runConversationTurn(
      createInput({
        messages: [new HumanMessage("Make this better.")],
        selectedClipIds: [4],
      }),
      {},
      createDependencies([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "clarify",
              type: "tool_call",
              name: "requestClarification",
              args: {
                question: "Do you want trim ranges, new clips, or story notes for this selected section?",
              },
            },
          ],
        }),
      ])
    );

    expect(result.outcome).toBe("clarification");
    expect(result.assistantResponse).toContain("trim ranges");
  });
});
